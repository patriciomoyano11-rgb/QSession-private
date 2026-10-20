"""Exercise the published edge+actor path in local workerd, without cloud access."""
import concurrent.futures
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[2]
WRANGLER=ROOT/'release/cloudflare-tools/node_modules/wrangler/bin/wrangler.js'
FOLDER=ROOT/'release/edge-cache-context-local'
PRIVATE=ROOT/'private/cloudflare-cli'
PREFIX='live/PRB10A-abcdefghijklmnopqr/'
WRAPPER=r'''
import worker, {QSessionSegmentCache, serveResponse, readFreshManifest, inspectLocalR2Pool} from './candidate-worker.mjs';
export {QSessionSegmentCache};
let backendRequests=0, actorRequests=0, storageReads=0;
const cacheFaultCounts={discarded:0,rejected:0,readErrors:0};
const nativeCache=caches.default;
Object.defineProperty(globalThis,'caches',{value:{default:{
  async match(request){
    const pathname=new URL(request.url).pathname;
    if(pathname.endsWith('/segment_cache-read-error.ts')){cacheFaultCounts.readErrors++;throw new Error('private cache read failure');}
    return nativeCache.match(request);
  },
  async put(request,response){
    const pathname=new URL(request.url).pathname;
    if(pathname.endsWith('/segment_cache-reject.ts')){cacheFaultCounts.rejected++;throw new Error('private cache write failure');}
    if(pathname.endsWith('/segment_cache-discard.ts')){cacheFaultCounts.discarded++;await response.arrayBuffer();return;}
    return nativeCache.put(request,response);
  },
}}});
const localActorErrors=[];
globalThis.fetch=async (input,init)=>{
  if(new URL(typeof input==='string'?input:input.url).hostname==='local-admission.invalid'){
    backendRequests++; return Response.json({ok:true,cacheSeconds:20});
  }
  throw new Error('Network access outside the local fixture is forbidden');
};
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export default {async fetch(request,env,ctx){
  const incoming=new URL(request.url);
  if(incoming.pathname==='/stats')return Response.json({backendRequests,actorRequests,storageReads,localActorErrors,cacheFaultCounts,bodyPool:inspectLocalR2Pool(),
    candidateSourceSha256:env.LOCAL_CANDIDATE_SHA256,runNonce:env.LOCAL_RUN_NONCE});
  if(!['/index.m3u8','/segment_fixture.ts','/unauthorized','/expired','/manifest-fault','/manifest-invalid','/manifest-read-fails',
    '/media-overloaded','/media-storage-fault','/media-invalid-fault',
    '/r2-read-fault','/r2-stream-fault','/r2-short-fault',
    '/cache-discard','/cache-reject','/cache-read-error'].includes(incoming.pathname))return new Response(null,{status:404});
  const fault=incoming.pathname.startsWith('/manifest-');
  const mediaFault=incoming.pathname.startsWith('/media-');
  const r2Fault=incoming.pathname.startsWith('/r2-');
  const cacheFault=incoming.pathname.startsWith('/cache-');
  const target=new URL('https://local-public-fixture.invalid/live/PRB10A-abcdefghijklmnopqr/'+
    (incoming.pathname==='/unauthorized'||incoming.pathname==='/expired'||fault?'index.m3u8':mediaFault||r2Fault||cacheFault?'segment_'+incoming.pathname.slice(1)+'.ts':incoming.pathname.slice(1)));
  let admission;
  if(incoming.pathname!=='/unauthorized'){
    const payload={v:1,aud:'qsession-hls',code:'PRB10A',prefix:'live/PRB10A-abcdefghijklmnopqr',
      lease:String(Number(incoming.searchParams.get('client'))||0).padStart(22,'0'),exp:Math.floor(Date.now()/1000)+(incoming.pathname==='/expired'?-10:600)};
    const body=b64(new TextEncoder().encode(JSON.stringify(payload)));
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.QSESSION_ADMISSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('v1.'+body))));
    target.searchParams.set('qsat','v1.'+body+'.'+signature);
    admission={payload,token:target.searchParams.get('qsat')};
  }
  if(fault){
    const broken=new Response(incoming.pathname==='/manifest-invalid'?'#EXTM3U\nhttps://untrusted.invalid/media.ts\n':
      new ReadableStream({start(controller){controller.error(new Error('local fixture read failure'));}}));
    return serveResponse(new Request(target),broken,admission,true,true,'fixture',
      ()=>incoming.pathname==='/manifest-read-fails'?Promise.reject(new Error('local storage failure')):
        readFreshManifest(env,'live/PRB10A-abcdefghijklmnopqr/index.m3u8'));
  }
  if(mediaFault){
    const binding={idFromName:name=>name,get:()=>({fetch:async()=>{
      if(incoming.pathname==='/media-overloaded')throw Object.assign(new Error('private local fixture details'),{overloaded:true});
      return new Response(null,{status:503,headers:{'X-QSession-Media-Failure':
        incoming.pathname==='/media-storage-fault'?'storage-body-read':'private-token=must-not-escape'}});
    }})};
    return worker.fetch(new Request(target),{...env,QSESSION_R2_EDGE_CACHE_ROOM:'',QSESSION_SEGMENT_CACHE:binding},ctx);
  }
  const headers=new Headers();
  if(request.headers.has('Range'))headers.set('Range',request.headers.get('Range'));
  if(env.QSESSION_R2_EDGE_CACHE_ROOM||r2Fault){
    const bucket=env.QSESSION_LIVE;
    const localBucket={get(...args){
      storageReads++;
      if(r2Fault){
        if(incoming.pathname==='/r2-read-fault')throw new Error('private local R2 secret');
        const body=new ReadableStream({start(controller){
          if(incoming.pathname==='/r2-stream-fault')controller.error(new Error('private local stream secret'));
          else{controller.enqueue(new Uint8Array(188).fill(71));controller.close();}
        }});
        return {body,size:1431620,httpEtag:'"local-fault"',writeHttpMetadata(h){h.set('Content-Type','video/mp2t');}};
      }
      return cacheFault?bucket.get('live/PRB10A-abcdefghijklmnopqr/segment_fixture.ts'):bucket.get(...args);
    },head(...args){return cacheFault?bucket.head('live/PRB10A-abcdefghijklmnopqr/segment_fixture.ts'):bucket.head(...args);}};
    const forbiddenActor={idFromName(name){actorRequests++;throw new Error('Canary must never consult the private actor');}};
    env={...env,QSESSION_R2_EDGE_CACHE_ROOM:'PRB10A',QSESSION_LIVE:localBucket,QSESSION_SEGMENT_CACHE:forbiddenActor};
  }else{
    const actual=env.QSESSION_SEGMENT_CACHE;
    const localActor={idFromName:name=>actual.idFromName(name),get(id){return {async fetch(req){
      actorRequests++;
      try{return await actual.get(id).fetch(req);}
      catch(error){
        // This fixture contains synthetic credentials only. Never installed
        // in the candidate module or uploaded to a provider.
        if(localActorErrors.length<4)localActorErrors.push(String(error.message).slice(0,180));
        throw error;
      }
    }};}};
    env={...env,QSESSION_SEGMENT_CACHE:localActor};
  }
  return worker.fetch(new Request(target,{method:request.method,headers}),env,ctx);
}};
'''


def main(destination, concurrency=64, requests=768, delivery='shared',scenario='mixed'):
    if type(concurrency) is not int or not 1<=concurrency<=256 or type(requests) is not int or not concurrency<=requests<=4096:
        raise ValueError('Local reproduction must remain bounded')
    if delivery not in ('shared','r2-edge'):raise ValueError('Unknown local delivery mode')
    if scenario not in ('normal','faults','mixed'):raise ValueError('Unknown local verification scenario')
    FOLDER.mkdir(exist_ok=True)
    PRIVATE.mkdir(exist_ok=True,parents=True)
    nonce=secrets.token_hex(8)
    # A fresh, short path also keeps SQLite filenames below Windows path
    # limits. The long private directory masked actor creation as internal RPC
    # failures, while the actor-free canary remained functional.
    state=ROOT/'release'/('w-'+nonce[:8])
    fixture=PRIVATE/'edge-context-segment.ts'
    segment=b'G'*1431620
    segment_digest=hashlib.sha256(segment).digest()
    fixture.write_bytes(segment)
    manifest=PRIVATE/'edge-context-index.m3u8'
    manifest.write_text('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:6,\nsegment_fixture.ts\n')
    (FOLDER/'worker.mjs').write_text(WRAPPER,encoding='utf8')
    candidate=(ROOT/'platform/edge/hls-worker.js').read_bytes().replace(b'\r\n',b'\n')
    inspection=b'\nexport function inspectLocalR2Pool(){return {payloadBytes:r2EdgeBodyBytes,entries:r2EdgeBodies.size,byteLimit:R2_EDGE_BODY_BYTES_LIMIT,keyLimit:R2_EDGE_BODY_KEY_LIMIT};}\n'
    (FOLDER/'candidate-worker.mjs').write_bytes(candidate+b'\nexport {serveResponse, readFreshManifest};\n'+inspection)
    config={'name':'qsession-edge-context-local-only','main':'worker.mjs','compatibility_date':'2026-09-25',
        'r2_buckets':[{'binding':'QSESSION_LIVE','bucket_name':'qsession-edge-local-fixture','remote':False}],
        'durable_objects':{'bindings':[{'name':'QSESSION_SEGMENT_CACHE','class_name':'QSessionSegmentCache'}]},
        'exports':{'QSessionSegmentCache':{'type':'durable-object','storage':'sqlite'}},
        'vars':{'QSESSION_ADMISSION_ROOM':'PRB10A','QSESSION_SHARED_CACHE_ROOM':'PRB10A',
            'QSESSION_ADMISSION_SECRET':'local-only-synthetic-admission-secret-32-bytes',
            'QSESSION_ADMISSION_API':'https://local-admission.invalid/check',
            'LOCAL_CANDIDATE_SHA256':hashlib.sha256(candidate).hexdigest(),'LOCAL_RUN_NONCE':nonce}}
    if delivery=='r2-edge':config['vars']['QSESSION_R2_EDGE_CACHE_ROOM']='PRB10A'
    config_file=FOLDER/'wrangler.json';config_file.write_text(json.dumps(config))
    env={k:v for k,v in os.environ.items() if not k.startswith(('CLOUDFLARE_','CF_API_'))}
    env.update({'XDG_CONFIG_HOME':str(PRIVATE),'WRANGLER_LOG_PATH':str(PRIVATE/'logs'),
         'WRANGLER_SEND_METRICS':'false','NO_COLOR':'1'})
    base=['node',str(WRANGLER)]
    for file,name in ((fixture,'segment_fixture.ts'),(manifest,'index.m3u8')):
        result=subprocess.run(base+['r2','object','put','qsession-edge-local-fixture/'+PREFIX+name,
            '--local','--persist-to',str(state),'--file',str(file),'--config',str(config_file)],
            cwd=ROOT,env=env,capture_output=True,timeout=45)
        if result.returncode:raise RuntimeError('Local fixture setup failed; details suppressed')
    process=subprocess.Popen(base+['dev','--local','--ip','127.0.0.1','--port','8790',
        '--persist-to',str(state),'--config',str(config_file)],cwd=ROOT,env=env,
        stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    known_errors=[];startup_errors=[]
    def drain():
        for raw in process.stdout:
            text=raw.decode('utf8',errors='replace').lower()
            if ('error' in text or 'failed' in text) and len(startup_errors)<6:
                cleaned=re.sub(r'\x1b\[[0-9;]*m','',raw.decode('utf8',errors='replace'))
                cleaned=re.sub(r'v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[token omitted]',cleaned)
                startup_errors.append(cleaned.strip()[:300])
            for phrase in ('different request','network connection lost','memory limit','the script will never'):
                if phrase in text:known_errors.append(phrase)
    thread=threading.Thread(target=drain,daemon=True);thread.start()
    outcomes=[]
    report={'localOnly':True,'cloudResourcesCreated':0,'cloudAuthenticationUsed':False,
            'outboundFetchForbidden':True,'maximumConcurrentRequests':concurrency,'capacityCertified':False,
            'candidateSourceSha256':hashlib.sha256(candidate).hexdigest(),'deliveryMode':delivery,'scenario':scenario}
    def stop_expired_runtime():
        report['localRuntimeDeadlineReached'] = True
        if process.poll() is None:
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,timeout=15)
    watchdog=threading.Timer(120,stop_expired_runtime)
    watchdog.daemon=True
    watchdog.start()
    try:
        for _ in range(80):
            if process.poll() is not None:raise RuntimeError('Local runtime stopped')
            try:
                urllib.request.urlopen('http://127.0.0.1:8790/not-fixture',timeout=.3)
            except urllib.error.HTTPError as error:
                if error.code==404:break
            except OSError:time.sleep(.15)
        else:raise RuntimeError('Local runtime not ready')
        with urllib.request.urlopen('http://127.0.0.1:8790/stats',timeout=3) as stats_response:
            identity=json.loads(stats_response.read(4096))
        if identity.get('runNonce')!=nonce or identity.get('candidateSourceSha256')!=report['candidateSourceSha256']:
            raise RuntimeError('Local fixture identity differs; no verification traffic started')
        def get(index):
            name='index.m3u8' if index%4==0 else 'segment_fixture.ts'
            try:
                with urllib.request.urlopen('http://127.0.0.1:8790/'+name+'?client='+str(index),timeout=12) as response:
                    if scenario=='mixed' and name.endswith('.ts') and index%7==0:
                        response.read(188);return {'canceledIntentionally':True}
                    data=response.read()
                    if name.endswith('.ts'):
                        assert len(data)==len(segment) and hashlib.sha256(data).digest()==segment_digest
                    else:
                        assert data.startswith(b'#EXTM3U') and b'qsat=v1.' in data
                    return {'status':response.status,'fullBodyVerified':True}
            except Exception as error:
                result={'errorClass':type(error).__name__,'status':getattr(error,'code',None)}
                code=getattr(error,'headers',{}).get('X-QSession-Media-Failure','')
                if re.fullmatch(r'[a-z-]{1,40}',code):result['mediaFailureCode']=code
                return result
        if scenario!='faults':
            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
                outcomes=list(executor.map(get,range(requests)))
        protocol_checks=[]
        for range_value,method,status,expected in [
                ('bytes=0-187','GET',206,segment[:188]),('bytes=-188','GET',206,segment[-188:]),
                (None,'HEAD',200,b''),('bytes=9999999-','GET',416,None)]:
            req=urllib.request.Request('http://127.0.0.1:8790/segment_fixture.ts?client=9999',
                method=method,headers={'Range':range_value} if range_value else {})
            try:response=urllib.request.urlopen(req,timeout=5)
            except urllib.error.HTTPError as error:response=error
            with response:
                body=response.read();ok=response.status==status and (expected is None or body==expected)
                if status==206:ok=ok and response.headers.get('Content-Length')=='188' and response.headers.get('Content-Range','').endswith('/1431620')
                if status==200 and method=='HEAD':ok=ok and response.headers.get('Content-Length')=='1431620'
                protocol_checks.append({'method':method,'range':range_value,'status':response.status,'passed':ok})
        try:
            urllib.request.urlopen('http://127.0.0.1:8790/unauthorized',timeout=3)
            denied=False
        except urllib.error.HTTPError as error:denied=error.code==403
        try:
            urllib.request.urlopen('http://127.0.0.1:8790/expired',timeout=3)
            expired_denied=False
        except urllib.error.HTTPError as error:expired_denied=error.code==403
        faults=[]
        fault_specs=[] if scenario=='normal' else [('manifest-fault',200,'X-QSession-Manifest-Recovery','storage'),
                ('manifest-invalid',502,'X-QSession-Manifest-Failure','reference'),
                ('manifest-read-fails',503,'X-QSession-Manifest-Failure','read'),
                ('media-overloaded',503,'X-QSession-Media-Failure','shared-overloaded'),
                ('media-storage-fault',503,'X-QSession-Media-Failure','storage-body-read'),
                ('media-invalid-fault',503,'X-QSession-Media-Failure','shared-response')]
        for route,status,header,value in fault_specs:
            try: response=urllib.request.urlopen('http://127.0.0.1:8790/'+route,timeout=5)
            except urllib.error.HTTPError as error:response=error
            with response:
                body=response.read()
                ok=response.status==status and response.headers.get(header)==value
                ok=ok and b'private-token' not in body and b'private local fixture details' not in body
                if status==200:ok=ok and body.startswith(b'#EXTM3U') and b'qsat=v1.' in body
                faults.append({'case':route,'status':response.status,'passed':ok})
        if delivery=='r2-edge' and scenario!='normal':
            for route in ('r2-read-fault','r2-stream-fault','r2-short-fault'):
                try:response=urllib.request.urlopen('http://127.0.0.1:8790/'+route,timeout=8)
                except urllib.error.HTTPError as error:response=error
                with response:
                    body=response.read()
                    faults.append({'case':route,'status':response.status,'passed':response.status==503 and b'private local' not in body})
        recovery_checks=[]
        if delivery=='r2-edge' and scenario!='normal':
            for route in ('cache-discard','cache-reject','cache-read-error'):
                with urllib.request.urlopen('http://127.0.0.1:8790/stats',timeout=3) as response:
                    before=json.loads(response.read(4096))
                def recover(index):
                    try:
                        with urllib.request.urlopen('http://127.0.0.1:8790/'+route+'?client='+str(index),timeout=8) as response:
                            body=response.read()
                            return (response.status==200 and len(body)==len(segment)
                                and hashlib.sha256(body).digest()==segment_digest
                                and response.headers.get('X-QSession-Cache-Fill')=='r2-edge')
                    except Exception:
                        return False
                with concurrent.futures.ThreadPoolExecutor(max_workers=64) as executor:
                    recovered=list(executor.map(recover,range(64)))
                with urllib.request.urlopen('http://127.0.0.1:8790/stats',timeout=3) as response:
                    after=json.loads(response.read(4096))
                reads=after['storageReads']-before['storageReads']
                recovery_checks.append({'case':route,'requests':len(recovered),
                    'fullBodiesVerified':sum(recovered),'sharedOriginReads':reads,
                    'passed':all(recovered) and reads==1})
            if not all(check['passed'] for check in recovery_checks):
                report['verifiedBodyRecoveryFailed']=True
        report.update(completedRequests=len(outcomes),fullBodiesVerified=sum(x.get('fullBodyVerified',False) for x in outcomes),
            intentionalCancellations=sum(x.get('canceledIntentionally',False) for x in outcomes),
            failures=[x for x in outcomes if 'errorClass' in x],unauthorizedRejected=denied,
            faultInjectionCases=faults,protocolChecks=protocol_checks,verifiedBodyRecoveryChecks=recovery_checks,
            expiredTokenRejected=expired_denied)
        with urllib.request.urlopen('http://127.0.0.1:8790/stats',timeout=3) as stats_response:
            report['localCounters']=json.loads(stats_response.read(4096))
        pool=report['localCounters']['bodyPool']
        report['bodyPoolSnapshotWithinLimits']=(0<=pool['payloadBytes']<=pool['byteLimit']
            and 0<=pool['entries']<=pool['keyLimit'])
        report['passed']=not report['failures'] and denied and expired_denied and all(x['passed'] for x in faults+protocol_checks) and not report.get('localRuntimeDeadlineReached')
        if delivery=='r2-edge':report['passed']=report['passed'] and report['localCounters']['actorRequests']==0
        report['passed']=report['passed'] and report['bodyPoolSnapshotWithinLimits'] and not report.get('verifiedBodyRecoveryFailed')
    except Exception as error:
        report.update(passed=False,errorClass=type(error).__name__,startupErrors=startup_errors)
    finally:
        watchdog.cancel()
        if process.poll() is None:
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,timeout=15)
        process.wait(timeout=15);report['localRuntimeStopped']=process.poll() is not None
        thread.join(timeout=2)
        watchdog.join(timeout=16)
        # Controlled abort/body-fault cases can log connection loss. A separate
        # normal run must be clean; late stdout can never flip a passed result
        # after it has already been written.
        expected_connection_loss=scenario in ('faults','mixed') and bool(report.get('faultInjectionCases') or report.get('intentionalCancellations'))
        report['injectedRuntimeErrors']=[e for e in known_errors if expected_connection_loss and e=='network connection lost']
        report['knownRuntimeErrors']=[e for e in known_errors if not(expected_connection_loss and e=='network connection lost')]
        if thread.is_alive() or report['knownRuntimeErrors']:report['passed']=False
        if report.get('localRuntimeDeadlineReached'):report['passed']=False
        if report.get('passed') is not True:report['localRuntimeDiagnostics']=startup_errors
        destination.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
    return 0 if report.get('passed') is True else 2


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/edge-cache-context-local-20261020.json')
    parser.add_argument('--concurrency',type=int,default=64)
    parser.add_argument('--requests',type=int,default=768)
    parser.add_argument('--delivery',choices=('shared','r2-edge'),default='shared')
    parser.add_argument('--scenario',choices=('normal','faults','mixed'),default='mixed')
    args=parser.parse_args()
    raise SystemExit(main(args.output,args.concurrency,args.requests,args.delivery,args.scenario))
