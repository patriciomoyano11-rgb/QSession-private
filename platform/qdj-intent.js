'use strict';

const {interpret} = require('./public/qdj-request');
const VALID_MOODS = new Set(['any','deep','warm','euphoric','sensual','meditative','focused','celebratory','dark']);
const VALID_RHYTHMS = new Set(['any','smooth','groove','drive','peak']);
const VALID_CURVES = new Set(['steady','rise','calm','wave']);

function canonicalSubgenre(value,catalog,family) {
  const wanted=String(value||'').trim().toLowerCase();if(!wanted)return '';
  const track=(catalog.tracks||[]).find(item=>(!family||item.family===family)&&String(item.subgenre||item.style||'').trim().toLowerCase()===wanted);
  return track?.subgenre||track?.style||'';
}

function sanitizeCriteria(candidate,catalog,fallback={}) {
  const proposed=candidate&&typeof candidate==='object'?candidate:{},result={};
  const families=new Set((catalog.families||[]).map(item=>item.id));
  const family=families.has(proposed.family)?proposed.family:fallback.family;if(families.has(family))result.family=family;
  const subgenre=canonicalSubgenre(proposed.subgenre,catalog,result.family)||canonicalSubgenre(fallback.subgenre,catalog,result.family);if(subgenre)result.subgenre=subgenre;
  for(const key of ['bpmMin','bpmMax']){const value=proposed[key]??fallback[key];if(Number.isFinite(Number(value))&&Number(value)>=50&&Number(value)<=220)result[key]=Math.round(Number(value));}
  if(result.bpmMin&&result.bpmMax&&result.bpmMin>result.bpmMax){delete result.bpmMin;delete result.bpmMax;}
  const minutes=proposed.minutes??fallback.minutes;if(Number.isInteger(Number(minutes))&&Number(minutes)>=5&&Number(minutes)<=180)result.minutes=Number(minutes);
  const mood=VALID_MOODS.has(proposed.mood)?proposed.mood:fallback.mood;if(VALID_MOODS.has(mood))result.mood=mood;
  const rhythm=VALID_RHYTHMS.has(proposed.rhythm)?proposed.rhythm:fallback.rhythm;if(VALID_RHYTHMS.has(rhythm))result.rhythm=rhythm;
  const energy=VALID_CURVES.has(proposed.energy)?proposed.energy:fallback.energy;if(VALID_CURVES.has(energy))result.energy=energy;
  const target=proposed.energyTarget??fallback.energyTarget;if(Number.isInteger(Number(target))&&Number(target)>=1&&Number(target)<=5)result.energyTarget=Number(target);
  return result;
}

function describeCriteria(criteria,catalog) {
  const family=catalog.families?.find(item=>item.id===criteria.family)?.name;
  const labels={deep:'profunda',warm:'cálida',euphoric:'eufórica',sensual:'sensual',meditative:'meditativa',focused:'enfocada',celebratory:'festiva',dark:'oscura',smooth:'ritmo suave',groove:'con groove',drive:'con impulso',peak:'de pico',steady:'energía estable',rise:'en ascenso',calm:'con cierre suave',wave:'en oleadas'};
  return [criteria.subgenre||family,labels[criteria.mood],labels[criteria.rhythm],labels[criteria.energy],criteria.energyTarget?`intensidad ${criteria.energyTarget}/5`:null,criteria.bpmMin?`${criteria.bpmMin}${criteria.bpmMax&&criteria.bpmMax!==criteria.bpmMin?'–'+criteria.bpmMax:''} BPM`:null,criteria.minutes?`${criteria.minutes} min`:null].filter(Boolean).join(' · ');
}

function outputText(payload) {
  if(typeof payload?.output_text==='string')return payload.output_text;
  for(const item of payload?.output||[])for(const content of item.content||[])if(typeof content.text==='string')return content.text;
  return '';
}

async function interpretIntent(command,catalog,{apiKey='',fetchImpl=fetch,model='gpt-5-mini'}={}) {
  const clean=String(command||'').trim().slice(0,600);if(!clean)throw new Error('Describe el set que quieres escuchar.');
  const fallback=sanitizeCriteria(interpret(clean,catalog),catalog);
  if(!apiKey)return {criteria:fallback,source:'local-semantic',summary:describeCriteria(fallback,catalog)};
  const taxonomy=(catalog.families||[]).map(family=>({id:family.id,name:family.name,subgenres:[...new Set((catalog.tracks||[]).filter(track=>track.family===family.id).map(track=>track.subgenre||track.style).filter(Boolean))]}));
  const schema={type:'object',additionalProperties:false,required:['family','subgenre','minutes','bpmMin','bpmMax','mood','rhythm','energy','energyTarget'],properties:{
    family:{type:['string','null']},subgenre:{type:['string','null']},minutes:{type:['integer','null']},bpmMin:{type:['integer','null']},bpmMax:{type:['integer','null']},
    mood:{type:['string','null'],enum:['any','deep','warm','euphoric','sensual','meditative','focused','celebratory','dark',null]},
    rhythm:{type:['string','null'],enum:['any','smooth','groove','drive','peak',null]},energy:{type:['string','null'],enum:['steady','rise','calm','wave',null]},energyTarget:{type:['integer','null'],minimum:1,maximum:5},
  }};
  try{
    const response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({
      model,store:false,instructions:'Interpreta en español una idea musical para qDJ. Respeta la intención completa: ocasión, actividad, género, subgénero, atmósfera, groove, intensidad, recorrido y duración. El género o subgénero nombrado por la persona es una condición estricta: selecciónalo exactamente de la taxonomía y no lo sustituyas por un género vecino. No diagnostiques ni prometas efectos terapéuticos. Usa solamente familias y subgéneros del catálogo entregado; deja null lo que no se pueda inferir. No conviertas energía en velocidad automáticamente. Una petición de estabilidad no debe escalar a un pico.',
      input:`CATÁLOGO DISPONIBLE:\n${JSON.stringify(taxonomy)}\n\nIDEA DEL USUARIO:\n${clean}`,
      text:{format:{type:'json_schema',name:'qsession_playlist_intent',strict:true,schema}},
    })});
    if(!response.ok)throw new Error(`Proveedor semántico ${response.status}`);
    const parsed=JSON.parse(outputText(await response.json()));const criteria=sanitizeCriteria(parsed,catalog,fallback);
    return {criteria,source:'semantic-ai',summary:describeCriteria(criteria,catalog)};
  }catch{
    return {criteria:fallback,source:'local-semantic',summary:describeCriteria(fallback,catalog)};
  }
}

module.exports={interpretIntent,sanitizeCriteria,describeCriteria};
