"""Disposable-VM-only rehearsal with real Redis and the two pinned app images.

Synthetic readiness fixtures exercise implementation; they do not approve any
production capacity. No production keys, user data or public endpoints are used.
"""
import asyncio
import collections
import hashlib
import json
import math
import os
import pathlib
import secrets
import socket
import sys
import subprocess
import time
import urllib.request
import urllib.error
import aiohttp

RUN=sys.argv[1] if len(sys.argv)>1 else '20261018'
if RUN not in ('20261018','20261018b','20261018c','20261018d'):raise ValueError('Bounded rehearsal run only')
ROOT=pathlib.Path('/root/qsession-rehearsal-'+RUN)
APP='qsession-rehearsal-app'
REDIS='qsession-rehearsal-redis'
CANDIDATE='qsession-app:qsession-20261018-camera-clock-v4'
ROLLBACK='qsession-app:qsession-20261018-edge-video-v2'
URL='http://127.0.0.1:8095'
CODE='TEN10A'
PREFIX='live/TEN10A-xxxxxxxxxxxxxxxxxx/'
JOIN='/api/rooms/TEN10A/media-token'
CHECK='/api/broadcast/admissions/check'
RELEASE='/api/broadcast/admissions/release'


def docker(*args):
    result=subprocess.run(['docker',*args],capture_output=True,timeout=90)
    if result.returncode:raise RuntimeError('Docker operation failed; private output suppressed')
    return result.stdout


def owned_remove(name):
    if name not in (APP,REDIS):raise ValueError('Scope')
    result=subprocess.run(['docker','inspect',name],capture_output=True,timeout=10)
    if result.returncode:return
    metadata=json.loads(result.stdout)[0]
    if metadata['Config'].get('Labels',{}).get('qsession.rehearsal')!='20261018':raise ValueError('Container ownership mismatch')
    docker('rm','-f',name)


def request(path,body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(URL+path,data=data,headers={'Content-Type':'application/json'})
    try:response=urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as error:response=error
    with response:
        payload=response.read(65537)
        if len(payload)>65536:raise ValueError('Oversize local response')
        return response.status,json.loads(payload),response.headers


def count():
    # Public room metrics intentionally cache for five seconds. Query the real
    # isolated Redis scope for assertions about immediate seat ownership.
    code=r"""
const {createProductStore}=require('./product-store');const {createBroadcastAdmissions}=require('./broadcast-admissions');const e=process.env;
if(e.QSESSION_REHEARSAL!=='isolated-20261018'||e.QSESSION_REDIS_URL!=='redis://127.0.0.1:6711')throw Error('scope');
const room=createProductStore({filePath:'/lab/data/state.json',authPepper:e.QSESSION_REHEARSAL_SECRET}).getRoomRecord('TEN10A');
const a=createBroadcastAdmissions({redisUrl:e.QSESSION_REDIS_URL,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
(async()=>{try{console.log(await a.count({code:'TEN10A',prefix:'live/TEN10A-xxxxxxxxxxxxxxxxxx',generation:room.id}));}finally{await a.close();}})().catch(()=>process.exitCode=1);
"""
    return int(docker('exec',APP,'node','-e',code).decode().strip())


def start_app(image,paused):
    if image not in (CANDIDATE,ROLLBACK):raise ValueError('Pinned image only')
    owned_remove(APP)
    docker('run','-d','--name',APP,'--label','qsession.rehearsal=20261018','--network','host',
           '--cpus','2','--memory','1536m','--env-file',str(ROOT/'private.env'),
           '-e','QSESSION_CDN_ONLY_PAUSED='+str(paused).lower(),
           '-v',str(ROOT)+':/lab','--entrypoint','node',image,'/lab/bootstrap.cjs')
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        try:
            if request('/api/status')[0]==200:return
        except (OSError,ValueError):pass
        time.sleep(.25)
    raise RuntimeError('Isolated app did not become ready')


def admitted():
    status,body,_=request(JOIN,{'role':'listener'})
    assert status==200 and body['transport']=='hls' and body['permissions']==['listen']
    assert 'token' not in body and body['delivery']['fallback'] is None
    return body['delivery']['admissionToken']


def check(token):return request(CHECK,{'token':token,'objectKey':PREFIX+'index.m3u8'})[0]


async def burst():
    semaphore=asyncio.Semaphore(64)
    started=time.monotonic();tokens=[None]*10000;latencies=[];statuses=collections.Counter();errors=collections.Counter()
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10),connector=aiohttp.TCPConnector(limit=64)) as session:
        async def join(index):
            await asyncio.sleep(max(0,started+index*30/10000-time.monotonic()))
            async with semaphore:
                began=time.monotonic()
                try:
                    async with session.post(URL+JOIN,json={'role':'listener'}) as response:
                        statuses[str(response.status)]+=1
                        body=await response.json()
                        assert response.status==200 and body.get('permissions')==['listen'] and 'token' not in body
                        assert body['delivery']['fallback'] is None and body['transport']=='hls'
                        tokens[index]=body['delivery']['admissionToken']
                        latencies.append((time.monotonic()-began)*1000)
                except Exception as error:errors[type(error).__name__]+=1
        await asyncio.gather(*(join(i) for i in range(10000)))
        elapsed=time.monotonic()-started
        assert all(tokens) and not errors
        active=count();assert active==10000
        assert request(JOIN,{'role':'listener'})[0]==429
        resumed=request(JOIN,{'role':'listener','previousAdmissionToken':tokens[0]})
        assert resumed[0]==200 and resumed[1]['delivery']['admissionToken']==tokens[0] and count()==10000
        async def release(token):
            async with semaphore:
                async with session.post(URL+RELEASE,json={'token':token}) as response:
                    assert response.status==200 and (await response.json())['released'] is True
        await asyncio.gather(*(release(token) for token in tokens))
    assert count()==0
    latencies.sort()
    return {'requested':10000,'httpStatuses':dict(statuses),'errors':dict(errors),'elapsedSeconds':round(elapsed,3),
            'joinWindowSeconds':max(31,math.ceil(elapsed)),'pacingWindowSeconds':30,'network':'loopback-only','observedJoinsPerSecond':round(10000/elapsed,2),
            'latencyMs':{str(p):round(latencies[min(len(latencies)-1,int((len(latencies)-1)*p/100))],2) for p in (50,95,99)},
            'activeAtCapacity':active,'overflowStatus':429,'resumeKeepsSameLease':True,'activeAfterRelease':0,
            'sfuCredentialsReturned':0,'decodedPlaybackTested':False}


def main():
    if socket.gethostname()!='qsession-load-20261018-atl-2' or os.getuid()!=0:raise ValueError('Disposable VM scope only')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700,exist_ok=False)
    os.chown(ROOT,1000,1000)
    (ROOT/'data').mkdir(mode=0o700);os.chown(ROOT/'data',1000,1000)
    bootstrap=pathlib.Path('/root/rehearsal-app.cjs').read_bytes()
    (ROOT/'bootstrap.cjs').write_bytes(bootstrap);os.chown(ROOT/'bootstrap.cjs',1000,1000);(ROOT/'bootstrap.cjs').chmod(0o400)
    (ROOT/'private.env').write_text('QSESSION_REHEARSAL=isolated-20261018\nQSESSION_REDIS_URL=redis://127.0.0.1:6711\nQSESSION_BROADCAST_ADMISSION_SECRET='+secrets.token_hex(32)+'\nQSESSION_REHEARSAL_SECRET='+secrets.token_hex(32)+'\n')
    report={'syntheticReadinessFixtureUsed':True,'productionChanged':False,'certifiesProductionCapacity':False,
            'candidate':CANDIDATE,'rollbackImage':ROLLBACK,'appCpuLimit':2,'appMemoryLimitMiB':1536,'startedAtUnix':time.time()}
    try:
        docker('pull','redis:7-alpine')
        docker('run','-d','--name',REDIS,'--label','qsession.rehearsal=20261018','--network','host',
               '-v',str(ROOT/'redis')+':/data','redis:7-alpine','redis-server','--bind','127.0.0.1','--port','6711','--save','','--appendonly','yes')
        start_app(CANDIDATE,False)
        tokens=[admitted(),admitted()];assert count()==2 and all(check(t)==200 for t in tokens)
        start_app(CANDIDATE,True)
        paused=request(JOIN,{'role':'listener'})
        assert paused[0]==503 and paused[2].get('Retry-After')=='30' and 'token' not in paused[1]
        assert count()==2 and all(check(t)==200 for t in tokens)
        report['pause']={'newJoinStatus':503,'retryAfterSeconds':30,'existingLeaseCheckStatuses':[200,200],'active':2}
        start_app(ROLLBACK,True)
        assert count()==2 and all(check(t)==200 for t in tokens) and request(JOIN,{'role':'listener'})[0]==503
        report['rollback']={'sameRedisLeasesPreserved':True,'existingLeaseCheckStatuses':[200,200],'active':2,'newJoinWhilePaused':503}
        start_app(CANDIDATE,False)
        restored_count=count();restored_checks=[check(t) for t in tokens]
        report['restoreObservation']={'active':restored_count,'existingCheckStatuses':restored_checks}
        assert restored_count==2 and restored_checks==[200,200]
        resumed=request(JOIN,{'role':'listener','previousAdmissionToken':tokens[0]})
        report['resumeObservation']={'status':resumed[0],'sameToken':resumed[1].get('delivery',{}).get('admissionToken')==tokens[0],'active':count()}
        assert resumed[0]==200 and resumed[1]['delivery']['admissionToken']==tokens[0] and count()==2
        tokens.append(admitted());report['newJoinObservation']={'active':count()};assert count()==3
        for token in tokens:assert request(RELEASE,{'token':token})[0]==200
        report['releaseObservation']={'active':count()};assert count()==0
        report['restoredCandidate']={'newAdmissionsReopened':True,'resumptionDidNotDuplicateSeat':True,'activeAfterRelease':0}
        before_state=hashlib.sha256((ROOT/'data/state.json').read_bytes()).hexdigest()
        report['httpJoinBurst']=asyncio.run(burst())
        report['joinStateFileUnchanged']=hashlib.sha256((ROOT/'data/state.json').read_bytes()).hexdigest()==before_state
        report['sfuActivityQueries']=len((ROOT/'data/sfu-calls.txt').read_text().splitlines()) if (ROOT/'data/sfu-calls.txt').exists() else 0
        assert report['joinStateFileUnchanged'] and report['sfuActivityQueries']==0
        room=request('/api/rooms/'+CODE)[1]['room']
        report['commercialPlanPreserved']=room['billingPlan']['maxParticipants']==25
        assert report['commercialPlanPreserved']
        report['passed']=True
    except Exception as error:
        report.update(passed=False,errorClass=type(error).__name__)
    finally:
        for name in (APP,REDIS):
            try:owned_remove(name)
            except Exception as error:report['cleanupErrorClass']=type(error).__name__
        report['endedAtUnix']=time.time()
        (ROOT/'report.json').write_text(json.dumps(report,indent=2))
        print(json.dumps(report),flush=True)
    return 0 if report.get('passed') and 'cleanupErrorClass' not in report else 2


if __name__=='__main__':raise SystemExit(main())
