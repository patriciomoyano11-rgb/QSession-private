'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {features}=require('../analysis/audio-features.cjs');
const {audioProfile}=require('../music-audio-profile');
const {gridFor,planMix}=require('../public/dj-mixer');
test('audio measures pulse and a quieter exit independently of title, rejects silence',()=>{
  const rate=8000,audio=new Float32Array(rate*72);
  for(let i=0;i<audio.length;i++){const time=i/rate,phase=(time-.12+.5)%.5;audio[i]=(time>48?.35:1)*(.7*Math.sin(2*Math.PI*60*time)*Math.exp(-phase*30)+.1*Math.sin(2*Math.PI*220*time));}
  const result=features(audio,rate);
  assert.equal(result.beatGrid.bpm,120);assert.ok(Math.abs(result.beatGrid.offset-.12)<.03);assert.equal(result.beatGrid.source,'audio');
  assert.ok(result.segments.every(segment=>Number.isFinite(segment.bassRatio)&&Number.isFinite(segment.brightness)&&Number.isFinite(segment.percussionDensity)&&Number.isFinite(segment.variation)));
  assert.ok(result.mixPoints.exit>=48&&result.mixPoints.exit<64);assert.equal(features(new Float32Array(rate*72)).beatGrid,null);
  const scaled=features(audio.map(x=>x*.5));assert.equal(scaled.beatGrid.bpm,120);assert.equal(scaled.mixPoints.exit,result.mixPoints.exit);
});
test('analysis uses matching content only, preserves manual corrections and abstains on uncertain labels',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-analysis-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'.analysis'));
  const track={checksum:'a'.repeat(64),family:'latin',mood:'warm',energy:3,bpm:95,classification:{reviewed:false}};
  const semantic={genre:{accepted:true,value:'electronic',entry:['electronic','Electrónica','House']},mood:{accepted:false,value:'dark'},intensity:{accepted:true,value:'5'},vocals:{accepted:true,value:'instrumental'}};
  const analysis={version:'audio-v1',checksum:track.checksum,status:'ready',acoustic:{beatGrid:{bpm:120},segments:[],mixPoints:{}},semantic,cues:[]};
  const file=path.join(root,'.analysis',`${track.checksum}.json`);fs.writeFileSync(file,JSON.stringify(analysis));
  const result=audioProfile(track,root);assert.equal(result.family,'electronic');assert.equal(result.mood,'warm');assert.equal(result.energy,5);assert.equal(result.bpm,120);assert.equal(result.classification.moodCertain,false);
  const manual=audioProfile({...track,classification:{reviewed:true}},root);assert.equal(manual.family,'latin');assert.equal(manual.bpm,95);assert.equal(manual.audioAnalysis.status,'ready');
  fs.writeFileSync(file,JSON.stringify({...analysis,checksum:'b'.repeat(64)}));assert.equal(audioProfile(track,root).audioAnalysis.status,'pending');
});
test('measured grids allow full bar mixes without inventing phrases or interpreting missing vocal cues as singers',()=>{
  const audioAnalysis={status:'ready',beatGrid:{bpm:120,offset:.12,confidence:.95,agreement:1,source:'audio'},mixPoints:{entry:0,exit:136,confidence:.7},cues:[{time:0,instrumental:true},{time:136,instrumental:true}]};
  const track={duration:180,audioAnalysis};const grid=gridFor(track,null);assert.equal(grid.phraseStart,null);
  const outgoing={track,grid,time:136,duration:180,rate:1},incoming={track,grid,time:0,duration:180,rate:1};
  const clear=planMix(outgoing,incoming);assert.equal(clear.synced,true);assert.equal(clear.duration,16);assert.equal(clear.exit,136);
  const uncertain=planMix({...outgoing,time:100},incoming);assert.equal(uncertain.synced,true);assert.equal(uncertain.duration,16);
  assert.equal(planMix(outgoing,incoming,{manual:true}).exit,null);
});

test('legacy vocal interpretation is not used to prohibit instrumental mixes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-legacy-vocals-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'.analysis'));
  const checksum='c'.repeat(64),track={checksum};
  const analysis={version:'audio-v1',checksum,status:'ready',acoustic:{},semantic:{genre:{accepted:false},mood:{accepted:false},intensity:{accepted:false},vocals:{accepted:true,value:'lead'}},cues:[{time:0,instrumental:false}]};
  fs.writeFileSync(path.join(root,'.analysis',checksum+'.json'),JSON.stringify(analysis));
  const legacy=audioProfile(track,root);assert.equal(legacy.vocalRole,undefined);assert.deepEqual(legacy.audioAnalysis.cues,[]);assert.equal(legacy.audioAnalysis.semantic.vocals.accepted,false);
  fs.writeFileSync(path.join(root,'.analysis',checksum+'.json'),JSON.stringify({...analysis,version:'audio-v2',semantic:{...analysis.semantic,vocals:{accepted:true,value:'instrumental'}}}));
  assert.equal(audioProfile(track,root).vocalRole,'instrumental');
});
