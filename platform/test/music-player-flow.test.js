'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/music-library.js'),'utf8');
function definition(name){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert.ok(start>=0);const tail=source.slice(start);const next=tail.slice(1).search(/\n  (?:async )?function \w+\(/);return next<0?tail:tail.slice(0,next+1);}

test('original BPM restores exact original speed even when metadata disagrees with measured audio',()=>{
  const audio={playbackRate:1.2,preservesPitch:false};const output={innerHTML:''};
  const scope={audio,current:'a',trackById:()=>({bpm:124}),mixer:{deck:{},snapshot:()=>({grid:{bpm:131.75}}),mixing:false},$:()=>output};
  vm.createContext(scope);vm.runInContext(definition('applyTargetBpm'),scope);
  scope.applyTargetBpm(124,{manual:false});assert.equal(audio.playbackRate,1);assert.equal(audio.preservesPitch,true);
  scope.applyTargetBpm(132);assert.ok(Math.abs(audio.playbackRate-132/131.75)<1e-10);
});
test('ordinary incoming buffering while locating its cue does not cancel a DJ mix',()=>{
  const listeners={};let cancelled=0,advanced=0;
  const incoming={addEventListener:(name,handler)=>listeners[name]=handler};
  const active={};const mixer={mixing:true,preparing:false,cancel:()=>cancelled++};
  const scope={audio:active,mixer,loading:false,current:'a',status(){},renderPlayer(){},next:async()=>advanced++};vm.createContext(scope);vm.runInContext(definition('bindAudio'),scope);scope.bindAudio(incoming);
  listeners.waiting();assert.equal(cancelled,0);listeners.ended();assert.equal(advanced,0);
  listeners.error();assert.equal(cancelled,1);
});
test('starting by moment generates and starts the full queue without manually adding tracks',async()=>{
  const elements={musicAutopilot:{checked:false},musicMoment:{value:'dance',selectedOptions:[{textContent:'Bailar y compartir'}]},musicMomentCommand:{value:''},musicName:{value:''},musicRhythm:{value:'any'}};
  const selections={};let generated=0,started=-1;
  const scope={$:id=>elements[id],current:null,autopilot:false,mixer:{auto:false},prime:async()=>{},renderFamilies(){},selectOption:(id,value)=>{selections[id]=value;if(elements[id])elements[id].value=value;},interpretQdjCommand(){},createAutopilot:async()=>{generated++;return 12;},playAt:async i=>{started=i;}};
  vm.createContext(scope);vm.runInContext(definition('startSession'),scope);await scope.startSession();assert.equal(generated,1);assert.equal(started,0);assert.equal(scope.autopilot,true);assert.equal(scope.mixer.auto,true);assert.equal(scope.family,'electronic');assert.equal(selections.musicEnergy,'rise');assert.equal(elements.musicName.value,'Bailar y compartir');
});
