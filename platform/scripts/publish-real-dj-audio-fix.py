"""Publish the tested Egress selector without restarting LiveKit or its encoder."""
import json
import pathlib
import shutil
import subprocess
import time
import urllib.request

container = 'qsession-qsession-app-1'
root = pathlib.Path('/opt/qsession/releases/qsession-20261018-real-dj-audio-v1')
source = root / 'edge-broadcast.js'
assert source.is_file()
verify = '''const {RoomServiceClient,EgressClient}=require('livekit-server-sdk');
(async()=>{const e=process.env;const u=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
const rooms=await new RoomServiceClient(u,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).listRooms();
if(rooms.some(r=>r.name!=='qsession-JNTUBY'&&r.numParticipants>0))process.exit(2);
const jobs=await new EgressClient(u,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).listEgress({roomName:'qsession-JNTUBY',active:true});
if(!jobs.some(j=>j.status===1))process.exit(3);
console.log('Selected room has an independent active CDN encoder.');
})().catch(()=>process.exit(1));'''
subprocess.run(['docker','exec',container,'node','-e',verify],check=True)
info = json.loads(subprocess.check_output(['docker','inspect',container]))[0]
base = 'qsession-app:qsession-20261018-real-dj-audio-base'
image = 'qsession-app:qsession-20261018-real-dj-audio-v1'
subprocess.run(['docker','tag',info['Image'],base],check=True)
(root / 'Dockerfile').write_text('FROM '+base+'\nCOPY edge-broadcast.js /app/edge-broadcast.js\n')
subprocess.run(['docker','build','-q','-t',image,str(root)],check=True)
deployment = pathlib.Path('/opt/qsession/platform/deploy')
override = deployment / 'compose.release.yml'
original = override.read_text()
updated = original.replace('image: '+info['Config']['Image'],'image: '+image,1)
assert updated != original
(root / 'compose.release.before.yml').write_text(original)
compose=['docker','compose','-f',str(deployment/'compose.yml'),'-f',str(override)]
try:
    override.write_text(updated)
    subprocess.run(compose+['up','-d','--no-deps','--no-build','qsession-app'],check=True)
    healthy = False
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8090/api/status',timeout=2) as response:
                healthy=json.load(response).get('ok') is True
            if healthy: break
        except Exception: pass
        time.sleep(1)
    if not healthy: raise RuntimeError('App health failed')
except Exception:
    override.write_text(original)
    subprocess.run(compose+['up','-d','--no-deps','--no-build','qsession-app'],check=True)
    raise
for directory in ['/opt/qsession/platform','/opt/qsession/releases/qsession-20261007-host-music-v2/platform']:
    destination = pathlib.Path(directory)/'edge-broadcast.js'
    backup=destination.with_name('edge-broadcast.before-real-dj-audio.js')
    if not backup.exists(): shutil.copyfile(destination,backup)
    shutil.copyfile(source,destination)
subprocess.run(['docker','exec',container,'node','-e',verify],check=True)
print(json.dumps({'appHealthy':True,'image':image,'livekitRestarted':False,'encoderRestarted':False,'massAudienceActivated':False}))
