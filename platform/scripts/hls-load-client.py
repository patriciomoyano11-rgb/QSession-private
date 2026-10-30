"""Bounded HTTP HLS probe, not decoded playback. Never joins LiveKit.

Ubuntu Python + aiohttp. Final JSON goes to stdout, optional progress to stderr.
"""
import argparse
import asyncio
import collections
import concurrent.futures
import hashlib
import importlib.metadata
import json
import http.client
import math
import os
import pathlib
import platform
import random
import re
import socket
import ssl
import stat
import sys
import time
import threading
import urllib.parse
import urllib.request
import urllib.error

try:
    import resource
except ImportError:  # Allow stdlib parser tests on Windows.
    resource = None

PREFIX = '/live/PRB10A-hWrdBkirH_2yHmZ9lp/'
# Populated only after an explicit staging host is accepted. There is no
# production default: a missing or production host must fail before any request.
HOST = None
URL = None
# One-client pilots may name these. The load command line never does.
KNOWN_CANARY_HOSTS = frozenset({
    'live.qsession.org',
    'qsession-live.patriciomoyano11.workers.dev',
})


def require_staging_delivery_host(host):
    """Refuse production playback names. Safe to copy onto a load generator.

    The body uses only its arguments and the stdlib so the orchestrator can
    paste this function into the remote controller. The uploaded client is a
    single file and must not import a sibling module.
    """
    import re as _re
    if type(host) is not str:
        raise ValueError('A staging delivery host is required')
    normalized = host.strip().lower().rstrip('.')
    if not _re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', normalized):
        raise ValueError('A staging delivery host is required')
    production = {
        'live.qsession.org',
        'www.qsession.org',
        'qsession.org',
        'media.qsession.org',
        'qsession-live.patriciomoyano11.workers.dev',
    }
    if normalized in production or normalized.endswith('.qsession.org'):
        raise ValueError('Production delivery hosts are refused; pass a staging hostname')
    labels = normalized.split('.')
    if not any(label == 'staging' or label.startswith('staging-')
               or label.endswith('-staging') or '-staging-' in label for label in labels):
        raise ValueError('Staging delivery host must include a staging DNS label')
    return normalized
SEGMENT_SECONDS = 6
RECENT_MEDIA_SECONDS = 12
STALL_SECONDS = 18
MEDIA_FAILURE_CODES = frozenset(('storage-read', 'storage-body-read', 'storage-size',
    'storage-incomplete', 'object-queue', 'read-queue', 'shared-overloaded', 'shared-retryable',
    'shared-response', 'shared-metadata', 'shared-request', 'edge-fill', 'edge-stream',
    'shared-stream', 'stream-cancelled', 'edge-fill-timeout', 'edge-fill-queue',
    'edge-not-retained', 'edge-read-queue', 'edge-cache-unavailable', 'edge-body-budget', 'edge-body-readers'))
CACHE_FILL_VALUES = frozenset(('stored', 'failed', 'pending', 'not-retained', 'shared', 'shared-edge', 'r2-edge'))
CACHE_PHASE_VALUES = frozenset(('miss', 'readError', 'putReject', 'verifyInvalid'))
CACHE_RECOVERY_VALUES = frozenset(('verified-body',))
ADMISSION_PHASE_VALUES = frozenset(('pending-limit', 'backoff', 'cache', 'backend', 'token-expired'))
ADMISSION_ATTEMPT_VALUES = frozenset(('0', '1', '2'))
ADMISSION_FAILURE_CODES = frozenset(('backend-timeout', 'backend-request', 'backend-network',
    'backend-tls', 'backend-dns', 'backend-invocation', 'backend-json', 'backend-redirect',
    'backend-response-size', 'backend-response-shape', 'edge-pending-limit'))
RESPONSE_DIAGNOSTIC_HEADERS = (
    ('mediaFailure', 'X-QSession-Media-Failure', MEDIA_FAILURE_CODES),
    ('cacheFill', 'X-QSession-Cache-Fill', CACHE_FILL_VALUES),
    ('cachePhase', 'X-QSession-Cache-Phase', CACHE_PHASE_VALUES),
    ('cacheRecovery', 'X-QSession-Cache-Recovery', CACHE_RECOVERY_VALUES),
    ('admissionPhase', 'X-QSession-Admission-Phase', ADMISSION_PHASE_VALUES),
    ('admissionAttempts', 'X-QSession-Admission-Attempts', ADMISSION_ATTEMPT_VALUES))
STDLIB_TLS_CONTEXT = ssl.create_default_context()
STDLIB_TLS_CONTEXT.set_alpn_protocols(['http/1.1'])
STDLIB_TLS_CONTEXT.post_handshake_auth = True
STDLIB_CONNECTIONS = threading.local()
STDLIB_OPEN_CONNECTIONS = set()
STDLIB_CONNECTION_LOCK = threading.Lock()
STDLIB_HTTP_WORKERS = 96


def configure_delivery_host(host, *, allow_known_canary=False):
    """Select a staging playback host. Load CLIs cannot opt into production.

    ``allow_known_canary`` exists for the one-client PRB10A pilot. The load
    client command line never sets it.
    """
    if allow_known_canary and host in KNOWN_CANARY_HOSTS:
        selected = host
    else:
        selected = require_staging_delivery_host(host)
    global HOST, URL
    HOST = selected
    URL = 'https://' + HOST + PREFIX + 'index.m3u8'


def close_stdlib_connections():
    with STDLIB_CONNECTION_LOCK:
        connections=list(STDLIB_OPEN_CONNECTIONS)
        STDLIB_OPEN_CONNECTIONS.clear()
    for connection in connections:
        connection.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class StdlibResponse:
    def __init__(self, status, headers, body, queue_seconds=0, network_seconds=0):
        self.status, self.headers, self.body = status, headers, body
        self.content = self
        self.transportQueueSeconds, self.transportNetworkSeconds = queue_seconds, network_seconds

    async def read(self, maximum):
        return self.body[:maximum]

    async def iter_chunked(self, size):
        for offset in range(0,len(self.body),size):
            yield self.body[offset:offset+size]


class StdlibRequest:
    def __init__(self,url,headers,timeout):
        self.url,self.headers,self.timeout=url,headers,timeout
        self.enqueued_at = self.fetch_started_at = None

    def fetch(self):
        self.fetch_started_at = time.monotonic()
        queued = max(0, self.fetch_started_at-(self.enqueued_at or self.fetch_started_at))
        url=urllib.parse.urlsplit(self.url)
        origin=(url.scheme,url.hostname,url.port)
        pool=getattr(STDLIB_CONNECTIONS,'pool',None)
        if pool is None:
            pool={};STDLIB_CONNECTIONS.pool=pool
        connection=pool.get(origin)
        if connection is None:
            connection=(http.client.HTTPSConnection(url.hostname,url.port,timeout=self.timeout,context=STDLIB_TLS_CONTEXT)
                        if url.scheme=='https' else http.client.HTTPConnection(url.hostname,url.port,timeout=self.timeout))
            pool[origin]=connection
            with STDLIB_CONNECTION_LOCK:STDLIB_OPEN_CONNECTIONS.add(connection)
        connection.timeout=self.timeout
        if connection.sock:connection.sock.settimeout(self.timeout)
        try:
            connection.request('GET',url.path+('?' + url.query if url.query else ''),headers=self.headers)
            with connection.getresponse() as response:
                maximum=65536 if url.path.endswith('.m3u8') else 3000000
                body=response.read(maximum+1)
                if len(body)>maximum:raise ValueError('Oversize response')
                return StdlibResponse(response.status,response.headers,body,queued,time.monotonic()-self.fetch_started_at)
        except (OSError,http.client.HTTPException,ValueError) as error:
            connection.close();pool.pop(origin,None)
            with STDLIB_CONNECTION_LOCK:STDLIB_OPEN_CONNECTIONS.discard(connection)
            if isinstance(error,http.client.HTTPException):raise urllib.error.URLError('HTTP transport failure') from None
            raise

    async def __aenter__(self):
        self.enqueued_at = time.monotonic()
        return await asyncio.wait_for(asyncio.to_thread(self.fetch),timeout=self.timeout)

    async def __aexit__(self,*_args):
        return False


class StdlibSession:
    def __init__(self,headers):self.headers=headers
    async def __aenter__(self):return self
    async def __aexit__(self,*_args):
        close_stdlib_connections()
        return False
    def get(self,url,allow_redirects,timeout):
        if allow_redirects:raise ValueError('Redirects must remain disabled')
        return StdlibRequest(url,self.headers,timeout.total)


class Http2Response:
    def __init__(self, response):
        self.response, self.status = response, response.status_code
        self.headers, self.content = response.headers, self
        self.http_version = response.http_version

    async def read(self, maximum):
        async for chunk in self.response.aiter_bytes(chunk_size=maximum):
            return chunk
        return b''

    def iter_chunked(self, size):
        return self.response.aiter_bytes(chunk_size=size)


class Http2Request:
    def __init__(self, context): self.context = context
    async def __aenter__(self): return Http2Response(await self.context.__aenter__())
    async def __aexit__(self, *args): return await self.context.__aexit__(*args)


class Http2Session:
    """Diagnostic protocol comparison: 16 independent HTTP/2 pools per worker.

    This does not claim one TCP connection per listener. Admission leases remain
    distinct; TLS validation and the same whole-request deadline stay enabled.
    """
    def __init__(self, headers):
        import httpx
        self.clients = [httpx.AsyncClient(http2=True, http1=False, trust_env=False,
            headers=headers, limits=httpx.Limits(max_connections=2, max_keepalive_connections=2))
            for _ in range(16)]

    async def __aenter__(self): return self
    async def __aexit__(self, *_args):
        await asyncio.gather(*(client.aclose() for client in self.clients))
        return False

    def get(self, url, allow_redirects, timeout):
        if allow_redirects: raise ValueError('Redirects must remain disabled')
        # Stable within this process, without retaining another copy of a token.
        index = hash(urllib.parse.urlsplit(url).query) % len(self.clients)
        return Http2Request(self.clients[index].stream('GET', url,
            follow_redirects=False, timeout=timeout.total))


def parse_manifest(manifest, expected_token=None):
    lines = [line.strip() for line in manifest.splitlines() if line.strip()]
    if not lines or lines[0] != '#EXTM3U' or len(lines) > 80:
        raise ValueError('Invalid bounded media manifest')
    sequence, target, duration = None, None, None
    segments, ended = [], False
    for line in lines[1:]:
        if line.startswith('#EXT-X-MEDIA-SEQUENCE:'):
            if sequence is not None:
                raise ValueError('Duplicate media sequence')
            sequence = int(line.split(':', 1)[1])
            if sequence < 0:
                raise ValueError('Negative media sequence')
        elif line.startswith('#EXT-X-TARGETDURATION:'):
            target = int(line.split(':', 1)[1])
        elif line.startswith('#EXTINF:'):
            if duration is not None:
                raise ValueError('Missing segment URI')
            duration = float(line.split(':', 1)[1].split(',', 1)[0])
            if not math.isfinite(duration) or not 5.5 <= duration <= 6.5:
                raise ValueError('Unexpected segment duration')
        elif line == '#EXT-X-ENDLIST':
            ended = True
        elif line.startswith(('#EXT-X-KEY:', '#EXT-X-MAP:', '#EXT-X-STREAM-INF:')):
            raise ValueError('Unexpected external media reference')
        elif not line.startswith('#'):
            url = urllib.parse.urljoin(URL, line)
            parsed = urllib.parse.urlsplit(url)
            filename = parsed.path.removeprefix(PREFIX)
            query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True,
                                          strict_parsing=True, max_num_fields=2)
            permitted_query = [('qsat', expected_token)] if expected_token else []
            if (parsed.scheme != 'https' or parsed.hostname != HOST or parsed.port not in (None, 443)
                    or parsed.username or parsed.password or query != permitted_query or parsed.fragment
                    or not parsed.path.startswith(PREFIX)
                    or not re.fullmatch(r'segment_load_[a-f0-9]{16}_[0-9]{5}\.ts', filename)):
                raise ValueError('Manifest escaped the isolated load signal')
            if sequence is None or duration is None:
                raise ValueError('Missing sequence or EXTINF')
            if int(filename.rsplit('_', 1)[-1][:-3]) != sequence + len(segments):
                raise ValueError('Segment name and media sequence disagree')
            segments.append({'sequence': sequence + len(segments), 'url': url, 'duration': duration})
            duration = None
    if not segments or len(segments) > 5 or duration is not None or target != SEGMENT_SECONDS:
        raise ValueError('Unexpected rolling media window')
    return {'segments': segments, 'ended': ended}


def segment_urls(manifest, expected_token=None):
    return [segment['url'] for segment in parse_manifest(manifest, expected_token)['segments']]


def read_tokens(path, count):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != 0 or info.st_size > 8000000:
            raise ValueError('Lease file must be a bounded root-owned private file')
        tokens = json.load(source)
    if (not isinstance(tokens, list) or len(tokens) != count
            or any(not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{20,4096}', token) for token in tokens)
            or len(set(tokens)) != count):
        raise ValueError('Provide one distinct lease token per requested client')
    return tokens


def percentiles(values):
    ordered = sorted(values)
    return {str(p): ordered[min(len(ordered)-1, int((len(ordered)-1)*p/100))] if ordered else None
            for p in (50, 95, 99)}


def runtime_versions():
    versions = {'python':platform.python_version(), 'implementation':platform.python_implementation(),
                'openssl':ssl.OPENSSL_VERSION}
    for package in ('aiohttp', 'httpx', 'h2'):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return versions


def run_provenance(args):
    # Explicit fields only: neither token values nor the lease file path is hashed or copied.
    configuration = {'clients':args.clients, 'rampSeconds':args.ramp, 'holdSeconds':args.hold,
        'reconnectAfterSeconds':getattr(args, 'reconnect_after', 0),
        'httpTransport':getattr(args, 'transport', 'aiohttp'), 'deliveryHost':HOST,
        'startAtUnix':args.start_at_unix, 'requestDeadlineSeconds':8, 'connectDeadlineSeconds':5,
        'recentMediaWindowSeconds':RECENT_MEDIA_SECONDS, 'stallSeconds':STALL_SECONDS}
    return {'clientSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
        'configurationSha256':hashlib.sha256(json.dumps(configuration, sort_keys=True,
            separators=(',', ':'), allow_nan=False).encode()).hexdigest(),
        'configuration':configuration, 'runtime':runtime_versions()}


class TransportTimings:
    """Bounded timing summaries; keep full counts/maxima and the latest 2048 timings.

    Percentiles describe the retained observations, never all requests in a long run.
    No trace parameter, exception message, header, host or URL is retained.
    """
    def __init__(self):
        self.values = collections.defaultdict(lambda: collections.deque(maxlen=2048))
        self.counts, self.sums, self.maxima = collections.Counter(), collections.Counter(), {}

    def observe(self, name, seconds):
        if not math.isfinite(seconds) or seconds < 0:
            return
        milliseconds = round(seconds*1000, 3)
        self.values[name].append(milliseconds)
        self.counts[name] += 1
        self.sums[name] += milliseconds
        self.maxima[name] = max(self.maxima.get(name, 0), milliseconds)

    def report(self):
        return {'percentileScope':'most-recent-2048-observations-per-phase',
            'phases':{name:{'observations':self.counts[name], 'retainedObservations':len(values),
                'meanMilliseconds':round(self.sums[name]/self.counts[name], 3),
                'maximumMilliseconds':self.maxima[name], 'percentileMilliseconds':percentiles(values)}
                for name, values in self.values.items()}}


class RequestTiming:
    """Observed client intervals, including scheduler delay; not server timings."""
    def __init__(self, started):
        self.started = started
        self.pending, self.durations = {}, {}
        self.headers_at = self.first_body_at = self.headers_sent_at = None
        self.connection_reused = False

    def begin(self, phase, now):
        self.pending[phase] = now

    def end(self, phase, now):
        began = self.pending.pop(phase, None)
        if began is not None:
            self.durations[phase] = self.durations.get(phase, 0)+max(0, now-began)

    def snapshot(self, now, body_complete=False):
        durations = dict(self.durations)
        if self.headers_at is not None:
            durations['requestToResponseHeaders'] = max(0, self.headers_at-self.started)
            if self.headers_sent_at is not None:
                durations['sentHeadersToResponseHeaders'] = max(0, self.headers_at-self.headers_sent_at)
            if self.first_body_at is not None:
                durations['headersToFirstBodyChunk'] = max(0, self.first_body_at-self.headers_at)
            if body_complete:
                durations['headersToBodyComplete'] = max(0, now-self.headers_at)
                if self.first_body_at is not None:
                    durations['firstBodyChunkToBodyComplete'] = max(0, now-self.first_body_at)
        return {'observedMilliseconds':{name:round(value*1000, 3) for name, value in durations.items()},
            'incompletePhases':sorted(self.pending), 'connectionReused':self.connection_reused,
            'bodyComplete':body_complete}


def aiohttp_trace_config(aiohttp):
    """Use public aiohttp trace signals only. TLS has no separate public signal."""
    if not hasattr(aiohttp, 'TraceConfig'):
        return None, []
    trace, supported = aiohttp.TraceConfig(), []
    for signal, phase, action in (
            ('on_connection_queued_start', 'connectorQueue', 'begin'),
            ('on_connection_queued_end', 'connectorQueue', 'end'),
            ('on_dns_resolvehost_start', 'dnsResolution', 'begin'),
            ('on_dns_resolvehost_end', 'dnsResolution', 'end'),
            ('on_connection_create_start', 'connectionCreateIncludingDnsTcpTls', 'begin'),
            ('on_connection_create_end', 'connectionCreateIncludingDnsTcpTls', 'end'),
            ('on_connection_reuseconn', None, 'reuse'),
            ('on_request_headers_sent', None, 'headersSent')):
        event = getattr(trace, signal, None)
        if event is None:
            continue
        supported.append(signal)
        async def callback(_session, context, _params, phase=phase, action=action):
            timing = getattr(context, 'trace_request_ctx', None)
            if not isinstance(timing, RequestTiming):
                return
            now = time.monotonic()
            if action == 'reuse':
                timing.connection_reused = True
            elif action == 'headersSent':
                timing.headers_sent_at = now
            else:
                getattr(timing, action)(phase, now)
        event.append(callback)
    return trace, supported


def cgroup_metrics():
    """Resolve the process's full v2 hierarchy before interpreting CPU quota.

    cpu.max does not apply to the actual hierarchy root. Its absence is evidence
    of unlimited root bandwidth only with verified membership, a full-root v2
    mount, the CPU controller and readable CPU accounting. A delegated mount or
    inaccessible/missing non-root file cannot prove the ancestor quota.
    """
    result = {'cpuQuotaObserved':False}
    stage = 'membership'
    def read(path):
        value = path.read_text()
        if len(value) > 1048576:
            raise ValueError('Oversize cgroup metadata')
        return value
    def absolute(value):
        value = re.sub(r'\\(040|011|012|134)', lambda match:chr(int(match[1], 8)), value)
        path = pathlib.PurePosixPath(value)
        if not path.is_absolute() or '..' in path.parts or '\x00' in value:
            raise ValueError('Invalid cgroup hierarchy path')
        return path
    def cpu_stat(directory):
        counters = {}
        for line in read(directory/'cpu.stat').splitlines():
            name, value = line.split()
            count = int(value)
            if count < 0:
                raise ValueError('Negative CPU accounting counter')
            counters[name] = count
        if not {'usage_usec', 'user_usec', 'system_usec'} <= counters.keys():
            raise ValueError('CPU accounting is incomplete')
        return counters
    try:
        membership = [line.split(':', 2)[2] for line in read(pathlib.Path('/proc/self/cgroup')).splitlines()
                      if line.startswith('0::')]
        if len(membership) != 1:
            raise ValueError('Unified cgroup membership is ambiguous')
        group = absolute(membership[0])
        stage = 'mount'
        mounts = []
        for line in read(pathlib.Path('/proc/self/mountinfo')).splitlines():
            before, separator, after = line.partition(' - ')
            fields = before.split()
            filesystem = after.split()
            if separator and filesystem and filesystem[0] == 'cgroup2' and len(fields) >= 6:
                mounts.append((absolute(fields[3]), absolute(fields[4])))
        if len(mounts) != 1 or mounts[0][0] != pathlib.PurePosixPath('/'):
            raise ValueError('The full CPU cgroup ancestry is not visible')
        root = pathlib.Path(str(mounts[0][1]))
        current = root.joinpath(*group.parts[1:])
        result['cgroupV2FullRootMountVerified'] = True
        stage = 'controller'
        if 'cpu' not in read(root/'cgroup.controllers').split():
            raise ValueError('CPU controller is not observable')
        result['cpuControllerAvailable'] = True
        stage = 'stat'
        counters = cpu_stat(current)
        for name, key in (('nr_periods','cpuQuotaPeriods'), ('nr_throttled','cpuThrottledPeriods'),
                          ('throttled_usec','cpuThrottledMicroseconds')):
            if name in counters:
                result[key] = counters[name]
        stage = 'quota'
        quotas, levels = [], 0
        directory = current
        while True:
            if levels >= 256:
                raise ValueError('CPU cgroup ancestry exceeds bounded inspection')
            levels += 1
            try:
                value = read(directory/'cpu.max').split()
            except FileNotFoundError:
                if directory != root:
                    raise ValueError('A non-root CPU quota is not observable') from None
                entries = {entry.name for entry in root.iterdir()}
                if 'cpu.max' in entries or not {'cpu.stat', 'cgroup.controllers'} <= entries:
                    raise ValueError('Root CPU quota absence could not be verified') from None
                cpu_stat(root)
                result['cpuRootQuotaNotApplicable'] = True
            else:
                if len(value) != 2 or int(value[1]) <= 0:
                    raise ValueError('Invalid CPU quota')
                if value[0] != 'max':
                    quota = int(value[0])
                    if quota <= 0:
                        raise ValueError('Invalid CPU bandwidth allocation')
                    quotas.append(quota/int(value[1]))
            if directory == root:
                break
            directory = directory.parent
        result.update(cpuQuotaObserved=True, cpuQuotaCores=min(quotas) if quotas else None,
                      cpuQuotaAncestorLevelsObserved=levels,
                      cpuQuotaSource='cgroup-v2-full-hierarchy')
    except (OSError, ValueError):
        result['cgroupMetricsUnavailable'] = True
        result['cpuQuotaUnobservableReason'] = stage
    return result


def stopped_at_test_deadline(error, remaining, deadline, now):
    """Only censor an HTTP timeout deliberately shortened by the test watchdog."""
    return isinstance(error, asyncio.TimeoutError) and remaining < 8 and now >= deadline - .01


def proc_metrics():
    """Linux counters. Reported link speed is not a provider throughput guarantee."""
    result = cgroup_metrics()
    result['logicalCpuCount'] = os.cpu_count()
    if hasattr(os, 'sched_getaffinity'):
        result['affinityCpuCount'] = len(os.sched_getaffinity(0))
    try:
        with open('/proc/stat') as source:
            ticks = [int(value) for value in source.readline().split()[1:9]]
        result.update(cpuTicks=sum(ticks), cpuIdleTicks=ticks[3]+ticks[4])
        result['cpuStealTicks'] = ticks[7]
        with open('/proc/meminfo') as source:
            memory = {line.split(':')[0]: int(line.split()[1]) for line in source}
        result['availableMemoryKiB'] = memory['MemAvailable']
        with open('/proc/self/status') as source:
            for line in source:
                if line.startswith('VmRSS:'):
                    result['rssKiB'] = int(line.split()[1])
        result['openFileDescriptors'] = len(os.listdir('/proc/self/fd'))
        with open('/proc/net/route') as source:
            interface = next(line.split()[0] for line in source if len(line.split()) > 2 and line.split()[1] == '00000000')
        with open('/proc/net/dev') as source:
            row = next(line.split(':', 1)[1].split() for line in source if line.split(':')[0].strip() == interface)
        result.update(interface=interface, rxBytes=int(row[0]), txBytes=int(row[8]),
                      rxErrors=int(row[2]), rxDropped=int(row[3]),
                      txErrors=int(row[10]), txDropped=int(row[11]))
        # Capture a before/after baseline as well as samples. Cumulative
        # post-test counters alone cannot attribute losses to this run.
        try:
            for file in ('/proc/net/snmp', '/proc/net/netstat'):
                with open(file) as source:
                    lines=source.read().splitlines()
                for index in range(0,len(lines)-1,2):
                    names,values=lines[index].split(),lines[index+1].split()
                    for name,value in zip(names[1:],values[1:]):
                        if name in {'OutSegs','RetransSegs','TCPTimeouts','TCPBacklogDrop','TCPSynRetrans'}:
                            result['tcp'+name]=int(value)
        except (OSError, ValueError, IndexError):
            result['tcpMetricsUnavailable']=True
        try:
            with open('/sys/class/net/' + interface + '/speed') as source:
                speed = int(source.read())
                if speed > 0:
                    result['reportedLinkSpeedMbps'] = speed
        except (OSError, ValueError):
            pass
    except (OSError, ValueError, StopIteration, KeyError, IndexError):
        result['metricsUnavailable'] = True
    return result


def response_diagnostic_markers(headers):
    """Retain fixed diagnostic values only, never arbitrary headers or stats."""
    markers = {}
    for field, header, allowed in RESPONSE_DIAGNOSTIC_HEADERS:
        value = headers.get(header, '')
        if value in allowed:
            markers[field] = value
    failure = headers.get('X-QSession-Admission-Failure', '')
    if failure in ADMISSION_FAILURE_CODES or re.fullmatch(r'backend-[1-5][0-9]{2}', failure):
        markers['admissionFailure'] = failure
    return markers


def record_response_diagnostics(stats, kind, headers):
    markers = response_diagnostic_markers(headers)
    if kind in ('manifest', 'segment'):
        for field, value in markers.items():
            # Admission failures keep their existing denial-only counter below.
            if field != 'admissionFailure':
                stats[kind+field[0].upper()+field[1:]+'_'+value] += 1
    return markers


def transport_failure_evidence(kind, response, received_bytes, exception_name):
    """Allowlisted correlation metadata only; never store URL, token or error text."""
    evidence = {'kind': kind if kind in ('manifest', 'segment') else 'unknown',
                'phase': 'after_headers' if response is not None else 'before_headers',
                'receivedBytes': received_bytes if isinstance(received_bytes, int) and 0 <= received_bytes <= 3000001 else None,
                'errorClass': exception_name if re.fullmatch(r'[A-Za-z]{1,64}', exception_name) else 'Other'}
    if response is not None:
        if isinstance(response.status, int) and 100 <= response.status <= 599:
            evidence['httpStatus'] = response.status
        headers = response.headers
        ray = headers.get('CF-Ray', '')
        if re.fullmatch(r'[a-fA-F0-9]{16}-[A-Z]{3}', ray):
            evidence['cloudflareRay'] = ray
        cache = headers.get('X-QSession-Edge-Cache', '')
        if cache in ('HIT', 'MISS'):
            evidence['edgeCache'] = cache
        manifest_failure = headers.get('X-QSession-Manifest-Failure', '')
        if manifest_failure in ('read', 'reference'):
            evidence['manifestFailure'] = manifest_failure
        evidence.update(response_diagnostic_markers(headers))
        length = headers.get('Content-Length', '')
        if re.fullmatch(r'\d{1,7}', length) and 0 <= int(length) <= 3000000:
            evidence['expectedBytes'] = int(length)
    return evidence


def validate_run_bounds(args):
    hold = args.hold
    reconnect = getattr(args, 'reconnect_after', 0)
    if (type(args.clients) is not int or not 1 <= args.clients <= 1250 or
            type(args.ramp) is not int or not 1 <= args.ramp <= 30 or
            type(hold) is not int or not 1 <= hold <= 620):
        raise ValueError('Test exceeds the bounded client or duration scope')
    if type(reconnect) is not int or (reconnect and not args.ramp < reconnect < args.ramp + hold - 18):
        raise ValueError('Reconnect must leave a complete recovery window')
    if reconnect and getattr(args, 'transport', 'aiohttp') != 'aiohttp':
        raise ValueError('Session restart probe requires aiohttp')


async def main(args):
    import aiohttp
    validate_run_bounds(args)
    provenance = run_provenance(args)
    tokens = read_tokens(args.tokens_file, args.clients) if args.tokens_file else None
    if resource:
        limit = resource.getrlimit(resource.RLIMIT_NOFILE)
        resource.setrlimit(resource.RLIMIT_NOFILE, (min(16384, limit[1]), limit[1]))
    if args.start_at_unix:
        wait = args.start_at_unix - time.time()
        if not 0 <= wait <= 180:
            raise ValueError('Coordinated start must be within the next 180 seconds')
        await asyncio.sleep(wait)
    stats, errors, statuses = collections.Counter(), collections.Counter(), collections.Counter()
    latencies, samples = collections.defaultdict(list), []
    transport_timings = TransportTimings()
    first_transport_failures, first_http_failures = [], []
    stop, stop_reason = asyncio.Event(), None
    started, start_wall, cpu_before = time.monotonic(), time.time(), time.process_time()
    duration = args.ramp + args.hold
    reconnect_after = getattr(args, 'reconnect_after', 0)
    reconnect_latencies = []
    deadline = started + duration
    network_before = proc_metrics()
    last_progress, active, finished = [0.0]*args.clients, [False]*args.clients, [None]*args.clients
    total_limit = args.clients*(math.ceil(duration/1.7)+math.ceil(duration/SEGMENT_SECONDS)+6)
    transport=getattr(args,'transport','aiohttp')
    transport_errors = (aiohttp.ClientError, asyncio.TimeoutError, urllib.error.URLError, OSError, ValueError)
    headers={'User-Agent':'QSessionAuthorizedSyntheticLoad/2.1','Origin':'https://qsession.org'}
    trace, trace_events = aiohttp_trace_config(aiohttp) if transport == 'aiohttp' else (None, [])
    def aiohttp_session(connector):
        # A new TraceConfig per session keeps aiohttp's frozen signal lifecycle local.
        config, _events = aiohttp_trace_config(aiohttp)
        options = {'trace_configs':[config]} if config is not None else {}
        return aiohttp.ClientSession(connector=connector, headers=headers, **options)
    if transport=='stdlib':
        asyncio.get_running_loop().set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=STDLIB_HTTP_WORKERS))
        session_context=StdlibSession(headers)
    elif transport=='http2':
        import httpx
        transport_errors += (httpx.HTTPError,)
        session_context=Http2Session(headers)
    else:
        connector=aiohttp.TCPConnector(limit=args.clients*2,family=socket.AF_INET,ttl_dns_cache=300,keepalive_timeout=20)
        session_context=aiohttp_session(connector)

    def halt(reason):
        nonlocal stop_reason
        stop_reason = stop_reason or reason
        stop.set()

    async with session_context as session:
        async def get(url, kind, http_session=None):
            remaining = deadline-time.monotonic()
            if remaining <= 0 or stop.is_set():
                return None
            if stats['manifestRequests']+stats['segmentRequests'] >= total_limit:
                halt('request_limit')
                return None
            began, size, prefix, body = time.monotonic(), 0, b'', bytearray()
            request_timing = RequestTiming(began)
            body_complete = False
            headers_received = False
            response_info = None
            stats[kind+'Requests'] += 1
            timeout = aiohttp.ClientTimeout(total=min(8, remaining), connect=min(5, remaining))
            trace_options = {'trace_request_ctx':request_timing} if trace is not None else {}
            request_context = (http_session if http_session is not None else session).get(
                url, allow_redirects=False, timeout=timeout, **trace_options)
            try:
                async with asyncio.timeout(min(8, remaining)), request_context as response:
                    headers_received = True
                    response_info = response
                    request_timing.headers_at = time.monotonic()
                    if isinstance(response, Http2Response):
                        stats['http2Responses' if response.http_version == 'HTTP/2' else 'unexpectedHttpVersionResponses'] += 1
                    if isinstance(response,StdlibResponse):
                        latencies[kind+'TransportQueue'].append(round(response.transportQueueSeconds*1000,2))
                        latencies[kind+'TransportNetwork'].append(round(response.transportNetworkSeconds*1000,2))
                    statuses[kind+':'+str(response.status)] += 1
                    diagnostic_markers = record_response_diagnostics(stats, kind, response.headers)
                    if kind == 'manifest':
                        failure = response.headers.get('X-QSession-Manifest-Failure')
                        if failure in ('read', 'reference'):
                            stats['manifestFailure_'+failure] += 1
                        if response.headers.get('X-QSession-Manifest-Recovery') == 'storage':
                            stats['manifestRecovery_storage'] += 1
                    colo = (response.headers.get('CF-Ray') or '').rsplit('-',1)[-1]
                    if re.fullmatch(r'[A-Z]{3}',colo):stats[kind+'Colo_'+colo] += 1
                    if response.status != 200:
                        errors[kind+':HTTP'+str(response.status)] += 1
                        if len(first_http_failures) < 12:
                            evidence = transport_failure_evidence(kind, response, 0, 'HttpStatus')
                            evidence['elapsedSeconds'] = round(time.monotonic() - started, 3)
                            evidence['transportTiming'] = request_timing.snapshot(time.monotonic())
                            first_http_failures.append(evidence)
                        # Classify denials without retaining bodies, URLs or tokens.
                        data=await response.content.read(4096)
                        known={b'Acceso de reproducci\xc3\xb3n denegado':'backend_denied',
                               b'Acceso de reproducci\xc3\xb3n no v\xc3\xa1lido o vencido':'invalid_token',
                               b'La admisi\xc3\xb3n ha finalizado':'lease_ended',
                               b'No se pudo comprobar el aforo; vuelve a intentarlo':'admission_unavailable',
                               b'El manifiesto contiene una referencia no v\xc3\xa1lida':'manifest_rewrite_failed'}
                        failure = diagnostic_markers.get('admissionFailure')
                        if failure is not None:
                            stats['admissionFailure_'+failure] += 1
                        classification=known.get(data)
                        if classification is None:
                            classification='html_denial' if b'<html' in data.lower() else 'other'
                        stats['denial_'+classification] += 1
                        if response.headers.get('cf-mitigated') == 'challenge':
                            stats['denial_cloudflare_challenge'] += 1
                        return None
                    maximum = 65536 if kind == 'manifest' else 3000000
                    async for chunk in response.content.iter_chunked(65536):
                        if chunk and request_timing.first_body_at is None:
                            request_timing.first_body_at = time.monotonic()
                        size += len(chunk)
                        stats[kind+'BytesReceived'] += len(chunk)
                        if size > maximum:
                            raise ValueError('Oversize response')
                        if not prefix:
                            prefix = chunk[:1]
                        if kind == 'manifest':
                            body.extend(chunk)
                    body_complete = True
                    if kind == 'segment' and (size < 188 or size % 188 != 0 or prefix != b'G'):
                        raise ValueError('Invalid MPEG-TS response')
                    elapsed = time.monotonic()-began
                    stats[kind+'Ok'] += 1
                    if kind == 'segment':
                        stats['segmentBytes'] += size
                        stats['segmentsBelowNominalSize'] += int(size < 1100000)
                        stats['segmentDownloadOver6Seconds'] += int(elapsed > SEGMENT_SECONDS)
                        if isinstance(response,StdlibResponse) and elapsed > SEGMENT_SECONDS:
                            stats['segmentLateTransportOver6Seconds'] += int(response.transportNetworkSeconds > SEGMENT_SECONDS)
                            stats['segmentLateQueueOnly'] += int(response.transportNetworkSeconds <= SEGMENT_SECONDS)
                        stats['cache'+response.headers.get('X-QSession-Edge-Cache', 'Unknown')] += 1
                    latencies[kind].append(round(elapsed*1000, 2))
                    return bytes(body) if kind == 'manifest' else size
            except transport_errors as exc:
                if stopped_at_test_deadline(exc, remaining, deadline, time.monotonic()):
                    stats[kind+'CancelledAtPlannedDeadline'] += 1
                    return None
                errors[kind+':'+type(exc).__name__] += 1
                if len(first_transport_failures) < 12:
                    evidence = transport_failure_evidence(kind, response_info, size, type(exc).__name__)
                    evidence['elapsedSeconds'] = round(time.monotonic() - started, 3)
                    evidence['transportTiming'] = request_timing.snapshot(time.monotonic(), body_complete)
                    first_transport_failures.append(evidence)
                stats[kind+('FailureAfterHeaders' if headers_received else 'FailureBeforeHeaders')] += 1
                if size:
                    stats[kind+'IncompleteBodyResponses'] += 1
                    stats[kind+'IncompleteBodyBytes'] += size
                # Only allowlisted numeric errno classes; never exception
                # messages, URLs, request headers or signed playback tokens.
                number=getattr(exc,'errno',None)
                if number in {54,60,104,110,111,10054,10060,10061}:
                    stats[kind+'TransportErrno_'+str(number)] += 1
                if isinstance(exc,asyncio.TimeoutError) and isinstance(request_context,StdlibRequest):
                    stats[kind+'TimeoutBeforeThreadStart' if request_context.fetch_started_at is None
                          else kind+'TimeoutAfterThreadStart'] += 1
                return None
            finally:
                ended = time.monotonic()
                latencies[kind+'AllResponses'].append(round((ended-began)*1000, 2))
                transport_timings.observe(kind+'RequestToTermination', ended-began)
                for phase, milliseconds in request_timing.snapshot(ended, body_complete)['observedMilliseconds'].items():
                    transport_timings.observe(kind+phase[0].upper()+phase[1:], milliseconds/1000)

        async def client(index):
            await asyncio.sleep(args.ramp*index/args.clients)
            if stop.is_set() or time.monotonic() >= deadline:
                return
            active[index] = True
            stats['startedClients'] += 1
            expected, stream_run, failures, received = None, None, 0, 0
            began = last_advance = time.monotonic()
            outcome = 'deadline'
            token = tokens[index] if tokens else None
            manifest_url = URL + '?' + urllib.parse.urlencode({'qsat': token}) if token else URL
            own_session = None
            restarted_at = None
            reconnect_measured = False
            def fresh_session():
                connector = aiohttp.TCPConnector(limit=2, family=socket.AF_INET, ttl_dns_cache=300)
                return aiohttp_session(connector)
            try:
                # A dedicated pool allows closing this client's actual sockets
                # without perturbing unrelated clients in the shared pool.
                if reconnect_after and index % 10 == 0:
                    own_session = fresh_session()
                while time.monotonic() < deadline and not stop.is_set():
                    if own_session is not None and restarted_at is None and time.monotonic() - started >= reconnect_after:
                        await own_session.close()
                        own_session = fresh_session()
                        restarted_at = time.monotonic()
                        stats['reconnectStartedClients'] += 1
                    body = await get(manifest_url, 'manifest', own_session)
                    if body is None:
                        failures += 1
                    else:
                        parsed = parse_manifest(body.decode('utf8'), token)
                        segments = parsed['segments']
                        run = segments[-1]['url'].rsplit('/', 1)[-1].split('_')[2]
                        if stream_run is not None and run != stream_run:
                            halt('synthetic_origin_changed')
                            outcome = 'origin_changed'
                            break
                        stream_run = run
                        if expected is None:
                            # Join at newest complete segment, intentionally skip older startup history.
                            expected = segments[-1]['sequence']
                        if segments[0]['sequence'] > expected:
                            stats['missedSegments'] += segments[0]['sequence']-expected
                            stats['clientsWithMissedSegments'] += 1
                            outcome = 'missed_segment'
                            break
                        for segment in segments:
                            if segment['sequence'] < expected:
                                continue
                            if segment['sequence'] != expected:
                                raise ValueError('Non-contiguous media sequence')
                            if await get(segment['url'], 'segment', own_session) is not None:
                                stats['mediaStartedClients'] += int(received == 0)
                                received += 1
                                expected += 1
                                last_progress[index] = last_advance = time.monotonic()
                                failures = 0
                                if restarted_at is not None and not reconnect_measured:
                                    reconnect_measured = True
                                    stats['reconnectMediaResumedClients'] += 1
                                    reconnect_latencies.append(round((time.monotonic() - restarted_at) * 1000, 2))
                            else:
                                failures += 1
                                break
                        if parsed['ended']:
                            stats['unexpectedEndList'] += 1
                            outcome = 'origin_ended'
                            halt('synthetic_origin_ended_early')
                            break
                    if time.monotonic()-last_advance > STALL_SECONDS:
                        stats['stalledClients'] += 1
                        outcome = 'stalled'
                        break
                    if failures >= 5:
                        stats['failedClients'] += 1
                        outcome = 'request_failures'
                        break
                    await asyncio.sleep(min(random.uniform(1.7, 2.3), max(0, deadline-time.monotonic())))
            except (ValueError, UnicodeError):
                errors['UnsafeOrInvalidManifest'] += 1
                outcome = 'invalid_manifest'
                halt('unsafe_or_invalid_manifest')
            except asyncio.CancelledError:
                outcome = 'deadline' if time.monotonic() >= deadline else 'cancelled'
                raise
            finally:
                if own_session is not None:
                    await own_session.close()
                active[index] = False
                stats['completedClients'] += 1
                finished[index] = {'outcome': outcome, 'segments': received,
                                   'seconds': round(time.monotonic()-began, 2)}

        async def monitor():
            previous, previous_time, cpu_prev = network_before, started, cpu_before
            saturation_streak = 0
            scheduled_sample = started
            while time.monotonic() < deadline and not stop.is_set():
                now, current = time.monotonic(), proc_metrics()
                interval = max(.001, now-previous_time)
                sample = {'elapsed': round(now-started, 2), 'observedAtUnix': round(start_wall+now-started, 3),
                          'activeClients': sum(active),
                          'recentMediaClients': sum(on and progress > 0 and now-progress <= RECENT_MEDIA_SECONDS
                                                    for on, progress in zip(active, last_progress)),
                          'segmentBytes': stats['segmentBytes'], 'segmentOk': stats['segmentOk'],
                          'requestErrors': sum(errors.values()),
                          'processCpuPercent': round(100*(time.process_time()-cpu_prev)/interval, 1),
                          'rssKiB': current.get('rssKiB'), 'availableMemoryKiB': current.get('availableMemoryKiB')}
                ticks = current.get('cpuTicks', 0)-previous.get('cpuTicks', 0)
                if ticks > 0:
                    sample['systemCpuPercent'] = round(100*(1-(current['cpuIdleTicks']-previous['cpuIdleTicks'])/ticks), 1)
                    if 'cpuStealTicks' in current and 'cpuStealTicks' in previous:
                        sample['cpuStealPercent'] = round(100*max(0, current['cpuStealTicks']-previous['cpuStealTicks'])/ticks, 2)
                for name in ('cpuThrottledPeriods', 'cpuThrottledMicroseconds'):
                    if name in current and name in previous:
                        sample[name+'Delta'] = max(0, current[name]-previous[name])
                for name in ('openFileDescriptors', 'cpuQuotaCores', 'affinityCpuCount'):
                    if name in current:
                        sample[name] = current[name]
                if 'rxBytes' in current and 'rxBytes' in previous:
                    sample['rxMbps'] = round((current['rxBytes']-previous['rxBytes'])*8/interval/1000000, 2)
                    sample['txMbps'] = round((current['txBytes']-previous['txBytes'])*8/interval/1000000, 2)
                for name in ('rxErrors', 'rxDropped', 'txErrors', 'txDropped',
                             'tcpOutSegs', 'tcpRetransSegs', 'tcpTCPTimeouts', 'tcpTCPBacklogDrop', 'tcpTCPSynRetrans'):
                    if name in current and name in previous:
                        sample[name+'Delta'] = max(0, current[name]-previous[name])
                sample['eventLoopLagSeconds'] = round(max(0, now-scheduled_sample), 3)
                samples.append(sample)
                if args.progress:
                    print(json.dumps({'progress': sample}), file=sys.stderr, flush=True)
                if sum(errors.values()) > 100 and sum(errors.values()) > .1*(stats['manifestRequests']+stats['segmentRequests']):
                    halt('persistent_request_errors')
                saturated = (sample.get('systemCpuPercent', 0) >= 95
                             or sample.get('availableMemoryKiB', 1000000) < 131072
                             or sample['eventLoopLagSeconds'] > 1)
                saturation_streak = saturation_streak+1 if saturated else 0
                if saturation_streak >= 3:
                    halt('generator_saturation_inconclusive')
                previous, previous_time, cpu_prev = current, now, time.process_time()
                # Align actual observations to the shared wall-clock start.
                # Sleeping two seconds after telemetry accumulates drift across
                # generators and leaves gaps in the common observation slots.
                # Never backfill a missed sample with a fictional measurement.
                scheduled_sample = started+(math.floor((time.monotonic()-started)/2)+1)*2
                await asyncio.sleep(max(0,min(scheduled_sample,deadline)-time.monotonic()))

        tasks = [asyncio.create_task(client(index)) for index in range(args.clients)]
        tasks.append(asyncio.create_task(monitor()))
        try:
            # Cancel in-flight HTTP at the deadline, including tasks delayed by the ramp.
            while time.monotonic() < deadline and not stop.is_set():
                await asyncio.sleep(min(.25, max(0, deadline-time.monotonic())))
        finally:
            stop.set()
            for task in tasks:
                task.cancel()
            try:
                results = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=5)
                if any(isinstance(item, Exception) for item in results):
                    halt('unexpected_task_error')
            except asyncio.TimeoutError:
                halt('cancellation_timeout')

    steady = [sample for sample in samples if sample['elapsed'] >= args.ramp+8]
    full_media = [sample for sample in samples if sample['recentMediaClients'] == args.clients]
    outcomes = collections.Counter(item['outcome'] for item in finished if item)
    expected_reconnects = (args.clients + 9) // 10 if reconnect_after else 0
    reconnect_passed = (stats['reconnectStartedClients'] == expected_reconnects
                       and stats['reconnectMediaResumedClients'] == expected_reconnects
                       and (not reconnect_latencies or max(reconnect_latencies) <= 12000))
    delivery_passed = (stop_reason is None and not errors and bool(full_media) and reconnect_passed
                       and stats['mediaStartedClients'] == args.clients and not stats['missedSegments']
                       and not stats['stalledClients'] and not stats['segmentDownloadOver6Seconds']
                       and not stats['segmentsBelowNominalSize'])
    report = {'schemaVersion': 2, 'synthetic': True, 'decodedMedia': False,
              'provenance':provenance,
              'transportInstrumentation':{'aiohttpTraceSignals':trace_events,
                  'separateTcpConnectObserved':False, 'separateTlsHandshakeObserved':False,
                  'connectionCreateIncludesDnsTcpTls':True if trace_events else None,
                  'timingsIncludeClientScheduling':True, 'timings':transport_timings.report()},
              'certifiesProductionCapacity': False, 'host': socket.gethostname(),
              'startedAtUnix': start_wall, 'endedAtUnix': time.time(),
              'requestedClients': args.clients, 'rampSeconds': args.ramp, 'holdSeconds': args.hold,
              'httpTransport':transport,'httpWorkers':STDLIB_HTTP_WORKERS if transport=='stdlib' else None,
              'http2ConnectionPools':16 if transport=='http2' else None,
              'deliveryHost':HOST,'tlsCertificateVerification':True,'redirectsAllowed':False,
              'maximumTrafficSeconds': duration, 'hardSafetyLimitSeconds': 660,
              'reconnection': {'mode': 'http-session-restart' if reconnect_after else 'disabled',
                  'afterSeconds': reconnect_after, 'expectedClients': expected_reconnects,
                  'sameLeaseTokensReused': True, 'newAdmissionsRequested': 0,
                  'maximumRecoveryMilliseconds': max(reconnect_latencies, default=None),
                  'passed': reconnect_passed, 'physicalNetworkSwitchTested': False},
              'elapsedSeconds': round(time.monotonic()-started, 3), 'stopReason': stop_reason or 'planned_deadline',
              'deliveryCheckPassed': delivery_passed,
              'requestLimit': total_limit, 'counts': dict(stats), 'errors': dict(errors),
              'httpStatuses': dict(statuses), 'clientOutcomes': dict(outcomes), 'samples': samples,
              'firstTransportFailures': first_transport_failures,
              'firstHttpFailures': first_http_failures,
              'peakActiveClients': max((sample['activeClients'] for sample in samples), default=0),
              'peakRecentMediaClients': max((sample['recentMediaClients'] for sample in samples), default=0),
              'steadyRecentMediaClientsMinimum': min((sample['recentMediaClients'] for sample in steady), default=0),
              'steadyMetricStartsAtSeconds': args.ramp+8,
              'fullRecentMediaSamples': len(full_media),
              'firstFullRecentMediaAtSeconds': full_media[0]['elapsed'] if full_media else None,
              'lastFullRecentMediaAtSeconds': full_media[-1]['elapsed'] if full_media else None,
              'recentMediaWindowSeconds': RECENT_MEDIA_SECONDS,
              'distinctLeaseTokensPresented': len(tokens) if tokens else 0,
              'backendActiveLeasesVerifiedByThisTool': False,
              'latencyMs': {kind: percentiles(values) for kind, values in latencies.items()},
              'cpuSeconds': round(time.process_time()-cpu_before, 3),
              'maxRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss if resource else None,
              'networkBefore': network_before, 'networkAfter': proc_metrics(),
              'interpretation': 'HTTP media delivery only. Active tasks or recent segment receipts do not prove smooth decoded playback.'}
    print(json.dumps(report), flush=True)
    return 0 if delivery_passed else 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clients', type=int, default=1250)
    parser.add_argument('--ramp', type=int, default=30)
    parser.add_argument('--hold', type=int, default=60)
    parser.add_argument('--reconnect-after', type=int, default=0)
    parser.add_argument('--start-at-unix', type=float, default=0,
                        help='Coordinate generators at a Unix time up to 180 seconds ahead')
    parser.add_argument('--progress', action='store_true')
    parser.add_argument('--transport',choices=('aiohttp','stdlib','http2'),default='aiohttp')
    parser.add_argument('--delivery-host', required=True,
                        help='Staging playback hostname. Production hosts are refused.')
    parser.add_argument('--tokens-file', type=pathlib.Path,
                        help='Optional root-only JSON array of one unique qsat lease token per client')
    args = parser.parse_args()
    try: validate_run_bounds(args)
    except ValueError as error: parser.error(str(error))
    configure_delivery_host(args.delivery_host)
    raise SystemExit(asyncio.run(main(args)))
