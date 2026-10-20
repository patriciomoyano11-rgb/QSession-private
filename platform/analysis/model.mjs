import {pipeline, env} from '@huggingface/transformers';
import {fileURLToPath} from 'node:url';
env.cacheDir = fileURLToPath(new URL('./models/', import.meta.url));
env.backends.onnx.wasm.numThreads = 2;
export const MODEL = 'Xenova/clap-htsat-unfused';
export const VERSION = 'audio-v2';
export async function loadModel(download = false) {
  return pipeline('zero-shot-audio-classification', MODEL, {dtype:'q8', device:'cpu', session_options:{intraOpNumThreads:2,interOpNumThreads:1}, local_files_only:!download});
}
export const groups = {
  genre: [
    ['electronic','Electrónica','House','house music with a steady four on the floor dance beat'],
    ['electronic','Electrónica','Techno','techno music with driving repetitive electronic percussion'],
    ['electronic','Electrónica','Drum & Bass','drum and bass music with fast breakbeats'],
    ['latin','Latina','Reggaetón','reggaeton music with a dembow rhythm'],
    ['latin','Latina','Salsa','salsa music with latin percussion and brass'],
    ['latin','Latina','Bachata','bachata music with guitar and latin percussion'],
    ['latin','Latina','Cumbia','cumbia music with a swaying latin rhythm'],
    ['afro','Afro y global','Afrobeats','afrobeats music with syncopated african dance percussion'],
    ['urban','Urbana','Hip Hop','hip hop rap music with a beat'],
    ['urban','Urbana','R&B','rhythm and blues soul music'],
    ['pop','Pop y celebración','Pop','pop music with singing and a catchy melody'],
    ['ambient','Chill y ambiental','Ambient','ambient atmospheric music without a strong beat'],
    ['ambient','Chill y ambiental','Downtempo','relaxed downtempo chill electronic music'],
    ['instrumental','Instrumental','Jazz','jazz music with improvisation'],
    ['rock','Rock y metal','Rock','rock music with electric guitars and drums'],
    ['instrumental','Instrumental','Clásica','classical orchestral or piano music'],
    [null,null,null,'speech, noise or sound effects without music'],
  ],
  mood: [ ['meditative','calm peaceful meditative music'], ['sensual','romantic sensual intimate music'], ['celebratory','happy joyful celebratory music'], ['euphoric','uplifting euphoric exciting music'], ['dark','dark tense aggressive music'], ['deep','sad melancholic introspective music'], ['warm','warm comforting gentle music'], ['focused','focused determined rhythmic music'] ],
  intensity: [['1','very gentle low intensity music'],['3','moderately energetic music'],['5','intense high energy vigorous music']],
  vocals: [['lead','The sound of singing.'],['instrumental','The sound of instrumental music.'],['mixed','The sound of music with occasional singing.']],
};

// Scores are relative similarities, not calibrated probabilities of correctness.
// Require both separation and agreement across sampled sections before adopting a label.
export function aggregate(rows, entries) {
  const labels = entries.map(entry => entry.at(-1));
  const ranked = labels.map((label,index) => ({index,label,score:rows.reduce((sum,row)=>sum+(row.find(x=>x.label===label)?.score||0),0)/rows.length})).sort((a,b)=>b.score-a.score);
  const winner=ranked[0], margin=winner.score-ranked[1].score;
  const agreement=rows.filter(row=>[...row].sort((a,b)=>b.score-a.score)[0]?.label===winner.label).length/rows.length;
  return {value:entries[winner.index][0],entry:entries[winner.index],score:winner.score,margin,agreement,accepted:winner.score>=.4&&margin>=.15&&agreement>=2/3,alternatives:ranked.slice(0,3).map(item=>({value:entries[item.index][0],score:item.score}))};
}

export async function interpret(classifier, sections) {
  const result={}; const vocalSections=[];
  // One audio embedding per window; normalize within each group afterwards.
  // This preserves relative scores while avoiding four runs of the audio model.
  const labelsByGroup=Object.fromEntries(Object.entries(groups).map(([name,entries])=>[name,entries.map(entry=>name==='vocals'?entry.at(-1):`This is ${entry.at(-1)}.`)]));
  const joint=[];for(const section of sections)joint.push(await classifier(section.audio,Object.values(labelsByGroup).flat(),{hypothesis_template:'{}'}));
  for (const [name,entries] of Object.entries(groups)) {
    const rows=[];
    for (let i=0;i<sections.length;i++) {
      const section=sections[i],labels=labelsByGroup[name];
      const matches=labels.map(label=>joint[i].find(item=>item.label===label)?.score||0),sum=matches.reduce((a,b)=>a+b,0);
      const row=entries.map((entry,index)=>({label:entry.at(-1),score:sum?matches[index]/sum:0}));
      rows.push(row);
      if(name==='vocals') {const local=aggregate([row],entries); vocalSections.push({time:section.time,duration:section.audio.length/48000,...local});}
    }
    result[name]=aggregate(rows,entries);
  }
  return {...result,vocalSections};
}
