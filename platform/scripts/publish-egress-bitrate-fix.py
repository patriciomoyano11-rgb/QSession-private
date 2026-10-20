"""Production-only narrow, reversible encoding-units correction. No audience activation."""
import hashlib
import json
import pathlib
import re
import subprocess
import time
import urllib.request

def run(*args):
    return subprocess.check_output(args, text=True).strip()

container = 'qsession-qsession-app-1'
check = '''const {RoomServiceClient}=require('livekit-server-sdk');
const e=process.env; const u=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
new RoomServiceClient(u,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).listRooms()
.then(r=>console.log(r.reduce((n,x)=>n+Number(x.numParticipants||0),0)))
.catch(()=>process.exit(1));'''
if int(run('docker', 'exec', container, 'node', '-e', check)):
    raise SystemExit('Media participants connected; defer app recreation.')
with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=5) as response:
    status = json.load(response)
if status['scale']['realtime']['connections']:
    raise SystemExit('App connections active; defer app recreation.')
inspect = json.loads(run('docker', 'inspect', container))[0]
deployment = pathlib.Path('/opt/qsession/platform/deploy')
override = deployment / 'compose.release.yml'
original_override = override.read_text()
old_image = inspect['Config']['Image']
release = pathlib.Path('/opt/qsession/releases/qsession-20261018-egress-segments-v1')
release.mkdir(exist_ok=True)
current = run('docker', 'exec', container, 'cat', '/app/edge-broadcast.js') + '\n'
patches = {
    'audioBitrate,\n': 'audioBitrate: Math.round(audioBitrate / 1000),\n',
    'videoBitrate,\n        keyFrameInterval:': 'videoBitrate: Math.round(videoBitrate / 1000),\n        keyFrameInterval:',
}
patched = current
# Restrict audio replacement to EncodingOptions, leaving estimates in bits/s.
start = patched.index('const encodingOptions = new EncodingOptions({')
end = patched.index('const info = await client.startParticipantEgress', start)
encoding = patched[start:end]
for before, after in patches.items():
    if encoding.count(after) == 1:
        continue
    if encoding.count(before) != 1:
        raise SystemExit('Expected encoding source changed; abort without modifying production.')
    encoding = encoding.replace(before, after, 1)
patched = patched[:start] + encoding + patched[end:]
before_prefix = 'filenamePrefix: `${outputPrefix}/segment`,'
after_prefix = "filenamePrefix: `${outputPrefix}/segment_${crypto.randomBytes(8).toString('hex')}`,"
if patched.count(before_prefix) != 1:
    raise SystemExit('Expected segment prefix changed; abort without modifying production.')
patched = patched.replace(before_prefix, after_prefix, 1)
source = release / 'edge-broadcast.js'
source.write_text(patched)
(release / 'edge-broadcast.before.js').write_text(current)
(release / 'compose.release.before.yml').write_text(original_override)
base = 'qsession-app:qsession-20261018-egress-segments-base'
subprocess.run(['docker', 'tag', inspect['Image'], base], check=True)
(release / 'Dockerfile').write_text('FROM ' + base + '\nCOPY edge-broadcast.js /app/edge-broadcast.js\n')
image = 'qsession-app:qsession-20261018-egress-segments-v1'
subprocess.run(['docker', 'build', '-q', '-t', image, str(release)], check=True)
updated = original_override.replace('image: ' + old_image, 'image: ' + image, 1)
if updated == original_override:
    raise SystemExit('Active compose image not found; no deployment applied.')
compose = ['docker', 'compose', '-f', str(deployment / 'compose.yml'), '-f', str(override)]
try:
    override.write_text(updated)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    healthy = False
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=2) as response:
                healthy = json.load(response).get('ok') is True
            if healthy:
                break
        except Exception:
            pass
        time.sleep(1)
    if not healthy:
        raise RuntimeError('Health check failed')
except Exception:
    override.write_text(original_override)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    raise
# Keep the recorded build sources aligned, without replacing other pending code.
paths = [pathlib.Path('/opt/qsession/platform/edge-broadcast.js'),
         pathlib.Path('/opt/qsession/releases/qsession-20261007-host-music-v2/platform/edge-broadcast.js')]
for destination in paths:
    before = destination.with_name('edge-broadcast.before-20261018-units.js')
    if not before.exists():
        before.write_bytes(destination.read_bytes())
    destination.write_text(patched)
print(json.dumps({'healthy': True, 'image': image,
                  'sourceSha256': hashlib.sha256(patched.encode()).hexdigest(),
                  'audienceModeChanged': False, 'rollback': str(release / 'compose.release.before.yml')}))
