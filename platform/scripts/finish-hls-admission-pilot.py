"""Run on production: report isolated lease renewal and release only its own lease."""
import json
import pathlib
import subprocess

path = pathlib.Path('/opt/qsession/platform/deploy/private/broadcast-admission-pilot.json')
pilot = json.loads(path.read_text())
code = r'''
const crypto=require('node:crypto');const {createClient}=require('redis');
const {createBroadcastAdmissions}=require('./broadcast-admissions');const {EgressClient}=require('livekit-server-sdk');
(async()=>{
 let raw='';for await(const chunk of process.stdin)raw+=chunk;const p=JSON.parse(raw),e=process.env;
 const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
 const store=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
 try{
  let claims=null;try{claims=store.decode(p.token)}catch(error){if(error.statusCode!==410)throw error}
  const event=crypto.createHash('sha256').update(p.scope.prefix+':'+p.scope.generation).digest('hex').slice(0,32);
  const key='qsession:broadcast:{'+p.scope.code+':'+event+'}:leases';
  const score=claims?Number(await redis.zScore(key,claims.lease)):null;
  const active=await store.count(p.scope);
  let released=false;try{released=await store.release(p.token)}catch(error){if(error.statusCode!==410)throw error}
  const activeAfter=await store.count(p.scope);
  const api=(e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http');
  const jobs=await new EgressClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).listEgress({roomName:'qsession-JNTUBY',active:true});
  console.log(JSON.stringify({code:'PRB10A',scoreBefore:p.scoreBefore,scoreAfter:score,
    renewedMilliseconds:score?score-p.scoreBefore:null,activeBeforeRelease:active,
    released,activeAfterRelease:activeAfter,observedAtUnix:Date.now()/1000,
    sameDjEgressStillActive:jobs.some(j=>j.egressId===p.djEgressId&&j.status===1)}));
 }finally{await store.close()}
})().catch(()=>{console.error('Pilot lease cleanup failed; details suppressed');process.exitCode=1});
'''
result = subprocess.check_output(['docker', 'exec', '-i', 'qsession-qsession-app-1', 'node', '-e', code],
                                 input=json.dumps(pilot).encode())
metadata = json.loads(result)
path.unlink()
metadata['privatePilotTokenFileRemoved'] = True
print(json.dumps(metadata))
