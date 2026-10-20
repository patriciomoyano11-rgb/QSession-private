"""Local official workerd test: no Cloudflare sign-in or remote resources."""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import subprocess
import threading
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG = ROOT / 'release/shared-cache-local/wrangler.json'
WRANGLER = ROOT / 'release/cloudflare-tools/node_modules/wrangler/bin/wrangler.js'
PRIVATE = ROOT / 'private/cloudflare-cli'
STATE = PRIVATE / 'local-state'
ENV = {**os.environ, 'XDG_CONFIG_HOME': str(PRIVATE), 'WRANGLER_LOG_PATH': str(PRIVATE / 'logs'),
       'WRANGLER_SEND_METRICS': 'false', 'NO_COLOR': '1'}

def main():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    fixture = PRIVATE / 'local-segment-fixture.ts'
    data = b'G' * 1431620
    fixture.write_bytes(data)
    base = ['node', str(WRANGLER)]
    put = subprocess.run(base + ['r2', 'object', 'put',
        'qsession-local-fixture/live/PRB10A-abcdefghijklmnopqr/segment_fixture.ts',
        '--local', '--persist-to', str(STATE), '--file', str(fixture), '--config', str(CONFIG)],
        cwd=ROOT, env=ENV, capture_output=True, timeout=45)
    if put.returncode: raise RuntimeError('Local fixture setup failed')
    process = subprocess.Popen(base + ['dev', '--local', '--ip', '127.0.0.1', '--port', '8789',
        '--persist-to', str(STATE), '--config', str(CONFIG)], cwd=ROOT, env=ENV,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    errors = []
    def drain():
        for line in process.stdout:
            if b'error' in line.lower(): errors.append(True)
    thread = threading.Thread(target=drain, daemon=True); thread.start()
    report = {'localOnly': True, 'authenticatedToCloudflare': False, 'remoteResourcesCreated': 0,
              'runtime': 'official workerd via Wrangler 4.151.1', 'capacityCertified': False}
    try:
        def get(index):
            request = urllib.request.Request('http://127.0.0.1:8789/segment_fixture.ts',
                headers={'Range': 'bytes=0-187'} if index < 16 else {})
            with urllib.request.urlopen(request, timeout=12) as response:
                body = response.read()
                assert response.status == (206 if index < 16 else 200)
                assert len(body) == (188 if index < 16 else len(data))
                assert body == (data[:188] if index < 16 else data)
                assert response.headers['Content-Length'] == str(len(body))
                return response.headers.get('X-QSession-Shared-Cache')
        for _ in range(100):
            if process.poll() is not None: raise RuntimeError('Local runtime stopped')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8789/not-fixture', timeout=.3): pass
            except urllib.error.HTTPError as error:
                if error.code == 404: break
            except OSError: time.sleep(.15)
        else: raise RuntimeError('Local runtime not ready')
        with concurrent.futures.ThreadPoolExecutor(max_workers=32) as executor:
            values = list(executor.map(get, range(96)))
        report.update(passed=True, correctResponses=len(values), fullSegments=80, nativeRanges=16,
                      cacheHits=values.count('HIT'), cacheMisses=values.count('MISS'),
                      fixtureSha256=hashlib.sha256(data).hexdigest())
    finally:
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=15)
        process.wait(timeout=15)
        report['localRuntimeStopped'] = process.poll() is not None
        (ROOT / 'release/shared-cache-workerd-local-20261018.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))

if __name__ == '__main__': main()
