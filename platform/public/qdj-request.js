/* Catalog-aware musical-intent interpretation. Works locally and is also the safe fallback for server AI interpretation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QSessionSetRequest=api;})(typeof window==='object'?window:globalThis,()=>{
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const contains=(text,phrase)=>(' '+text+' ').includes(' '+normalize(phrase)+' ');
  const includesAny=(text,phrases)=>phrases.some(phrase=>text.includes(normalize(phrase)));
  const score=(text,phrases)=>phrases.reduce((total,phrase)=>total+(contains(text,phrase)?Math.max(2,normalize(phrase).split(' ').length*2):text.includes(normalize(phrase))?1:0),0);
  const availableFamily=(catalog,id)=>catalog?.families?.some(family=>family.id===id);
  const firstAvailable=(catalog,candidates)=>candidates.find(id=>availableFamily(catalog,id));
  const FAMILY_IDEAS={
    electronic:['electronica','electronico','house','techno','acid','club','rave','underground','discoteca','dj','bailar','bailando','baile','pista','after','nocturno'],
    latin:['latina','latino','salsa','bachata','merengue','reggaeton','tropical','caribe','caribeno'],
    cumbia:['cumbia','cumbias','sonidera','villera'],
    afro:['afro','afrobeats','afrobeat','amapiano','tribal','percusion africana'],
    urban:['urbana','urbano','hip hop','rap','trap','r b','reggaeton'],
    pop:['pop','hits','cumpleanos','boda','casamiento','celebracion','cantar','conocidas'],
    ambient:['ambient','ambiental','chill','downtempo','atmosferica','paisaje sonoro','descansar','reposo','dormir','fondo discreto'],
    wellness:['yoga','meditacion','respiracion','contemplacion','pausa consciente','relajacion'],
    instrumental:['instrumental','piano','jazz','acustica','cinematica','sin voces','trabajar','estudiar','concentracion','concentrarme','reunion','conferencia','conversar','cena'],
    rock:['rock','metal','guitarras','punk'],
    roots:['raices','tradicional','folclor','folklore','regional'],
  };
  const MOODS={
    dark:['oscura','oscuro','sombria','sombrio','misteriosa','misterioso','nocturna','nocturno','industrial','cruda','crudo'],
    deep:['profunda','profundo','introspectiva','introspectivo','hipnotica','hipnotico','envolvente','subterranea','subterraneo'],
    warm:['calida','calido','amable','acogedora','acogedor','organica','organico','elegante','cercana','cercano'],
    euphoric:['euforica','euforico','explosiva','explosivo','extasis','triunfal'],
    sensual:['sensual','seductora','seductor','romantica','romantico','intima','intimo'],
    meditative:['meditativa','meditativo','contemplativa','contemplativo','serena','sereno','respirar','calma interior'],
    focused:['enfocada','enfocado','concentracion','concentrarme','productiva','productivo','estudiar','trabajar','sin distraer'],
    celebratory:['celebracion','festiva','festivo','fiesta','cumpleanos','boda','alegre','alegria'],
  };
  const RHYTHMS={
    smooth:['suave','fluida','fluido','sutil','delicada','delicado','espaciada','espaciado','sin invadir','de fondo','pulso ligero'],
    groove:['groove','bailable','bailar','bailando','movimiento','cadencia','swing','con ritmo','moverse'],
    drive:['impulso','dinamica','dinamico','constante','avanzar','entrenar','ejercicio','empuje','conducir'],
    peak:['pico','maxima energia','muy intensa','muy intenso','explosiva','explosivo','contundente'],
  };
  function bestLabel(text,map){return Object.entries(map).map(([value,phrases])=>({value,points:score(text,phrases)})).sort((a,b)=>b.points-a.points)[0];}
  function catalogGenres(catalog){return [...new Map((catalog?.tracks||[]).map(track=>{const name=track.subgenre||track.style;return [normalize(name),{name,family:track.family}];})).values()].filter(item=>item.name).sort((a,b)=>normalize(b.name).length-normalize(a.name).length);}
  function closestSubgenre(text,catalog){
    const genres=catalogGenres(catalog),exact=genres.find(item=>contains(text,item.name));if(exact)return exact;
    const words=new Set(text.split(' ').filter(word=>word.length>2));
    const candidates=genres.map(item=>{const parts=normalize(item.name).split(' ').filter(word=>word.length>2);return {item,points:parts.reduce((n,word)=>n+(words.has(word)?2:0),0),parts};})
      .filter(entry=>entry.points>=2&&entry.parts.length&&entry.points/entry.parts.length>=1).sort((a,b)=>b.points-a.points||b.parts.length-a.parts.length);
    return candidates[0]?.item||null;
  }
  function interpret(command,catalog){
    const text=normalize(command);if(!text)throw Error('Describe el set que quieres escuchar.');
    const result={};
    const familyScores=Object.entries(FAMILY_IDEAS).filter(([id])=>availableFamily(catalog,id)).map(([id,phrases])=>({id,points:score(text,phrases)})).sort((a,b)=>b.points-a.points);
    if(familyScores[0]?.points>0)result.family=familyScores[0].id;
    const genre=closestSubgenre(text,catalog);if(genre){result.family=genre.family;result.subgenre=genre.name;}
    else if(contains(text,'jazz')){result.family=firstAvailable(catalog,['instrumental','ambient']);result.subgenre='Jazz';}
    else if(contains(text,'death metal')){result.family=firstAvailable(catalog,['rock']);result.subgenre='Death Metal';}
    const raw=String(command).toLowerCase();
    const bpm=raw.match(/(\d{2,3})\s*(?:-|–|a|hasta)\s*(\d{2,3})\s*bpm/)||text.match(/(\d{2,3})\s*bpm/);
    if(bpm){result.bpmMin=Number(bpm[1]);result.bpmMax=Number(bpm[2]||bpm[1]);if(result.bpmMin<50||result.bpmMax>220||result.bpmMax<result.bpmMin)throw Error('Usa un rango de 50 a 220 BPM.');}
    const duration=text.match(/(\d+)\s*(?:minutos|min|mins)\b/);const hours=text.match(/(\d+)\s*horas?\b/);
    if(duration||hours){result.minutes=Number(duration?.[1]||hours[1])*(!duration?60:1);if(result.minutes<5||result.minutes>180)throw Error('La duración debe estar entre 5 y 180 minutos.');}
    const mood=bestLabel(text,MOODS);if(mood?.points>0)result.mood=mood.value;
    const rhythm=bestLabel(text,RHYTHMS);if(rhythm?.points>0)result.rhythm=rhythm.value;
    if(includesAny(text,['empiece suave y termine','comience suave y termine','de menos a mas','subiendo energia','energia en ascenso','creciente','ir levantando','sube de a poco'])||/(?:empez|comien)[a-z]*.{0,100}(?:termin|acab)[a-z]*.{0,50}(?:bail|arriba|energia)/.test(text))result.energy='rise';
    else if(includesAny(text,['termine tranquilo','termine suave','bajar de a poco','descenso','descendente','cerrar con calma','aterrizar']))result.energy='calm';
    else if(includesAny(text,['subidas y descansos','altos y bajos','en oleadas','en olas','varias olas']))result.energy='wave';
    else if(includesAny(text,['sin subir demasiado','mantener la energia','energia estable','estable','equilibrada','equilibrado','constante','sin picos']))result.energy='steady';
    if(includesAny(text,['muy suave','energia baja','baja intensidad','tranquila','tranquilo','calmada','calmado','sin invadir']))result.energyTarget=1;
    else if(includesAny(text,['suave','relajada','relajado','ligera','ligero']))result.energyTarget=2;
    else if(includesAny(text,['energia media','moderada','moderado']))result.energyTarget=3;
    else if(includesAny(text,['alta energia','intensa','intenso','potente'])&&!includesAny(text,['sin llegar agresivo','no muy intensa','no muy intenso']))result.energyTarget=5;
    else if(includesAny(text,['bailar','bailable','fiesta','movimiento','con energia']))result.energyTarget=4;
    if(includesAny(text,['sin llegar agresivo','sin ser agresivo','no demasiado fuerte','sin picos','no muy intensa','no muy intenso']))result.energyTarget=Math.min(result.energyTarget||4,4);
    if(!result.family){
      if(includesAny(text,['descansar','dormir','atmosfera','paisaje sonoro']))result.family=firstAvailable(catalog,['ambient','wellness','instrumental']);
      else if(includesAny(text,['conversar','cena','reunion','trabajar','estudiar','sin voces']))result.family=firstAvailable(catalog,['instrumental','ambient','electronic']);
      else if(includesAny(text,['bailar','fiesta','movimiento']))result.family=firstAvailable(catalog,['electronic','latin','cumbia','pop']);
    }
    return Object.fromEntries(Object.entries(result).filter(([,value])=>value!==undefined&&value!==null));
  }
  return{interpret,normalize};
});
