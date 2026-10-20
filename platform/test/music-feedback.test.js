'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMusicFeedback}=require('../music-feedback');
const {buildSession,createMusicLibrary}=require('../music-library');
const {createQsessionServer}=require('../server');
const tracks=['a','b','c','d'].map((id,i)=>({id,title:id,artist:'Artist '+id,family:'electronic',subgenre:'House',bpm:124,mood:'warm',rhythm:'groove',energy:3,duration:900,order:i,sourceType:'qsession-original'}));
test('votes persist once per voter, can change or be withdrawn, and never expose other voters',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-votes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const options={filePath:path.join(dir,'votes.json'),hasTrack:id=>tracks.some(row=>row.id===id)},store=createMusicFeedback(options);
 await store.put('account:alice','a',1);await store.put('account:alice','a',1);
 assert.equal((await store.get('account:alice')).a.likes,1);
 await store.put('guest:bob','a',-1);
 const resumed=createMusicFeedback(options);assert.equal((await resumed.get('guest:bob')).a.myVote,-1);assert.equal((await resumed.get('account:alice')).a.myVote,1);
 assert.equal((await resumed.put('account:alice','a',-1)).likes,0);assert.equal((await resumed.get()).a.dislikes,2);
 await resumed.put('guest:bob','a',0);assert.equal((await resumed.get()).a.dislikes,1);
 await assert.rejects(resumed.put('bob','unknown',1));await assert.rejects(resumed.put('bob','a','1'));
 assert.deepEqual((await resumed.export('account:alice')).map(row=>[row.trackId,row.vote]),[['a',-1]]);
 await resumed.remove('account:alice');assert.deepEqual(await resumed.get(),{});
});
test('Auto DJ incorporates collective preference and personal dislikes while preserving genre, BPM, exclusions and energy',()=>{
 const opts={family:'electronic',minutes:15,bpmMin:120,bpmMax:128};
 assert.equal(buildSession(tracks,opts).tracks[0].id,'a');
 assert.equal(buildSession(tracks,{...opts,feedback:{c:{score:.8}}}).tracks[0].id,'c');
 assert.equal(buildSession(tracks,{...opts,feedback:{c:{score:.8,myVote:-1},b:{myVote:1}}}).tracks[0].id,'b');
 assert.equal(buildSession(tracks,{...opts,excludeIds:['b'],feedback:{b:{myVote:1},a:{myVote:-1}}}).tracks[0].id,'c');
 const result=buildSession([...tracks,{...tracks[0],id:'wrong',family:'latin',bpm:80}],{...opts,feedback:{wrong:{score:1,myVote:1}}});assert.equal(result.tracks[0].family,'electronic');
 const rising=buildSession(tracks.map((row,i)=>({...row,energy:i+1,duration:180})),{...opts,energy:'rise',feedback:{d:{myVote:1,score:1}}});assert.deepEqual(rising.tracks.map(row=>row.energy),[1,2,3,4]);
});
test('HTTP feedback supports signed guest identities, account persistence, validation and server-owned algorithm signals',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-votes-http-'));
 const library=createMusicLibrary({externalEnabled:false,ownedStore:{list:()=>tracks,get:id=>tracks.find(row=>row.id===id)}});
 const app=createQsessionServer({env:{},port:0,dataFile:path.join(dir,'state.json'),analyticsDataFile:path.join(dir,'analytics'),musicLibrary:library});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const r=await fetch(base+'/api/music/feedback');assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.equal(r.headers.get('cache-control'),'no-store');const cookie=r.headers.get('set-cookie').split(';')[0];
 const put=async(id,vote,c=cookie)=>fetch(base+'/api/music/tracks/'+id+'/feedback',{method:'PUT',headers:{Cookie:c,'Content-Type':'application/json'},body:JSON.stringify({vote})});
 assert.equal((await(await put('a',1)).json()).feedback.likes,1);assert.equal((await(await put('a',1)).json()).feedback.likes,1);
 assert.equal((await(await put('a',-1)).json()).feedback.dislikes,1);assert.equal((await put('a',5)).status,400);assert.equal((await put('unknown',1)).status,400);
 assert.equal((await fetch(base+'/api/admin/music/feedback')).status,401);
 const forged=await fetch(base+'/api/music/feedback?trackId=a',{headers:{Cookie:'qsession_music_voter=forged'}});assert.equal((await forged.json()).tracks.a.myVote,0);assert.ok(forged.headers.get('set-cookie'));
 const auto=await fetch(base+'/api/music/session',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({family:'electronic',minutes:15,feedback:{a:{myVote:1,score:999},c:{myVote:-1}}})});const session=await auto.json();assert.equal(session.tracks[0].id,'b','server dislike overrides forged client feedback');
 const reg=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'votes@example.test',password:'Votes-test-only-123',displayName:'Votes'})});assert.equal(reg.status,201);const accountCookie=reg.headers.get('set-cookie').split(';')[0];
 await put('b',1,accountCookie);const account=await(await fetch(base+'/api/music/feedback',{headers:{Cookie:accountCookie}})).json();assert.equal(account.tracks.b.myVote,1);assert.equal(account.tracks.a.myVote,0);
 const exported=await(await fetch(base+'/api/account/export',{headers:{Cookie:accountCookie}})).json();assert.deepEqual(exported.musicVotes.map(row=>[row.trackId,row.vote]),[['b',1]]);
 await put('a',0);assert.equal((await(await fetch(base+'/api/music/feedback?trackId=a',{headers:{Cookie:cookie}})).json()).tracks.a.votes,0);
});

test('client can withdraw a vote, cannot stack pending votes, and preserves its previous vote on network failure',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../public/music-library.js'),'utf8');
 const start=source.indexOf('  async function voteTrack('),end=source.indexOf('  function creditNode(',start);let sent,release;
 const message={textContent:''};const group={dataset:{feedbackTrack:'a'},querySelector:()=>message};
 const scope={feedback:{a:{myVote:1}},pendingVotes:new Set(),syncFeedback(){},document:{querySelectorAll:()=>[group]},request:async(url,options)=>{sent=JSON.parse(options.body);return {feedback:{myVote:0,likes:0,dislikes:0}};}};
 vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);await scope.voteTrack('a',1);assert.equal(sent.vote,0);assert.equal(scope.feedback.a.myVote,0);
 let calls=0;scope.request=()=>{calls++;return new Promise(resolve=>release=resolve);};const pending=scope.voteTrack('a',-1);await scope.voteTrack('a',-1);assert.equal(calls,1);release({feedback:{myVote:-1,likes:0,dislikes:1}});await pending;
 scope.request=async()=>{throw Error('Sin conexión');};await scope.voteTrack('a',1);assert.equal(scope.feedback.a.myVote,-1);assert.equal(message.textContent,'Sin conexión');assert.equal(scope.pendingVotes.size,0);
});
test('playback updates retain the same voting controls and keyboard focus for an unchanged song',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../public/music-library.js'),'utf8');const start=source.indexOf('  function setNow('),end=source.indexOf('  function renderPlayer(',start);
 const track={id:'a',title:'A',artist:'Artist'};let replaced=0;const state={textContent:''};const box={dataset:{trackIdentity:JSON.stringify([track.id,track.title,track.artist,undefined,undefined,undefined,undefined])},querySelector:()=>state,replaceChildren:()=>replaced++};
 const scope={$:()=>box,loading:false,audio:{paused:false}};vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);scope.setNow(track);assert.equal(replaced,0);assert.equal(state.textContent,'AL AIRE');scope.audio.paused=true;scope.setNow(track);assert.equal(replaced,0);assert.equal(state.textContent,'EN PAUSA');
});

test('dance selection gently penalizes downward energy and tempo, while calm and smooth sessions remain intentional',()=>{
 const {continuityPenalty}=require('../music-library');const previous={energy:4,bpm:126};
 assert.equal(continuityPenalty(previous,{energy:4,bpm:125}),0);
 assert.ok(continuityPenalty(previous,{energy:3,bpm:124})>0);
 assert.ok(continuityPenalty(previous,{energy:2,bpm:116})>continuityPenalty(previous,{energy:3,bpm:124}));
 assert.equal(continuityPenalty(previous,{energy:1,bpm:80}),2,'adjustment remains bounded');
 assert.equal(continuityPenalty(previous,{energy:1,bpm:80},{energy:'calm'}),0);
 assert.equal(continuityPenalty(previous,{energy:1,bpm:80},{rhythm:'smooth'}),0);
 assert.equal(continuityPenalty(previous,{}),0,'missing metadata does not invent an emotional drop');
});
