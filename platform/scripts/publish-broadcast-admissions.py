"""Deploy dormant 10k admissions plus a one-hour, synthetic-only validation scope.

No production room is activated or upgraded by this publication. Existing billing
and the separate DJ/encoder connection are checked before and after replacement.
The temporary technical scope is disabled/removed after delivery validation.
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess
import time
import urllib.request

release=pathlib.Path('/opt/qsession/releases/qsession-20261018-cdn-admissions-v1')
payload=release/'payload'
deployment=pathlib.Path('/opt/qsession/platform/deploy')
container='qsession-qsession-app-1'
baseline=json.loads((payload/'baseline.json').read_text())
def app(code):
    return subprocess.check_output(['docker','exec',container,'node','-e',code],text=True)
def state():
    with urllib.request.urlopen('http://127.0.0.1:8090/api/status',timeout=5) as response:return json.load(response)
def room():
    with urllib.request.urlopen('http://127.0.0.1:8090/api/rooms/JNTUBY',timeout=5) as response:
        value=json.load(response)['room']
    return {k:value.get(k) for k in ['code','status','capacity','capacityMode','billingPlan']}
def stream():
    return json.loads(app("""const {EgressClient,RoomServiceClient}=require('livekit-server-sdk');const e=process.env;
const api=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
(async()=>{const eg=new EgressClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET),rs=new RoomServiceClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const jobs=await eg.listEgress({roomName:'qsession-JNTUBY',active:true});const p=await rs.listParticipants('qsession-JNTUBY');
console.log(JSON.stringify({jobs:jobs.map(j=>j.egressId).sort(),dj:p.some(x=>x.identity==='dj-primary-jntuby')}));
})().catch(()=>{console.error('Selected stream continuity unavailable');process.exit(1)});"""))
for file,digest in baseline.items():
    raw=subprocess.check_output(['docker','exec',container,'cat','/app/'+file])
    if hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest()!=digest:raise SystemExit('Baseline changed: '+file)
if state()['scale']['broadcast']['audienceMode']!='interactive':raise SystemExit('Expected dormant audience mode')
if app("process.stdout.write(String(process.env.QSESSION_BROADCAST_AUDIENCE_TARGET||'500000'))").strip()!='10000':raise SystemExit('Unexpected broadcast target')
if app('process.stdout.write(String(process.getuid()))').strip()!='1000':raise SystemExit('Unexpected application UID')
before_room,before_stream=room(),stream()
inspect=json.loads(subprocess.check_output(['docker','inspect',container]))[0]
base='qsession-app:cdn-admissions-20261018-base'
subprocess.run(['docker','tag',inspect['Image'],base],check=True)
files=list(baseline)+['broadcast-admissions.js','broadcast-event-plan.js']
(release/'Dockerfile').write_text('FROM '+base+'\n'+'\n'.join('COPY payload/'+p+' /app/'+p for p in files)+'\n')
image='qsession-app:qsession-20261018-cdn-admissions-v1'
subprocess.run(['docker','build','-q','-t',image,str(release)],check=True)

private=deployment/'private'
private.mkdir(exist_ok=True,mode=0o700)
key=(private/'broadcast-admission.key').read_text().strip()
if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}',key):raise SystemExit('Admission key missing or invalid')
room_id=app("""const fs=require('node:fs');const s=JSON.parse(fs.readFileSync(process.env.QSESSION_DATA_FILE,'utf8'));
const r=[...s.rooms].reverse().find(r=>r.code==='JNTUBY'&&r.status!=='archived');if(!r)process.exit(1);process.stdout.write(r.id);""").strip()
now=datetime.datetime.now(datetime.timezone.utc)
stamp=lambda d:d.isoformat(timespec='milliseconds').replace('+00:00','Z')
probe={'schemaVersion':1,'code':'PRB10A','prefix':'live/PRB10A-hWrdBkirH_2yHmZ9lp',
       'generation':'synthetic-'+secrets.token_hex(8),'issuedAt':stamp(now),'expiresAt':stamp(now+datetime.timedelta(hours=1)),'capacity':10000}
grant={'schemaVersion':1,'planId':'broadcast-event-10000','status':'prepared','roomCode':'JNTUBY','roomId':room_id,
       'targetViewers':10000,'maxParticipants':10000,'approvedBy':'Usuario de este chat de QSession',
       'authorizationReference':'2026-10-18: autorización explícita «ok hagamoslo» para preparar y vincular el evento de 10.000, probar con hasta US$5 temporales y activar sólo tras comprobar su preparación. Sin nueva tarifa, cobro ni ampliación a 500.000.',
       'issuedAt':stamp(now),'expiresAt':stamp(now+datetime.timedelta(hours=24))}
for name,value in [('broadcast-admission-probe.json',probe),('broadcast-event-plan.json',grant)]:
    dest=private/name
    dest.write_text(json.dumps(value,ensure_ascii=False))
    os.chown(dest,1000,0);dest.chmod(0o400)

override=deployment/'compose.release.yml'
env_path=deployment/'qsession.env'
original_override=override.read_text()
original_env=env_path.read_text()
backup=release/'private'
backup.mkdir(mode=0o700,exist_ok=True)
for name,source in [('compose.release.before.yml',original_override),('qsession.env.before',original_env)]:
    target=backup/name;target.write_text(source);target.chmod(0o600)
changes={'QSESSION_BROADCAST_ADMISSION_SECRET':key,
         'QSESSION_BROADCAST_ADMISSION_PROBE_FILE':'/run/qsession/broadcast-admission-probe.json',
         'QSESSION_BROADCAST_EVENT_PLAN_FILE':'/run/qsession/broadcast-event-plan.json'}
updated_env=original_env
for name,value in changes.items():
    updated_env=re.sub(r'^'+re.escape(name)+r'=.*\n?','',updated_env,flags=re.M)
    updated_env=updated_env.rstrip()+'\n'+name+'='+value+'\n'
# Parse/rewrite only the override. Base services, LiveKit and encoder are untouched.
import yaml
config=yaml.safe_load(original_override)
service=config['services']['qsession-app']
service['image']=image
volumes=service.setdefault('volumes',[])
for name in ['broadcast-admission-probe.json','broadcast-event-plan.json']:
    target='/run/qsession/'+name
    volumes[:]=[v for v in volumes if not (isinstance(v,str) and ':'+target+':' in v)]
    volumes.append(str(private/name)+':'+target+':ro')
updated_override=yaml.safe_dump(config,sort_keys=False)
compose=['docker','compose','-f',str(deployment/'compose.yml'),'-f',str(override)]
try:
    env_path.write_text(updated_env);env_path.chmod(0o600)
    override.write_text(updated_override)
    subprocess.run(compose+['up','-d','--no-deps','--no-build','qsession-app'],check=True)
    healthy=False
    for _ in range(30):
        try:
            health=state()
            if health.get('ok'):healthy=True;break
        except Exception:pass
        time.sleep(1)
    if not healthy or health['scale']['broadcast']['audienceMode']!='interactive':raise RuntimeError('Health/mode check failed')
    if room()!=before_room or stream()!=before_stream:raise RuntimeError('Room limits or independent DJ stream changed')
    with urllib.request.urlopen('http://127.0.0.1:8090/api/rooms/JNTUBY',timeout=5) as response:
        prepared=json.load(response)['room'].get('broadcastEventPlan',{})
    if prepared.get('status')!='prepared' or prepared.get('effectiveMaxParticipants') is not None:raise RuntimeError('Expected dormant event authorization')
except Exception:
    override.write_text(original_override);env_path.write_text(original_env);env_path.chmod(0o600)
    subprocess.run(compose+['up','-d','--no-deps','--no-build','qsession-app'],check=True)
    raise
for file in files:
    for source in [pathlib.Path('/opt/qsession/platform'),pathlib.Path('/opt/qsession/releases/qsession-20261007-host-music-v2/platform')]:
        dest=source/file
        if dest.exists():
            saved=dest.with_name(dest.name+'.before-cdn-admissions-20261018')
            if not saved.exists():saved.write_bytes(dest.read_bytes())
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((payload/file).read_bytes())
report={'published':True,'healthy':True,'image':image,'audienceMode':'interactive','capacityCertified':False,
        'jntubyPlanAndStreamUnchanged':True,'event10000Prepared':True,'event10000Effective':False,
        'syntheticOnlyProbeEnabled':True,'probeExpiresAt':probe['expiresAt'],'probeGeneration':probe['generation']}
(release/'result.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
