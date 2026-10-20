'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {eligible}=require('../music-library');
const selection=require('../music-data/audius-selection.json');
async function main(){
  const pending=selection.tracks.slice(), results=[];
  async function worker(){while(pending.length){const t=pending.shift();try{
    const metadata=await fetch(`https://api.audius.co/v1/tracks/${t.id}?app_name=QSession`,{signal:AbortSignal.timeout(15000)});
    if(!metadata.ok)throw new Error(`metadata ${metadata.status}`);
    const body=await metadata.json();const raw=Array.isArray(body.data)?body.data[0]:body.data;
    if(!eligible(raw)||raw.user.handle!==t.handle)throw new Error('not eligible');
    const stream=await fetch(`https://api.audius.co/v1/tracks/${t.id}/stream?app_name=QSession`,{headers:{Range:'bytes=0-1023',Origin:'https://qsession.org'},signal:AbortSignal.timeout(20000)});
    const status=stream.status,type=stream.headers.get('content-type'),cors=stream.headers.get('access-control-allow-origin');
    await stream.body?.cancel();
    const ok=stream.ok&&/audio|octet-stream/.test(type||'')&&(cors==='*'||cors==='https://qsession.org');
    results.push({id:t.id,title:t.title,ok,status,type,cors,checkedAt:new Date().toISOString()});
    console.log(`${ok?'OK':'FAIL'} ${t.id} ${t.title}: ${status} ${type} CORS=${cors}`);
  }catch(e){results.push({id:t.id,title:t.title,ok:false,error:e.message});console.log(`FAIL ${t.id} ${e.message}`);}}}
  await Promise.all([worker(),worker(),worker()]);
  fs.mkdirSync(path.join(__dirname,'../tmp'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../tmp/audius-verification.json'),JSON.stringify(results,null,2));
  console.log(`Verified ${results.filter(r=>r.ok).length}/${results.length}`);
  if(results.some(r=>!r.ok))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
