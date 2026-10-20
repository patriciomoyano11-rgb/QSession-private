'use strict';
// Upgrade acoustic measurements without running the semantic model again.
// Semantic v1 records remain explicitly legacy until the worker replaces them.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {features}=require('./audio-features.cjs');
const root=path.resolve(process.env.QSESSION_ORIGINAL_MUSIC_DIR||'/data/original-music');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json')));
let upgraded=0,grids=0,failed=0;
for(const track of catalog.tracks||[]){
  if(track.status==='archived'||!/^[a-f0-9]{64}$/.test(track.checksum||''))continue;
  const file=path.resolve(root,String(track.fileName||'')),cache=path.join(root,'.analysis',track.checksum+'.json');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.existsSync(cache))continue;
  const prior=JSON.parse(fs.readFileSync(cache));
  if(prior.status!=='ready'||prior.version!=='audio-v1'||prior.checksum!==track.checksum)continue;
  if(!fs.realpathSync(file).startsWith(fs.realpathSync(root)+path.sep))continue;
  if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==track.checksum)throw Error('Content checksum mismatch');
  const decoded=spawnSync(process.env.QSESSION_FFMPEG_PATH||'ffmpeg',['-v','error','-nostdin','-i',file,'-t','1800','-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],{maxBuffer:60000000,timeout:120000});
  if(decoded.status!==0||!decoded.stdout?.length){failed++;continue;}
  const b=decoded.stdout,audio=new Float32Array(b.buffer,b.byteOffset,b.length/4),acoustic=features(audio);
  const tmp=cache+'.pulse.tmp';fs.writeFileSync(tmp,JSON.stringify({...prior,acoustic,acousticVersion:'pulse-v2'}));fs.renameSync(tmp,cache);
  upgraded++;if(acoustic.beatGrid)grids++;
}
console.log(JSON.stringify({upgraded,grids,failed}));
const verified=process.env.QSESSION_VERIFIED_ANALYSIS_DIR;
if(verified){
  const allowed=new Map((catalog.tracks||[]).map(t=>[t.checksum,t]));let imported=0;
  for(const name of fs.readdirSync(verified)){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const analysis=JSON.parse(fs.readFileSync(path.join(verified,name))),track=allowed.get(analysis.checksum);
    if(!track||analysis.version!=='audio-v2'||analysis.status!=='ready'||name!==analysis.checksum+'.json')throw Error('Invalid verified analysis');
    const file=path.resolve(root,track.fileName);if(!file.startsWith(root+path.sep)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==analysis.checksum)throw Error('Verified content mismatch');
    fs.writeFileSync(path.join(root,'.analysis',name),JSON.stringify(analysis));imported++;
  }
  console.log(JSON.stringify({verifiedImported:imported}));
}
if(failed)process.exitCode=1;
