'use strict';

// Local HTTP admission benchmark only. Never connects to a CDN, LiveKit or a remote URL.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {once}=require('node:events');
const {performance}=require('node:perf_hooks');
const {createQsessionServer}=require('../server');
const {createProductStore}=require('../product-store');
const {CHECKS,plannedProfile}=require('../mass-broadcast-readiness');
const {syntheticAdmissions}=require('../test/fixtures/broadcast-admissions.cjs');

async function run({requests=10000,concurrency=32}={}) {
  if(!Number.isInteger(requests)||requests<1||requests>10000||!Number.isInteger(concurrency)||concurrency<1||concurrency>100) throw new Error('Sólo se permiten 1–10000 solicitudes y 1–100 operaciones paralelas al servidor local creado por esta prueba.');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-admission-'));
  const env={QSESSION_AUDIENCE_MODE:'cdn-only',QSESSION_CDN_ONLY_ROOM:'LOAD10',QSESSION_BROADCAST_AUDIENCE_TARGET:'10000',QSESSION_HLS_VIDEO_BITRATE:'1800000',QSESSION_HLS_AUDIO_BITRATE:'320000',QSESSION_HLS_SEGMENT_SECONDS:'6'};
  const now=Date.now(),when=new Date(now-1000).toISOString();
  // Dependency injection with synthetic evidence exercises code, NOT operational readiness.
  const synthetic={schemaVersion:1,roomCode:'LOAD10',targetViewers:10000,approvedBy:'LOCAL SIMULATION ONLY',approvedAt:when,expiresAt:new Date(now+3600000).toISOString(),providerConcurrentViewers:10000,loadTestConcurrentViewers:10000,joinWindowSeconds:300,loadTestJoinsPerSecond:100,profile:plannedProfile(env),checks:Object.fromEntries(CHECKS.map(key=>[key,{status:'passed',reference:'synthetic-loopback-not-real-evidence',verifiedAt:when}]))};
  const productStore=createProductStore();productStore.createRoomRecord({code:'LOAD10',name:'Local admission simulation',visibility:'public'});
  let joinWrites=0;const recordJoin=productStore.recordJoin;productStore.recordJoin=(...args)=>{joinWrites++;return recordJoin(...args);};
  const broadcastAdmissions=syntheticAdmissions();
  let sfuActivityChecks=0;
  let app;
  try {
    app=createQsessionServer({env,port:0,productStore,broadcastAdmissions,dataFile:path.join(dir,'state.json'),analyticsDataFile:path.join(dir,'analytics.ndjson'),mediaDirectory:path.join(dir,'media'),privateMediaDirectory:path.join(dir,'private-media'),promotionMediaDirectory:path.join(dir,'promotion-media'),liveRoomActivityProvider:async()=>{sfuActivityChecks++;return new Map();},roomSecret:'local-simulation-not-a-production-secret',livekitUrl:'wss://media.invalid',livekitApiKey:'local-test-key',livekitApiSecret:'local-test-secret',publicRoomsEnabled:true,massBroadcastReadiness:synthetic,edgeBroadcast:{configured:true,provider:'mock-only',deliveryMode:'object-storage',playbackUrl:code=>`https://cdn.invalid/live/${code}-xxxxxxxxxxxxxxxxxx/index.m3u8`}});
    app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
    const url=`http://127.0.0.1:${app.server.address().port}/api/rooms/LOAD10/media-token`;
    let next=0,completed=0,failures=0,sfuCredentials=0,authorizedHlsResponses=0;
    const durations=[],statuses={},start=performance.now();
    await Promise.all(Array.from({length:Math.min(requests,concurrency)},async()=>{
      for(;;){const index=next++;if(index>=requests)break;const began=performance.now();
        try {
          const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'listener'}),signal:AbortSignal.timeout(15000)});
          const body=await response.json();statuses[response.status]=(statuses[response.status]||0)+1;
          if(body.token||body.delivery?.fallback)sfuCredentials++;
          const admissionToken=body.delivery?.admissionToken;
          const authorized=Boolean(admissionToken&&body.delivery?.url&&new URL(body.delivery.url).searchParams.get('qsat')===admissionToken);
          if(authorized)authorizedHlsResponses++;
          if(!response.ok||!authorized||body.transport!=='hls'||body.delivery?.audienceMode!=='cdn-only'||body.permissions?.join(',')!=='listen')failures++;
          completed++;
        }catch{failures++;}
        durations.push(performance.now()-began);
      }
    }));
    const elapsed=performance.now()-start;durations.sort((a,b)=>a-b);
    const percentile=p=>Number(durations[Math.min(durations.length-1,Math.ceil(p*durations.length)-1)].toFixed(2));
    const hashes=Object.fromEntries(['server.js','edge-broadcast.js','mass-broadcast-readiness.js','broadcast-admissions.js','broadcast-event-plan.js','test/fixtures/broadcast-admissions.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]));
    return {kind:'local-http-admission-benchmark',network:'loopback-only',simulation:true,admissionBackend:'synthetic-memory-only',redisConnectionsOpened:0,certifiesRedisCapacity:false,certifiesAudienceCapacity:false,videoStreamsOpened:0,requests,concurrency,completed,failures,statuses,sfuCredentialsReturned:sfuCredentials,sfuActivityChecks,authorizedHlsResponses,joinStoreWrites:joinWrites,elapsedSeconds:Number((elapsed/1000).toFixed(3)),requestsPerSecond:Number((completed*1000/elapsed).toFixed(2)),latencyMilliseconds:{p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)},nodeVersion:process.version,rssMegabytes:Number((process.memoryUsage().rss/1048576).toFixed(1)),sourceHashes:hashes,notValidated:['Atomicidad, aforo y rendimiento de Redis','10.000 espectadores simultáneos','Tráfico CDN y red','Audio/video real','Dispositivos móviles','Hardware del servidor de producción']};
  } finally {
    if(app?.server.listening){app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
    if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('qsession-admission-'))throw new Error('Invalid temporary cleanup target');
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
if(require.main===module){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){if(!['--requests','--concurrency'].includes(args[i])||!args[i+1]){process.stderr.write('Uso: --requests 10000 --concurrency 32. No se aceptan direcciones externas.\n');process.exit(2);}options[args[i].slice(2)]=Number(args[i+1]);}
  run(options).then(result=>{process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.failures||result.sfuCredentialsReturned||result.sfuActivityChecks||result.joinStoreWrites)process.exitCode=1;}).catch(()=>{process.stderr.write('No se completó el ensayo local de admisiones.\n');process.exitCode=1;});
}
module.exports={run};
