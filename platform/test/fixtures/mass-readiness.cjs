'use strict';
// Synthetic evidence for unit tests only. Never an operational approval.
const {CHECKS,plannedProfile}=require('../../mass-broadcast-readiness');
function syntheticReadiness(roomCode,env={},now=Date.now()) {
  const target=Number(env.QSESSION_BROADCAST_AUDIENCE_TARGET||500000);
  return {schemaVersion:1,roomCode,targetViewers:target,approvedBy:'SYNTHETIC TEST FIXTURE',approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),providerConcurrentViewers:target,loadTestConcurrentViewers:target,joinWindowSeconds:300,loadTestJoinsPerSecond:2000,profile:plannedProfile(env),checks:Object.fromEntries(CHECKS.map(key=>[key,{status:'passed',reference:'synthetic-test-only',verifiedAt:new Date(now-1000).toISOString()}]))};
}
module.exports={syntheticReadiness};
