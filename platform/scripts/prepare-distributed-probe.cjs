'use strict';
// Run inside the app container; stdout is private and consumed only by the
// operator's memory-to-SSH pipe. It must never be displayed or logged.
const fs=require('node:fs');
const {createClient}=require('redis');
const {createBroadcastAdmissions}=require('../broadcast-admissions');
(async()=>{
 const e=process.env,p=JSON.parse(fs.readFileSync(e.QSESSION_BROADCAST_ADMISSION_PROBE_FILE,'utf8'));
 const remaining=Number(e.QSESSION_PROBE_MIN_REMAINING_SECONDS||300);
 if(!Number.isInteger(remaining)||remaining<300||remaining>900)throw Error('remaining');
 if(p.code!=='PRB10A'||p.prefix!=='live/PRB10A-hWrdBkirH_2yHmZ9lp'||p.capacity!==10000||Date.parse(p.expiresAt)-Date.now()<remaining*1000)throw Error('scope');
 const scope={code:p.code,prefix:p.prefix,generation:p.generation};
 const capacity=Number(process.env.QSESSION_PROBE_TEST_CLIENTS||10000);
 if(!Number.isSafeInteger(capacity)||capacity<4||capacity>10000)throw Error('test_clients');
 const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
 const a=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
 const tokens=new Array(capacity);let cursor=0;
 try{
  if(fs.existsSync('/tmp/qsession-probe-load-leases.json'))throw Error('previous_private_file');
  if(await a.count(scope)!==0)throw Error('previous_leases');
  const started=Date.now();
  await Promise.all(Array.from({length:64},async()=>{for(;;){const i=cursor++;if(i>=tokens.length)return;tokens[i]=(await a.reserve({...scope,capacity,expiresAt:Math.min(Date.parse(p.expiresAt),Date.now()+900000)})).token;}}));
  let overflowStatus=0;try{await a.reserve({...scope,capacity,expiresAt:Date.now()+300000});}catch(err){overflowStatus=err.statusCode;}
  const resumed=await a.reserve({...scope,capacity,expiresAt:Date.now()+300000,previousToken:tokens[0]});
  const active=await a.count(scope);
  if(active!==capacity||overflowStatus!==429||resumed.token!==tokens[0])throw Error('capacity_or_resume');
  fs.writeFileSync('/tmp/qsession-probe-load-leases.json',JSON.stringify({tokens,scope}),{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({tokens,scope,active,overflowStatus,resumePreservesLease:true,mintMilliseconds:Date.now()-started,issuedAtUnix:Date.now()/1000}));
 }catch(err){await Promise.allSettled(tokens.filter(Boolean).map(token=>a.release(token)));throw err;}
 finally{await a.close();}
})().catch(()=>{process.stderr.write('Distributed probe preparation failed; details suppressed\n');process.exitCode=1;});
