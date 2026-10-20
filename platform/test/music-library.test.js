'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createMusicLibrary,buildSession,eligible}=require('../music-library');
const {createMusicPlaylists}=require('../music-playlists');
const {createOwnedMusicLibrary,classifyMusic,probeAudioDuration}=require('../music-owned-library');
const {createQsessionServer}=require('../server');
const seed=require('../music-data/audius-selection.json');
const raw={id:'abc',title:'Original',duration:180,user:{name:'Artist',handle:'artist'},slug:'original',license:'All rights reserved'};
test('catalog rejects unavailable, gated, derivative, AI and alternative-license tracks',()=>{
  assert.equal(eligible(raw),true);
  for(const change of [{is_stream_gated:true},{access:{stream:false}},{is_available:false},{is_delete:true},{title:'Song (Bootleg)'},{license:'CC BY-NC'},{license:'https://example.com/license'},{remix_of:{tracks:[{}]}},{cover_original_artist:'Other'},{duration:0},{ai_attribution_user_id:123},{description:'This is a cover of another song'},{parental_warning_type:'Explicit'}])assert.equal(eligible({...raw,...change}),false,JSON.stringify(change));
});
test('selection has unique real references, provenance and all requested families',()=>{
  assert.equal(new Set(seed.tracks.map(t=>t.id)).size,seed.tracks.length);
  for(const family of ['electronic','ambient','cumbia','roots'])assert.ok(seed.tracks.some(t=>t.family===family));
  for(const t of seed.tracks){assert.match(t.sourceUrl,/^https:\/\/audius.co\//);assert.equal(t.review.listened,false);assert.ok(t.duration>60);assert.ok(t.style);}
});
test('production can remove every external track while preserving the owned Flow Music catalog',async()=>{
  const own={id:'original_flow_1',title:'Flow Original',artist:'QSession Original',family:'electronic',duration:180,energy:3,sourceType:'qsession-original'};
  const library=createMusicLibrary({externalEnabled:false,selection:{tracks:[{...raw,handle:'artist'}]},ownedStore:{list:()=>[own],get:id=>id===own.id?own:null}});
  const catalog=library.catalog();
  assert.equal(catalog.externalEnabled,false);
  assert.deepEqual(catalog.tracks.map(track=>track.id),[own.id]);
  assert.equal(catalog.selectionMethod,'Catálogo propio de QSession');
  assert.equal(library.has('abc'),false);
  assert.equal(library.has(own.id),true);
  await assert.rejects(library.resolve('abc'),/no pertenece/);
  assert.equal((await library.resolve(own.id)).url,`/api/music/originals/${own.id}/audio`);
});
test('autopilot never repeats, reports shortage and respects rising energy',()=>{
  const result=buildSession(seed.tracks,{family:'roots',minutes:90,energy:'rise'});
  assert.equal(new Set(result.tracks.map(t=>t.id)).size,result.tracks.length);
  assert.ok(result.shortfallSeconds>0);
  assert.equal(result.durationSeconds,result.tracks.reduce((s,t)=>s+t.duration,0));
  assert.deepEqual(result.tracks.map(t=>t.energy),result.tracks.map(t=>t.energy).sort());
  assert.throws(()=>buildSession(seed.tracks,{family:'bogus'}));
  assert.throws(()=>buildSession(seed.tracks,{family:'ambient',minutes:Infinity}));
});
test('autopilot can exclude its recent history and folder names classify genres and subgenres',()=>{
  const first=seed.tracks.find(track=>track.family==='electronic');
  const result=buildSession(seed.tracks,{family:'electronic',minutes:15,excludeIds:[first.id]});
  assert.ok(result.tracks.every(track=>track.id!==first.id));
  assert.deepEqual(classifyMusic({relativePath:'Flow exports/Afro House/Sunset.wav'}),{family:'electronic',genre:'Electrónica',subgenre:'Afro House',energy:4,bpm:122,mood:'warm',rhythm:'groove',confidence:'filename'});
  assert.equal(classifyMusic({filename:'deep meditation.flac'}).family,'wellness');
});
test('new playlists rotate away from tracks already proposed, even before playback',()=>{
  const tracks=Array.from({length:12},(_,index)=>({id:`rotation-${index}`,title:`Rotation ${index}`,artist:`Artist ${index}`,family:'electronic',subgenre:'House',duration:180,energy:3,bpm:124,mood:'warm',rhythm:'groove',order:index}));
  const first=buildSession(tracks,{family:'electronic',subgenre:'House',minutes:12,rotation:1});
  const history=first.tracks.map((track,index)=>({id:track.id,artist:track.artist,at:index+1}));
  const second=buildSession(tracks,{family:'electronic',subgenre:'House',minutes:12,history,rotation:2});
  assert.equal(first.tracks.length,4);assert.equal(second.tracks.length,4);assert.deepEqual(second.tracks.filter(track=>history.some(item=>item.id===track.id)),[]);assert.equal(second.rotationApplied,2);assert.equal(second.subgenreTracks,12);
});
test('qDJ applies BPM, emotion, rhythm and wave controls without repeating tracks',()=>{
  const tracks=Array.from({length:8},(_,index)=>({id:`t${index}`,title:`Track ${index}`,artist:`A${index}`,family:'electronic',duration:180,energy:index%5+1,bpm:124+index%4,mood:index<6?'dark':'warm',rhythm:index<6?'drive':'smooth',order:index}));
  const result=buildSession(tracks,{family:'electronic',minutes:15,energy:'wave',bpmMin:124,bpmMax:130,mood:'dark',rhythm:'drive'});
  assert.ok(result.tracks.length>0);
  assert.ok(result.tracks.every(track=>track.bpm>=124&&track.bpm<=130&&track.mood==='dark'&&track.rhythm==='drive'));
  assert.equal(new Set(result.tracks.map(track=>track.id)).size,result.tracks.length);
  assert.equal(result.controls.energy,'wave');
});

test('autopilot builds the entire compatible set when exact mood matches cannot fill the requested time',()=>{
  const tracks=Array.from({length:12},(_,i)=>({id:'fill'+i,title:'Track '+i,artist:'A'+i,family:'electronic',subgenre:i<10?'House':'Techno',duration:180,bpm:120,energy:3,mood:i<2?'warm':'focused',rhythm:'groove',order:i}));
  const set=buildSession(tracks,{family:'electronic',minutes:30,mood:'warm',bpmMin:116,bpmMax:123,subgenre:'House'});
  assert.equal(set.tracks.length,10);assert.equal(set.shortfallSeconds,0);assert.equal(set.relaxedFilters,true);assert.ok(set.tracks.every(t=>t.subgenre==='House'));assert.equal(new Set(set.tracks.map(t=>t.id)).size,10);
});
test('an exact genre request reports a shortage instead of borrowing a neighboring genre',()=>{
  const tracks=[
    {id:'deep',title:'Deep',artist:'A',family:'electronic',subgenre:'Deep House',duration:180,bpm:122,energy:3,mood:'deep',rhythm:'smooth',order:1},
    ...Array.from({length:10},(_,i)=>({id:`tech-${i}`,title:`Tech ${i}`,artist:`T${i}`,family:'electronic',subgenre:'Techno',duration:180,bpm:132,energy:4,mood:'dark',rhythm:'drive',order:i+2})),
  ];
  const set=buildSession(tracks,{family:'electronic',subgenre:'Deep House',minutes:20});
  assert.deepEqual(set.tracks.map(track=>track.id),['deep']);
  assert.equal(set.genreExact,true);assert.equal(set.subgenreTracks,1);assert.equal(set.shortfallSeconds,1020);
});
test('server probes M4A duration when the browser cannot read metadata',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-m4a-duration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bytes=Buffer.alloc(128);Buffer.from('mvhd').copy(bytes,8);bytes[12]=0;bytes.writeUInt32BE(1000,24);bytes.writeUInt32BE(179904,28);
  const source=path.join(dir,'probe.m4a');fs.writeFileSync(source,bytes);
  assert.equal(await probeAudioDuration(source,'.m4a'),180);
  const store=createOwnedMusicLibrary({directory:path.join(dir,'library')});
  const upload=Object.assign(Readable.from([bytes]),{headers:{'content-length':String(bytes.length)}});
  const imported=await store.importTrack(upload,{filename:'Acid Resonance.m4a'});
  assert.equal(imported.track.duration,180);
  assert.equal(imported.track.bpm,132);
});
test('owned catalog accepts fixed and chunked uploads, rejects empty audio, persists metadata and allows manual classification review',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-originals-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=createOwnedMusicLibrary({directory});
  const bytes=Buffer.from('ID3 original qsession test track');
  const upload=()=>Object.assign(Readable.from([bytes]),{headers:{'content-length':String(bytes.length)}});
  const imported=await store.importTrack(upload(),{filename:'Organic_House_Sunrise.mp3',relativePath:'Electronic/Organic House/Organic_House_Sunrise.mp3',duration:182});
  assert.equal(imported.duplicate,false);assert.equal(imported.track.subgenre,'Organic House');assert.equal(imported.track.sourceType,'qsession-original');
  const duplicate=await store.importTrack(upload(),{filename:'copy.mp3',duration:182});assert.equal(duplicate.duplicate,true);
  const chunked=Object.assign(Readable.from([Buffer.from('ID3 chunked '),Buffer.from('qsession audio')]),{headers:{}});
  const importedChunked=await store.importTrack(chunked,{filename:'chunked.mp3',duration:185});
  assert.equal(importedChunked.duplicate,false);assert.equal(importedChunked.track.byteLength,26);
  const empty=Object.assign(Readable.from([]),{headers:{}});
  await assert.rejects(store.importTrack(empty,{filename:'empty.mp3',duration:10}),/llegó vacío/);
  const updated=store.update(imported.track.id,{family:'ambient',subgenre:'Downtempo',energy:2});assert.equal(updated.family,'ambient');assert.equal(updated.classification.reviewed,true);
  const dj=store.update(imported.track.id,{bpm:124,camelotKey:'8a',beatGrid:{bpm:124,offset:.2,phraseStart:8,verified:true}});
  assert.equal(dj.camelotKey,'8A');assert.equal(dj.beatGrid.phraseStart,8);
  assert.throws(()=>store.update(imported.track.id,{camelotKey:'13A'}),/Tonalidad/);
  assert.throws(()=>store.update(imported.track.id,{beatGrid:{bpm:124,offset:-1,verified:true}}),/Rejilla/);
  assert.throws(()=>store.update(imported.track.id,{beatGrid:{bpm:124,offset:1,phraseStart:.2,verified:true}}),/frase/);
  const reopened=createOwnedMusicLibrary({directory});assert.equal(reopened.list().length,2);assert.ok(reopened.file(imported.track.id).path.endsWith('.mp3'));
  assert.equal(reopened.get(imported.track.id).beatGrid.offset,.2);
  assert.equal(reopened.update(imported.track.id,{bpm:126}).beatGrid,null,'changing the verified tempo invalidates the old grid');
  const removed=reopened.remove(importedChunked.track.id);assert.equal(removed.recoverable,true);assert.equal(reopened.file(importedChunked.track.id),null);
  assert.equal(reopened.list().length,1);assert.equal(fs.readdirSync(path.join(directory,'.trash')).length,1);
  assert.equal(createOwnedMusicLibrary({directory}).list().length,1,'an archived track stays out of the catalog after restart');
});
test('playback only resolves allowlisted IDs and rechecks current access, caching successful responses',async()=>{
  let calls=0;
  const library=createMusicLibrary({selection:{tracks:[{...raw,handle:'artist'}]},apiKey:'private-key',fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer private-key');assert.match(url,/tracks\/abc\?/);return {ok:true,json:async()=>({data:[raw]})};}});
  await assert.rejects(library.resolve('unknown'));
  const [a,b]=await Promise.all([library.resolve('abc'),library.resolve('abc')]);
  assert.equal(calls,1);assert.deepEqual(a,b);assert.ok(!JSON.stringify(a).includes('private-key'));
  const blocked=createMusicLibrary({selection:{tracks:[{...raw,handle:'artist'}]},fetchImpl:async()=>({ok:true,json:async()=>({data:[{...raw,is_stream_gated:true}]})})});
  await assert.rejects(blocked.resolve('abc'));
});
test('playlists persist per account and reject unknown tracks or duplicate IDs',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-music-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const options={filePath:path.join(dir,'playlists.json'),hasTrack:id=>id==='abc'};
  const store=createMusicPlaylists(options);
  const list=[{id:'one',name:'Evening',trackIds:['abc','abc']}];
  await store.put('alice',list);
  assert.deepEqual(await store.get('bob'),[]);
  assert.deepEqual((await createMusicPlaylists(options).get('alice'))[0].trackIds,['abc']);
  await assert.rejects(store.put('alice',[{...list[0],trackIds:['bad']}]));
  await assert.rejects(store.put('alice',[...list,...list]));
});
test('music HTTP API enforces account access, disables playback and serves a bounded catalog',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-music-api-'));
  const app=createQsessionServer({env:{},port:0,dataFile:path.join(dir,'state.json'),analyticsDataFile:path.join(dir,'analytics'),musicLibrary:createMusicLibrary({enabled:false})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${app.server.address().port}`;
  const catalog=await(await fetch(url+'/api/music/catalog')).json();assert.equal(catalog.enabled,false);assert.deepEqual(catalog.tracks,[]);
  const interpreted=await(await fetch(url+'/api/music/interpret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'electrónica cálida y estable durante 30 minutos'})})).json();
  assert.equal(interpreted.ok,true);assert.equal(interpreted.criteria.family,'electronic');assert.equal(interpreted.criteria.mood,'warm');assert.equal(interpreted.criteria.energy,'steady');
  assert.equal((await fetch(url+'/api/music/playlists')).status,401);
  assert.equal((await fetch(url+'/api/music/playlists',{method:'PUT',body:JSON.stringify({playlists:[]})})).status,401);
  assert.equal((await fetch(url+'/api/music/tracks/abc/play')).status,503);
  assert.equal((await fetch(url+'/api/music/session',{method:'POST',body:JSON.stringify({family:'invalid'})})).status,400);
  async function register(email){
    const r=await fetch(url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'Music-test-only-123',displayName:'Music Test'})});
    assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];
  }
  const alice=await register('music-alice@example.test'),bob=await register('music-bob@example.test');
  const saved=await fetch(url+'/api/music/playlists',{method:'PUT',headers:{Cookie:alice,'Content-Type':'application/json'},body:JSON.stringify({playlists:[{id:'test-list',name:'Cumbias',trackIds:[seed.tracks[0].id]}]})});
  assert.equal(saved.status,200);
  assert.equal((await(await fetch(url+'/api/music/playlists',{headers:{Cookie:alice}})).json()).playlists.length,1);
  assert.deepEqual((await(await fetch(url+'/api/music/playlists',{headers:{Cookie:bob}})).json()).playlists,[]);
});
test('admin imports an original track and the player streams it with byte ranges',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-original-http-'));
  const app=createQsessionServer({
    env:{},port:0,dataFile:path.join(dir,'state.json'),analyticsDataFile:path.join(dir,'analytics'),
    originalMusicDirectory:path.join(dir,'originals'),adminUsername:'music-admin',adminPassword:'Strong-music-password-123',
    adminSessionSecret:'test-admin-session-secret-with-enough-entropy',
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${app.server.address().port}`;
  const login=await fetch(url+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'music-admin',password:'Strong-music-password-123'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const audio=Buffer.from('ID3-qsession-original-audio');
  const params=new URLSearchParams({filename:'Afro_House_Night.mp3',relativePath:'Electrónica/Afro House/Afro_House_Night.mp3',duration:'245'});
  const imported=await fetch(`${url}/api/admin/music/import?${params}`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'audio/mpeg'},body:audio});
  assert.equal(imported.status,201);
  const payload=await imported.json();
  assert.equal(payload.track.subgenre,'Afro House');
  const catalog=await(await fetch(url+'/api/music/catalog')).json();
  assert.ok(catalog.tracks.some(track=>track.id===payload.track.id&&track.sourceType==='qsession-original'));
  const playable=await(await fetch(`${url}/api/music/tracks/${payload.track.id}/play`)).json();
  assert.equal(playable.url,`/api/music/originals/${payload.track.id}/audio`);
  const ranged=await fetch(`${url}${playable.url}`,{headers:{Range:'bytes=0-2'}});
  assert.equal(ranged.status,206);
  assert.equal(ranged.headers.get('accept-ranges'),'bytes');
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),audio.subarray(0,3));
  const listed=await(await fetch(`${url}/api/admin/music/tracks`,{headers:{Cookie:cookie}})).json();
  assert.ok(listed.tracks.some(track=>track.id===payload.track.id));
  const removed=await fetch(`${url}/api/admin/music/tracks/${payload.track.id}`,{method:'DELETE',headers:{Cookie:cookie}});
  assert.equal(removed.status,200);assert.equal((await removed.json()).removed.recoverable,true);
  assert.ok(!(await(await fetch(url+'/api/music/catalog')).json()).tracks.some(track=>track.id===payload.track.id));
  assert.equal((await fetch(`${url}${playable.url}`)).status,404);
});
