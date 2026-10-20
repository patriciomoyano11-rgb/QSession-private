'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSession}=require('../music-library');
const track=(id,changes={})=>({id,title:id,artist:id,family:'instrumental',subgenre:'Piano',duration:180,bpm:80,energy:2,mood:'warm',rhythm:'smooth',...changes});
test('Instrumental never selects Brutal Death Metal or abandons a missing subgenre',()=>{
  const metal=track('Brutal Death Metal',{family:'instrumental',subgenre:'Rock',bpm:124,energy:5,mood:'dark',classification:{method:'audio',reviewed:false}});
  const piano=track('piano');
  assert.deepEqual(buildSession([metal,piano],{family:'instrumental'}).tracks.map(t=>t.id),['piano']);
  const empty=buildSession([metal,piano],{family:'instrumental',subgenre:'Jazz'});
  assert.deepEqual(empty.tracks,[]);assert.equal(empty.shortfallSeconds,1800);
});
test('short catalogs preserve BPM boundaries and requested low energy',()=>{
  const set=buildSession([track('soft'),track('intense',{energy:5}),track('fast',{bpm:180})],{family:'instrumental',energyTarget:1,bpmMin:76,bpmMax:84});
  assert.deepEqual(set.tracks.map(t=>t.id),['soft']);assert.ok(set.shortfallSeconds>0);
});
test('rotation favors less recently played tracks and known compatible keys',()=>{
  const a=track('a',{camelotKey:'8A'}),b=track('b',{camelotKey:'8A'}),c=track('c',{camelotKey:'3B'});
  assert.equal(buildSession([a,b,c],{family:'instrumental',history:[{id:'a',artist:'a'}]}).tracks[0].id,'b');
  assert.equal(buildSession([a,b,c],{family:'instrumental',previousTrackId:'a',excludeIds:['a']}).tracks[0].id,'b');
  const repeated=buildSession([a,a,b],{family:'instrumental'});assert.equal(new Set(repeated.tracks.map(t=>t.id)).size,repeated.tracks.length);
});
