const test=require('node:test');
const assert=require('node:assert/strict');
const {interpretIntent}=require('../qdj-intent');

const catalog={families:[{id:'electronic',name:'Electrónica'},{id:'instrumental',name:'Instrumental'}],tracks:[{family:'electronic',subgenre:'Deep House'},{family:'electronic',subgenre:'Techno'},{family:'instrumental',subgenre:'Jazz'}]};

test('semantic endpoint logic works locally when no AI provider is configured',async()=>{
  const result=await interpretIntent('deep house cálido, estable, 30 minutos',catalog);
  assert.equal(result.source,'local-semantic');assert.deepEqual(result.criteria,{family:'electronic',subgenre:'Deep House',minutes:30,mood:'warm',energy:'steady'});assert.match(result.summary,/Deep House/);
});

test('structured AI interpretation is catalog constrained and keeps local evidence',async()=>{
  let requestBody;
  const fetchImpl=async(_url,options)=>{requestBody=JSON.parse(options.body);return {ok:true,json:async()=>({output_text:JSON.stringify({family:'electronic',subgenre:'Deep House',minutes:45,bpmMin:null,bpmMax:null,mood:'deep',rhythm:'groove',energy:'rise',energyTarget:4})})};};
  const result=await interpretIntent('empieza profundo y termina para bailar durante 45 minutos',catalog,{apiKey:'test',fetchImpl});
  assert.equal(result.source,'semantic-ai');assert.equal(result.criteria.subgenre,'Deep House');assert.equal(result.criteria.energy,'rise');assert.equal(result.criteria.energyTarget,4);assert.equal(requestBody.store,false);assert.equal(requestBody.text.format.strict,true);
});

test('invalid AI taxonomy falls back without inventing unavailable genres',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({output_text:JSON.stringify({family:'opera',subgenre:'Ópera',minutes:30,bpmMin:null,bpmMax:null,mood:null,rhythm:null,energy:null,energyTarget:null})})});
  const result=await interpretIntent('deep house 30 minutos',catalog,{apiKey:'test',fetchImpl});
  assert.equal(result.criteria.family,'electronic');assert.equal(result.criteria.subgenre,'Deep House');
});
