'use strict';
const seed = require('./music-data/audius-selection.json');
const OML = 'https://audius.org/open-music-license.pdf';
const {harmonicDistance} = require('./public/dj-mixer');
const families = [
  {id:'electronic',name:'Electrónica',description:'House, techno, acid, microhouse, breaks y electrónica experimental.'},
  {id:'latin',name:'Latina',description:'Cumbia, salsa, reggaetón, bachata y fusiones para celebrar.'},
  {id:'afro',name:'Afro y global',description:'Afrobeats, amapiano y ritmos de raíz contemporánea.'},
  {id:'urban',name:'Urbana',description:'Hip hop, R&B y sonidos urbanos.'},
  {id:'pop',name:'Pop y celebración',description:'Canciones accesibles para bodas, cumpleaños y encuentros.'},
  {id:'ambient',name:'Chill y ambiental',description:'Downtempo, piano y atmósferas para bajar el ritmo.'},
  {id:'wellness',name:'Bienestar',description:'Yoga, respiración, meditación y relajación.'},
  {id:'instrumental',name:'Instrumental',description:'Música cinematográfica, jazz, acústica y fondos profesionales.'},
  {id:'rock',name:'Rock y metal',description:'Rock, guitarras y metal, separados de los fondos instrumentales.'},
  {id:'cumbia',name:'Cumbias',description:'Cumbia contemporánea y electrónica, con su estilo indicado.'},
  {id:'roots',name:'Raíces y tradicionales',description:'Una selección pequeña de música regional y fusiones latinoamericanas. La oferta colombiana aún es limitada.'},
];
function eligible(t) {
  if (!t || !t.id || !t.title || !t.user?.name) return false;
  if (t.is_delete || t.is_unlisted || t.is_available === false || t.is_streamable === false || t.is_stream_gated || t.access?.stream === false || t.user.is_deactivated) return false;
  if (t.ai_attribution_user_id || t.remix_of?.tracks?.length || t.cover_original_song_title || t.cover_original_artist || t.stem_of) return false;
  if (t.parental_warning_type && !/^(not explicit|clean|none)$/i.test(t.parental_warning_type)) return false;
  // Fail closed for alternative licences; they require a separate review.
  if (t.license && !/^all rights reserved$/i.test(t.license)) return false;
  if (/\b(remix|bootleg|mashup|cover|edit|djset|demo)\b/i.test(t.title)) return false;
  if (/\b(cover of|this is a cover|AI technology|AI generated|suno|udio)\b/i.test(t.description || '')) return false;
  return Number.isFinite(t.duration) && t.duration >= 60 && t.duration <= 1200;
}
const moods = ['any','deep','warm','euphoric','sensual','meditative','focused','celebratory','dark'];
const rhythms = ['any','smooth','groove','drive','peak'];
function inferredProfile(track) {
  if(track.classification?.reviewed!==true && track.family==='instrumental' && /\b(rock|metal)\b/i.test(track.subgenre||track.style||''))track={...track,family:'rock',genre:'Rock y metal',subgenre:/death metal/i.test(track.title)?'Death Metal':/metal/i.test(track.title)?'Metal':track.subgenre||'Rock'};
  const text = `${track.subgenre || ''} ${track.style || ''} ${track.genre || ''}`.toLowerCase();
  const electronic = track.family === 'electronic';
  const bpm = Math.max(40, Math.min(220, Number(track.bpm) || (
    /drum|jungle/.test(text) ? 174 : /trance/.test(text) ? 138 : /techno|acid/.test(text) ? 132
      : /house/.test(text) ? 124 : /cumbia|salsa|reggaet/.test(text) ? 98
        : /ambient|medita|yoga/.test(text) ? 72 : electronic ? 124 : 110
  )));
  const mood = track.mood || (/ambient|medita|yoga/.test(text) ? 'meditative' : /techno|acid|warehouse/.test(text) ? 'dark'
    : /cumbia|salsa|pop|celebr/.test(text) ? 'celebratory' : /afro|organic|jazz/.test(text) ? 'warm' : 'focused');
  const rhythm = track.rhythm || (Number(track.energy) >= 5 ? 'peak' : Number(track.energy) >= 4 ? 'drive'
    : Number(track.energy) <= 2 ? 'smooth' : 'groove');
  return {...track,bpm,mood,rhythm};
}
// A small preference for emotional/beat continuity, not a ban on changing energy.
function continuityPenalty(previous,next,{energy='steady',rhythm='any'}={}) {
  if(!previous||energy==='calm'||rhythm==='smooth')return 0;
  const energyDrop=previous.energy!=null&&next.energy!=null&&Number.isFinite(Number(previous.energy))&&Number.isFinite(Number(next.energy))?Math.max(0,Number(previous.energy)-Number(next.energy)):0;
  const tempoDrop=previous.bpm!=null&&next.bpm!=null&&Number.isFinite(Number(previous.bpm))&&Number.isFinite(Number(next.bpm))?Math.max(0,Number(previous.bpm)-Number(next.bpm)-2):0;
  return Math.min(2,energyDrop*.75+tempoDrop*.08);
}
function buildSession(tracks, {family, minutes=30, energy='steady', bpmMin=0, bpmMax=0, mood='any', rhythm='any', subgenre='',excludeIds=[],feedback={},energyTarget=null,previousTrackId=null,history=[],rotation=0}={}) {
  if (!families.some(f=>f.id===family)) throw new Error('Elige un género disponible');
  if (!Number.isInteger(Number(minutes)) || Number(minutes)<5 || Number(minutes)>180) throw new Error('Duración no válida');
  if (!['steady','rise','calm','wave'].includes(energy)) throw new Error('Energía no válida');
  if (!moods.includes(mood)) throw new Error('Emoción no válida');
  if (!rhythms.includes(rhythm)) throw new Error('Ritmo no válido');
  const minimumBpm = Math.max(0, Math.min(220, Number(bpmMin) || 0));
  const maximumBpm = Math.max(0, Math.min(220, Number(bpmMax) || 0));
  if (minimumBpm && maximumBpm && minimumBpm > maximumBpm) throw new Error('El rango de BPM no es válido');
  const targetLevel=energyTarget==null?null:Number(energyTarget);
  if(targetLevel!=null&&(!Number.isInteger(targetLevel)||targetLevel<1||targetLevel>5))throw new Error('Energía de la pista no válida');
  const initialTrack=tracks.find(track=>track.id===previousTrackId);
  const rotationValue=Math.max(0,Math.min(1000000,Math.floor(Number(rotation)||0)));
  const rotationRank=track=>{let hash=(2166136261^rotationValue)>>>0;for(const character of String(track.id||track.title||'')){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619)>>>0;}return hash;};
  const excluded = new Set(Array.isArray(excludeIds) ? excludeIds.slice(0, 500).filter(id=>typeof id==='string') : []);
  const familyPool = tracks.map(inferredProfile).filter(t=>t.family===family && !excluded.has(t.id) && feedback[t.id]?.myVote!==-1);
  // A named subgenre is a hard musical boundary. Never fill a Deep House,
  // Techno or Cumbia request with a neighboring label just to reach duration.
  const wantedSubgenre=String(subgenre||'').trim().toLocaleLowerCase('es');
  const preferredPool=wantedSubgenre?familyPool.filter(t=>String(t.subgenre||t.style||'').trim().toLocaleLowerCase('es')===wantedSubgenre):familyPool;
  const narrowed = preferredPool.filter(t=>(!minimumBpm || t.bpm>=minimumBpm) && (!maximumBpm || t.bpm<=maximumBpm)
    && (mood==='any' || t.mood===mood) && (rhythm==='any' || t.rhythm===rhythm));
  const compatible=preferredPool.filter(t=>(!minimumBpm||t.bpm>=minimumBpm-6)&&(!maximumBpm||t.bpm<=maximumBpm+6)
    && (rhythm==='any'||t.rhythm===rhythm)
    && (targetLevel==null || Math.abs((Number(t.energy)||3)-targetLevel)<=1)
    && (mood==='any'||t.mood===mood||({warm:['deep','focused','sensual'],deep:['warm','focused','meditative'],focused:['deep','warm','dark'],meditative:['deep','warm'],dark:['deep','focused'],sensual:['warm','deep'],euphoric:['celebratory'],celebratory:['euphoric','warm']}[mood]||[]).includes(t.mood)));
  // Emotion and rhythm describe a preference, not a reason to discard an otherwise
  // coherent track. Genre/subgenre, explicit tempo and requested intensity remain hard boundaries.
  const preferenceFallback=preferredPool.filter(t=>(!minimumBpm||t.bpm>=minimumBpm)&&(!maximumBpm||t.bpm<=maximumBpm)
    && (targetLevel==null || Math.abs((Number(t.energy)||3)-targetLevel)<=1));
  // Genre boundaries remain mandatory even when the requested duration cannot be filled.
  const exact=narrowed.filter(t=>targetLevel==null || Math.abs((Number(t.energy)||3)-targetLevel)<=1);
  const exactSeconds=exact.reduce((sum,t)=>sum+t.duration,0);
  const candidates=exactSeconds>=Number(minutes)*60?exact:[...compatible,...preferenceFallback];
  const pool = [...new Map(candidates.map(t=>[t.id,t])).values()];
  const recent=Array.isArray(history)?history.slice(-100):[];
  const recencyCost=track=>recent.reduce((cost,item,index)=>cost+(item.id===track.id?30:item.artist===track.artist?3:0)*(index+1)/Math.max(1,recent.length),0);
  const preferenceScore = track => (targetLevel!=null?4-Math.abs((Number(track.energy)||3)-targetLevel)*4:0) + (feedback[track.id]?.myVote===1 ? 2 : 0) + Math.max(-1.5,Math.min(1.5,(Number(feedback[track.id]?.score)||0)*1.5)) + (mood!=='any' && track.mood===mood ? 4 : 0) + (rhythm!=='any' && track.rhythm===rhythm ? 3 : 0)
    + ((!minimumBpm || track.bpm>=minimumBpm) && (!maximumBpm || track.bpm<=maximumBpm) ? 2 : 0);
  pool.sort((a,b)=>(energy==='rise' ? a.energy-b.energy : energy==='calm' ? b.energy-a.energy : 0)
    || recencyCost(a)-recencyCost(b) || preferenceScore(b)-preferenceScore(a) || a.bpm-b.bpm || (rotationValue?rotationRank(a)-rotationRank(b):a.order-b.order));
  const selected=[], usedArtists=new Map();
  let seconds=0;
  while (pool.length && seconds < Number(minutes)*60) {
    const targetEnergy = energy==='wave' ? [2,3,4,5,4,3][selected.length%6] : null;
    const previous=selected.at(-1)||initialTrack;
    const candidates=pool.map((track,index)=>({track,index})).filter(({track:t})=>(energy==='steady'||energy==='wave'||t.energy===pool[0].energy)
      && (!targetEnergy || Math.abs(t.energy-targetEnergy)<=1));
    if(previous)candidates.sort((a,b)=>{
      const cost=t=>Math.abs(Math.log2(t.bpm/previous.bpm))*40+(harmonicDistance(previous.camelotKey||previous.key,t.camelotKey||t.key)??2)*2+Math.abs(t.energy-previous.energy)*2
        +continuityPenalty(previous,t,{energy,rhythm})+(previous.mood!==t.mood?3:0)+(previous.vocalRole==='lead'&&t.vocalRole==='lead'?2:0)
        +((previous.subgenre||previous.style)!==(t.subgenre||t.style)?8:0)+(t.artist===previous.artist?4:0)+(usedArtists.get(t.artist)||0)*2+recencyCost(t)-preferenceScore(t);
      return cost(a.track)-cost(b.track)||(rotationValue?rotationRank(a.track)-rotationRank(b.track):a.index-b.index);
    });
    let index=candidates[0]?.index??-1;
    if (index<0) index=0;
    const [track]=pool.splice(index,1);
    selected.push(track); seconds+=track.duration;
    usedArtists.set(track.artist,(usedArtists.get(track.artist)||0)+1);
  }
  return {tracks:selected,requestedMinutes:Number(minutes),durationSeconds:seconds,shortfallSeconds:Math.max(0,Number(minutes)*60-seconds),availableTracks:familyPool.length,subgenreTracks:preferredPool.length,genreExact:!wantedSubgenre||selected.every(track=>String(track.subgenre||track.style||'').trim().toLocaleLowerCase('es')===wantedSubgenre),compatibleTracks:pool.length+selected.length,rotationApplied:rotationValue,
    feedbackApplied:Object.keys(feedback).length>0,controls:{family,energy,energyTarget:targetLevel,bpmMin:minimumBpm,bpmMax:maximumBpm,mood,rhythm,subgenre},relaxedFilters:selected.some(t=>!narrowed.some(n=>n.id===t.id))};
}
function createMusicLibrary({fetchImpl=fetch,apiKey='',enabled=true,externalEnabled=true,selection=seed,ownedStore=null}={}) {
  const externalTracks = externalEnabled ? selection.tracks : [];
  const cache=new Map(), pending=new Map();
  function tracks() {return [...externalTracks, ...(ownedStore?.list?.() || [])];}
  function catalog() {
    const available=enabled?tracks():[];
    return {enabled,externalEnabled,families,tracks:available.map(inferredProfile),subgenres:[...new Set(available.map(track=>track.subgenre||track.style).filter(Boolean))].sort(),
      qdj:{autopilot:true,mixing:{decks:2,beatDetection:'live',bassSwap:true,peakSafeFaders:true,harmonicOrdering:'known-camelot-keys',phraseAlignment:'verified-grid-only',adaptiveTransitions:['bridge','lift','release','breathe','contrast','protect'],segmentEvidence:['intensity','bass-balance','brightness','percussion-density','variation']},controls:{bpm:true,mood:true,rhythm:true,energy:true,tempo:true},aiGeneration:{enabled:false,status:'provider-required'}},
      reviewedAt:externalEnabled?selection.reviewedAt:null,selectionMethod:externalEnabled?selection.selectionMethod:'Catálogo propio de QSession'};
  }
  async function resolve(id) {
    if (!enabled) throw new Error('La biblioteca está desactivada');
    const original=ownedStore?.get?.(id);
    if (original) return {track:{...original,fileName:undefined,checksum:undefined},url:`/api/music/originals/${encodeURIComponent(id)}/audio`};
    const selected=externalTracks.find(t=>t.id===id);
    if (!selected) throw new Error('Esta canción no pertenece a la selección');
    if (cache.get(id)?.expires>Date.now()) return cache.get(id).value;
    if (pending.has(id)) return pending.get(id);
    const task=(async()=>{
      const response=await fetchImpl(`https://api.audius.co/v1/tracks/${encodeURIComponent(id)}?app_name=QSession`, {
        headers:apiKey?{Authorization:`Bearer ${apiKey}`}:{},signal:AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('Audius no está disponible. Intenta con otra canción.');
      const payload=await response.json();
      const raw=Array.isArray(payload.data)?payload.data[0]:payload.data;
      if (!eligible(raw) || raw.id!==id || raw.user.handle!==selected.handle) throw new Error('Esta canción ya no está disponible para la biblioteca');
      // No expiring signed URLs, API keys or audio binaries are stored locally.
      const track={...selected,title:raw.title,artist:raw.user.name,duration:raw.duration,
        sourceUrl:`https://audius.co/${encodeURIComponent(raw.user.handle)}/${encodeURIComponent(raw.slug)}`,
        copyright:raw.copyright_line || selected.copyright || `© ${raw.user.name}`,
        licenseUrl:OML};
      const value={track,url:`https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?app_name=QSession`};
      cache.set(id,{expires:Date.now()+60000,value});
      return value;
    })();
    pending.set(id,task);
    try {return await task;} finally {pending.delete(id);}
  }
  return {catalog,resolve,has:id=>tracks().some(t=>t.id===id),session:options=>buildSession(enabled?tracks():[],options)};
}
module.exports={createMusicLibrary,buildSession,continuityPenalty,eligible,inferredProfile,families,moods,rhythms,OML};
