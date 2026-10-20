'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),music=fs.readFileSync(path.join(__dirname,'../public/music-library.js'),'utf8');
function definition(source,name){const start=source.search(new RegExp('^(?:  )?(?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);const tail=source.slice(start),next=/\n(?:  )?(?:async )?function \w+\(/.exec(tail);return next?tail.slice(0,next.index):tail;}

test('all devices initially select Q Session library while Chrome capability only controls availability',()=>{
  for(const android of [true,false]){const select={options:[{value:'tab'}]},context={byId:()=>select,windowsDesktopBridge:()=>null,isNativeAndroidApp:()=>android,navigator:{mediaDevices:{getDisplayMedia(){}}},devicePrefersPortraitCamera:()=>android,broadcastSourceMenuButtons:()=>[],syncBroadcastSourceControl(){},updateBroadcastSourceHelp(){},refreshAudioInputDevices:async()=>{}};
    vm.createContext(context);vm.runInContext(definition(app,'configureDefaultBroadcastSource'),context);context.configureDefaultBroadcastSource();assert.equal(select.value,'library');assert.equal(select.options[0].disabled,android);
  }
});

test('broadcast library resumes a suspended context and interrupted media without changing tempo',async()=>{
  let resumed=0,played=0,ticked=0;const context={broadcasting:true,destination:{stream:{getAudioTracks:()=>[{readyState:'live'}]}},current:'song',playbackRequested:true,loading:false,transitioning:false,context:{state:'suspended',resume:async()=>resumed++},audio:{paused:true,playbackRate:1.08},mixer:{play:async()=>played++,tick:()=>ticked++}};
  vm.createContext(context);vm.runInContext(definition(music,'resumeBroadcast'),context);await context.resumeBroadcast();assert.equal(resumed,1);assert.equal(played,1);assert.equal(ticked,1);assert.equal(context.audio.playbackRate,1.08);
  context.playbackRequested=false;await context.resumeBroadcast();assert.equal(played,1,'manual pause remains paused');
  context.playbackRequested=true;context.broadcasting=false;await context.resumeBroadcast();assert.equal(played,1,'stopped broadcast remains stopped');
});

test('ended output track is reported instead of claiming successful recovery',async()=>{
  const context={broadcasting:true,destination:{stream:{getAudioTracks:()=>[{readyState:'ended'}]}},current:'song',playbackRequested:true,loading:false,transitioning:false};vm.createContext(context);vm.runInContext(definition(music,'resumeBroadcast'),context);await assert.rejects(context.resumeBroadcast(),/salida de la biblioteca/);
});

test('Android background unload cannot stop capture or disconnect the live host',()=>{
  const start=app.indexOf("window.addEventListener('beforeunload', () => {"),end=app.indexOf('async function restoreRequestedRoom()',start);let handler,stopped=0,disconnected=0;
  const scope={window:{addEventListener:(_,fn)=>handler=fn},hasNativeAndroidAudio:()=>true,state:{mediaRole:'dj',mediaConnected:true,androidBroadcastBackground:true,mediaCaptureStream:{getTracks:()=>[{stop:()=>stopped++}]},mediaRoom:{disconnect:()=>disconnected++}},stopWebGlobalPresence(){},stopDesktopChromeCapture(){},stopRoomQrScanner(){},stopProfileActivityPolling(){},disposeVoiceOverlayProcessor(){}};
  vm.createContext(scope);vm.runInContext(app.slice(start,end),scope);handler();assert.equal(stopped,0);assert.equal(disconnected,0);
  scope.state.androidBroadcastBackground=false;handler();assert.equal(stopped,1);assert.equal(disconnected,1);
});

test('continuity cannot revive a stopped room or reenter a pending recovery',async()=>{
  let calls=0;const scope={hasNativeAndroidAudio:()=>true,state:{mediaRole:'dj',mediaConnected:true,mediaSourceKind:'library'},window:{addEventListener(){},QSessionMusic:{resumeBroadcast:async()=>calls++}},setMediaStatus(){}};
  vm.createContext(scope);vm.runInContext(definition(app,'ensureAndroidBroadcastContinuity'),scope);await scope.ensureAndroidBroadcastContinuity();assert.equal(calls,1);scope.state.mediaConnected=false;await scope.ensureAndroidBroadcastContinuity();assert.equal(calls,1);scope.state.mediaConnected=true;scope.state.androidBroadcastRecovering=true;await scope.ensureAndroidBroadcastContinuity();assert.equal(calls,1);
});

test('focus, pageshow, visibility and native resume all request listener recovery',()=>{
  const handlers=new Map(),recoveries=[];
  const scope={window:{addEventListener:(name,handler)=>handlers.set(name,handler)},document:{visibilityState:'visible',addEventListener:(name,handler)=>handlers.set(name,handler)},
    state:{account:null},byId:()=>({hidden:true,open:false}),syncWebMediaSubscriptions(){},chatViewIsVisible:()=>false,stopChatPolling(){},
    scheduleListenerAudioRecovery:options=>recoveries.push(options)};
  vm.createContext(scope);
  const start=app.indexOf("document.addEventListener('visibilitychange', () => {"),end=app.indexOf("byId('toggleAccountPassword').addEventListener",start);
  vm.runInContext(app.slice(start,end),scope);
  for(const name of ['focus','pageshow','visibilitychange','qsession-native-audio-resume'])handlers.get(name)();
  assert.equal(recoveries.length,4);
  assert.equal(recoveries[3].requestFocus,false,'native resume must not request audio focus recursively');
});
