'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {assessReadiness,parseEnv}=require('../mass-broadcast-readiness');
const {syntheticReadiness}=require('./fixtures/mass-readiness.cjs');
const now=Date.now(),env={QSESSION_CDN_ONLY_ROOM:'ABC123',QSESSION_AUDIENCE_MODE:'interactive'};

test('the default package is disabled and reports pending evidence',()=>{
 const config=parseEnv(fs.readFileSync(path.join(__dirname,'../deploy/mass-broadcast.env.example'),'utf8'));
 const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../deploy/mass-broadcast-readiness.example.json'),'utf8').replace(/^\uFEFF/,''));
 const report=assessReadiness(config,evidence,now);
 assert.equal(report.configuredMode,'interactive');assert.equal(report.evidenceComplete,false);assert.equal(report.willActivate,false);assert.ok(report.blockers.length>10);
 assert.equal(report.planning.aggregateTbps,1.06);assert.equal(report.planning.terabytesPerHour,477);
});
test('complete synthetic evidence only validates records; never activates or certifies capacity',()=>{
 const report=assessReadiness(env,syntheticReadiness('ABC123',env,now),now);
 assert.deepEqual(report.blockers,[]);assert.equal(report.evidenceComplete,true);assert.equal(report.capacityCertifiedByThisTool,false);assert.equal(report.willActivate,false);assert.equal(report.configuredMode,'interactive');
});

test('passing the DJ distribution checks cannot substitute for private chat, media and voice checks', () => {
 const targetEnv={...env,QSESSION_BROADCAST_AUDIENCE_TARGET:'10000'};
 for(const key of ['privateChatAndGroups','privateMediaAccess','privateVoiceIsolation','privateChatLoad']) {
  const evidence=syntheticReadiness('ABC123',targetEnv,now);
  delete evidence.checks[key];
  const report=assessReadiness(targetEnv,evidence,now);
  assert.equal(report.evidenceComplete,false);
  assert.ok(report.blockers.includes(`Pendiente: ${key}.`));
 }
});
test('room, profile, budget, load and validity mismatches all block',()=>{
 const changes=[e=>e.roomCode='DEF456',e=>e.providerConcurrentViewers=499999,e=>e.loadTestConcurrentViewers=10000,e=>e.loadTestJoinsPerSecond=5,e=>e.profile.audioBitrate=64000,e=>e.checks.budget.status='pending',e=>e.checks.webAudioVideo.reference='',e=>e.expiresAt=new Date(now-1).toISOString(),e=>e.expiresAt=new Date(now+40*86400000).toISOString(),e=>e.checks.cdnCapacity.verifiedAt=new Date(now+1000).toISOString(),e=>e.approvedBy=''];
 for(const change of changes){const evidence=syntheticReadiness('ABC123',env,now);change(evidence);assert.equal(assessReadiness(env,evidence,now).evidenceComplete,false);}
});
test('configuration is parsed as data with no shell expansion or secret disclosure',()=>{
 const data=parseEnv('\uFEFF# comment\nQSESSION_CDN_ONLY_ROOM="ABC123"\nQSESSION_HLS_AUDIO_BITRATE=320000 # bits\nQSESSION_UNRELATED_SECRET=secret-test\nQSESSION_HLS_VIDEO_BITRATE=$(touch something)');
 assert.equal(data.QSESSION_CDN_ONLY_ROOM,'ABC123');assert.equal(data.QSESSION_HLS_VIDEO_BITRATE,'$(touch something)');assert.equal(data.QSESSION_HLS_AUDIO_BITRATE,'320000');
 const report=assessReadiness(data,{},now);assert.equal(report.evidenceComplete,false);assert.doesNotMatch(JSON.stringify(report),/secret-test|touch something/);
});
test('CLI leaves input files unchanged and exits nonzero for pending preparation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-preflight-'));
 try {
  const envFile=path.join(dir,'settings.env'),readinessFile=path.join(dir,'readiness.json');
  const content='QSESSION_AUDIENCE_MODE=interactive\nQSESSION_CDN_ONLY_ROOM=ABC123\nQSESSION_API_SECRET=DO_NOT_PRINT';
  fs.writeFileSync(envFile,content);fs.writeFileSync(readinessFile,'{}');
  const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/check-mass-broadcast.cjs'),'--env-file',envFile,'--readiness-file',readinessFile],{encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).willActivate,false);assert.doesNotMatch(result.stdout+result.stderr,/DO_NOT_PRINT/);
  assert.equal(fs.readFileSync(envFile,'utf8'),content);assert.equal(fs.readFileSync(readinessFile,'utf8'),'{}');
 } finally {assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('qsession-preflight-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI accepts a synthetic complete package without writing configuration',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-preflight-'));
 try {
  const envFile=path.join(dir,'settings.env'),readinessFile=path.join(dir,'readiness.json');
  fs.writeFileSync(envFile,'QSESSION_CDN_ONLY_ROOM=ABC123\nQSESSION_AUDIENCE_MODE=interactive');fs.writeFileSync(readinessFile,JSON.stringify(syntheticReadiness('ABC123')));
  const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/check-mass-broadcast.cjs'),'--env-file',envFile,'--readiness-file',readinessFile],{encoding:'utf8'});
  assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).willActivate,false);
 } finally {assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('qsession-preflight-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('the 10000 profile is independent of the dormant 500000 profile',()=>{
 const config=parseEnv(fs.readFileSync(path.join(__dirname,'../deploy/broadcast-10000.env.example'),'utf8'));
 const pending=JSON.parse(fs.readFileSync(path.join(__dirname,'../deploy/broadcast-10000-readiness.example.json'),'utf8').replace(/^\uFEFF/,''));
 const report=assessReadiness(config,pending,now);
 assert.equal(report.targetViewers,10000);assert.equal(report.configuredMode,'interactive');assert.equal(report.willActivate,false);assert.equal(report.evidenceComplete,false);
 assert.equal(report.planning.aggregateTbps,.0212);assert.equal(report.planning.terabytesPerHour,9.54);
 const testEnv={...config,QSESSION_CDN_ONLY_ROOM:'TEN10A'};
 const evidence=syntheticReadiness('TEN10A',testEnv,now);
 assert.equal(assessReadiness(testEnv,evidence,now).evidenceComplete,true);
 assert.equal(assessReadiness({...testEnv,QSESSION_BROADCAST_AUDIENCE_TARGET:'500000'},evidence,now).evidenceComplete,false);
});
