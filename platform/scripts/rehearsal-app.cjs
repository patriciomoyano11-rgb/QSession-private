'use strict';
// Isolated disposable VM only. Synthetic readiness is explicitly NOT an
// approval for production. Both production images run this identical harness.
const fs=require('node:fs');
const {createQsessionServer}=require('/app/server');
const {createProductStore}=require('/app/product-store');
const {CHECKS,plannedProfile}=require('/app/mass-broadcast-readiness');
const e=process.env,code='TEN10A';
if(e.QSESSION_REHEARSAL!=='isolated-20261018'||e.QSESSION_REDIS_URL!=='redis://127.0.0.1:6711')throw Error('Rehearsal scope only');
const env={QSESSION_BROADCAST_AUDIENCE_TARGET:'10000',QSESSION_HLS_VIDEO_BITRATE:'1600000',QSESSION_HLS_AUDIO_BITRATE:'128000',QSESSION_HLS_SEGMENT_SECONDS:'6',
 QSESSION_REDIS_URL:e.QSESSION_REDIS_URL,QSESSION_BROADCAST_ADMISSION_SECRET:e.QSESSION_BROADCAST_ADMISSION_SECRET,
 QSESSION_CDN_ONLY_PAUSED:e.QSESSION_CDN_ONLY_PAUSED||'false'};
const store=createProductStore({filePath:'/lab/data/state.json',authPepper:e.QSESSION_REHEARSAL_SECRET});
if(!store.getRoomRecord(code))store.createRoomRecord({code,name:'Synthetic isolated recovery rehearsal',visibility:'public',billingPlanId:'paid-25',billingCapacityLimit:25,sessionDurationMinutes:120,status:'live'});
const room=store.getRoomRecord(code),now=Date.now();
const readiness={schemaVersion:1,roomCode:code,targetViewers:10000,approvedBy:'SYNTHETIC TEST FIXTURE - NEVER PRODUCTION',
 approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),providerConcurrentViewers:10000,loadTestConcurrentViewers:10000,
 joinWindowSeconds:30,loadTestJoinsPerSecond:334,profile:plannedProfile(env),
 checks:Object.fromEntries(CHECKS.map(key=>[key,{status:'passed',reference:'synthetic-isolated-fixture-only',verifiedAt:new Date(now-1000).toISOString()}]))};
const grant={schemaVersion:1,planId:'broadcast-event-10000',status:'prepared',roomCode:code,roomId:room.id,targetViewers:10000,maxParticipants:10000,
 approvedBy:'SYNTHETIC TEST FIXTURE',authorizationReference:'synthetic-isolated-fixture-only',issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString()};
const app=createQsessionServer({env,port:8095,productStore:store,dataFile:'/lab/data/state.json',mediaDirectory:'/lab/data/media',privateMediaDirectory:'/lab/data/private',
 promotionMediaDirectory:'/lab/data/promotions',analyticsDataFile:'/lab/data/analytics.ndjson',
 livekitUrl:'wss://media.invalid',livekitApiKey:'synthetic-lab-only',livekitApiSecret:e.QSESSION_REHEARSAL_SECRET,roomSecret:e.QSESSION_REHEARSAL_SECRET,
 audienceMode:'cdn-only',cdnOnlyRoom:code,broadcastAudienceTarget:10000,massBroadcastReadiness:readiness,broadcastEventPlan:grant,
 edgeBroadcast:{configured:true,provider:'isolated-rehearsal-only',deliveryMode:'object-storage',playbackUrl:value=>'https://qsession-live.patriciomoyano11.workers.dev/live/'+value+'-xxxxxxxxxxxxxxxxxx/index.m3u8'},
 liveRoomActivityProvider:async()=>{fs.appendFileSync('/lab/data/sfu-calls.txt','1\n');throw Error('CDN audience must never query SFU');}});
app.server.listen(8095,'127.0.0.1',()=>console.log(JSON.stringify({rehearsalReady:true,syntheticReadinessFixtureUsed:true,roomCode:code,listen:'loopback-only'})));
