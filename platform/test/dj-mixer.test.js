'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {estimateBeatGrid,planMix,alignedIncomingTime,equalPowerCurves,peakSafeCurves,transitionCurves,harmonicDistance,Mixer}=require('../public/dj-mixer');

test('pulse fitting measures tempo and phase, rejects silence and irregular attacks',()=>{
  const peaks=Array.from({length:48},(_,i)=>({time:.17+i*60/126+Math.sin(i)*.004,strength:1}));
  const result=estimateBeatGrid(peaks,124);
  assert.ok(result);assert.ok(Math.abs(result.bpm-126)<.5);assert.ok(Math.abs(result.offset-.17)<.02);
  assert.equal(estimateBeatGrid([],124),null);
  const irregular=Array.from({length:70},(_,i)=>({time:i*.317+(Math.sin(i*12.7)+1)*.15,strength:1}));
  assert.equal(estimateBeatGrid(irregular,124),null);
});
const outgoing={track:{bpm:124},grid:{bpm:124,offset:.1},time:100,duration:180,rate:1};
const incoming={track:{bpm:126},grid:{bpm:126,offset:.2},time:0,duration:180,rate:1};

test('harmonic conflict and confirmed lead vocals prevent long rhythmic overlaps',()=>{
  const harmonic=planMix({...outgoing,track:{camelotKey:'1A'}},{...incoming,track:{camelotKey:'6A'}});
  assert.equal(harmonic.synced,false);assert.equal(harmonic.reason,'harmonic-clash');assert.ok(harmonic.duration<=3);
  const vocal=planMix({...outgoing,track:{vocalRole:'lead'}},{...incoming,track:{vocalRole:'lead'}});
  assert.equal(vocal.synced,false);assert.equal(vocal.reason,'lead-vocals');assert.ok(vocal.duration<=3);
});
test('mix aligns actual beats, preserves compatible tempo, and uses bars',()=>{
  const plan=planMix(outgoing,incoming,{bars:8});
  assert.equal(plan.synced,true);assert.equal(plan.phraseAligned,false);
  assert.ok(Math.abs(plan.rate-124/126)<1e-9);assert.ok(Math.abs(plan.duration-32*60/124)<1e-9);
  assert.ok(plan.wait>=0&&plan.wait<60/124);assert.equal(plan.cue,.2);
  const verified=planMix({...outgoing,grid:{...outgoing.grid,phraseStart:.1}},{...incoming,grid:{...incoming.grid,phraseStart:4}},{bars:8});
  assert.equal(verified.phraseAligned,true);assert.equal(verified.cue,4);
});
test('transition plan changes its phrasing and bass handoff with the requested musical journey',()=>{
  const reviewed=(energy,mood='warm',rhythm='groove')=>({bpm:124,energy,mood,rhythm,classification:{reviewed:true},camelotKey:'8A'});
  const rise=planMix({...outgoing,track:reviewed(2)},{...incoming,track:reviewed(4)},{bars:8,journey:{curve:'rise',targetRhythm:'groove'}});
  const calm=planMix({...outgoing,track:reviewed(4)},{...incoming,track:reviewed(2)},{bars:8,journey:{curve:'calm',targetRhythm:'groove'}});
  const bridge=planMix({...outgoing,track:reviewed(3)},{...incoming,track:reviewed(3)},{bars:8,journey:{curve:'steady',targetRhythm:'groove'}});
  assert.equal(rise.profile.id,'lift');assert.equal(calm.profile.id,'release');assert.equal(bridge.profile.id,'bridge');
  assert.ok(rise.duration>8*4*60/124);assert.ok(calm.duration>8*4*60/124);assert.ok(bridge.duration>=8*4*60/124);
  assert.ok(rise.bass.incomingHold>calm.bass.incomingHold,'an ascent keeps the established low end longer');
  assert.notDeepEqual(rise.profile,calm.profile);
});
test('measured dynamics can shape a wave while missing evidence keeps a conservative pulse',()=>{
  const analyzed=(intensity)=>({bpm:124,audioAnalysis:{segments:[{start:0,end:180,intensity}],mixPoints:{entry:0,exit:120,confidence:.7}}});
  const wave=planMix({...outgoing,track:analyzed(.25)},{...incoming,track:analyzed(.75)},{journey:{curve:'wave'}});
  const unknown=planMix(outgoing,incoming,{journey:{curve:'wave'}});
  assert.equal(wave.profile.id,'lift');assert.equal(unknown.profile.id,'pulse');assert.equal(unknown.profile.confidence,'low');
});
test('a measured change in percussion or timbre receives space instead of the standard long blend',()=>{
  const analyzed=(segment)=>({bpm:124,camelotKey:'8A',audioAnalysis:{segments:[{start:0,end:180,intensity:.5,...segment}],mixPoints:{entry:0,exit:120,confidence:.7}}});
  const plan=planMix({...outgoing,track:analyzed({bassRatio:.3,brightness:.02,percussionDensity:1})},{...incoming,track:analyzed({bassRatio:1,brightness:.09,percussionDensity:2.4})},{bars:8,journey:{curve:'steady'}});
  assert.equal(plan.profile.id,'contrast');assert.equal(plan.duration,4*4*60/124);assert.ok(plan.profile.bassDistance>.45);
});
test('unknown pulse and extreme tempo differences do not claim sync or stretch',()=>{
  for(const next of [{...incoming,grid:null},{...incoming,grid:{bpm:90,offset:0}}]){
    const plan=planMix(outgoing,next,{bars:16});assert.equal(plan.synced,false);assert.equal(plan.rate,1);assert.equal(plan.duration,2.5);assert.equal(plan.profile.id,'handoff');
  }
  const late=planMix({...outgoing,time:179},incoming);
  assert.ok(late.duration>0&&late.duration<1);
});
test('equal-power envelopes retain energy throughout the overlap',()=>{
  const {outgoing:a,incoming:b}=equalPowerCurves();
  assert.equal(a[0],1);assert.equal(b[0],0);assert.equal(b.at(-1),1);
  for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]*a[i]+b[i]*b[i]-1)<1e-6);
});
test('harmonic selection recognizes wraparound and relative keys without inventing missing keys',()=>{
  assert.equal(harmonicDistance('12A','1A'),1);assert.equal(harmonicDistance('8A','8B'),.5);assert.equal(harmonicDistance('', '8A'),null);
});

test('mix envelopes cannot overload identical full-scale bass or invert stereo channels',()=>{
  const {outgoing:a,incoming:b}=peakSafeCurves();
  assert.equal(a[0],1);assert.equal(b[0],0);assert.equal(a.at(-1),0);assert.equal(b.at(-1),1);
  for(let i=0;i<a.length;i++){
    assert.ok(a[i]>=0&&b[i]>=0);assert.ok(Math.abs(a[i]+b[i]-1)<1e-7);
    for(const sample of [-1,-.95,0,.95,1])assert.ok(Math.abs(sample*a[i]+sample*b[i])<=1+1e-7);
  }
});
test('adaptive transition envelopes are distinct, complementary and peak-safe',()=>{
  const lift=transitionCurves('late'),release=transitionCurves('early'),soft=transitionCurves('soft');
  assert.ok(lift.incoming[32]<release.incoming[32]);assert.notEqual(soft.incoming[32],lift.incoming[32]);
  for(const curves of [lift,release,soft])for(let i=0;i<curves.incoming.length;i++){
    assert.ok(curves.incoming[i]>=0&&curves.outgoing[i]>=0);
    assert.ok(Math.abs(curves.incoming[i]+curves.outgoing[i]-1)<1e-6);
  }
});

function fixture(){
  const scheduled=[];let next=0;const tasks=new Map();
  const timers={setInterval:()=>99,clearInterval:()=>{},setTimeout:(fn,ms)=>{const id=++next;tasks.set(id,{fn,ms});return id;},clearTimeout:id=>tasks.delete(id)};
  const parameter=()=>({value:1,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v,t){scheduled.push({kind:'ramp',v,t});},setValueCurveAtTime(values,t,duration){scheduled.push({kind:'curve',values,t,duration});}});
  const node=()=>({gain:parameter(),frequency:parameter(),connect(){return this;},fftSize:2048,frequencyBinCount:1024,getByteFrequencyData(data){data.fill(0);},getFloatTimeDomainData(data){data.fill(0);}});
  const context={currentTime:0,sampleRate:48000,createMediaElementSource:node,createAnalyser:node,createGain:node,createBiquadFilter:node};
  const audios=[];const audioFactory=()=>{const audio={paused:true,src:'',currentTime:0,duration:180,playbackRate:1,play:async function(){this.paused=false;},pause(){this.paused=true;},removeAttribute(){this.src='';},load(){}};audios.push(audio);return audio;};
  const active=[];const mixer=new Mixer(context,node(),{audioFactory,timers,onActive:(a,t)=>active.push(t.id)});
  async function flushDelay(ms){await Promise.resolve();await Promise.resolve();await Promise.resolve();for(const [id,task]of tasks)if(task.ms===ms){tasks.delete(id);task.fn();}await Promise.resolve();await Promise.resolve();}
  return {mixer,scheduled,audios,active,flushDelay};
}
test('autonomy waits for an analyzed exit instead of always waiting for the final seconds',()=>{
  const f=fixture();let requests=0;f.mixer.onAutoMix=()=>requests++;
  const analysis={status:'ready',beatGrid:{source:'audio',bpm:120,offset:0,confidence:.95,agreement:1},mixPoints:{entry:0,exit:136,confidence:.7},cues:[{time:0,instrumental:true},{time:136,instrumental:true}]};
  f.mixer.decks.forEach(deck=>{deck.track={audioAnalysis:analysis,duration:180};});f.mixer.prepared=true;f.audios[0].paused=false;
  f.audios[0].currentTime=119;f.mixer.tick();assert.equal(requests,0);
  f.audios[0].currentTime=120;f.mixer.tick();assert.equal(requests,1);
  f.mixer.auto=false;f.mixer.tick();assert.equal(requests,1);
});

test('effects reserve temporary music headroom and cannot stack while it is occupied',()=>{
  const f=fixture();assert.equal(f.mixer.musicBus.gain.value,1);
  assert.equal(f.mixer.reserveEffectHeadroom(),true);assert.equal(f.mixer.reserveEffectHeadroom(),false);
  assert.ok(f.scheduled.some(p=>p.kind==='ramp'&&p.v===.5));
  assert.ok(f.scheduled.some(p=>p.kind==='ramp'&&p.v===1&&p.t>2));
  f.mixer.context.currentTime=3;assert.equal(f.mixer.reserveEffectHeadroom(),true);
});

test('two decks overlap; bass is exchanged; the old deck stops only after mix completion',async()=>{
  const f=fixture();await f.mixer.load({id:'a',bpm:124,duration:180,beatGrid:{verified:true,bpm:124,offset:0}},'/a');
  const prepared=f.mixer.prepare({id:'b',bpm:126,duration:180,beatGrid:{verified:true,bpm:126,offset:0}},'/b');await f.flushDelay(1000);assert.equal(await prepared,true);
  f.audios[0].currentTime=0;
  f.mixer.decks[0].rms=.1;f.mixer.decks[1].rms=.2;
  const mixed=f.mixer.mix({manual:true,fallbackSeconds:4});await f.flushDelay(-1);
  assert.equal(f.audios[0].paused,false);assert.equal(f.audios[1].paused,false);
  assert.equal(f.scheduled.filter(x=>x.kind==='curve').length,2);
  assert.equal(f.mixer.decks[0].trim.gain.value,1);assert.equal(f.mixer.decks[1].trim.gain.value,.7);
  assert.ok(f.scheduled.some(x=>x.kind==='ramp'&&x.v===-18));
  await f.flushDelay(f.scheduled.find(x=>x.kind==='curve').duration*1000);assert.ok(await mixed);
  assert.equal(f.audios[0].paused,true);assert.equal(f.mixer.audio,f.audios[1]);assert.deepEqual(f.active,['a','b']);
});
test('startup latency is compensated before the incoming fader opens',()=>{
  const plan=planMix(outgoing,incoming,{bars:8});
  const startedLate=outgoing.time+plan.wait*outgoing.rate+.083;
  const cue=alignedIncomingTime({...plan,incomingDuration:180},startedLate);
  const outgoingPhase=((startedLate-outgoing.grid.offset)%(60/outgoing.grid.bpm)+(60/outgoing.grid.bpm))%(60/outgoing.grid.bpm)/outgoing.rate;
  const incomingPhase=(cue-plan.cue)/plan.rate;
  assert.ok(Math.abs(outgoingPhase-incomingPhase)<1e-9);
  assert.ok(cue>plan.cue,'the silent deck advances by the real browser startup delay');
});
test('structural rises and falls choose different musical handoffs',()=>{
  const analyzed=(first,second)=>({bpm:124,camelotKey:'8A',classification:{reviewed:true},energy:3,mood:'warm',rhythm:'groove',audioAnalysis:{segments:[{start:0,end:8,intensity:first,bassRatio:.4,brightness:.02,percussionDensity:1},{start:8,end:16,intensity:second,bassRatio:.4,brightness:.02,percussionDensity:1}],mixPoints:{entry:0,exit:8,confidence:.7}}});
  const lift=planMix({...outgoing,time:8,track:analyzed(.8,.3)},{...incoming,track:analyzed(.2,.7)},{journey:{curve:'rise'}});
  const release=planMix({...outgoing,time:8,track:analyzed(.3,.8)},{...incoming,track:analyzed(.7,.2)},{journey:{curve:'calm'}});
  assert.equal(lift.profile.id,'breathe');
  assert.equal(release.profile.id,'release');
  assert.notEqual(lift.profile.curve,release.profile.curve);
});
test('pause during overlap cancels automation and never promotes a stale incoming track',async()=>{
  const f=fixture();await f.mixer.load({id:'a',duration:180},'/a');
  const prepared=f.mixer.prepare({id:'b',duration:180},'/b');await f.flushDelay(16000);await prepared;
  const mixed=f.mixer.mix();await f.flushDelay(-1);f.mixer.pause();
  assert.equal(await mixed,false);await f.flushDelay(4000);
  assert.ok(f.audios.every(a=>a.paused));assert.deepEqual(f.active,['a']);assert.equal(f.mixer.mixing,false);
});
test('incoming playback failure retains the current track',async()=>{
  const f=fixture();await f.mixer.load({id:'a',duration:180},'/a');
  const prepared=f.mixer.prepare({id:'b',duration:180},'/b');await f.flushDelay(16000);await prepared;
  f.audios[1].play=async()=>{throw new Error('network');};
  assert.equal(await f.mixer.mix(),false);assert.equal(f.audios[0].paused,false);assert.equal(f.audios[1].paused,true);assert.deepEqual(f.active,['a']);
});
test('autopilot requests a mix before the track ends and respects pause and manual mode',async()=>{
  const f=fixture();await f.mixer.load({id:'a',duration:180},'/a');
  const prepared=f.mixer.prepare({id:'b',duration:180},'/b');await f.flushDelay(16000);await prepared;
  let requests=0;f.mixer.onAutoMix=()=>{requests++;};f.audios[0].currentTime=177;
  f.mixer.tick();assert.equal(requests,1);
  f.mixer.auto=false;f.mixer.tick();assert.equal(requests,1);
  f.mixer.auto=true;f.mixer.pause();f.mixer.tick();assert.equal(requests,1);
});

test('synchronized dance handoff retains outgoing bass until incoming bass reaches unity without extra gain',async()=>{
 const f=fixture();await f.mixer.load({id:'a',duration:180},'/a');const ready=f.mixer.prepare({id:'b',duration:180},'/b');await f.flushDelay(16000);await ready;
 const outgoing=[],incoming=[];
 for(const [param,events] of [[f.mixer.decks[0].bass.gain,outgoing],[f.mixer.decks[1].bass.gain,incoming]]){
  param.setValueAtTime=(value,time)=>events.push({kind:'set',value,time});param.linearRampToValueAtTime=(value,time)=>events.push({kind:'ramp',value,time});
 }
 f.mixer.plan=()=>({synced:true,reason:'beat-compatible',cue:0,rate:1,wait:0,duration:4});
 const result=f.mixer.mix();await f.flushDelay(-1);
 assert.ok(incoming.some(event=>event.kind==='ramp'&&event.value===0&&event.time===2));
 assert.ok(outgoing.some(event=>event.kind==='set'&&event.value===0&&event.time===2));
 assert.ok(outgoing.some(event=>event.kind==='ramp'&&event.value===-18&&event.time===2.6));
 assert.ok([...outgoing,...incoming].every(event=>event.value<=0),'bass is never boosted');
 await f.flushDelay(4000);assert.ok(await result);
});

test('manual mix waits at most one beat and respects selected short duration rather than a full phrase',()=>{
 const a={...outgoing,grid:{bpm:124,offset:0,phraseStart:0},time:101};const b={...incoming,grid:{bpm:124,offset:0,phraseStart:0}};
 const plan=planMix(a,b,{manual:true,fallbackSeconds:4,bars:16});assert.ok(plan.wait<60/124);assert.ok(Math.abs(plan.duration-4)<60/124);assert.equal(plan.phraseAligned,false);
});
test('confirmed intro is skipped beyond an earlier phrase marker; uncertain or smooth introductions remain intact',async()=>{
 const {entryFor}=require('../public/dj-mixer');const track={id:'intro',duration:180,audioAnalysis:{mixPoints:{entry:24,exit:140,confidence:.9}}};
 assert.equal(entryFor(track,180),24);assert.equal(entryFor(track,180,'smooth'),0);assert.equal(entryFor({...track,audioAnalysis:{mixPoints:{entry:24,confidence:.4}}},180),0);
 assert.equal(entryFor({...track,audioAnalysis:{mixPoints:{entry:170,confidence:.9}}},180),0);
 const plan=planMix(outgoing,{...incoming,track,grid:{bpm:124,offset:0,phraseStart:0}});assert.ok(plan.cue>=24,'phrase marker cannot undo intro cut');
 const f=fixture();await f.mixer.load(track,'/intro');assert.equal(f.mixer.audio.currentTime,24);
});
test('dance faders shorten the low-power overlap while retaining a peak-safe sum',()=>{
 const basic=peakSafeCurves(),driven=peakSafeCurves(129,true);let oldPower=0,newPower=0;
 for(let i=0;i<129;i++){oldPower+=basic.outgoing[i]**2+basic.incoming[i]**2;newPower+=driven.outgoing[i]**2+driven.incoming[i]**2;assert.ok(driven.outgoing[i]+driven.incoming[i]<=1+1e-7);}
 assert.ok(newPower>oldPower);assert.equal(driven.incoming[0],0);assert.equal(driven.outgoing[128],0);
});
test('manual preparation can finish an analysis wait promptly and transition effects reserve only ten percent',async()=>{
 const f=fixture();await f.mixer.load({id:'a',duration:180},'/a');const next=f.mixer.prepare({id:'b',duration:180},'/b');await f.flushDelay(-1);assert.equal(f.mixer.finishPreparation(),true);assert.equal(await next,true);
 assert.equal(f.mixer.reserveEffectHeadroom(1,.9),true);assert.ok(f.scheduled.some(row=>row.kind==='ramp'&&row.v===.9));assert.equal(f.mixer.reserveEffectHeadroom(1,.9),false);
});
