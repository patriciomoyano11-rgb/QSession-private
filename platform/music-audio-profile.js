'use strict';
const fs=require('node:fs');
const path=require('node:path');
function audioProfile(track,root) {
  if(!/^[a-f0-9]{64}$/.test(track.checksum||''))return track;
  let analysis;
  try {analysis=JSON.parse(fs.readFileSync(path.join(root,'.analysis',`${track.checksum}.json`),'utf8'));}catch{return {...track,audioAnalysis:{status:'pending'}};}
  if(analysis.checksum!==track.checksum||!['audio-v1','audio-v2'].includes(analysis.version))return {...track,audioAnalysis:{status:'pending'}};
  if(analysis.status!=='ready')return {...track,audioAnalysis:{status:analysis.status}};
  const {acoustic,semantic,cues}=analysis;
  const legacy=analysis.version==='audio-v1';
  const result={...track,audioAnalysis:{status:'ready',version:analysis.version,model:analysis.model,analyzedAt:analysis.analyzedAt,beatGrid:acoustic.beatGrid,segments:acoustic.segments,mixPoints:acoustic.mixPoints,cues:legacy?[]:cues,semantic:legacy?{...semantic,vocals:{...semantic.vocals,accepted:false}}:semantic}};
  // Administrator corrections always take precedence over automatic interpretation.
  if(track.classification?.reviewed!==true) {
    if(semantic.genre.accepted&&semantic.genre.value) {const [family,genre,subgenre]=semantic.genre.entry;Object.assign(result,{family,genre,subgenre});}
    if(semantic.mood.accepted)result.mood=semantic.mood.value;
    if(semantic.intensity.accepted)result.energy=Number(semantic.intensity.value);
    if(acoustic.beatGrid)result.bpm=acoustic.beatGrid.bpm;
    result.classification={method:'audio',reviewed:false,genreCertain:semantic.genre.accepted&&!!semantic.genre.value,moodCertain:semantic.mood.accepted,energyCertain:semantic.intensity.accepted};
  }
  if(!legacy&&semantic.vocals.accepted)result.vocalRole=semantic.vocals.value;
  return result;
}
module.exports={audioProfile};
