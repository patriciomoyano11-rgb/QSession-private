'use strict';
const {estimateBeatGrid,estimateEnvelopeGrid}=require('../public/dj-mixer.js');
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function features(audio,sampleRate=8000) {
  const duration=audio.length/sampleRate,hop=Math.round(sampleRate*.02),frames=[];
  let low=0,previous=0,peak=0;
  const alpha=1-Math.exp(-2*Math.PI*180/sampleRate);
  for(let start=0;start<audio.length;start+=hop) {
    let square=0,bass=0,crossings=0;
    const end=Math.min(start+hop,audio.length);
    for(let i=start;i<end;i++) {const x=audio[i];low+=alpha*(x-low);square+=x*x;bass+=low*low;if(x*previous<0)crossings++;previous=x;peak=Math.max(peak,Math.abs(x));}
    frames.push({time:start/sampleRate,rms:Math.sqrt(square/(end-start)),bass:Math.sqrt(bass/(end-start)),brightness:crossings/(end-start)});
  }
  const sorted=frames.map(x=>x.rms).sort((a,b)=>a-b), median=sorted[Math.floor(sorted.length*.5)]||0;
  const loud=sorted[Math.floor(sorted.length*.9)]||0;
  const peaks=[];let last=-1;
  for(let i=2;i<frames.length-2;i++) {
    const frame=frames[i],delta=frame.bass-frames[i-2].bass;
    if(delta>Math.max(.003,median*.12)&&frame.bass>=frames[i+1].bass&&frame.time-last>.24) {peaks.push({time:frame.time,strength:Math.min(4,delta/Math.max(.005,median))});last=frame.time;}
  }
  // Do not use filename BPM as a hint. Independent windows must agree.
  const grids=[];
  for(let start=0;start<duration;start+=24) {const grid=estimateEnvelopeGrid(frames.filter(p=>p.time>=start&&p.time<start+24).map(p=>({time:p.time,energy:p.bass})),120)||estimateBeatGrid(peaks.filter(p=>p.time>=start&&p.time<start+24),120);if(grid)grids.push({...grid,start,end:Math.min(duration,start+24)});}
  const best=grids.length?[...grids].sort((a,b)=>b.confidence-a.confidence)[0]:null;
  const matching=best?grids.filter(g=>Math.abs(g.bpm-best.bpm)<1.5):[];
  const agreement=matching.length/Math.max(1,Math.floor(duration/24));
  const bpm=matching.length?matching.map(g=>g.bpm).sort((a,b)=>a-b)[Math.floor(matching.length/2)]:0;
  // BPM alone is not enough for a beat mix. Keep only grids whose tempo and
  // phase recur across most independent windows; otherwise qDJ will use a
  // short clean handoff instead of colliding two uncertain kick patterns.
  const beatGrid=best&&agreement>=.8&&best.confidence>=(best.method==='onset-correlation'?.65:.82)?{bpm,offset:best.offset,confidence:clamp(best.confidence,0,1),phaseConfidence:best.phaseConfidence??null,method:best.method,source:'audio',agreement:Math.min(1,agreement),windows:grids}:null;
  const segments=[];
  for(let start=0;start<duration;start+=8) {
    const slice=frames.slice(Math.round(start/.02),Math.round((start+8)/.02));
    const rms=Math.sqrt(slice.reduce((s,f)=>s+f.rms*f.rms,0)/Math.max(1,slice.length));
    const bass=Math.sqrt(slice.reduce((s,f)=>s+f.bass*f.bass,0)/Math.max(1,slice.length));
    const brightness=slice.reduce((s,f)=>s+f.brightness,0)/Math.max(1,slice.length);
    const mean=slice.reduce((s,f)=>s+f.rms,0)/Math.max(1,slice.length);
    const variation=Math.sqrt(slice.reduce((s,f)=>s+(f.rms-mean)**2,0)/Math.max(1,slice.length))/Math.max(loud,.001);
    const end=Math.min(duration,start+8),percussionDensity=peaks.filter(event=>event.time>=start&&event.time<end).length/Math.max(.001,end-start);
    segments.push({start,end,intensity:clamp(rms/Math.max(loud,.001),0,1),rms,bassRatio:clamp(bass/Math.max(rms,.001),0,2),brightness,percussionDensity,variation:clamp(variation,0,2)});
  }
  const usable=segments.filter(s=>s.rms>.003);
  const intro=usable.find(s=>s.start<=Math.min(32,duration*.15));
  const outro=usable.filter(s=>s.start>=duration*.65&&s.start<=duration-10).sort((a,b)=>a.intensity-b.intensity||b.start-a.start)[0];
  return {duration,peak,rms:Math.sqrt(frames.reduce((s,f)=>s+f.rms*f.rms,0)/Math.max(1,frames.length)),dynamicRange:loud/Math.max(sorted[Math.floor(sorted.length*.1)]||0,.001),beatGrid,segments,
    mixPoints:{entry:intro?.start||0,exit:outro?.start??null,source:'relative-dynamics',confidence:outro?.intensity<.65?.7:.4}};
}
module.exports={features};
