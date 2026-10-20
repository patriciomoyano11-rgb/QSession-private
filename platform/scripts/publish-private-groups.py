"""Run on the production host: overlay eight reviewed runtime files only."""
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.request
import yaml

RELEASE = pathlib.Path('/opt/qsession/releases/qsession-20261020-private-groups-v1')
PAYLOAD = RELEASE / 'payload'
DEPLOYMENT = pathlib.Path('/opt/qsession/platform/deploy')
CONTAINER = 'qsession-qsession-app-1'
EXPECTED_BASE = 'sha256:a5eecbb6fc0cb0af68f178799eed9b92140fc2743a7321b6767309dcfb3f6165'
IMAGE = 'qsession-app:qsession-20261020-private-groups-v1'
manifest = json.loads((RELEASE / 'manifest.json').read_text())
allowed = {'server.js', 'product-store.js', 'realtime-hub.js', 'edge-broadcast.js',
           'mass-broadcast-readiness.js', 'public/app.js', 'public/index.html', 'public/sw.js'}
if set(manifest) != allowed or (RELEASE / 'result.json').exists():
    raise SystemExit('Unexpected release payload or an already recorded outcome')

def health():
    with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=5) as response:
        return json.load(response)

def media_snapshot():
    # Extract identifiers only; Egress configuration can contain storage keys.
    code = """const {EgressClient,RoomServiceClient}=require('livekit-server-sdk');const e=process.env;
const api=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
(async()=>{const rs=new RoomServiceClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const eg=new EgressClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const rooms=await rs.listRooms();const jobs=await eg.listEgress({active:true});
const hosts=[];for(const r of rooms){const p=await rs.listParticipants(r.name);
for(const x of p)if(x.identity.startsWith('dj-'))hosts.push(r.name+':'+x.identity);}
console.log(JSON.stringify({hosts:hosts.sort(),jobs:jobs.map(x=>x.egressId).sort()}));
})().catch(()=>{console.error('Media continuity check failed');process.exit(1)});"""
    return json.loads(subprocess.check_output(['docker', 'exec', CONTAINER, 'node', '-e', code], text=True, timeout=30))

def wait_healthy():
    for _ in range(40):
        try:
            value = health()
            if value.get('ok'):
                return value
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Application did not recover its health')

actual_image = subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', CONTAINER], text=True).strip()
if actual_image != EXPECTED_BASE:
    raise SystemExit('The running image no longer matches the reviewed baseline')
for name, hashes in manifest.items():
    raw = subprocess.check_output(['docker', 'exec', CONTAINER, 'cat', '/app/' + name])
    if hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest() != hashes['beforeSha256']:
        raise SystemExit('Published source changed: ' + name)
    if hashlib.sha256((PAYLOAD / name).read_bytes()).hexdigest() != hashes['afterSha256']:
        raise SystemExit('Reviewed payload changed: ' + name)
before = health()
if not before.get('ok') or before['scale']['broadcast']['audienceMode'] != 'interactive':
    raise SystemExit('Expected a healthy interactive app; do not change an active CDN cutover')
before_media = media_snapshot()
override = DEPLOYMENT / 'compose.release.yml'
original = override.read_text()
(RELEASE / 'compose.release.before.yml').write_text(original)
base = 'qsession-app:private-groups-20261020-reviewed-base-v1'
subprocess.run(['docker', 'tag', actual_image, base], check=True)
(RELEASE / 'Dockerfile').write_text('FROM ' + base + '\n' + '\n'.join(
    'COPY payload/' + name + ' /app/' + name for name in sorted(allowed)) + '\n')
subprocess.run(['docker', 'build', '-q', '-t', IMAGE, str(RELEASE)], check=True)
for name in ['server.js', 'product-store.js', 'edge-broadcast.js', 'realtime-hub.js', 'mass-broadcast-readiness.js', 'public/app.js', 'public/sw.js']:
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--cpus', '0.5', '--memory', '256m',
                    '--entrypoint', 'node', IMAGE, '--check', '/app/' + name], check=True)
config = yaml.safe_load(original)
config['services']['qsession-app']['image'] = IMAGE
compose = ['docker', 'compose', '-f', str(DEPLOYMENT / 'compose.yml'), '-f', str(override)]
try:
    override.write_text(yaml.safe_dump(config, sort_keys=False))
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    after = wait_healthy()
    if after['scale']['broadcast']['audienceMode'] != 'interactive' or media_snapshot() != before_media:
        raise RuntimeError('Media continuity or audience mode changed during the release')
    for name, hashes in manifest.items():
        raw = subprocess.check_output(['docker', 'exec', CONTAINER, 'cat', '/app/' + name])
        if hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest() != hashes['afterSha256']:
            raise RuntimeError('Running payload verification failed')
except Exception:
    override.write_text(original)
    subprocess.run(compose + ['up', '-d', '--no-deps', '--no-build', 'qsession-app'], check=True)
    wait_healthy()
    raise
for name in allowed:
    for root in [pathlib.Path('/opt/qsession/platform'), pathlib.Path('/opt/qsession/releases/qsession-20261007-host-music-v2/platform')]:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        backup = target.with_name(target.name + '.before-private-groups-20261020')
        if target.exists() and not backup.exists():
            backup.write_bytes(target.read_bytes())
        target.write_bytes((PAYLOAD / name).read_bytes())
report = {'published': True, 'healthy': True, 'image': IMAGE, 'audienceMode': 'interactive',
          'files': sorted(allowed), 'djConnectionsAndMediaJobsUnchanged': True,
          'mainAudioPublisher': 'dj-only', 'maximumPrivateGroupMembers': 10,
          'physicalDeviceRetest': 'pending', 'capacityCertified': False,
          'capacityExpanded': False, 'cloudResourcesCreated': 0}
(RELEASE / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
