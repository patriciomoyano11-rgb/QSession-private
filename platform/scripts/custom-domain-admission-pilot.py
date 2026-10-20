"""Operator-only one-client PRB10A pilot on live.qsession.org.

Requires the renewed private probe. Credentials stay on their existing hosts;
only one expiring technical lease is piped in memory to the owned encoder.
The script never provisions resources or changes a real room or broadcaster.
"""
import base64
import argparse
import hashlib
import json
import pathlib
import shlex
import subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes',
     '-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12']
APP='qsession-qsession-app-1'
PRODUCTION='root@104.238.137.144'
ENCODER='root@45.77.192.82'
PREPARE=r'''
const fs=require('node:fs'),crypto=require('node:crypto');const {createClient}=require('redis');
const {EgressClient}=require('livekit-server-sdk');const {createBroadcastAdmissions}=require('./broadcast-admissions');
(async()=>{const e=process.env,p=JSON.parse(fs.readFileSync(e.QSESSION_BROADCAST_ADMISSION_PROBE_FILE,'utf8'));
const privatePath='/tmp/qsession-custom-domain-pilot.json';
if(p.code!=='PRB10A'||p.prefix!=='live/PRB10A-hWrdBkirH_2yHmZ9lp'||p.capacity!==10000||Date.parse(p.expiresAt)-Date.now()<180000||fs.existsSync(privatePath))throw Error('scope');
const eg=new EgressClient((e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http'),e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
const jobs=await eg.listEgress({active:true});if(jobs.some(j=>j.roomName==='qsession-PRB10A'))throw Error('probe_writer');
const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
const store=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});let token;
try{const scope={code:p.code,prefix:p.prefix,generation:p.generation};if(await store.count(scope)!==0)throw Error('leases');
const a=await store.reserve({...scope,capacity:10000,expiresAt:Math.min(Date.parse(p.expiresAt),Date.now()+300000)});token=a.token;
const claims=store.decode(token),event=crypto.createHash('sha256').update(p.prefix+':'+p.generation).digest('hex').slice(0,32);
const score=Number(await redis.zScore('qsession:broadcast:{'+p.code+':'+event+'}:leases',claims.lease));
const value={token,scope,scoreBefore:score,expiresAt:a.expiresAt,mediaJobsBefore:jobs.map(j=>({egressId:j.egressId,status:j.status}))};
fs.writeFileSync(privatePath,JSON.stringify(value),{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(value));
}catch(error){if(token)await store.release(token);throw error;}finally{await store.close();}})().catch(()=>{process.stderr.write('Technical pilot preparation failed; details suppressed\n');process.exitCode=1});
'''
FINISH=r'''
const fs=require('node:fs'),crypto=require('node:crypto');const {createClient}=require('redis');
const {EgressClient}=require('livekit-server-sdk');const {createBroadcastAdmissions}=require('./broadcast-admissions');
(async()=>{const path='/tmp/qsession-custom-domain-pilot.json',p=JSON.parse(fs.readFileSync(path,'utf8')),e=process.env;
if(p.scope.code!=='PRB10A'||p.scope.prefix!=='live/PRB10A-hWrdBkirH_2yHmZ9lp')throw Error('scope');
const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
const store=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
try{let claims=null;try{claims=store.decode(p.token)}catch(err){if(err.statusCode!==410)throw err;}
const event=crypto.createHash('sha256').update(p.scope.prefix+':'+p.scope.generation).digest('hex').slice(0,32);
const score=claims?Number(await redis.zScore('qsession:broadcast:{'+p.scope.code+':'+event+'}:leases',claims.lease)):null;
let released=false;try{released=await store.release(p.token)}catch(err){if(err.statusCode!==410)throw err;}
const after=await store.count(p.scope);fs.unlinkSync(path);
const jobs=await new EgressClient((e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http'),e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).listEgress({active:true});
const ids=items=>items.map(j=>j.egressId).sort();
console.log(JSON.stringify({probeCode:'PRB10A',renewedMilliseconds:score?score-p.scoreBefore:null,released,activeAfterRelease:after,privateMasterFileRemoved:true,
mediaJobIdsUnchanged:JSON.stringify(ids(jobs))===JSON.stringify(ids(p.mediaJobsBefore)),certifiesProductionCapacity:false}));
}finally{await store.close();}})().catch(()=>{process.stderr.write('Technical pilot cleanup failed; details suppressed\n');process.exitCode=1});
'''


def remote(host,command,data=None,timeout=30,acceptable=(0,)):
    result=subprocess.run(SSH+[host,command],input=data,capture_output=True,timeout=timeout)
    if result.returncode not in acceptable:
        raise RuntimeError('Scoped remote operation failed; details suppressed')
    return result.stdout


def upload_tools():
    names=('hls-load-client.py','synthetic-hls-origin.py','run-hls-admission-pilot.py')
    payload={name:base64.b64encode((ROOT/'platform/scripts'/name).read_bytes()).decode() for name in names}
    script=r'''
import sys,json,pathlib,os,base64,py_compile,hashlib,stat
data=json.load(sys.stdin);names={'hls-load-client.py','synthetic-hls-origin.py','run-hls-admission-pilot.py'}
if set(data)!=names:raise ValueError('scope')
root=pathlib.Path('/opt/qsession-encoder/ops')
if root.resolve()!=root:raise ValueError('unsafe ops path')
backup=root/'custom-domain-backups-20261018';backup.mkdir(mode=0o700,exist_ok=True)
out=[]
for name,encoded in data.items():
 path=root/name;content=base64.b64decode(encoded,validate=True)
 if len(content)>100000:raise ValueError('oversize tool')
 if path.exists():
  info=path.lstat()
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0:raise ValueError('unsafe tool')
  old=backup/name
  if not old.exists():
   with open(old,'xb') as handle:handle.write(path.read_bytes())
   old.chmod(0o600)
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as handle:handle.write(content)
 path.chmod(0o600);py_compile.compile(str(path),doraise=True)
 out.append({'name':name,'sha256':hashlib.sha256(content).hexdigest()})
print(json.dumps({'uploadedTools':out}))
'''
    return json.loads(remote(ENCODER,'python3 -c '+shlex.quote(script),json.dumps(payload).encode()))


def main(destination, transport='stdlib'):
    if transport not in ('stdlib','aiohttp'):raise ValueError('Unsupported transport')
    report={'synthetic':True,'deliveryHost':'live.qsession.org','requestedClients':1,
            'certifiesProductionCapacity':False,'resourcesProvisioned':0}
    prepared=False
    private=None
    try:
        report['tools']=upload_tools()
        private=json.loads(remote(PRODUCTION,'docker exec -i '+APP+' node -',PREPARE.encode()))
        prepared=True
        script=r'''
import sys,json,pathlib,os,stat,re
tokens=json.load(sys.stdin)
if not isinstance(tokens,list) or len(tokens)!=1 or not re.fullmatch(r'[A-Za-z0-9_.-]{20,4096}',tokens[0]):raise ValueError('scope')
path=pathlib.Path('/opt/qsession-encoder/private/probe-tokens.json')
if path.exists():
 info=path.lstat()
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:raise ValueError('unsafe token file')
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as output:json.dump(tokens,output)
'''
        remote(ENCODER,'python3 -c '+shlex.quote(script),json.dumps([private['token']]).encode())
        # Independent bounded lifetime; the origin also has its own 90-second deadline.
        report['pilot']=json.loads(remote(ENCODER,
            'timeout --signal=TERM --kill-after=5s 145s /opt/qsession-encoder/probe-venv/bin/python /opt/qsession-encoder/ops/run-hls-admission-pilot.py --delivery-host live.qsession.org --transport '+transport,
            timeout=160,acceptable=(0,2)))
    except Exception as error:
        report['errorClass']=type(error).__name__
    finally:
        if prepared:
            try:report['leaseCleanup']=json.loads(remote(PRODUCTION,'docker exec -i '+APP+' node -',FINISH.encode()))
            except Exception as error:report['leaseCleanupErrorClass']=type(error).__name__
        if private:
            fingerprint=hashlib.sha256(json.dumps([private['token']]).encode()).hexdigest()
            script=r'''
import sys,pathlib,hashlib,stat,json
expected=sys.stdin.read().strip();path=pathlib.Path('/opt/qsession-encoder/private/probe-tokens.json')
if not path.exists():print(json.dumps({'privateEncoderTokenFileRemoved':True,'alreadyAbsent':True}))
else:
 info=path.lstat()
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:raise ValueError('unsafe file')
 if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ValueError('different pilot owns file')
 path.unlink();print(json.dumps({'privateEncoderTokenFileRemoved':True}))
'''
            try:report['encoderCleanup']=json.loads(remote(ENCODER,'python3 -c '+shlex.quote(script),fingerprint.encode()))
            except Exception as error:report['encoderCleanupErrorClass']=type(error).__name__
        report['passed']=(not report.get('errorClass') and report.get('pilot',{}).get('passed') is True
            and report.get('leaseCleanup',{}).get('activeAfterRelease')==0
            and (report.get('leaseCleanup',{}).get('renewedMilliseconds') or 0)>20000
            and report.get('encoderCleanup',{}).get('privateEncoderTokenFileRemoved') is True)
        destination.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        # No authorized URL or lease token is present in this redacted artifact.
        print(json.dumps({'report':str(destination),'passed':report['passed'],
            'activeAfterRelease':report.get('leaseCleanup',{}).get('activeAfterRelease'),
            'errorClass':report.get('errorClass')}),flush=True)
    return 0 if report['passed'] else 2


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/custom-domain-admission-pilot-20261018.json')
    parser.add_argument('--transport',choices=('stdlib','aiohttp'),default='stdlib')
    args=parser.parse_args()
    raise SystemExit(main(args.output,args.transport))
