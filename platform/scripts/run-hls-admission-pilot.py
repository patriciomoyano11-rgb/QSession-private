"""Run only on the encoder: one technical HLS client and a bounded synthetic origin.

No token, authorized URL or response body is printed. Does not touch JNTUBY.
"""
import importlib.util
import argparse
import concurrent.futures
import collections
import json
import os
import pathlib
import re
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path('/opt/qsession-encoder')
PYTHON = ROOT / 'probe-venv/bin/python'
ORIGIN = ROOT / 'ops/synthetic-hls-origin.py'
RUNNER = ROOT / 'ops/hls-load-client.py'
TOKENS = ROOT / 'private/probe-tokens.json'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def fetch_details(url, maximum, extra_headers=None):
    request = urllib.request.Request(url, headers={'User-Agent': 'QSessionIsolatedAdmissionPilot/1.1',
        'Origin': 'https://qsession.org', **(extra_headers or {})})
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=8) as response:
            body = response.read(maximum+1)
            if len(body) > maximum:
                raise ValueError('Oversize technical response')
            return response.status, body, {name: response.headers.get(name) for name in
                ('Content-Length', 'Content-Range', 'Content-Type', 'X-QSession-Edge-Cache',
                 'X-QSession-Cache-Fill', 'CF-Ray')}
    except urllib.error.HTTPError as exc:
        body = exc.read(maximum+1)
        return exc.code, body if len(body) <= maximum else b'', {}


def fetch(url, maximum):
    status, body, _ = fetch_details(url, maximum)
    return status, body


def main(args):
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location('hls_client', RUNNER)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.configure_delivery_host(args.delivery_host, allow_known_canary=True)
    tokens = runner.read_tokens(TOKENS, 1)
    token = tokens[0]
    url = runner.URL + '?' + urllib.parse.urlencode({'qsat': token})
    report = {'synthetic': True, 'requestedClients': 1, 'startedAtUnix': time.time(),
              'certifiesProductionCapacity': False, 'decodedPlaybackTested': False,
              'deliveryHost': args.delivery_host}
    process = None
    try:
        report['unauthorizedManifestStatus'], _ = fetch(runner.URL, 65536)
        if report['unauthorizedManifestStatus'] != 403:
            raise ValueError('Technical origin was not protected')
        with tempfile.TemporaryDirectory(prefix='qsession-admission-pilot-') as directory:
            log = pathlib.Path(directory) / 'origin.jsonl'
            with open(log, 'xb') as output:
                process = subprocess.Popen([str(PYTHON), str(ORIGIN), '--duration', '90',
                                            '--delivery-host', args.delivery_host, '--known-canary'],
                                           stdout=output, stderr=subprocess.DEVNULL, start_new_session=True)
                ready = None
                deadline = time.monotonic()+20
                while time.monotonic() < deadline and process.poll() is None:
                    for line in log.read_text().splitlines():
                        item = json.loads(line)
                        if item.get('originReady'):
                            ready = item
                            break
                    if ready:
                        break
                    time.sleep(.2)
                if not ready:
                    raise ValueError('Synthetic origin did not become ready')
                report['originRunId'] = ready['runId']
                report['firstAuthorizedGetAtUnix'] = time.time()
                report['authorizedManifestStatus'], manifest = fetch(url, 65536)
                if report['authorizedManifestStatus'] != 200:
                    public_errors = {'La admisión de espectadores no está disponible',
                        'No se pudo comprobar el aforo; vuelve a intentarlo',
                        'La admisión ha finalizado', 'Acceso de reproducción denegado',
                        'La señal todavía no está disponible'}
                    text = manifest.decode('utf-8', errors='replace')
                    report['publicWorkerFailure'] = text if text in public_errors else 'unclassified-public-failure'
                    raise ValueError('Authorized manifest unavailable')
                segments = runner.parse_manifest(manifest.decode(), token)['segments']
                report['manifestTokensPreserved'] = True
                native_url = segments[-1]['url']
                with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                    burst=list(pool.map(lambda _:fetch_details(native_url,188,{'Range':'bytes=0-187'}),range(16)))
                report['coldNativeBurst']={'requests':16,'correctRanges':sum(status==206 and len(data)==188 and data[:1]==b'G' for status,data,_ in burst),
                    'cache':dict(collections.Counter(headers.get('X-QSession-Edge-Cache','absent') for _,_,headers in burst)),
                    'fill':dict(collections.Counter(headers.get('X-QSession-Cache-Fill','absent') or 'absent' for _,_,headers in burst))}
                if report['coldNativeBurst']['correctRanges']!=16:raise ValueError('Concurrent native ranges failed')
                status, data, headers = fetch_details(native_url, 188, {'Range': 'bytes=0-187'})
                report['nativeFirstRange'] = {'status': status, 'bytes': len(data), 'headers': headers}
                if status != 206 or len(data) != 188 or data[:1] != b'G':
                    raise ValueError('Cold native byte range failed')
                status, data, headers = fetch_details(native_url, 188, {'Range': 'bytes=188-375'})
                report['nativeCachedRange'] = {'status': status, 'bytes': len(data), 'headers': headers}
                report['nativeRangesVerified'] = (status == 206 and len(data) == 188
                                                   and headers.get('X-QSession-Edge-Cache') == 'HIT')
                without_token = urllib.parse.urlunparse(urllib.parse.urlparse(native_url)._replace(query=''))
                report['unauthorizedWarmRangeStatus'], _ = fetch(without_token, 65536)
                if report['unauthorizedWarmRangeStatus'] != 403:
                    raise ValueError('Warm range bypassed authorization')
                report['authorizedSegmentStatus'], segment, headers = fetch_details(segments[-1]['url'], 3000000)
                report['authorizedSegmentHeaders'] = headers
                report['authorizedSegmentBytes'] = len(segment)
                if report['authorizedSegmentStatus'] != 200 or len(segment) < 1100000:
                    raise ValueError('Authorized media unavailable')
                status, data, headers = fetch_details(native_url, 188, {'Range': 'bytes=376-563'})
                report['nativeRangeAfterFullGet'] = {'status': status, 'bytes': len(data), 'headers': headers}
                before = time.monotonic()
                client = subprocess.run([str(PYTHON), str(RUNNER), '--clients', '1', '--ramp', '1', '--hold', '28',
                                         '--tokens-file', str(TOKENS), '--delivery-host', args.delivery_host,
                                         '--transport', args.transport], capture_output=True, timeout=40)
                report['runnerExitCode'] = client.returncode
                report['runner'] = json.loads(client.stdout)
                report['renewalObservationElapsedSeconds'] = round(time.monotonic()-before, 3)
                report['authorizedAfter20SecondsStatus'], _ = fetch(url, 65536)
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)
            for line in log.read_text().splitlines():
                item = json.loads(line)
                if item.get('originReport'):
                    report['origin'] = item['originReport']
            report['originCleanupComplete'] = report.get('origin', {}).get('cleanupComplete') is True
    except Exception as exc:
        report['errorClass'] = type(exc).__name__
    finally:
        if process and process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)
        report['endedAtUnix'] = time.time()
        report['passed'] = (not report.get('errorClass') and report.get('runnerExitCode') == 0
                             and report.get('nativeRangesVerified') is True
                             and report.get('authorizedAfter20SecondsStatus') == 200
                             and report.get('originCleanupComplete') is True)
        destination = ROOT / 'ops/admission-pilot-report.json'
        destination.write_text(json.dumps(report))
        destination.chmod(0o600)
        print(json.dumps(report), flush=True)
    return 0 if report['passed'] else 2


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--delivery-host', choices=('qsession-live.patriciomoyano11.workers.dev','live.qsession.org'),
                        default='qsession-live.patriciomoyano11.workers.dev')
    parser.add_argument('--transport', choices=('stdlib','aiohttp'), default='stdlib')
    args=parser.parse_args()
    try:
        raise SystemExit(main(args))
    except Exception as exc:
        print(json.dumps({'errorClass': type(exc).__name__, 'detailsSuppressed': True}), flush=True)
        raise SystemExit(2)
