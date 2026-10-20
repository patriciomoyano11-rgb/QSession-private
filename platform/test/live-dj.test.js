'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/music-library.js'),'utf8');
const body=(first,next)=>source.slice(source.indexOf(first),source.indexOf(next,source.indexOf(first)));
function scope(request){const tracks={a:{id:'a',title:'Playing'},b:{id:'b',title:'New direction',energy:4,mood:'euphoric'}};const status={textContent:''};let cancels=0,prepared=0;const value={liveRevision:1,generation:5,current:'a',queue:['a','old'],loading:false,autopilotLoading:false,transitioning:false,manualPreparation:false,liveAbort:null,mixer:{mixing:false,cancel:()=>cancels++},AbortController,request,qdjControls:()=>({family:'latin',energyTarget:4,mood:'euphoric'}),rememberTrack:track=>tracks[track.id]=track,trackById:id=>tracks[id],$:()=>status,renderQueue(){},renderTracks(){},audio:{paused:false},prepareNext:async()=>prepared++,liveMoodNames:['Eufórica'],liveMoods:['euphoric'],setTimeout(){throw Error('unexpected retry');}};vm.createContext(value);vm.runInContext(body('  async function applyLiveSteering(', '  function qdjControls('),value);return {value,status,cancels:()=>cancels,prepared:()=>prepared};}
test('live sliders replace future tracks while keeping the playing song and paused state',async()=>{
 let input;const f=scope(async(url,options)=>{input=JSON.parse(options.body);return {tracks:[{id:'b',title:'New direction',energy:4,mood:'euphoric'}]};});f.value.audio.paused=true;
 assert.equal(await f.value.applyLiveSteering(1),true);assert.deepEqual(Array.from(f.value.queue),['a','b']);assert.equal(f.value.current,'a');assert.equal(f.value.audio.paused,true);assert.equal(f.prepared(),0);assert.equal(input.family,'latin');assert.equal(input.energyTarget,4);assert.equal(input.previousTrackId,'a');assert.deepEqual(input.excludeIds,['a']);assert.equal(f.cancels(),1);
});
test('empty compatible selection removes the old genre queue; network errors preserve it',async()=>{
 const empty=scope(async()=>({tracks:[]}));assert.equal(await empty.value.applyLiveSteering(1),false);assert.deepEqual(Array.from(empty.value.queue),['a']);assert.equal(empty.cancels(),1);assert.match(empty.status.textContent,/No hay pistas compatibles/);
 const offline=scope(async()=>{throw Error('offline');});assert.equal(await offline.value.applyLiveSteering(1),false);assert.deepEqual(Array.from(offline.value.queue),['a','old']);assert.equal(offline.cancels(),0);
});
test('stale responses cannot overwrite later steering or revive a stopped session',async()=>{
 for(const change of [value=>value.liveRevision++,value=>{value.generation++;value.current=null;value.queue=[];}]){let resolve;const f=scope(()=>new Promise(done=>resolve=done));const result=f.value.applyLiveSteering(1);change(f.value);resolve({tracks:[{id:'b',title:'New',energy:4,mood:'euphoric'}]});assert.equal(await result,false);assert.equal(f.cancels(),0);}
});
test('energy target selects a different first song and rejects invalid levels',()=>{
 const {buildSession}=require('../music-library');const tracks=[1,3,5].map((energy,i)=>({id:'t'+i,artist:'Artist '+i,title:'T'+i,family:'electronic',energy,bpm:124,mood:'warm',rhythm:'groove',duration:900,order:i}));
 assert.equal(buildSession(tracks,{family:'electronic',minutes:15,energyTarget:5}).tracks[0].energy,5);assert.equal(buildSession(tracks,{family:'electronic',minutes:15,energyTarget:1}).tracks[0].energy,1);assert.throws(()=>buildSession(tracks,{family:'electronic',energyTarget:9}));
});
