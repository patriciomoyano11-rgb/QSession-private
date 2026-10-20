"""Deploy reviewed CDN admission/client code, leaving all audience activation off."""
import hashlib
import json
import pathlib
import re
import subprocess
import time
import urllib.request

release = pathlib.Path('/opt/qsession/releases/qsession-20261018-cdn-preparation-v1')
payload = release / 'payload'
deployment = pathlib.Path('/opt/qsession/platform/deploy')
container = 'qsession-qsession-app-1'
manifest = json.loads((payload / 'baseline.json').read_text())
for file, expected in manifest.items():
    raw = subprocess.check_output(['docker', 'exec', container, 'cat', '/app/' + file])
    if hashlib.sha256(raw).hexdigest() != expected:
        raise SystemExit('Published baseline changed: ' + file)
with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=5) as response:
    status = json.load(response)
if status['scale']['realtime']['connections']:
    raise SystemExit('Users connected; defer app recreation.')
inspect = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
base = 'qsession-app:qsession-20261018-cdn-preparation-base'
subprocess.run(['docker', 'tag', inspect['Image'], base], check=True)
for file in ['index.html', 'sw.js']:
    raw = subprocess.check_output(['docker', 'exec', container, 'cat', '/app/public/' + file]).decode()
    updated, count = re.subn(r'/app\.js\?v=[A-Za-z0-9_-]+', '/app.js?v=20261018-cdn-preparation-v1', raw)
    if not count:
        raise SystemExit('Client cache version missing: ' + file)
    if file == 'sw.js':
        updated = re.sub(r"const CACHE = '[^']+';", "const CACHE = 'qsession-20261018-cdn-preparation-v1';", updated, count=1)
    (payload / 'public' / file).write_text(updated)
(release / 'Dockerfile').write_text('FROM ' + base + '''
ENV QSESSION_BROADCAST_AUDIENCE_TARGET=10000
COPY payload/server.js payload/mass-broadcast-readiness.js /app/
COPY payload/public/app.js payload/public/index.html payload/public/sw.js /app/public/
COPY payload/scripts/check-mass-broadcast.cjs /app/scripts/
''')
image = 'qsession-app:qsession-20261018-cdn-preparation-v1'
subprocess.run(['docker', 'build', '-q', '-t', image, str(release)], check=True)
override = deployment / 'compose.release.yml'
original = override.read_text()
(release / 'compose.release.before.yml').write_text(original)
updated = original.replace('image: ' + inspect['Config']['Image'], 'image: ' + image, 1)
if updated == original:
    raise SystemExit('Active image not found in compose.')
compose = ['docker', 'compose', '-f', str(deployment / 'compose.yml'), '-f', str(override)]
try:
    override.write_text(updated)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    result = None
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=2) as response:
                result = json.load(response)
            if result.get('ok'):
                break
        except Exception:
            pass
        time.sleep(1)
    if not result or not result.get('ok') or result['scale']['broadcast']['audienceMode'] != 'interactive':
        raise RuntimeError('Expected healthy interactive mode after publication.')
except Exception:
    override.write_text(original)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    raise
print(json.dumps({'healthy': True, 'image': image, 'audienceMode': 'interactive',
                  'defaultFutureTarget': 10000, 'activatedEvent': None, 'capacityValidated': False}))
