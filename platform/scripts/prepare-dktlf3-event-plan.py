"""Run on production after probe cleanup: prepare only the approved DKTLF3 event.

Keeps interactive mode, commercial limits, image, media services and playback
hostname. API reload is necessary to read the private single-event grant.
"""
import datetime
import json
import os
import pathlib
import stat
import subprocess
import time
import urllib.request

APP='qsession-qsession-app-1'
PATH=pathlib.Path('/opt/qsession/platform/deploy/private/broadcast-event-plan.json')
BACKUP=PATH.with_name('broadcast-event-plan.before-DKTLF3-20261018.json')
ROOM_ID='room_53bd8f8b-aff9-4625-8e8e-9f679d08e423'
CHECK=r'''
const fs=require('node:fs'),path=require('node:path');const {createProductStore}=require('./product-store');
const {createClient}=require('redis');const {createBroadcastAdmissions}=require('./broadcast-admissions');const {EgressClient}=require('livekit-server-sdk');
(async()=>{const e=process.env;if((e.QSESSION_AUDIENCE_MODE||'interactive')!=='interactive'||e.QSESSION_BROADCAST_EVENT_PLAN_FILE!=='/run/qsession/broadcast-event-plan.json'||fs.existsSync('/tmp/qsession-probe-load-leases.json'))throw Error('mode_or_probe');
const store=createProductStore({filePath:e.QSESSION_DATA_FILE||path.join(process.cwd(),'data','qsession-state.json'),authPepper:e.QSESSION_AUTH_PEPPER||''});const r=store.getRoomRecord('DKTLF3');if(!r||r.id!=='room_53bd8f8b-aff9-4625-8e8e-9f679d08e423'||r.status!=='live')throw Error('room');
const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();const a=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
try{const p=JSON.parse(fs.readFileSync(e.QSESSION_BROADCAST_ADMISSION_PROBE_FILE,'utf8'));if(await a.count(p)!==0)throw Error('probe_leases');
const jobs=await new EgressClient((e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http'),e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).listEgress({roomName:'qsession-DKTLF3',active:true});
const fields=['id','code','status','capacity','capacityMode','billingPlan','startedAt','expiresAt'];console.log(JSON.stringify({room:Object.fromEntries(fields.map(k=>[k,r[k]??null])),jobs:jobs.map(j=>j.egressId).sort(),mode:'interactive'}));}finally{await a.close();}})().catch(()=>{console.error('Event preflight failed; details suppressed');process.exit(1)});
'''


def state():
    result=subprocess.run(['docker','exec','-i',APP,'node','-'],input=CHECK.encode(),capture_output=True,check=True,timeout=25)
    return json.loads(result.stdout)


def healthy():
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8090/api/status',timeout=2) as response:
                if response.status==200:return True
        except Exception:pass
        time.sleep(.5)
    return False


def write(data):
    fd=os.open(PATH,os.O_WRONLY|os.O_TRUNC|os.O_NOFOLLOW)
    with os.fdopen(fd,'wb') as target:
        target.write(data);target.flush();os.fsync(target.fileno())


def main():
    os.umask(0o077)
    info=PATH.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=1000 or info.st_mode&0o077 or info.st_size>8192:raise ValueError('private_file')
    original=PATH.read_bytes();old=json.loads(original)
    if old['roomCode']!='5JZGUH' or old['roomId']!='room_176b7474-ad51-4390-b013-4e9e05bc2ad8' or old['status']!='prepared':raise ValueError('old_scope')
    before=state();image=subprocess.check_output(['docker','inspect','--format','{{.Image}}',APP])
    if BACKUP.exists():raise ValueError('backup_already_exists')
    now=datetime.datetime.now(datetime.timezone.utc)
    plan={**old,'roomCode':'DKTLF3','roomId':ROOM_ID,'issuedAt':now.isoformat(timespec='milliseconds'),
          'expiresAt':(now+datetime.timedelta(hours=24)).isoformat(timespec='milliseconds'),
          'authorizationReference':'User explicitly selected Preparar DKTLF3 in reply to call_0196f2eec74245b1acbb7e1c8823d381; 10000 single-event permission remains prepared until all readiness checks pass.'}
    raw=json.dumps(plan).encode()
    validation="const fs=require('node:fs');const {parseBroadcastEventPlan:p}=require('./broadcast-event-plan');p(JSON.parse(fs.readFileSync(0,'utf8')),{roomCode:'DKTLF3',roomId:'"+ROOM_ID+"',target:10000});console.log('valid');"
    subprocess.run(['docker','exec','-i',APP,'node','-e',validation],input=raw,capture_output=True,check=True,timeout=10)
    fd=os.open(BACKUP,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as target:target.write(original)
    os.chown(BACKUP,info.st_uid,info.st_gid)
    try:
        write(raw);subprocess.run(['docker','restart',APP],capture_output=True,check=True,timeout=30)
        if not healthy():raise RuntimeError('health')
        after=state()
        if after!=before or subprocess.check_output(['docker','inspect','--format','{{.Image}}',APP])!=image:raise RuntimeError('continuity')
    except Exception:
        write(original);subprocess.run(['docker','restart',APP],capture_output=True,check=True,timeout=30)
        print(json.dumps({'prepared':False,'originalPrivatePlanRestored':True,'healthy':healthy()}));return 2
    print(json.dumps({'prepared':True,'roomCode':'DKTLF3','roomId':ROOM_ID,'targetViewers':10000,
        'expiresAt':plan['expiresAt'],'effective':False,'audienceMode':'interactive','commercialRoomFieldsUnchanged':True,
        'appImageUnchanged':True,'mediaJobIdentifiersUnchanged':True,'livekitOrEncoderRestarted':False,
        'certifiesProductionCapacity':False,'mode500000Activated':False}));return 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'errorClass':type(exc).__name__,'detailsSuppressed':True}));raise SystemExit(2)
