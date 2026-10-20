"""Run on production: reserve one isolated probe lease, transfer directly to encoder.

Only public status metadata is printed. No room activation or media publication.
"""
import json
import os
import pathlib
import subprocess
import urllib.request

import yaml

private = pathlib.Path('/opt/qsession/platform/deploy/private')
pilot_path = private / 'broadcast-admission-pilot.json'
if pilot_path.exists():
    raise SystemExit('An earlier isolated pilot must be cleaned up first')
with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=5) as response:
    health = response.status
if health != 200:
    raise SystemExit('App health is not ready')
code = r'''
const fs=require('node:fs'),crypto=require('node:crypto');
const {createClient}=require('redis');
const {EgressClient}=require('livekit-server-sdk');
const {createBroadcastAdmissions}=require('./broadcast-admissions');
(async()=>{
 const e=process.env,p=JSON.parse(fs.readFileSync(e.QSESSION_BROADCAST_ADMISSION_PROBE_FILE,'utf8'));
 if(p.code!=='PRB10A'||p.prefix!=='live/PRB10A-hWrdBkirH_2yHmZ9lp'||Date.parse(p.expiresAt)-Date.now()<180000)throw Error('scope');
 const api=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
 const eg=new EgressClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET);
 const probeJobs=await eg.listEgress({roomName:'qsession-PRB10A',active:true});
 if(probeJobs.length)throw Error('probe_writer');
 const dj=await eg.listEgress({roomName:'qsession-JNTUBY',active:true});
 const activeDj=dj.filter(j=>j.status===1);if(activeDj.length!==1)throw Error('dj_state');
 const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
 const admissions=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
 try{
  const scope={code:p.code,prefix:p.prefix,generation:p.generation};
  const before=await admissions.count(scope);
  const admission=await admissions.reserve({...scope,capacity:p.capacity,expiresAt:Math.min(Date.parse(p.expiresAt),Date.now()+300000)});
  const claims=admissions.decode(admission.token);
  const event=crypto.createHash('sha256').update(p.prefix+':'+p.generation).digest('hex').slice(0,32);
  const key='qsession:broadcast:{'+p.code+':'+event+'}:leases';
  const score=Number(await redis.zScore(key,claims.lease));
  console.log(JSON.stringify({token:admission.token,expiresAt:admission.expiresAt,scope,
     scoreBefore:score,activeBefore:before,activeAfter:admission.active,
     probeExpiresAt:p.expiresAt,probeHasActiveEgress:false,djEgressId:activeDj[0].egressId,health:200}));
 }finally{await admissions.close();}
})().catch(()=>{console.error('Isolated pilot preparation failed; details suppressed');process.exitCode=1});
'''
pilot = json.loads(subprocess.check_output(['docker', 'exec', 'qsession-qsession-app-1', 'node', '-e', code]))
descriptor = os.open(pilot_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w') as output:
    json.dump(pilot, output)
container = json.loads(subprocess.check_output(['docker', 'inspect', 'qsession-qsession-app-1']))[0]
environment = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
config = yaml.safe_load(pathlib.Path('/opt/qsession/platform/deploy/egress.yaml').read_text())
config['api_key'], config['api_secret'] = environment['LIVEKIT_API_KEY'], environment['LIVEKIT_API_SECRET']
config['qsession_probe_tokens'] = [pilot['token']]
subprocess.run(['ssh', '-T', '-i', '/root/.ssh/qsession-encoder/config-transfer',
                '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ConnectTimeout=12', 'root@45.77.192.82'], input=yaml.safe_dump(config).encode(), check=True)
print(json.dumps({key: pilot[key] for key in ('probeExpiresAt', 'activeBefore', 'activeAfter',
                                            'probeHasActiveEgress', 'djEgressId', 'health')}))
print(json.dumps({'leaseIssuedAtUnix': (pilot['scoreBefore']-90000)/1000,
                  'leaseExpiresAtUnix': pilot['expiresAt']/1000}))
