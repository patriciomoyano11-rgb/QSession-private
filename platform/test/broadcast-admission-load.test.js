'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('../scripts/load-broadcast-admissions.cjs');
test('admission benchmark stays local and reports no media capacity certification',async()=>{
  const result=await run({requests:100,concurrency:8});
  assert.equal(result.network,'loopback-only');assert.equal(result.completed,100);
  assert.equal(result.admissionBackend,'synthetic-memory-only');assert.equal(result.redisConnectionsOpened,0);assert.equal(result.certifiesRedisCapacity,false);
  assert.equal(result.authorizedHlsResponses,100);assert.equal(result.sfuActivityChecks,0);
  assert.ok(result.notValidated.includes('Atomicidad, aforo y rendimiento de Redis'));
  assert.ok(result.sourceHashes['test/fixtures/broadcast-admissions.cjs']);assert.equal(result.failures,0);assert.equal(result.sfuCredentialsReturned,0);assert.equal(result.joinStoreWrites,0);
  assert.equal(result.videoStreamsOpened,0);assert.equal(result.certifiesAudienceCapacity,false);assert.ok(result.latencyMilliseconds.p99>=result.latencyMilliseconds.p50);
});
test('admission benchmark rejects excessive load before starting',async()=>{
  await assert.rejects(()=>run({requests:10001}),/permiten/);await assert.rejects(()=>run({requests:100,concurrency:101}),/permiten/);
});
