'use strict';
// Explicit editorial shortlist. Discovery is never automatically promoted.
const fs=require('node:fs');
const path=require('node:path');
const source=['audius-discovery-first','audius-discovery'].flatMap(f=>JSON.parse(fs.readFileSync(path.join(__dirname,`../tmp/${f}.json`),'utf8')).flatMap(g=>g.tracks));
const choices={
  electronic:[['vWy3a4V','House orgánico',2],['V43vZ4a','House y percusión',3],['PW5KMVp','Downtempo oriental',2],['VgyMzlb','Electrónica orgánica',2],['5O7MKb1','Downtempo',1],['1zAAly','Deep house',2],['QNk9my3','Deep house',2],['Wkp1Jvo','House melódico',3],['QbOVXNV','House progresivo',3],['MVBXj','House progresivo',3],['83V8l','House psicodélico',3],['1GQ8X','House orgánico',2],['dE0ak35','House y folktrónica',2],['911AP4j','House orgánico',2],['l4A1Ggb','House oriental',2],['aWN2z','House experimental',3]],
  ambient:[['zzaz5','Ambient contemplativo',1],['plxl5','Ambient contemplativo',1],['0XbXV','Ambient contemplativo',1],['dYjMv','Handpan',1],['rE6K8','Piano tranquilo',1],['X9aOv7J','Cuencos y paisajes sonoros',1],['QNjm3','Guitarra ambiental en vivo',1],['2G25K','Ambient',1],['Mo3qE4Z','Ambient',1],['91Ax2Vk','Ambient',1],['mlGxoR5','Ambient',1],['jvd2o','Guitarra contemplativa',1],['31w1y1v','Ambient experimental',1],['zVYJwrz','Ambient experimental',1]],
  cumbia:[['5BZ6Y','Cumbia y afro-latin',2],['GJ9m99j','Cumbia de autor',1],['wQRm1','Cumbia y folktrónica',2],['lpypG','Cumbia y dub',2],['QVpGorR','Cumbia electrónica',2],['PQGVpN1','Cumbia electrónica',1],['Ab10Yrw','Cumbia electrónica',2],['aBvdoYE','Cumbia y bass',3],['dKdzP','Cumbia y bass',3],['b6QVW','Cumbia romántica',1],['WkoXK','Cumbia downtempo',2],['QQJy3','Cumbia lo-fi',1],['vGAR8','Cumbia y mantra',1]],
  roots:[['zVN8Z','Fusión de joropo y música andina',2],['NvrZZ','Joropo y jazz venezolano',3],['pPbA2qo','Xote instrumental brasileño',2],['Kv1kw','Acordeón regional del sur',2],['P6ENk','Música andina',2],['amXEa','Música andina',2],['X9wYp9p','Fusión andina y downtempo',1],['M2ZqZ','Fusión colombiana y electrónica',2]],
};
const tracks=[];
for(const [family,items] of Object.entries(choices)) for(const [id,style,energy] of items) {
  const t=source.find(t=>t.id===id);
  if(!t||t.blocked)throw new Error(`Review unavailable track ${id}`);
  tracks.push({id,family,style,energy,order:tracks.length,title:t.title.trim(),artist:t.artist.trim(),handle:t.handle,duration:t.duration,bpm:family==='ambient'?null:t.bpm,
    releasedAt:t.date,sourceUrl:`https://audius.co${t.permalink}`,artwork:t.artwork||null,copyright:t.copyright||`© ${t.artist.trim()}`,licenseUrl:'https://audius.org/open-music-license.pdf',
    review:{method:'metadata-editorial',listened:false,reason:`${style}; selección basada en título, etiquetas, descripción y perfil de publicación.`,declaredLicense:t.license||null}});
}
// Preserve later editorial additions when rebuilding the initial selection.
const catalogPath=path.join(__dirname,'../music-data/audius-selection.json');
if(fs.existsSync(catalogPath)){
  const existing=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
  const initialIds=new Set(tracks.map(t=>t.id));
  for(const track of existing.tracks)if(!initialIds.has(track.id))tracks.push({...track,order:tracks.length});
}
fs.mkdirSync(path.join(__dirname,'../music-data'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'../music-data/audius-selection.json'),JSON.stringify({reviewedAt:new Date().toISOString(),selectionMethod:'Selección editorial por metadatos; pendiente de evaluación auditiva completa. Incluye catálogo de fondo, no solo novedades.',tracks},null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.keys(choices).map(f=>[f,tracks.filter(t=>t.family===f).length]))));
