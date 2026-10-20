'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const app=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
function fixture(){
 const calls=[];const state={mediaRole:'listener',currentRoomCode:'ABC123',remoteAudioTracks:new Set(),broadcastDelivery:{audienceMode:'cdn-only'},broadcastUsingEdge:true};
 const ctx={state,URL,window:{LivekitClient:{Room:class {async connect(){calls.push('sfu-connect');} async startAudio(){} }}},
  disconnectMedia:async()=>{state.mediaRoom=null;state.mediaConnected=false;},hasNativeAndroidAudio:()=>false,setMediaStatus:()=>{},wireMediaRoom:()=>{},
  mediaCredentials:async()=>({delivery:{kind:'broadcast',audienceMode:'cdn-only',url:'https://cdn.example/live.m3u8',fallback:null},permissions:['listen']}),
  postNativeAudioCommand:()=>calls.push('native-command'),stopChatPolling:()=>calls.push('stop-chat'),stopFlowerListeningRewards:()=>calls.push('stop-rewards'),startProfileActivityPolling:()=>calls.push('start-profile'),loadProfileActivity:async()=>calls.push('load-profile'),
  startEdgeBroadcastPlayback:async()=>{calls.push('hls-start');state.broadcastUsingEdge=true;return true;},updateMediaConnection:()=>calls.push('update'),
  stopEdgeBroadcastPlayback:()=>calls.push('hls-stop'),setMediaControlsActive:()=>{},showListenerRetry:()=>calls.push('retry'),syncWebMediaSubscriptions:()=>calls.push('sfu-subscriptions')};
 vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function isCdnOnlyAudience()'),app.indexOf('async function startEdgeBroadcastPlayback')),ctx);
 vm.runInContext(app.slice(app.indexOf('async function connectMedia('),app.indexOf('function setMediaControlsActive(')),ctx);
 return {ctx,calls,state};
}
test('mass audience starts HLS without connecting a LiveKit participant',async()=>{const {ctx,calls,state}=fixture();await ctx.connectMedia('listener');assert.ok(calls.includes('hls-start'));assert.ok(!calls.includes('sfu-connect'));assert.equal(state.mediaRoom,null);assert.equal(state.participantCameraAllowed,false);assert.ok(calls.includes('stop-chat'));});

test('joining HLS preserves the selected private group and its notification connection',async()=>{
 const {ctx,calls,state}=fixture();state.chatMode='group';state.chatModeChosen=true;state.account={id:'test'};
 await ctx.connectMedia('listener');
 assert.equal(state.chatMode,'group');assert.equal(state.chatModeChosen,true);
 assert.ok(calls.includes('start-profile'));assert.ok(calls.includes('load-profile'));
});
test('CDN outage offers retry without falling back to native or browser SFU',()=>{const {ctx,calls,state}=fixture();ctx.fallbackEdgeBroadcastToWebRtc();assert.ok(calls.includes('retry'));assert.ok(!calls.includes('native-command'));assert.ok(!calls.includes('sfu-subscriptions'));assert.equal(state.mediaConnected,false);});

test('mass playback pauses background directory, map and profile polling, then allows it again',()=>{
 const {ctx,state}=fixture(),timers=[],requests=[];
 Object.assign(ctx,{setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},document:{visibilityState:'visible'},byId:()=>({hidden:false,open:false}),loadPublicRooms:()=>requests.push('directory'),loadGlobalRave:()=>requests.push('map'),loadProfileActivity:()=>requests.push('profile')});
 state.account={id:'test-account'};
 for(const [start,end] of [['function startPublicRoomPolling()','function globalMapPosition('],['function startGlobalRavePolling()','function nativeGpsCountryCode('],['function startProfileActivityPolling()','async function openProfileActivity(']])vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end)),ctx);
 ctx.startPublicRoomPolling();ctx.startGlobalRavePolling();ctx.startProfileActivityPolling();
 for(const callback of timers)callback();assert.deepEqual(requests,[]);
 state.broadcastDelivery=null;for(const callback of timers)callback();assert.deepEqual(requests,['directory','map','profile']);
});
