'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createBroadcastAdmissions}=require('../broadcast-admissions');
const secret='test-secret-exclusively-local-123456789';
const claims=()=>({v:1,aud:'qsession-hls',code:'TST123',prefix:'live/TST123-1234567890abcdefgh',lease:'abcdefghijklmnopqrstuvwx',exp:Math.floor(Date.now()/1000)+60,generation:'test-event'});
function sign(value,key=secret){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return 'v1.'+body+'.'+crypto.createHmac('sha256',key).update('v1.'+body).digest('base64url');}
test('tokens bind room, prefix, lease, generation, expiry and authenticated version',()=>{
  const a=createBroadcastAdmissions({secret,redisClient:{isReady:true}});
  assert.deepEqual(a.decode(sign(claims())),claims());
  for(const change of [{v:2},{aud:'other'},{prefix:'live/OTHER1-1234567890abcdefgh'},{lease:'guessable'}, {generation:12}])assert.throws(()=>a.decode(sign({...claims(),...change})),{statusCode:403});
  assert.throws(()=>a.decode(sign({...claims(),exp:1})),{statusCode:410});
  assert.throws(()=>a.decode(sign(claims(),'different-secret-12345678901234567890')),{statusCode:403});
  assert.throws(()=>a.decode(sign(claims()).replace(/^v1/,'v2')),{statusCode:403});
});
test('unconfigured or unavailable Redis never grants an in-memory seat',async()=>{
  const a=createBroadcastAdmissions();
  assert.equal(a.configured,false);
  await assert.rejects(()=>a.reserve({code:'TST123',prefix:claims().prefix,capacity:1,expiresAt:Date.now()+60000}),{statusCode:503});
  const b=createBroadcastAdmissions({secret,redisClient:{isOpen:false,connect:async()=>{throw Error('Cannot connect');}}});
  await assert.rejects(()=>b.reserve({code:'TST123',prefix:claims().prefix,capacity:1,expiresAt:Date.now()+60000}),{statusCode:503});
});
test('invalid paths, unauthenticated tokens and nonintegral limits never reach Redis',async()=>{
  let calls=0;const a=createBroadcastAdmissions({secret,redisClient:{isOpen:true,isReady:true,eval:()=>{calls++;throw Error('unexpected');}}});
  for(const objectKey of ['live/OTHER1-1234567890abcdefgh/index.m3u8',claims().prefix+'/../index.m3u8',claims().prefix+'/file.txt'])await assert.rejects(()=>a.check({token:sign(claims()),objectKey}),{statusCode:403});
  await assert.rejects(()=>a.reserve({code:'TST123',prefix:claims().prefix,capacity:1.5,expiresAt:Date.now()+60000}),{statusCode:403});
  assert.equal(calls,0);
});
