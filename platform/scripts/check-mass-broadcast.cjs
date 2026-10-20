'use strict';
const fs=require('node:fs');
const {assessReadiness,parseEnv}=require('../mass-broadcast-readiness');
function main(args){
  if(args.length===1&&args[0]==='--help'){process.stdout.write('Uso: node scripts/check-mass-broadcast.cjs --env-file archivo.env --readiness-file expediente.json\nSólo lectura: 0=expediente completo, 1=pendiente, 2=entrada inválida. Nunca activa ni despliega.\n');return;}
  const flags={};
  for(let i=0;i<args.length;i+=2){if(!['--env-file','--readiness-file'].includes(args[i])||!args[i+1])throw new Error('Uso: node scripts/check-mass-broadcast.cjs --env-file archivo.env --readiness-file expediente.json');flags[args[i]]=args[i+1];}
  if(!flags['--env-file']||!flags['--readiness-file'])throw new Error('Indica ambos archivos. Este comando sólo revisa; nunca activa ni despliega.');
  const env=parseEnv(fs.readFileSync(flags['--env-file'],'utf8'));
  const evidence=JSON.parse(fs.readFileSync(flags['--readiness-file'],'utf8').replace(/^\uFEFF/,''));
  const report=assessReadiness(env,evidence);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(!report.evidenceComplete)process.exitCode=1;
}
if(require.main===module){try{main(process.argv.slice(2));}catch{process.stderr.write('No se pudieron revisar los archivos. Usa --env-file y --readiness-file con archivos legibles y JSON válido. No se ha modificado nada.\n');process.exitCode=2;}}
module.exports={main};
