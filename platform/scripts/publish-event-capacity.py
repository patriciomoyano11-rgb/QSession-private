"""Publish only reviewed event quotation/limit files on the existing app image."""
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.request

release = pathlib.Path('/opt/qsession/releases/qsession-20261018-event-capacity-v1')
payload = release / 'payload'
deployment = pathlib.Path('/opt/qsession/platform/deploy')
container = 'qsession-qsession-app-1'
manifest = json.loads((payload / 'baseline.json').read_text())


def digest(raw):
    return hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest()


def app_code(code):
    return subprocess.check_output(['docker', 'exec', container, 'node', '-e', code], text=True)


def status():
    with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=5) as response:
        return json.load(response)


def room_snapshot():
    code = """const {RoomServiceClient,EgressClient}=require('livekit-server-sdk');
const e=process.env;const api=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
(async()=>{const rs=new RoomServiceClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const eg=new EgressClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const participants=await rs.listParticipants('qsession-JNTUBY');
const jobs=await eg.listEgress({roomName:'qsession-JNTUBY',active:true});
console.log(JSON.stringify({djConnected:participants.some(p=>p.identity==='dj-primary-jntuby'),jobs:jobs.map(j=>j.egressId).sort()}));
})().catch(()=>{console.error('Selected-room continuity check unavailable');process.exit(1)});"""
    return json.loads(app_code(code))


for file, expected in manifest.items():
    raw = subprocess.check_output(['docker', 'exec', container, 'cat', '/app/' + file])
    if digest(raw) != expected:
        raise SystemExit('Published baseline changed: ' + file)
before = status()
if not before.get('ok') or before['scale']['broadcast']['audienceMode'] != 'interactive':
    raise SystemExit('Expected healthy interactive mode before publication')
before_room = room_snapshot()
with urllib.request.urlopen('http://127.0.0.1:8090/api/rooms/JNTUBY', timeout=5) as response:
    room = json.load(response)['room']
    before_limits = {key: room.get(key) for key in ['capacity', 'capacityMode', 'billingPlan']}
inspect = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
base = 'qsession-app:event-capacity-20261018-base'
subprocess.run(['docker', 'tag', inspect['Image'], base], check=True)
copies = '\n'.join('COPY payload/' + file + ' /app/' + file for file in manifest)
(release / 'Dockerfile').write_text('FROM ' + base + '\n' + copies + '\n')
image = 'qsession-app:qsession-20261018-event-capacity-v1'
subprocess.run(['docker', 'build', '-q', '-t', image, str(release)], check=True)
override = deployment / 'compose.release.yml'
original = override.read_text()
(release / 'compose.release.before.yml').write_text(original)
updated = original.replace('image: ' + inspect['Config']['Image'], 'image: ' + image, 1)
if updated == original:
    raise SystemExit('Active image not found in deployment override')
compose = ['docker', 'compose', '-f', str(deployment / 'compose.yml'), '-f', str(override)]
try:
    override.write_text(updated)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    healthy = False
    for _ in range(30):
        try:
            result = status()
            if result.get('ok'):
                healthy = True
                break
        except Exception:
            pass
        time.sleep(1)
    if not healthy or result['scale']['broadcast']['audienceMode'] != 'interactive':
        raise RuntimeError('Application health or audience mode changed unexpectedly')
    runtime = json.loads(app_code("""const {calculateCustomRoomQuote:q}=require('./custom-room-pricing');
const a=q({capacity:10000}),b=q({capacity:12345});
console.log(JSON.stringify({capacity:a.capacity,requiresReview:a.requiresReview,capacityValidated:a.capacityValidated,manual:b.capacity}));"""))
    if runtime != {'capacity': 10000, 'requiresReview': True, 'capacityValidated': False, 'manual': 12345}:
        raise RuntimeError('Runtime quotation check failed')
    with urllib.request.urlopen('http://127.0.0.1:8090/api/rooms/JNTUBY', timeout=5) as response:
        room = json.load(response)['room']
        after_limits = {key: room.get(key) for key in ['capacity', 'capacityMode', 'billingPlan']}
    after_room = room_snapshot()
    if before_limits != after_limits or before_room != after_room:
        raise RuntimeError('Selected room state or independent broadcast changed')
except Exception:
    override.write_text(original)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    raise

for file in manifest:
    for source in [pathlib.Path('/opt/qsession/platform'), pathlib.Path('/opt/qsession/releases/qsession-20261007-host-music-v2/platform')]:
        destination = source / file
        if not destination.exists():
            continue
        backup = destination.with_name(destination.name + '.before-event-capacity-20261018')
        if not backup.exists():
            backup.write_bytes(destination.read_bytes())
        destination.write_bytes((payload / file).read_bytes())
report = {'published': True, 'image': image, 'healthy': True, 'audienceMode': 'interactive',
          'roomLimitsUnchanged': True, 'djConnectionAndEgressUnchanged': True,
          'quote10000RequiresReview': True, 'quoteManualExact': 12345,
          'capacityCertified': False, 'files': list(manifest)}
(release / 'result.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
