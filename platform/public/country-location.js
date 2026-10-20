(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QSessionCountryLocation=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const ringsByCountry=new WeakMap();
  function rings(country){
    if(ringsByCountry.has(country))return ringsByCountry.get(country);
    const tokens=String(country.path||'').match(/[MLZ]|-?\d+(?:\.\d+)?/g)||[],result=[];let ring=[];
    for(let i=0;i<tokens.length;){const token=tokens[i++];if(token==='M'){if(ring.length)result.push(ring);ring=[];ring.push([Number(tokens[i++]),Number(tokens[i++])]);}else if(token==='L')ring.push([Number(tokens[i++]),Number(tokens[i++])]);else if(token==='Z'){if(ring.length)result.push(ring);ring=[];}}
    if(ring.length)result.push(ring);ringsByCountry.set(country,result);return result;
  }
  function contains(country,x,y){let inside=false;for(const ring of rings(country))for(let i=0,j=ring.length-1;i<ring.length;j=i++){const[a,b]=ring[i],[c,d]=ring[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;}return inside;}
  function countryCode(map,coords){
    const latitude=coords?.latitude,longitude=coords?.longitude;
    if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return '';
    const x=(longitude+180)/360*1000,y=(90-latitude)/180*500;
    const microstate=(map.microstates||[]).map(c=>({c,d:Math.hypot(c.x-x,c.y-y)})).filter(p=>p.d<=.5).sort((a,b)=>a.d-b.d)[0];
    if(microstate)return microstate.c.code;
    const countries=[...new Map((map.countries||[]).map(c=>[c.code,c])).values()];
    return countries.find(c=>{const bounds=c.locationBounds||c.bounds;return Array.isArray(bounds)&&x>=bounds[0]&&x<=bounds[2]&&y>=bounds[1]&&y<=bounds[3]&&contains(c,x,y);})?.code||'';
  }
  function freshCountry(record,now=Date.now()){
    if(!record||typeof record!=='object'||record.verifiedBy!=='gps'||!/^[A-Z]{2}$/.test(record.code||'')||!Number.isFinite(record.verifiedAt))return '';
    const age=now-record.verifiedAt;return age>=0&&age<30*60*1000?record.code:'';
  }
  return {countryCode,freshCountry};
});
