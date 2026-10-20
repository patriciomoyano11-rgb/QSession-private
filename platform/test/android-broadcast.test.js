'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const functions=source.slice(source.indexOf('function hasTypedAndroidBroadcastService()'),source.indexOf('async function stopPublishedAudio()'));
function fixture({version='0.1.40',sourceName='library',mode='live',native=true,response='ready'}={}){
  const handlers=new Map(),commands=[];let timer;
  const scope={navigator:{userAgent:'QSessionAndroid/'+version},state:{currentRoom:{broadcastMode:mode}},PHYSICAL_AUDIO_SOURCES:new Set(['microphone','usb']),byId:()=>({value:sourceName}),hasNativeAndroidAudio:()=>native,crypto:{randomUUID:()=> 'request-1'},setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},window:{addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name)=>handlers.delete(name)},postNativeAudioCommand:command=>{commands.push(command);if(response!=='timeout')handlers.get('qsession-native-audio-status')?.({detail:JSON.stringify({type:'broadcast-service-'+response,requestId:command.requestId,message:'Permiso denegado'})});return true;}};
  vm.createContext(scope);vm.runInContext(functions,scope);return {scope,commands,handlers,expire:()=>timer?.()};
}
test('library and preedited video require no microphone foreground service',async()=>{
  for(const options of [{sourceName:'library'},{sourceName:'microphone',mode:'recorded'}]){
    const f=fixture(options);await f.scope.prepareNativeBroadcastService('ABC123');
    assert.equal(f.commands[0].requiresMicrophone,false);assert.equal(f.handlers.size,0);
  }
});
test('physical inputs request microphone service and wait for native readiness',async()=>{
  const f=fixture({sourceName:'microphone',response:'timeout'});let complete=false;
  const task=f.scope.prepareNativeBroadcastService('ABC123').then(()=>complete=true);await Promise.resolve();assert.equal(complete,false);
  assert.equal(f.commands[0].requiresMicrophone,true);
  f.handlers.get('qsession-native-audio-status')({detail:JSON.stringify({type:'broadcast-service-ready',requestId:'another-request'})});
  await Promise.resolve();assert.equal(complete,false);
  f.handlers.get('qsession-native-audio-status')({detail:JSON.stringify({type:'broadcast-service-ready',requestId:'request-1'})});
  await task;assert.equal(complete,true);assert.equal(f.handlers.size,0);
});
test('native permission failures and missing acknowledgement reject instead of claiming live',async()=>{
  const failure=fixture({response:'error'});await assert.rejects(failure.scope.prepareNativeBroadcastService('ABC123'),/Permiso denegado/);assert.equal(failure.handlers.size,0);
  const timeout=fixture({response:'timeout'});const task=timeout.scope.prepareNativeBroadcastService('ABC123');timeout.expire();await assert.rejects(task,/no respondió/);assert.equal(timeout.handlers.size,0);
});
test('old APKs cannot start a microphone service for library music; web needs no native service',async()=>{
  for(const options of [{version:'0.1.39',sourceName:'library'},{native:false}]){const f=fixture(options);await f.scope.prepareNativeBroadcastService('ABC123');assert.equal(f.commands.length,0);}
  const old=fixture({version:'0.1.39',sourceName:'microphone'});await old.scope.prepareNativeBroadcastService('ABC123');assert.equal(old.commands.length,1);
});
test('legacy capturing click hook cannot run before source permissions',async()=>{
  const start=source.indexOf("window.addEventListener('click', event => {",source.indexOf("byId('startBroadcast').addEventListener"));const end=source.indexOf('}, true);',start)+9;
  assert.ok(start>=0);let handler,started=0,stopped=0;
  const scope={IS_QSESSION_ANDROID:true,hasTypedAndroidBroadcastService:()=>false,byId:()=>({disabled:false}),startBroadcast:()=>started++,window:{addEventListener:(_,fn)=>handler=fn}};
  vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);
  handler({target:{closest:()=>true},stopImmediatePropagation:()=>stopped++});assert.equal(started,1);assert.equal(stopped,1);
  scope.hasTypedAndroidBroadcastService=()=>true;handler({target:{closest:()=>true},stopImmediatePropagation:()=>stopped++});assert.equal(started,1);
});

test('active source, not an unapplied menu choice, determines native microphone requirements',async()=>{
  const f=fixture({sourceName:'library'});f.scope.state.mediaConnected=true;f.scope.state.mediaSourceKind='microphone';
  await f.scope.prepareNativeBroadcastService('ABC123');assert.equal(f.commands[0].requiresMicrophone,true);
});
test('camera and physical capture requirements are sent independently',async()=>{
  const f=fixture({sourceName:'library'});f.scope.state.localCameraEnabled=true;await f.scope.prepareNativeBroadcastService('ABC123');
  assert.equal(f.commands[0].requiresMicrophone,false);assert.equal(f.commands[0].requiresCamera,true);
});
