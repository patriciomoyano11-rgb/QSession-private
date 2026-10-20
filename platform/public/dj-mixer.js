/* Two streaming decks; no full-track decoding or extra audio downloads on mobile. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QSessionDJ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const modulo = (value, period) => ((value % period) + period) % period;

  function harmonicDistance(first, second) {
    const parse = value => {
      const match = /^(1[0-2]|[1-9])([AB])$/i.exec(String(value || '').trim());
      return match ? {number: Number(match[1]), mode: match[2].toUpperCase()} : null;
    };
    const a = parse(first), b = parse(second);
    if (!a || !b) return null;
    const difference = Math.abs(a.number - b.number);
    return Math.min(difference, 12 - difference) + (a.mode === b.mode ? 0 : difference === 0 ? .5 : 2);
  }

  // Fit recurring low-frequency attacks to a pulse grid. Sparse/irregular audio
  // deliberately returns no grid rather than treating genre-derived BPM as measured.
  function estimateBeatGrid(peaks, hint = 124) {
    if (peaks.length < 12 || peaks.at(-1).time - peaks[0].time < 8) return null;
    let best = null;
    for (let bpm = 70; bpm <= 180; bpm += .25) {
      const beat = 60 / bpm;
      let x = 0, y = 0, total = 0;
      for (const peak of peaks) {
        const weight = Math.min(peak.strength, 4);
        const angle = 2 * Math.PI * peak.time / beat;
        x += Math.cos(angle) * weight; y += Math.sin(angle) * weight; total += weight;
      }
      const confidence = Math.hypot(x, y) / Math.max(total, .001);
      const score = confidence - .08 * Math.abs(Math.log2(bpm / hint));
      if (!best || score > best.score) best = {bpm, confidence, score, offset: modulo(Math.atan2(y, x) * beat / (2 * Math.PI), beat)};
    }
    return best.confidence >= .72 ? {bpm: best.bpm, offset: best.offset, confidence: best.confidence} : null;
  }

  function gridFor(track, detected, time=0) {
    const grid = track?.beatGrid;
    if (grid?.verified === true && Number(grid.bpm) > 0 && Number.isFinite(grid.offset)) {
      return {bpm: Number(grid.bpm), offset: grid.offset, confidence: 1, phraseStart: Number.isFinite(grid.phraseStart) ? grid.phraseStart : null};
    }
    const measured=track?.audioAnalysis?.beatGrid;
    // A BPM estimate is useful for ordering, but beat mixing also needs a stable
    // phase. Require agreement across independent windows before two kick drums
    // are allowed to overlap. A weak grid falls back to a clean handoff.
    if(measured?.source==='audio'&&measured.confidence>=(measured.method==='onset-correlation'?.65:.82)&&measured.agreement>=.8&&Number(measured.bpm)>0&&Number.isFinite(measured.offset)){
      const local=measured.windows?.filter(w=>time>=w.start&&time<w.end&&w.confidence>=(w.method==='onset-correlation'?.55:.78)).sort((a,b)=>b.confidence-a.confidence)[0];
      return {...measured,offset:Number.isFinite(local?.offset)?local.offset:measured.offset,localConfidence:local?.confidence??null,phraseStart:null};
    }
    return detected?.confidence>=.72&&(!Number.isFinite(detected.phaseConfidence)||detected.phaseConfidence>=.22)?detected:null;
  }

  // Correlate a bass onset envelope rather than requiring every percussion
  // accent to share one phase. Offbeat bass and hats otherwise erase the grid.
  function estimateEnvelopeGrid(envelope, hint = 120) {
    if(envelope.length<150)return null;
    const step=(envelope.at(-1).time-envelope[0].time)/(envelope.length-1);
    if(!(step>0)||envelope.at(-1).time-envelope[0].time<8)return null;
    const values=envelope.map((p,i)=>Math.max(0,p.energy-(envelope[Math.max(0,i-Math.max(1,Math.round(.04/step)))].energy)));
    const mean=values.reduce((a,b)=>a+b,0)/values.length;
    if(mean<.0001)return null;
    let best=null;
    for(let bpm=70;bpm<=180;bpm+=.25){
      const lag=60/bpm/step;let sum=0,aa=0,bb=0;
      for(let i=Math.ceil(lag);i<values.length;i++){const j=i-lag,k=Math.floor(j),v=values[k]*(1-j+k)+values[k+1]*(j-k);const a=values[i]-mean,b=v-mean;sum+=a*b;aa+=a*a;bb+=b*b;}
      const confidence=sum/Math.sqrt(aa*bb||1),score=confidence-.025*Math.abs(Math.log2(bpm/hint));
      if(!best||score>best.score)best={bpm,confidence,score};
    }
    if(best.confidence<.4)return null;
    const beat=60/best.bpm;let x=0,y=0,total=0;
    values.forEach((v,i)=>{const angle=2*Math.PI*envelope[i].time/beat;x+=v*Math.cos(angle);y+=v*Math.sin(angle);total+=v;});
    const phaseConfidence=Math.hypot(x,y)/Math.max(total,.0001);
    if(phaseConfidence<.15)return null;
    return {bpm:best.bpm,offset:modulo(Math.atan2(y,x)*beat/(2*Math.PI),beat),confidence:best.confidence,phaseConfidence,method:'onset-correlation'};
  }

  function entryFor(track,duration,style='auto') {
    const points=track?.audioAnalysis?.mixPoints;
    if(style==='smooth'||!(points?.confidence>=.7)||!Number.isFinite(points.entry)||!(duration>0))return 0;
    return points.entry>=0&&points.entry<=Math.min(60,duration*.3)?points.entry:0;
  }

  function segmentAt(track,time) {
    const segments=track?.audioAnalysis?.segments;
    if(!Array.isArray(segments)||!segments.length||!Number.isFinite(time))return null;
    return segments.find(segment=>time>=segment.start&&time<segment.end)||
      [...segments].sort((a,b)=>Math.abs(a.start-time)-Math.abs(b.start-time))[0]||null;
  }

  function intensityTrend(track,time,direction=1) {
    const segments=track?.audioAnalysis?.segments;
    if(!Array.isArray(segments)||segments.length<2||!Number.isFinite(time))return null;
    const ordered=[...segments].filter(segment=>Number.isFinite(segment.intensity)).sort((a,b)=>a.start-b.start);
    const current=segmentAt(track,time);if(!current||!Number.isFinite(current.intensity))return null;
    const neighbor=direction<0?[...ordered].reverse().find(segment=>segment.end<=current.start):ordered.find(segment=>segment.start>=current.end);
    return neighbor?neighbor.intensity-current.intensity:null;
  }

  function trustedFeature(track,name) {
    if(track?.classification?.reviewed===true)return track?.[name]??null;
    const semantic=track?.audioAnalysis?.semantic;
    if(name==='energy'&&semantic?.intensity?.accepted)return Number(track.energy)||null;
    if(name==='mood'&&semantic?.mood?.accepted)return track.mood||null;
    if(name==='rhythm'&&track?.audioAnalysis?.status==='ready'&&track?.classification?.method==='audio')return track.rhythm||null;
    return null;
  }

  // Choose a musical handoff rather than applying one crossfade to every pair.
  // User direction decides the intended journey; only reviewed or accepted
  // analysis may be described as evidence about a track's mood or intensity.
  function transitionProfile(outgoing,incoming,{journey={},style='auto',synced=false,keyDistance=null,harmonicClash=false,vocalClash=false,entry=0,exit=null}={}) {
    const oldTrack=outgoing.track||{},newTrack=incoming.track||{};
    const oldEnergy=trustedFeature(oldTrack,'energy'),newEnergy=trustedFeature(newTrack,'energy');
    const energyDelta=Number.isFinite(oldEnergy)&&Number.isFinite(newEnergy)?newEnergy-oldEnergy:null;
    const oldMood=trustedFeature(oldTrack,'mood'),newMood=trustedFeature(newTrack,'mood');
    const sameMood=Boolean(oldMood&&newMood&&oldMood===newMood);
    const oldRhythm=trustedFeature(oldTrack,'rhythm'),newRhythm=trustedFeature(newTrack,'rhythm');
    const sameRhythm=Boolean(oldRhythm&&newRhythm&&oldRhythm===newRhythm);
    const oldSegment=segmentAt(oldTrack,Number.isFinite(exit)?exit:outgoing.time);
    const newSegment=segmentAt(newTrack,entry);
    const dynamicDelta=Number.isFinite(oldSegment?.intensity)&&Number.isFinite(newSegment?.intensity)?newSegment.intensity-oldSegment.intensity:null;
    const bassDistance=Number.isFinite(oldSegment?.bassRatio)&&Number.isFinite(newSegment?.bassRatio)?Math.abs(newSegment.bassRatio-oldSegment.bassRatio):null;
    const brightnessDistance=Number.isFinite(oldSegment?.brightness)&&Number.isFinite(newSegment?.brightness)?Math.abs(newSegment.brightness-oldSegment.brightness):null;
    const percussionDistance=Number.isFinite(oldSegment?.percussionDensity)&&Number.isFinite(newSegment?.percussionDensity)?Math.abs(newSegment.percussionDensity-oldSegment.percussionDensity):null;
    const outgoingFall=intensityTrend(oldTrack,Number.isFinite(exit)?exit:outgoing.time,-1);
    const incomingRise=intensityTrend(newTrack,entry,1);
    const structuralContrast=(bassDistance!=null&&bassDistance>.45)||(brightnessDistance!=null&&brightnessDistance>.045)||(percussionDistance!=null&&percussionDistance>.9);
    const direction=energyDelta??(dynamicDelta==null?0:dynamicDelta>.16?1:dynamicDelta<-.16?-1:0);
    const curve=journey.curve||journey.energy||'steady';
    const rhythm=journey.targetRhythm||journey.rhythm||'';
    const knownSignals=[energyDelta,dynamicDelta,bassDistance,brightnessDistance,percussionDistance,outgoingFall,incomingRise,oldMood&&newMood?1:null,oldRhythm&&newRhythm?1:null,keyDistance].filter(value=>value!=null).length;
    let id='pulse';
    if(harmonicClash||vocalClash)id='protect';
    else if(!synced)id='handoff';
    else if(style==='smooth'||rhythm==='smooth')id='breathe';
    else if(structuralContrast)id='contrast';
    else if(outgoingFall>.12&&incomingRise>.12)id='breathe';
    else if(incomingRise>.14&&direction>=0)id='lift';
    else if(outgoingFall>.14&&direction<=0)id='release';
    else if(curve==='rise'&&(direction>=0||journey.targetEnergy>oldEnergy))id='lift';
    else if(curve==='calm'&&(direction<=0||journey.targetEnergy<oldEnergy))id='release';
    else if(curve==='wave'&&direction>0)id='lift';
    else if(curve==='wave'&&direction<0)id='release';
    else if(synced&&(sameMood||sameRhythm||keyDistance!=null&&keyDistance<=1))id='bridge';
    const definitions={
      protect:{label:'cambio protegido',detail:vocalClash?'separa las voces principales':'evita sostener tonalidades incompatibles',barDelta:0,curve:'clean',bass:{incomingHold:.18,incomingFull:.55,outgoingHold:.28,outgoingCut:.62}},
      handoff:{label:'entrega limpia',detail:'evita enfrentar baterías cuando la cuadrícula rítmica no es confiable',barDelta:0,curve:'clean',bass:null},
      breathe:{label:'transición respirada',detail:'abre espacio y conserva la introducción de la siguiente pista',barDelta:0,curve:'soft',bass:null},
      contrast:{label:'contraste con espacio',detail:'acorta el solapamiento porque cambian la percusión o el color sonoro',barDelta:-4,curve:'clean',bass:{incomingHold:.16,incomingFull:.5,outgoingHold:.24,outgoingCut:.58}},
      lift:{label:'ascenso progresivo',detail:'mantiene el groove antes de entregar el impulso a la siguiente pista',barDelta:4,curve:'late',bass:{incomingHold:.42,incomingFull:.62,outgoingHold:.5,outgoingCut:.72}},
      release:{label:'liberación gradual',detail:'reduce densidad antes de establecer el nuevo pulso',barDelta:4,curve:'early',bass:{incomingHold:.22,incomingFull:.52,outgoingHold:.3,outgoingCut:.6}},
      bridge:{label:'puente armónico',detail:'prolonga la continuidad entre pistas compatibles',barDelta:0,curve:'soft',bass:{incomingHold:.34,incomingFull:.56,outgoingHold:.48,outgoingCut:.7}},
      pulse:{label:'relevo de pulso',detail:'alinea el beat y alterna los graves sin sumar ganancia',barDelta:0,curve:'drive',bass:{incomingHold:.35,incomingFull:.5,outgoingHold:.5,outgoingCut:.65}}
    };
    const selected={...definitions[id],bass:definitions[id].bass?{...definitions[id].bass}:null};
    // Within an archetype, measured local dynamics still move the handoff.
    // A denser incoming passage arrives later; a lighter one can enter sooner.
    if(selected.bass&&dynamicDelta!=null&&!['protect','contrast'].includes(id)){
      const shift=clamp(dynamicDelta*.12,-.06,.06);
      selected.bass.incomingHold=clamp(selected.bass.incomingHold+shift,.12,.55);
      selected.bass.incomingFull=clamp(selected.bass.incomingFull+shift,.4,.72);
      selected.bass.outgoingHold=clamp(selected.bass.outgoingHold+shift*.6,.22,.58);
      selected.bass.outgoingCut=clamp(selected.bass.outgoingCut+shift*.5,.52,.78);
    }
    if(id==='bridge'&&bassDistance!=null&&bassDistance<.2&&percussionDistance!=null&&percussionDistance<.3)selected.barDelta=8;
    return {id,...selected,energyDelta,dynamicDelta,bassDistance,brightnessDistance,percussionDistance,outgoingFall,incomingRise,sameMood,sameRhythm,confidence:knownSignals>=4?'high':knownSignals>=2?'medium':'low'};
  }

  function planMix(outgoing, incoming, {bars = 8, targetBpm, manual = false, fallbackSeconds = 4, style = 'auto',journey={}} = {}) {
    const a = outgoing.grid, b = incoming.grid;
    const tempo = Number(targetBpm) || (a?.bpm || outgoing.track?.bpm || 124) * outgoing.rate;
    const rate = b ? tempo / b.bpm : 1;
    const remaining = Math.max(0, (outgoing.duration - outgoing.time) / outgoing.rate);
    const keyDistance=harmonicDistance(outgoing.track?.camelotKey||outgoing.track?.key,incoming.track?.camelotKey||incoming.track?.key);
    const harmonicClash=keyDistance!=null&&keyDistance>1;
    const exit=outgoing.track?.audioAnalysis?.mixPoints?.exit;
    const entry=entryFor(incoming.track,incoming.duration,style);
    const instrumentalAt=(track,time)=>track?.audioAnalysis?.cues?.some(c=>c.instrumental&&Math.abs(c.time-time)<2);
    const transitionTime=Number.isFinite(exit)?exit:outgoing.time;
    const vocalClash=outgoing.track?.vocalRole==='lead'&&incoming.track?.vocalRole==='lead'&&!(instrumentalAt(outgoing.track,transitionTime)&&instrumentalAt(incoming.track,entry));
    const synced = Boolean(style!=='smooth'&&!harmonicClash&&!vocalClash&&a && b && rate >= .92 && rate <= 1.08 && Math.abs(a.bpm * outgoing.rate - tempo) < 1);
    const profile=transitionProfile(outgoing,incoming,{journey,style,synced,keyDistance,harmonicClash,vocalClash,entry,exit});
    const beat = 60 / tempo;
    const outgoingBeat=a?60/a.bpm:null;
    const block = !manual&&a?.phraseStart != null ? outgoingBeat * 16 : outgoingBeat;
    const origin = a?.phraseStart ?? a?.offset ?? 0;
    // `time`, `origin` and `block` are media seconds. Convert the distance to
    // wall-clock seconds only after finding the next grid boundary.
    const wait = synced ? modulo(origin-outgoing.time,block) / outgoing.rate : 0;
    // Phrase alignment is claimed only for a verified phrase grid. A detected
    // kick grid aligns beats, not vocals, verse boundaries or musical downbeats.
    const adaptiveFallback=profile.id==='breathe'?Math.max(fallbackSeconds,5):profile.id==='lift'||profile.id==='release'?Math.max(fallbackSeconds,5):fallbackSeconds;
    const fallback=!synced?Math.min(2.5,clamp(fallbackSeconds,1.5,3)):(harmonicClash||vocalClash)?Math.min(3,clamp(fallbackSeconds,2,8)):clamp(adaptiveFallback,2,8);
    const manualLength=harmonicClash||vocalClash?Math.min(3,clamp(fallbackSeconds,2,12)):clamp(fallbackSeconds,2,12);
    const adaptiveBars=clamp(Number(bars)+(!manual?profile.barDelta:0),4,16);
    const requested=manual?(synced?Math.max(1,Math.round(manualLength/beat))*beat:manualLength):synced?adaptiveBars*4*beat:fallback;
    const duration = Math.max(.25, Math.min(requested, remaining - wait - .25, (incoming.duration - entry) / (synced?rate:1) - .25));
    const phrase=b?.phraseStart!=null?b.phraseStart+Math.max(0,Math.ceil((entry-b.phraseStart)/(16*60/b.bpm)))*(16*60/b.bpm):null;
    const cue=synced?Math.max(entry,phrase??(entry===0?b.offset:entry+modulo((b?.offset||0)-entry,60/b.bpm))):entry;
    return {synced, phraseAligned: synced && !manual && a.phraseStart != null && b.phraseStart != null,
      tempo, rate: synced ? rate : 1, cue,
      exit:style!=='smooth'&&!manual&&Number.isFinite(exit)&&outgoing.track.audioAnalysis.mixPoints.confidence>=.7&&exit>outgoing.duration*.6&&exit<outgoing.duration-1?exit:null,
      wait: remaining > wait + 1 ? wait : 0, duration, manual,profile,bass:profile.bass,outgoingGrid:a,incomingGrid:b,outgoingRate:outgoing.rate,
      reason:harmonicClash?'harmonic-clash':vocalClash?'lead-vocals':style==='smooth'?'context-smooth':synced?'beat-compatible':'unverified-or-incompatible-tempo'};
  }

  function alignedIncomingTime(plan,outgoingTime) {
    if(!plan?.synced||!plan.outgoingGrid||!plan.incomingGrid)return plan?.cue||0;
    const a=plan.outgoingGrid,b=plan.incomingGrid;
    const outgoingBeat=60/a.bpm;
    const wallPhase=modulo(outgoingTime-a.offset,outgoingBeat)/Math.max(.01,plan.outgoingRate||1);
    const target=plan.cue+wallPhase*plan.rate;
    return clamp(target,0,Math.max(0,(Number(plan.incomingDuration)||Infinity)-.25));
  }

  function equalPowerCurves(size = 129) {
    const outgoing = new Float32Array(size), incoming = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const angle = i / (size - 1) * Math.PI / 2;
      outgoing[i] = Math.cos(angle); incoming[i] = Math.sin(angle);
    }
    return {outgoing, incoming};
  }

  // Complementary envelopes also bound correlated kicks and identical material.
  // Equal-power envelopes can add 3 dB and clip a full-scale master.
  function peakSafeCurves(size = 129, preserveDrive = false) {
    const curves = equalPowerCurves(size);
    if(preserveDrive)for(let i=0;i<size;i++){const t=i/(size-1),phase=t<.5?.5*(2*t)**2:1-.5*(2*(1-t))**2;curves.outgoing[i]=Math.cos(phase*Math.PI/2);curves.incoming[i]=Math.sin(phase*Math.PI/2);}
    for (let i = 0; i < size; i++) {
      const total = curves.outgoing[i] + curves.incoming[i];
      curves.outgoing[i] /= total; curves.incoming[i] /= total;
    }
    curves.outgoing[size - 1] = 0;
    return curves;
  }

  function transitionCurves(profile='drive',size=129) {
    const outgoing=new Float32Array(size),incoming=new Float32Array(size);
    for(let index=0;index<size;index++){
      const t=index/(size-1);let phase=t;
      if(profile==='soft')phase=t*t*(3-2*t);
      else if(profile==='late'){const x=clamp((t-.08)/.92,0,1);phase=x*x*(3-2*x);}
      else if(profile==='early'){const x=clamp(t/.92,0,1);phase=x*x*(3-2*x);}
      else if(profile==='drive')phase=t<.5?.5*(2*t)**2:1-.5*(2*(1-t))**2;
      incoming[index]=phase;outgoing[index]=1-phase;
    }
    outgoing[size-1]=0;incoming[0]=0;incoming[size-1]=1;
    return {outgoing,incoming};
  }

  function createOutput(context, volume = 1) {
    const output = context.createGain();
    output.gain.value = clamp(volume, 0, 1);
    output.connect(context.destination);
    return output;
  }

  class Mixer {
    constructor(context, output, {onActive = () => {}, onAutoMix = () => {}, onFailure = () => {}, onMixStart=()=>{}, audioFactory = () => new Audio(), timers = globalThis} = {}) {
      this.context = context; this.output = output; this.onActive = onActive;
      this.musicBus = context.createGain(); this.musicBus.connect(output);
      this.onAutoMix = onAutoMix; this.onFailure = onFailure; this.onMixStart=onMixStart;this.timers = timers;
      this.active = 0; this.serial = 0; this.mixing = false; this.preparing = false; this.prepared = false; this.auto = true; this.bars = 8; this.style='auto';this.journey={};
      this.decks = [0, 1].map(() => {
        const audio = audioFactory(); audio.crossOrigin = 'anonymous'; audio.preload = 'auto'; audio.preservesPitch = true;
        const source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
        const trim = context.createGain(), bass = context.createBiquadFilter(), fader = context.createGain();
        bass.type = 'lowshelf'; bass.frequency.value = 220; fader.gain.value = 0;
        source.connect(analyser); analyser.connect(trim); trim.connect(bass); bass.connect(fader); fader.connect(this.musicBus);
        return {audio, analyser, trim, bass, fader, spectrum: new Uint8Array(analyser.frequencyBinCount), samples: new Float32Array(analyser.fftSize), envelope: [], peaks: [], grid: null, rms: 0, lastEnergy: 0, lastPeak: -1, lastTime: -1, track: null};
      });
      this.interval = timers.setInterval(() => this.tick(), 40);
    }
    get deck() { return this.decks[this.active]; }
    get audio() { return this.deck.audio; }
    reserveEffectHeadroom(seconds = 2, level = .5) {
      const now = this.context.currentTime;
      if (now < (this.effectUntil || 0)) return false;
      this.effectUntil = now + seconds;
      const gain = this.musicBus.gain;
      gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(clamp(level,.5,1), now + .01);
      gain.setValueAtTime(clamp(level,.5,1), now + seconds);
      gain.linearRampToValueAtTime(1, now + seconds + .08);
      return true;
    }
    snapshot(deck) { return {track: deck.track, grid: gridFor(deck.track, deck.grid,deck.audio.currentTime), rate: deck.audio.playbackRate, time: deck.audio.currentTime, duration: Number.isFinite(deck.audio.duration) ? deck.audio.duration : Number(deck.track?.duration) || 0}; }
    resetDeck(deck, audible = false) {
      const now = this.context.currentTime;
      for (const param of [deck.fader.gain, deck.bass.gain, deck.trim.gain]) param.cancelScheduledValues(now);
      deck.fader.gain.setValueAtTime(audible ? 1 : 0, now); deck.bass.gain.setValueAtTime(0, now); deck.trim.gain.setValueAtTime(1, now);
    }
    cancel() {
      this.serial++; this.mixing = false; this.preparing = false; this.prepared = false;
      if (this.pending) {this.timers.clearTimeout(this.pending.id); this.pending.resolve(false); this.pending = null;}
      const activeTrim = this.deck.trim.gain.value;
      this.decks.forEach((deck, index) => {this.resetDeck(deck, index === this.active); if (index !== this.active) {deck.audio.pause(); deck.audio.removeAttribute('src'); deck.audio.load(); deck.track = null;}});
      this.deck.trim.gain.setValueAtTime(activeTrim, this.context.currentTime);
    }
    async load(track, url) {
      this.cancel(); const deck = this.deck; const token = this.serial;
      deck.audio.pause(); this.resetDeck(deck, true); deck.track = track; deck.grid = null; deck.peaks = []; deck.lastTime = -1; deck.lastPeak = -1; deck.lastAnalysis = 0; deck.rms = 0;
      deck.envelope=[];deck.audio.playbackRate = 1; deck.audio.src = url;
      await this.play(deck.audio);
      if (token !== this.serial) return false;
      const entry=entryFor(track,Number.isFinite(deck.audio.duration)?deck.audio.duration:Number(track.duration),this.style);
      if(entry>0)deck.audio.currentTime=entry;
      this.onActive(deck.audio, track); return true;
    }
    async play(audio) {
      let timeout;
      try {await Promise.race([audio.play(), new Promise((_, reject) => {timeout = this.timers.setTimeout(() => reject(new Error('Audio no disponible')), 15000);})]);}
      finally {this.timers.clearTimeout(timeout);}
    }
    async prepare(track, url, {quick=false}={}) {
      if (this.mixing) return false;
      this.cancel(); const token = this.serial; this.preparing = true; this.quickPreparation=false;
      const deck = this.decks[1 - this.active]; deck.track = track; deck.grid = null; deck.peaks = []; deck.lastTime = -1; deck.lastPeak = -1; deck.lastAnalysis = 0; deck.rms = 0;
      deck.envelope=[];deck.audio.src = url; deck.audio.playbackRate = 1; this.resetDeck(deck);
      try {
        await this.play(deck.audio);
        if (token !== this.serial) return false;
        const sampled = quick||this.quickPreparation?true:await this.delay(gridFor(track,null)?1000:16000);
        if (!sampled || token !== this.serial) return false;
        deck.audio.pause(); deck.audio.currentTime = 0;
        this.prepared = true; return true;
      } catch (error) {
        if (token === this.serial) {this.resetDeck(deck); deck.audio.pause(); deck.track = null; this.onFailure(error);}
        return false;
      } finally {if (token === this.serial) this.preparing = false;}
    }
    finishPreparation() {
      if(!this.preparing||this.mixing)return false;
      this.quickPreparation=true;
      if(this.pending){const pending=this.pending;this.pending=null;this.timers.clearTimeout(pending.id);pending.resolve(true);}
      return true;
    }
    delay(milliseconds) {
      return new Promise(resolve => {const id = this.timers.setTimeout(() => {this.pending = null; resolve(true);}, milliseconds); this.pending = {id, resolve};});
    }
    plan(options = {}) { return planMix(this.snapshot(this.deck), this.snapshot(this.decks[1 - this.active]), {bars: this.bars,style:this.style,journey:this.journey, ...options}); }
    async mix(options = {}) {
      if (!this.prepared || this.mixing || this.audio.paused) return false;
      const token = this.serial; const old = this.deck, incoming = this.decks[1 - this.active]; const plan = this.plan(options);
      this.mixing = true;
      try {
        if (plan.wait && !await this.delay(plan.wait * 1000)) return false;
        if (token !== this.serial || old.audio.paused) return false;
        incoming.audio.currentTime = plan.cue; incoming.audio.playbackRate = plan.rate;
        await this.play(incoming.audio);
        if (token !== this.serial) return false;
        // HTML media playback does not start sample-accurately. While the new
        // deck is still silent, compensate the real startup delay against the
        // outgoing grid so the faders never open on two displaced kicks.
        if(plan.synced)incoming.audio.currentTime=alignedIncomingTime({...plan,incomingDuration:incoming.audio.duration},old.audio.currentTime);
        const now = this.context.currentTime;
        // Match levels by attenuation; complementary faders reserve peak headroom.
        const oldTrim=clamp(old.trim.gain.value,.5,1),reference=(old.rms||.1)*oldTrim;
        old.trim.gain.setValueAtTime(oldTrim,now);
        incoming.trim.gain.setValueAtTime(clamp(reference/(incoming.rms||reference),.7,1),now);
        const curves = transitionCurves(plan.profile?.curve||'drive');
        old.fader.gain.cancelScheduledValues(now); incoming.fader.gain.cancelScheduledValues(now);
        old.fader.gain.setValueCurveAtTime(curves.outgoing, now, plan.duration);
        incoming.fader.gain.setValueCurveAtTime(curves.incoming, now, plan.duration);
        this.onMixStart({outgoing:old.track,incoming:incoming.track,...plan,effect:options.effect||'none'});
        // Keep the outgoing beat until the incoming bass has arrived. Complementary
        // faders still bound the sum; no bass boost or additional master gain.
        const bass=plan.bass===undefined?{incomingHold:.35,incomingFull:.5,outgoingHold:.5,outgoingCut:.65}:plan.bass;
        if(bass){
          incoming.bass.gain.setValueAtTime(-18, now);
          incoming.bass.gain.setValueAtTime(-18, now + plan.duration * bass.incomingHold);
          incoming.bass.gain.linearRampToValueAtTime(0, now + plan.duration * bass.incomingFull);
          old.bass.gain.setValueAtTime(0, now);
          old.bass.gain.setValueAtTime(0, now + plan.duration * bass.outgoingHold);
          old.bass.gain.linearRampToValueAtTime(-18, now + plan.duration * bass.outgoingCut);
        }
        if (!await this.delay(plan.duration * 1000) || token !== this.serial) return false;
        old.audio.pause(); this.resetDeck(old); old.audio.removeAttribute('src'); old.audio.load(); old.track = null;
        this.active = 1 - this.active; this.prepared = false;
        this.onActive(incoming.audio, incoming.track); return plan;
      } catch (error) {
        if (token === this.serial) {this.resetDeck(old, true); this.resetDeck(incoming); incoming.audio.pause(); this.prepared = false; this.onFailure(error);}
        return false;
      } finally {if (token === this.serial) this.mixing = false;}
    }
    sample(deck) {
      const time = deck.audio.currentTime;
      if (deck.audio.paused || time === deck.lastTime) return;
      if (time < deck.lastTime || time - deck.lastTime > .5) {deck.envelope=[];deck.peaks = []; deck.lastPeak = -1; deck.lastEnergy = 0; deck.lastAnalysis = 0;}
      deck.lastTime = time;
      deck.analyser.getByteFrequencyData(deck.spectrum);
      const first = Math.ceil(45 * deck.analyser.fftSize / this.context.sampleRate), last = Math.ceil(220 * deck.analyser.fftSize / this.context.sampleRate);
      let energy = 0; for (let i = first; i <= last; i++) energy += deck.spectrum[i] / 255;
      energy /= Math.max(1, last - first + 1);
      deck.envelope.push({time,energy});deck.envelope=deck.envelope.filter(p=>p.time>time-24);
      const delta = Math.max(0, energy - deck.lastEnergy); deck.lastEnergy = energy;
      if (delta > .08 && time - deck.lastPeak > .22) {deck.peaks.push({time, strength: delta * 10}); deck.lastPeak = time;}
      deck.peaks = deck.peaks.filter(peak => peak.time > time - 24);
      if (!deck.lastAnalysis || time - deck.lastAnalysis > 2) {deck.grid = estimateEnvelopeGrid(deck.envelope,Number(deck.track?.bpm)||124)||estimateBeatGrid(deck.peaks, Number(deck.track?.bpm) || 124); deck.lastAnalysis = time;}
      deck.analyser.getFloatTimeDomainData(deck.samples);
      let sum = 0; for (const value of deck.samples) sum += value * value;
      const rms = Math.sqrt(sum / deck.samples.length);
      if (rms > .005) deck.rms = deck.rms ? .95 * deck.rms + .05 * rms : rms;
    }
    tick() {
      this.decks.forEach(deck => this.sample(deck));
      if (!this.auto || !this.prepared || this.mixing || this.audio.paused) return;
      const remaining = (this.audio.duration - this.audio.currentTime) / this.audio.playbackRate;
      const plan = this.plan();
      const structuralCue=plan.exit!=null&&this.audio.currentTime>=Math.max(this.audio.duration*.6,plan.exit-(plan.duration+plan.wait)*this.audio.playbackRate);
      if (remaining > .5 && (structuralCue||remaining <= plan.duration + plan.wait + 1)) this.onAutoMix();
    }
    pause() {this.cancel(); this.audio.pause();}
    seek(time) {this.cancel(); this.audio.currentTime = time; this.deck.grid = null; this.deck.peaks = [];}
    stop() {this.cancel(); this.decks.forEach(deck => {deck.audio.pause(); deck.audio.removeAttribute('src'); deck.audio.load(); deck.track = null;});}
    destroy() {this.stop(); this.timers.clearInterval(this.interval);}
  }
  return {estimateBeatGrid, estimateEnvelopeGrid, gridFor, entryFor, segmentAt, intensityTrend, trustedFeature, transitionProfile, planMix, alignedIncomingTime, equalPowerCurves, peakSafeCurves, transitionCurves, createOutput, harmonicDistance, Mixer};
});
