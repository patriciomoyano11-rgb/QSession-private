"""Publish only the reviewed browser video handoff fix; preserve live DJ and limits."""
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.request
import yaml

release = pathlib.Path('/opt/qsession/releases/qsession-20261018-camera-clock-v4')
payload = release / 'payload'
deployment = pathlib.Path('/opt/qsession/platform/deploy')
container = 'qsession-qsession-app-1'
baseline = json.loads((payload / 'baseline.json').read_text())

def status():
    with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=5) as response:
        return json.load(response)

def selected_room():
    with urllib.request.urlopen('http://127.0.0.1:8090/api/rooms/JNTUBY', timeout=5) as response:
        room = json.load(response)['room']
    return {key: room.get(key) for key in ['status', 'capacity', 'capacityMode', 'billingPlan', 'broadcastEventPlan']}

def stream():
    code = """const {EgressClient,RoomServiceClient}=require('livekit-server-sdk');const e=process.env;
const api=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
(async()=>{const rs=new RoomServiceClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const eg=new EgressClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const p=await rs.listParticipants('qsession-JNTUBY');const jobs=await eg.listEgress({roomName:'qsession-JNTUBY',active:true});
console.log(JSON.stringify({dj:p.some(x=>x.identity==='dj-primary-jntuby'),jobs:jobs.map(x=>x.egressId).sort()}));
})().catch(()=>{console.error('Stream continuity unavailable');process.exit(1)});"""
    return json.loads(subprocess.check_output(['docker', 'exec', container, 'node', '-e', code], text=True))

def wait_healthy():
    for _ in range(35):
        try:
            value = status()
            if value.get('ok'):
                return value
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Application did not become healthy')

for file, digest in baseline.items():
    raw = subprocess.check_output(['docker', 'exec', container, 'cat', '/app/' + file])
    if hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest() != digest:
        raise SystemExit('Published baseline changed: ' + file)
before = status()
if not before.get('ok') or before['scale']['broadcast']['audienceMode'] != 'interactive':
    raise SystemExit('Expected healthy interactive audience mode')
before_room, before_stream = selected_room(), stream()
inspect = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
base = 'qsession-app:camera-clock-20261018-base-v4'
subprocess.run(['docker', 'tag', inspect['Image'], base], check=True)
(release / 'Dockerfile').write_text('FROM ' + base + '\n' + '\n'.join(
    'COPY payload/' + file + ' /app/' + file for file in baseline) + '\n')
image = 'qsession-app:qsession-20261018-camera-clock-v4'
subprocess.run(['docker', 'build', '-q', '-t', image, str(release)], check=True)
override = deployment / 'compose.release.yml'
original = override.read_text()
(release / 'compose.release.before.yml').write_text(original)
config = yaml.safe_load(original)
config['services']['qsession-app']['image'] = image
compose = ['docker', 'compose', '-f', str(deployment / 'compose.yml'), '-f', str(override)]
try:
    override.write_text(yaml.safe_dump(config, sort_keys=False))
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    after = wait_healthy()
    if after['scale']['broadcast']['audienceMode'] != 'interactive' or selected_room() != before_room or stream() != before_stream:
        raise RuntimeError('Audience mode, selected room or DJ stream changed')
except Exception:
    override.write_text(original)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    wait_healthy()
    raise
for file in baseline:
    for root in [pathlib.Path('/opt/qsession/platform'), pathlib.Path('/opt/qsession/releases/qsession-20261007-host-music-v2/platform')]:
        dest = root / file
        dest.parent.mkdir(parents=True, exist_ok=True)
        backup = dest.with_name(dest.name + '.before-edge-video-20261018')
        if dest.exists() and not backup.exists():
            backup.write_bytes(dest.read_bytes())
        dest.write_bytes((payload / file).read_bytes())
result = {'published': True, 'healthy': True, 'image': image, 'audienceMode': 'interactive',
          'jntubyPlanAndStreamUnchanged': True, 'capacityCertified': False,
          'files': list(baseline), 'physicalIncognitoRetest': 'pending'}
(release / 'result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
