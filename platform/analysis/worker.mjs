import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadModel,interpret,MODEL,VERSION,groups,aggregate} from './model.mjs';
const require=createRequire(import.meta.url);
const {features}=require('./audio-features.cjs');
const root=path.resolve(process.env.QSESSION_ORIGINAL_MUSIC_DIR||path.join(path.dirname(fileURLToPath(import.meta.url)),'../data/original-music'));
const output=path.join(root,'.analysis');
let ffmpeg=process.env.QSESSION_FFMPEG_PATH||'ffmpeg';
try {if(!process.env.QSESSION_FFMPEG_PATH)ffmpeg=require('@ffmpeg-installer/ffmpeg').path;} catch {}
let classifier;
function decode(file,{rate=8000,start=0,seconds=14400}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file,pipe','-format_whitelist','mov,mp3,wav,aac,ogg,flac','-ss',String(start),'-i',file,'-t',String(seconds),'-vn','-ac','1','-ar',String(rate),'-f','f32le','pipe:1'],{windowsHide:true});
    const parts=[];let bytes=0,error='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('Tiempo máximo de decodificación excedido'));},120000);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>rate*seconds*4+4096){child.kill();return;}parts.push(chunk);});
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-1000);});
    child.on('error',err=>{clearTimeout(timer);reject(err);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0||!bytes)return reject(new Error(error||'Audio no decodificable'));const buffer=Buffer.concat(parts);const samples=new Float32Array(Math.floor(buffer.length/4));for(let i=0;i<samples.length;i++)samples[i]=buffer.readFloatLE(i*4);resolve(samples);});
  });
}
function save(checksum,result) {
  fs.mkdirSync(output,{recursive:true});const dest=path.join(output,`${checksum}.json`),tmp=`${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify({...result,version:VERSION,checksum,analyzedAt:new Date().toISOString()}));fs.renameSync(tmp,dest);
}
async function scan() {
  if(!fs.existsSync(path.join(root,'catalog.json')))return;
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
  for(const track of catalog.tracks||[]) {
    if(track.status==='archived'||!/^[a-f0-9]{64}$/.test(track.checksum||''))continue;
    const cached=path.join(output,`${track.checksum}.json`);
    try {const prior=JSON.parse(fs.readFileSync(cached));if(prior.version===VERSION&&(prior.status==='ready'||prior.status==='failed'&&Date.now()-Date.parse(prior.analyzedAt)<3600000))continue;}catch{}
    const file=path.resolve(root,String(track.fileName||''));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))continue;
    const real=fs.realpathSync(file);if(!real.startsWith(fs.realpathSync(root)+path.sep))continue;
    try {
      // Validate content identity: stale metadata must never describe a different audio file.
      const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(real))hash.update(chunk);
      if(hash.digest('hex')!==track.checksum)throw new Error('El archivo cambió respecto al catálogo');
      save(track.checksum,{status:'analyzing'});
      console.log(`Analizando ${track.id}`);
      const pcm=await decode(real),acoustic=features(pcm);
      if(acoustic.duration<10||acoustic.rms<.001)throw new Error('Audio demasiado corto o silencioso para interpretar');
      classifier ||= await loadModel();
      const times=[.12,.48,.82].map(f=>Math.max(0,Math.min(acoustic.duration-10,acoustic.duration*f)));
      const sections=[];for(const time of times)sections.push({time,audio:await decode(real,{rate:48000,start:time,seconds:10})});
      const semantic=await interpret(classifier,sections);
      // Structural windows get their own vocal assessment; global labels cannot establish a safe cue.
      const cueTimes=[acoustic.mixPoints.entry,acoustic.mixPoints.exit].filter(x=>x!=null);
      const cueSections=[];for(const time of cueTimes)cueSections.push({time,audio:await decode(real,{rate:48000,start:time,seconds:10})});
      const vocalLabels=groups.vocals.map(entry=>entry.at(-1));
      const cues=[];for(const section of cueSections){const scores=await classifier(section.audio,vocalLabels,{hypothesis_template:'{}'});const assessed=aggregate([scores],groups.vocals);cues.push({time:section.time,duration:section.audio.length/48000,instrumental:assessed.accepted&&assessed.value==='instrumental',vocalRole:assessed.accepted?assessed.value:null,score:assessed.score});}
      save(track.checksum,{status:'ready',model:MODEL,acoustic,semantic,cues});
      console.log(`Análisis guardado ${track.id}`);
    }catch(error){save(track.checksum,{status:'failed',error:String(error.message).slice(0,300)});console.error(`${track.id}: ${error.message}`);}
  }
}
do {try{await scan();}catch(error){console.error(error.message);}if(process.argv.includes('--once'))break;await new Promise(resolve=>setTimeout(resolve,15000));}while(true);
if(classifier)await classifier.dispose();
