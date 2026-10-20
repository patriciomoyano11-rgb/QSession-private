"""Operate up to eight explicitly inventoried temporary HLS generators over SSH.

No provisioning, destruction, token minting, activation or secret downloads.
Requires known SSH host keys, /root/hls-load-client.py and a root-0600 JSON array
of the inventoried client count in /root/qsession-load-tokens.json on each VM.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import ipaddress
import json
import math
import pathlib
import re
import statistics
import subprocess
import sys
import time
import uuid

IDENTITY = 'C:/Users/maria/.ssh/qsession_deploy_ed25519'
PROTECTED_IPS = {'104.238.137.144', '45.77.192.82', '45.77.118.43'}
DELIVERY_HOSTS = ('qsession-live.patriciomoyano11.workers.dev', 'live.qsession.org')

REMOTE_SCRIPT = r'''
import hashlib, json, math, os, pathlib, platform, runpy, signal, ssl, stat, subprocess, sys, time
os.umask(0o077)
run_id, start_at, clients = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
delivery_host = sys.argv[4]
transport = sys.argv[5]
hold, reconnect = int(sys.argv[6]), int(sys.argv[7])
worker_count, declared_cpus = int(sys.argv[8]), int(sys.argv[9])
expected_client_hash, orchestration_hash, configuration_hash = sys.argv[10:13]
if worker_count not in (4, 8) or not worker_count <= clients <= 1500:
    raise SystemExit('Invalid bounded worker partition')
observed_cpus = os.cpu_count()
affinity_cpus = len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else None
effective_cpus = min(value for value in (observed_cpus, affinity_cpus) if value is not None)
if declared_cpus > effective_cpus or (worker_count == 8 and (declared_cpus < 8 or effective_cpus < 8)):
    raise SystemExit('Worker CPU allocation has not been verified on this generator')
if not 60 <= hold <= 620 or (reconnect and not 30 < reconnect < 30 + hold - 18):
    raise SystemExit('Invalid bounded timing')
if reconnect and transport != 'aiohttp':
    raise SystemExit('Session restart requires aiohttp')
traffic_seconds = 30 + hold
if delivery_host not in ('qsession-live.patriciomoyano11.workers.dev', 'live.qsession.org'):
    raise SystemExit('Delivery host is outside the isolated test scope')
if transport not in ('stdlib', 'aiohttp', 'http2'):
    raise SystemExit('Unsupported HTTP transport')
if not 1 <= clients <= 1500:
    raise SystemExit('Per-generator client count exceeds the bounded test scope')
splits = tuple(clients//worker_count + (index < clients%worker_count) for index in range(worker_count))
source = pathlib.Path('/root/hls-load-client.py')
token_path = pathlib.Path('/root/qsession-load-tokens.json')
if not source.is_file() or source.is_symlink():
    raise SystemExit('Uploaded load client is missing or unsafe')
if source.stat().st_uid != 0 or stat.S_IMODE(source.stat().st_mode) & 0o022:
    raise SystemExit('Uploaded client must be root-owned and not writable by other users')
client_hash = hashlib.sha256(source.read_bytes()).hexdigest()
if client_hash != expected_client_hash:
    raise SystemExit('Uploaded load client does not match the reviewed local source')
# Import only the hash-verified standard-library metadata functions, never main().
client_metadata = runpy.run_path(str(source), run_name='qsession_generator_metadata')
quota_evidence = client_metadata['cgroup_metrics']()
quota_cpus, quota_observed = quota_evidence.get('cpuQuotaCores'), quota_evidence.get('cpuQuotaObserved') is True
if worker_count == 8 and not quota_observed:
    raise SystemExit('Eight workers require observable CPU quota headroom')
if quota_cpus is not None and quota_cpus < declared_cpus:
    raise SystemExit('Declared CPU allocation exceeds the observed CPU quota')
descriptor = os.open(token_path, os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(descriptor) as token_file:
    info = os.fstat(token_file.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 8000000:
        raise SystemExit('Expected a bounded root-0600 lease file')
    tokens = json.load(token_file)
if (not isinstance(tokens, list) or len(tokens) != clients
        or any(not isinstance(token, str) or not 20 <= len(token) <= 2048 for token in tokens)
        or len(set(tokens)) != clients):
    raise SystemExit('Expected exactly the inventoried distinct bounded lease tokens')
if not 0 <= start_at-time.time() <= 180:
    raise SystemExit('Coordinated start must still be within 180 seconds ahead')
if not pathlib.Path('/usr/bin/timeout').is_file():
    raise SystemExit('GNU timeout is required as an independent traffic watchdog')
if subprocess.run(['/usr/bin/python3','-c','import aiohttp'],capture_output=True).returncode:
    raise SystemExit('aiohttp is missing from generator runtime')
if transport == 'http2' and subprocess.run(['/usr/bin/python3','-c','import httpx,h2'],capture_output=True).returncode:
    raise SystemExit('Official distribution HTTP/2 dependencies are missing')
folder = pathlib.Path('/root/qsession-load') / run_id
folder.mkdir(mode=0o700, parents=True, exist_ok=False)
jobs, subsets, handles = [], [], []
stop_at = time.monotonic()+max(0,start_at-time.time())+traffic_seconds+25
kill_at = stop_at+5
watchdog = False
try:
    cursor = 0
    for index, count in enumerate(splits):
        subset = folder / ('leases-'+str(index)+'.json')
        with open(subset,'x') as output:
            json.dump(tokens[cursor:cursor+count],output)
        subset.chmod(0o600)
        subsets.append(subset)
        cursor += count
        report_path = folder / ('worker-'+str(index)+'.json')
        progress_path = folder / ('worker-'+str(index)+'.progress.jsonl')
        report = open(report_path,'xb')
        progress = open(progress_path,'xb')
        handles.extend((report,progress))
        # This independent timeout survives loss of the operator's SSH connection.
        lifetime = max(1,math.ceil(max(0,start_at-time.time())+traffic_seconds+25))
        command = ['/usr/bin/timeout','--signal=TERM','--kill-after=5s',str(lifetime)+'s',
                   '/usr/bin/python3',str(source),'--clients',str(count),'--ramp','30','--hold',str(hold),
                   '--reconnect-after',str(reconnect),
                   '--start-at-unix',str(start_at),'--tokens-file',str(subset),'--transport',transport,
                   '--delivery-host',delivery_host,'--progress']
        child = subprocess.Popen(command,stdout=report,stderr=progress,start_new_session=True,cwd=folder)
        jobs.append({'index':index,'clients':count,'process':child,
                     'reportPath':report_path,'progressPath':progress_path})
    del tokens
    while any(job['process'].poll() is None for job in jobs) and time.monotonic() < stop_at:
        time.sleep(.2)
    if any(job['process'].poll() is None for job in jobs):
        watchdog = True
        for job in jobs:
            if job['process'].poll() is None:
                try:
                    os.killpg(job['process'].pid,signal.SIGTERM)
                except ProcessLookupError:
                    pass
        while any(job['process'].poll() is None for job in jobs) and time.monotonic() < kill_at:
            time.sleep(.1)
finally:
    for job in jobs:
        if job['process'].poll() is None:
            try:
                os.killpg(job['process'].pid,signal.SIGKILL)
            except ProcessLookupError:
                pass
    for job in jobs:
        try:
            job['process'].wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
    for handle in handles:
        handle.close()
    for subset in subsets:
        subset.unlink(missing_ok=True)
workers = []
for job in jobs:
    item = {'index':job['index'],'clients':job['clients'],'exitCode':job['process'].returncode,
            'stderrBytes':job['progressPath'].stat().st_size}
    try:
        raw=job['reportPath'].read_bytes()
        if len(raw)>2000000:
            raise ValueError('Oversize report')
        item['report']=json.loads(raw)
    except Exception as exc:
        item['reportErrorClass']=type(exc).__name__
    workers.append(item)
print(json.dumps({'nodeReport':{'runId':run_id,'startAtUnix':start_at,'requestedClients':clients,
      'workersPerNode':worker_count,
      'cpuVerification':{'declaredLogicalCpuCount':declared_cpus,'observedLogicalCpuCount':observed_cpus,
                         'affinityCpuCount':affinity_cpus,'effectiveCpuCount':effective_cpus,
                         'cpuQuotaObserved':quota_observed,'cpuQuotaCores':quota_cpus,
                         'cpuQuotaEvidence':quota_evidence},
      'provenance':{'clientSha256':client_hash,'orchestrationSha256':orchestration_hash,
                    'configurationSha256':configuration_hash,
                    'runtime':{'python':platform.python_version(),'implementation':platform.python_implementation(),
                               'openssl':ssl.OPENSSL_VERSION}},
      'watchdogTriggered':watchdog,'trafficHardStopAtUnix':start_at+traffic_seconds+30,
      'leaseSubsetFilesRemoved':all(not p.exists() for p in subsets),
      'workers':workers,'certifiesProductionCapacity':False}}),flush=True)
'''


def workers_per_node(node):
    """Four preserves historical partitions; eight requires explicit CPU evidence."""
    count = node.get('workersPerNode', 4)
    cpus = node.get('logicalCpuCount', 4)
    if type(count) is not int or count not in (4, 8):
        raise ValueError('workersPerNode must be 4 or 8')
    if type(cpus) is not int or not 1 <= cpus <= 128:
        raise ValueError('logicalCpuCount must be verified and bounded')
    if count == 8 and ('logicalCpuCount' not in node or cpus < 8):
        raise ValueError('Eight workers require an explicitly verified logicalCpuCount >= 8')
    return count


def client_splits(node):
    count, clients = workers_per_node(node), node.get('clients', 1250)
    if type(clients) is not int or not count <= clients <= 1500:
        raise ValueError('Each generator requires at least one client per worker and at most 1500 clients')
    return tuple(clients//count + (index < clients%count) for index in range(count))


def reproducibility_metadata(inventory):
    # This input must be validate_inventory's allowlisted output, never a token file.
    configuration = json.dumps(inventory, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    return {'clientSha256':hashlib.sha256(pathlib.Path(__file__).with_name('hls-load-client.py').read_bytes()).hexdigest(),
            'orchestrationSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
            'remoteControllerSha256':hashlib.sha256(REMOTE_SCRIPT.encode()).hexdigest(),
            'configurationSha256':hashlib.sha256(configuration).hexdigest()}


def timing(inventory):
    hold = inventory.get('holdSeconds', 60)
    reconnect = inventory.get('reconnectAfterSeconds', 0)
    if type(hold) is not int or not 60 <= hold <= 620:
        raise ValueError('Hold must be 60..620 seconds')
    if type(reconnect) is not int or (reconnect and not 30 < reconnect < 30 + hold - 18):
        raise ValueError('Reconnect must leave a complete recovery window')
    if reconnect and inventory.get('httpTransport', 'stdlib') != 'aiohttp':
        raise ValueError('Session restart requires aiohttp')
    return hold, reconnect


def validate_inventory(inventory, now=None):
    now = time.time() if now is None else now
    run_id, start_at = inventory.get('runId'), inventory.get('startAtUnix')
    nodes = inventory.get('generators')
    delivery_host = inventory.get('deliveryHost', DELIVERY_HOSTS[0])
    transport = inventory.get('httpTransport', 'stdlib')
    hold, reconnect = timing(inventory)
    if transport not in ('stdlib', 'aiohttp', 'http2'):
        raise ValueError('Unsupported HTTP transport')
    if delivery_host not in DELIVERY_HOSTS:
        raise ValueError('Delivery host is outside the isolated test scope')
    if not isinstance(run_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{7,63}', run_id):
        raise ValueError('Inventory runId must be a bounded safe name')
    if not isinstance(start_at, (int, float)) or not math.isfinite(start_at) or not 0 <= start_at-now <= 180:
        raise ValueError('Inventory startAtUnix must be within the next 180 seconds')
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 8:
        raise ValueError('Inventory must explicitly contain one to eight temporary generators')
    seen_ips, seen_ids, seen_labels = set(), set(), set()
    for node in nodes:
        if not isinstance(node, dict) or node.get('ownedForThisTest') is not True or node.get('destroyed') is True:
            raise ValueError('Every generator requires explicit ownedForThisTest=true')
        ip = ipaddress.ip_address(node.get('ip', ''))
        if ip.version != 4 or not ip.is_global or str(ip) in PROTECTED_IPS:
            raise ValueError('Only explicitly inventoried public IPv4 generators are accepted')
        provider_id = str(uuid.UUID(node.get('id', '')))
        label = node.get('label', '')
        if not re.fullmatch(r'qsession-load-[A-Za-z0-9_-]{1,80}', label):
            raise ValueError('Generator labels must identify the disposable qsession-load resources')
        if str(ip) in seen_ips or provider_id in seen_ids or label in seen_labels:
            raise ValueError('Generator IPs, provider UUIDs and labels must be unique')
        seen_ips.add(str(ip))
        seen_ids.add(provider_id)
        seen_labels.add(label)
        clients = node.get('clients', 1250)
        client_splits(node)
        speed = node.get('advertisedNetworkMbps')
        if speed is not None and (not isinstance(speed, (int, float)) or not math.isfinite(speed) or speed <= 0):
            raise ValueError('advertisedNetworkMbps must be a positive finite number')
    # Retain only the public metadata this operator needs; never copy unexpected
    # inventory fields such as credentials into the local result artifact.
    if sum(node.get('clients',1250) for node in nodes) > 10000:
        raise ValueError('Total clients exceed the authorized 10000-client test')
    keys = ('ip','id','label','ownedForThisTest','advertisedNetworkMbps','clients','logicalCpuCount','workersPerNode')
    return {'runId':run_id,'startAtUnix':start_at,'deliveryHost':delivery_host,'httpTransport':transport,
            'holdSeconds':hold,'reconnectAfterSeconds':reconnect,
            'generators':[{key:node[key] for key in keys if key in node} for node in nodes]}


def longest_consecutive_run(indices):
    best, current, previous = [], [], None
    for index in sorted(indices):
        current = current+[index] if previous is not None and index == previous+1 else [index]
        if len(current) > len(best):
            best = current[:]
        previous = index
    return best


def aggregate(inventory, results):
    """Align every worker by actual Unix samples; never add unrelated node peaks."""
    start_at = inventory['startAtUnix']
    expected_workers = sum(workers_per_node(node) for node in inventory['generators'])
    expected_clients = sum(node.get('clients',1250) for node in inventory['generators'])
    hold, reconnect = timing(inventory)
    duration = 30 + hold
    steady_end = duration - 2
    expected_steady = (steady_end - 38) // 2 + 1
    bins = collections.defaultdict(dict)
    nodes, failures = [], []
    total_counts = collections.Counter()
    for position, node in enumerate(inventory['generators']):
        result = results[position] if position < len(results) and isinstance(results[position], dict) else {}
        clients = node.get('clients',1250)
        worker_count = workers_per_node(node)
        splits = client_splits(node)
        process_cpu_threshold = .9*100*node.get('logicalCpuCount',4)/worker_count
        metadata = {'ip':node['ip'],'id':node['id'],'label':node['label']}
        report = result.get('nodeReport')
        if not report or report.get('runId') != inventory['runId'] or report.get('startAtUnix') != start_at:
            nodes.append({**metadata,'controllerFailed':True,'errorClass':result.get('errorClass','InvalidNodeReport')})
            failures.append(node['label']+':controller')
            continue
        worker_failures, cpu_saturation, saturation_stops, node_rx_samples = [], [], [], collections.defaultdict(list)
        rss, available_memory, system_cpu = [], [], []
        steady_rx, reported_speeds = [], []
        seen_workers = set()
        if report.get('workersPerNode', 4) != worker_count:
            worker_failures.append('worker_partition_mismatch')
        if worker_count == 8:
            cpu_evidence = report.get('cpuVerification', {})
            observed_fields = ('observedLogicalCpuCount', 'affinityCpuCount', 'effectiveCpuCount')
            quota = cpu_evidence.get('cpuQuotaCores')
            if (cpu_evidence.get('declaredLogicalCpuCount') != node['logicalCpuCount']
                    or any(type(cpu_evidence.get(key)) is not int or cpu_evidence[key] < node['logicalCpuCount']
                           for key in observed_fields)
                    or cpu_evidence.get('cpuQuotaObserved') is not True
                    or (quota is not None and (type(quota) not in (int,float)
                        or not math.isfinite(quota) or quota < node['logicalCpuCount']))):
                worker_failures.append('cpu_allocation_unverified')
        for worker in report.get('workers', []):
            index = worker.get('index')
            item = worker.get('report')
            identity = (node['id'],index)
            if type(index) is not int or index not in range(worker_count) or not isinstance(item, dict):
                worker_failures.append(str(index)+':missing_report')
                continue
            if index in seen_workers:
                worker_failures.append(str(index)+':duplicate_report')
                continue
            seen_workers.add(index)
            if (item.get('requestedClients') != splits[index]
                    or item.get('distinctLeaseTokensPresented') != splits[index]):
                worker_failures.append(str(index)+':unexpected_client_or_lease_count')
            if worker.get('exitCode') != 0 or not item.get('deliveryCheckPassed'):
                worker_failures.append(str(index)+':delivery_failed')
            if hold != 60 and (item.get('rampSeconds') != 30 or item.get('holdSeconds') != hold):
                worker_failures.append(str(index)+':duration_mismatch')
            if reconnect:
                recovery = item.get('reconnection', {})
                expected_reconnects = (splits[index] + 9) // 10
                if (recovery.get('mode') != 'http-session-restart' or recovery.get('afterSeconds') != reconnect
                        or recovery.get('passed') is not True or recovery.get('expectedClients') != expected_reconnects
                        or item.get('counts', {}).get('reconnectStartedClients') != expected_reconnects
                        or item.get('counts', {}).get('reconnectMediaResumedClients') != expected_reconnects
                        or not isinstance(recovery.get('maximumRecoveryMilliseconds'), (int, float))
                        or not 0 <= recovery['maximumRecoveryMilliseconds'] <= 12000):
                    worker_failures.append(str(index)+':reconnection_failed')
            if item.get('stopReason') == 'generator_saturation_inconclusive':
                saturation_stops.append(index)
            total_counts.update(item.get('counts',{}))
            streak = 0
            for sample in item.get('samples',[]):
                observed = sample.get('observedAtUnix')
                if not isinstance(observed,(int,float)) or not math.isfinite(observed):
                    continue
                slot = round((observed-start_at)/2)
                if slot < 0 or slot*2 > duration+30 or abs(observed-(start_at+slot*2)) > 1:
                    continue
                if identity not in bins[slot] or abs(observed-(start_at+slot*2)) < abs(bins[slot][identity]['observedAtUnix']-(start_at+slot*2)):
                    bins[slot][identity] = sample
                if isinstance(sample.get('rxMbps'),(int,float)):
                    node_rx_samples[slot].append(sample['rxMbps'])
                if sample.get('elapsed',0) >= 38:
                    if isinstance(sample.get('rssKiB'),(int,float)):
                        rss.append(sample['rssKiB'])
                    if isinstance(sample.get('availableMemoryKiB'),(int,float)):
                        available_memory.append(sample['availableMemoryKiB'])
                    if isinstance(sample.get('systemCpuPercent'),(int,float)):
                        system_cpu.append(sample['systemCpuPercent'])
                    # CPU time includes all TLS threads: 100% means one core,
                    # not all available CPU. Configured workers share the verified
                    # VM cores; whole-system saturation remains a separate guard.
                    high_cpu = sample.get('processCpuPercent',0) >= process_cpu_threshold or sample.get('systemCpuPercent',0) >= 90
                    streak = streak+1 if high_cpu else 0
                    if streak >= 3:
                        cpu_saturation.append(index)
            for metrics_key in ('networkBefore','networkAfter'):
                speed = item.get(metrics_key,{}).get('reportedLinkSpeedMbps')
                if isinstance(speed,(int,float)) and speed > 0:
                    reported_speeds.append(speed)
        if seen_workers != set(range(worker_count)):
            worker_failures.append('missing_worker_reports')
        # Every process samples the same VM NIC; use medians, never sum NIC counters.
        for slot, values in node_rx_samples.items():
            if slot*2 >= 38:
                steady_rx.append(statistics.median(values))
        known_speeds = reported_speeds + ([node['advertisedNetworkMbps']] if node.get('advertisedNetworkMbps') else [])
        nic_reference = min(known_speeds) if known_speeds else None
        rx_p95 = sorted(steady_rx)[min(len(steady_rx)-1,int((len(steady_rx)-1)*.95))] if steady_rx else None
        near_nic = bool(nic_reference and rx_p95 is not None and rx_p95 >= .9*nic_reference)
        issue = bool(worker_failures or report.get('watchdogTriggered'))
        node_summary = {**metadata,'controllerFailed':False,'workerCount':len(report.get('workers',[])),
                        'expectedWorkerCount':worker_count,'clientPartitions':list(splits),
                        'cpuVerification':report.get('cpuVerification'),
                        'provenance':report.get('provenance'),
                        'expectedReconnectionClients':sum((count+9)//10 for count in splits) if reconnect else 0,
                        'deliveryWorkerFailures':worker_failures,'watchdogTriggered':bool(report.get('watchdogTriggered')),
                        'sustainedCpuAtOrAbove90PercentWorkers':sorted(set(cpu_saturation)),
                        'generatorSaturationStopWorkers':saturation_stops,
                        'logicalCpuCount':node.get('logicalCpuCount',4),
                        'processCpuSaturationThresholdPercent':process_cpu_threshold,
                        'nicReferenceMbps':nic_reference,'steadyRxMedianMbps':statistics.median(steady_rx) if steady_rx else None,
                        'nicHeadroomObservable':nic_reference is not None and rx_p95 is not None,
                        'steadyRxP95Mbps':rx_p95,'nearReportedNicLimit':near_nic,
                        'peakWorkerRssKiB':max(rss) if rss else None,
                        'minimumAvailableMemoryKiB':min(available_memory) if available_memory else None,
                        'maximumSteadySystemCpuPercent':max(system_cpu) if system_cpu else None,
                        'generatorHeadroomInconclusive':bool(cpu_saturation or near_nic or saturation_stops),
                        'leaseSubsetFilesRemoved':report.get('leaseSubsetFilesRemoved') is True}
        nodes.append(node_summary)
        if issue:
            failures.append(node['label']+':delivery')
        if cpu_saturation or near_nic or saturation_stops:
            failures.append(node['label']+':generator_headroom_inconclusive')
    aligned = []
    for slot, series in sorted(bins.items()):
        complete = len(series) == expected_workers
        aligned.append({'elapsedSeconds':slot*2,'observedAtUnixApprox':start_at+slot*2,
                        'workerSamples':len(series),'complete':complete,
                        'concurrentRecentMediaClients':sum(sample.get('recentMediaClients',0) for sample in series.values()),
                        'activeClientTasks':sum(sample.get('activeClients',0) for sample in series.values())})
    full = [item['elapsedSeconds']//2 for item in aligned if item['complete']
            and item['concurrentRecentMediaClients'] == expected_clients]
    longest = longest_consecutive_run(full)
    steady = [item for item in aligned if item['complete'] and 38 <= item['elapsedSeconds'] <= steady_end]
    if not longest:
        failures.append('no_common_full_media_sample')
    if len(steady) != expected_steady or any(item['concurrentRecentMediaClients'] != expected_clients for item in steady):
        failures.append('incomplete_common_media_delivery_between_seconds_38_and_'+str(steady_end))
    return {'schemaVersion':1,'runId':inventory['runId'],'startAtUnix':start_at,
            'requestedGenerators':len(inventory['generators']),'requestedClients':expected_clients,
            'expectedWorkers':expected_workers,'nodes':nodes,'counts':dict(total_counts),
            'alignedSamples':aligned,'alignmentToleranceSeconds':1,'recentMediaWindowSeconds':12,
            'peakConcurrentRecentMediaClients':max((item['concurrentRecentMediaClients'] for item in aligned if item['complete']),default=0),
            'steadyConcurrentRecentMediaMinimum':min((item['concurrentRecentMediaClients'] for item in steady),default=0),
            'completeSteadySamples':len(steady),'expectedSteadySamples':expected_steady,
            'holdSeconds':hold,'steadyWindowStartSeconds':38,'steadyWindowEndSeconds':steady_end,
            'requiredSteadySpanSeconds':steady_end-38,'reconnectAfterSeconds':reconnect,
            'longestCommonFullMediaSpanSeconds':2*(longest[-1]-longest[0]) if longest else 0,
            'longestCommonFullMediaFirstAtSeconds':longest[0]*2 if longest else None,
            'longestCommonFullMediaLastAtSeconds':longest[-1]*2 if longest else None,
            'failureReasons':failures,'httpDeliveryChecksPassed':not failures,
            'decodedPlaybackTested':False,'backendActiveLeasesVerifiedByThisTool':False,
            'certifiesProductionCapacity':False,
            'interpretation':'Aligned recent segment receipts, not decoded playback. CPU or NIC saturation makes generator capacity inconclusive. Backend lease counts require a separate observation.'}


def run_node(node, inventory, provenance=None):
    provenance = provenance or reproducibility_metadata(inventory)
    command = ['ssh','-T','-i',IDENTITY,'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
               '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12',
               'root@'+node['ip'],'/usr/bin/python3','-',inventory['runId'],str(inventory['startAtUnix']),str(node.get('clients',1250)),
               inventory.get('deliveryHost', DELIVERY_HOSTS[0]), inventory.get('httpTransport', 'stdlib'),
               str(timing(inventory)[0]), str(timing(inventory)[1]), str(workers_per_node(node)),
               str(node.get('logicalCpuCount',4)), provenance['clientSha256'],
               provenance['orchestrationSha256'], provenance['configurationSha256']]
    timeout = max(30,math.ceil(inventory['startAtUnix']-time.time())+30+timing(inventory)[0]+50)
    try:
        result = subprocess.run(command,input=REMOTE_SCRIPT.encode(),capture_output=True,timeout=timeout)
        if result.returncode != 0:
            return {'errorClass':'RemoteControllerFailed','exitCode':result.returncode,
                    'stderrBytes':len(result.stderr)}
        if len(result.stdout)>10000000:
            return {'errorClass':'OversizeNodeReport'}
        return json.loads(result.stdout)
    except Exception as exc:
        # Do not print remote stderr or token-bearing command output.
        return {'errorClass':type(exc).__name__}


def main(args):
    inventory = validate_inventory(json.loads(args.inventory.read_text(encoding='utf-8-sig')))
    provenance = reproducibility_metadata(inventory)
    if not pathlib.Path(IDENTITY).is_file():
        raise ValueError('Expected existing deployment identity is missing')
    ordered = [None]*len(inventory['generators'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(ordered)) as pool:
        pending = {pool.submit(run_node,node,inventory,provenance):index for index,node in enumerate(inventory['generators'])}
        for future in concurrent.futures.as_completed(pending):
            index = pending[future]
            ordered[index] = future.result()
            print(json.dumps({'generatorCompleted':inventory['generators'][index]['label'],
                              'controllerReportReceived':'nodeReport' in ordered[index]}),file=sys.stderr,flush=True)
    summary = aggregate(inventory,ordered)
    artifact = {'summary':summary,'inventory':inventory,'nodeResults':ordered,
                'provenance':provenance}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temporary = args.output.with_name(args.output.name+'.incoming')
    temporary.write_text(json.dumps(artifact,indent=2)+'\n',encoding='utf-8')
    temporary.replace(args.output)
    print(json.dumps({'report':str(args.output.resolve()),'requestedClients':summary['requestedClients'],
                      'peakConcurrentRecentMediaClients':summary['peakConcurrentRecentMediaClients'],
                      'longestCommonFullMediaSpanSeconds':summary['longestCommonFullMediaSpanSeconds'],
                      'httpDeliveryChecksPassed':summary['httpDeliveryChecksPassed'],
                      'failureReasons':summary['failureReasons'],'certifiesProductionCapacity':False}),flush=True)
    return 0 if summary['httpDeliveryChecksPassed'] else 2


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    try:
        raise SystemExit(main(args))
    except Exception as exc:
        print(json.dumps({'errorClass':type(exc).__name__,
                          'message':'Orchestration failed. No token or remote stderr content was printed.'}),file=sys.stderr)
        raise SystemExit(2)
