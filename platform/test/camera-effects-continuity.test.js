'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('camera frames continue without a window animation callback and stop cleanly',async()=>{
 const timers=new Map();let paints=0,requested=0,stopped=0;
 const track={requestFrame(){requested++;},stop(){stopped++;}},stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
 const drawing={drawImage(){paints++;},save(){},restore(){}};
 const context={window:{addEventListener(){},removeEventListener(){}},document:{createElement(type){return type==='video'?{videoWidth:1280,videoHeight:720,readyState:2,play:async()=>{}}:{getContext:()=>drawing,captureStream:()=>stream};}},Image:class{},performance:{now:()=>100},setInterval(fn,delay){timers.set(1,{fn,delay});return 1;},clearInterval(id){timers.delete(id);}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/camera-effects.js'),'utf8'),context);
 const engine=new context.window.QSessionCameraEffects.CameraEffectEngine(stream,{effect:'none',frameRate:24});
 await engine.start();assert.equal(paints,1);const timer=timers.get(1);assert.equal(timer.delay,1000/24);
 timer.fn();timer.fn();assert.equal(paints,3);assert.equal(requested,2);
 engine.stop();assert.equal(timers.size,0);assert.equal(stopped,2);timer.fn();assert.equal(paints,3,'a queued frame cannot restart a stopped camera');
});
