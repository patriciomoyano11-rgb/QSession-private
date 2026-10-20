'use strict';
// Runs only in an explicitly configured Redis, in a fresh isolated namespace.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createClient}=require('redis');
const {createBroadcastAdmissions}=require(process.env.QSESSION_ADMISSIONS_MODULE || '../broadcast-admissions');

(async()=>{
  const url=process.env.QSESSION_TEST_REDIS_URL || process.env.QSESSION_REDIS_URL;
  if(!url)throw Error('Configure the isolated Redis test destination');
  const namespace='qsession:admission-test:'+crypto.randomBytes(8).toString('hex');
  const secret=crypto.randomBytes(32).toString('hex');
  const clients=[createClient({url}),createClient({url})];
  clients.forEach(c=>c.on('error',()=>{}));
  await Promise.all(clients.map(c=>c.connect()));
  const stores=clients.map(redisClient=>createBroadcastAdmissions({redisClient,secret,namespace}));
  const code='TS100A',prefix='live/TS100A-1234567890abcdefgh',generation='isolated-test';
  const input={code,prefix,generation,capacity:10000,expiresAt:Date.now()+60000};
  const keyHash=crypto.createHash('sha256').update(prefix+':'+generation).digest('hex').slice(0,32);
  const key=`${namespace}:{${code}:${keyHash}}:leases`;
  const secondGeneration='expiry-only';
  const expiryHash=crypto.createHash('sha256').update(prefix+':'+secondGeneration).digest('hex').slice(0,32);
  const expiryKey=`${namespace}:{${code}:${expiryHash}}:leases`;
  const began=Date.now();
  let admitted=[],denied=0;
  try{
    for(let offset=0;offset<10020;offset+=128){
      const batch=await Promise.allSettled(Array.from({length:Math.min(128,10020-offset)},(_,j)=>stores[(offset+j)%2].reserve(input)));
      for(const row of batch){
        if(row.status==='fulfilled')admitted.push(row.value);
        else if(row.reason.statusCode===429)denied++;
        else throw row.reason;
      }
    }
    assert.equal(admitted.length,10000);assert.equal(denied,20);
    assert.equal(await stores[0].count(input),10000);
    const resumed=await stores[1].reserve({...input,previousToken:admitted[0].token});
    assert.equal(resumed.token,admitted[0].token);
    assert.equal(resumed.active,10000);
    assert.equal(await stores[0].release(admitted[1].token),true);
    assert.equal(await stores[0].release(admitted[1].token),false);
    const replacement=await stores[1].reserve(input);
    assert.equal(replacement.active,10000);
    await assert.rejects(()=>stores[0].reserve(input),{statusCode:429});
    await assert.rejects(()=>stores[0].check({token:replacement.token,objectKey:'live/OTHER1-1234567890abcdefgh/segment.ts'}),{statusCode:403});
    const check=await stores[0].check({token:replacement.token,objectKey:prefix+'/segment_test.ts'});
    assert.equal(check.ok,true);
    const short=await stores[0].reserve({...input,generation:secondGeneration,capacity:1,expiresAt:Date.now()+2200});
    await new Promise(resolve=>setTimeout(resolve,2300));
    await assert.rejects(()=>stores[1].check({token:short.token,objectKey:prefix+'/index.m3u8'}),{statusCode:410});
    assert.equal(await stores[0].count({...input,generation:secondGeneration}),0);
    console.log(JSON.stringify({redisAtomicCapacityPassed:true,concurrentAppClients:2,attempts:10020,
      admitted:10000,denied:20,resumeAtCapacity:true,releasedSeatReused:true,expiryPassed:true,
      elapsedMs:Date.now()-began,synthetic:true,videoViewersTested:0,certifiesProductionCapacity:false}));
  }finally{
    await clients[0].del([key,expiryKey]);
    await Promise.all(stores.map(s=>s.close()));
  }
})().catch(e=>{console.error('Redis admission validation failed: '+e.message);process.exitCode=1;});
