"""Private-network encoder replacement with one continuing AV decoder.

Never accesses production. Does not certify browser or physical-device recovery.
"""
import functools
import http.server
import json
import os
import pathlib
import secrets
import signal
import socket
import subprocess
import threading
import time
import urllib.request

ROOT=pathlib.Path('/root/qsession-recovery-20261018')
NETWORK='qsession-recovery-net'
NAMES=('qsession-recovery-redis','qsession-recovery-livekit','qsession-recovery-egress-a','qsession-recovery-egress-b')
APP='qsession-recovery-sdk:20261018'
IMAGES=json.loads((ROOT/'runtime.json').read_text())['images']


def docker(*args,timeout=60):
    result=subprocess.run(['docker',*args],capture_output=True,timeout=timeout)
    if result.returncode:raise RuntimeError('Isolated Docker operation failed; details suppressed')
    return result.stdout


def run(name,image,*args):
    if name not in NAMES:raise ValueError('Scope')
    return docker('run','-d','--name',name,'--label','qsession.recovery=20261018','--network',NETWORK,*args,image).decode().strip()


def inspect_ip(name):
    return json.loads(docker('inspect',name))[0]['NetworkSettings']['Networks'][NETWORK]['IPAddress']


def control(action,argument=None):
    args=['run','--rm','--network',NETWORK,'-v',str(ROOT/'control.json')+':/lab/control.json:ro',
          '-v','/root/recovery-control.cjs:/lab/control.cjs:ro','--entrypoint','node',APP,'/lab/control.cjs',action]
    if argument:args.append(argument)
    return json.loads(docker(*args,timeout=60))


def manifest():
    path=ROOT/'media/index.m3u8'
    if not path.exists():return None
    text=path.read_text();uris=[line.strip() for line in text.splitlines() if line and not line.startswith('#')]
    return {'mtime':path.stat().st_mtime,'last':uris[-1] if uris else None,'hasEndlist':'#EXT-X-ENDLIST' in text}


def await_manifest(encoder,timeout=40):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        value=manifest()
        if value and value['last'] and '/segment_'+encoder+'_' in '/'+value['last'] and time.time()-value['mtime']<12:return value
        time.sleep(.25)
    raise RuntimeError('Fresh isolated manifest missing')


def decode():
    result=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostats','-progress','pipe:1',
        '-i','http://127.0.0.1:8098/index.m3u8','-t','4','-map','0:v:0','-map','0:a:0','-f','null','-'],capture_output=True,timeout=30)
    progress={}
    for line in result.stdout.decode().splitlines():
        if '=' in line:
            key,value=line.split('=',1);progress[key]=value
    frames=int(progress.get('frame','0'));decoded=int(progress.get('out_time_us','0'))/1000000
    if result.returncode or frames<90 or decoded<3.5:raise RuntimeError('Synthetic audio/video decode failed')
    return {'videoFrames':frames,'decodedAudioVideoSeconds':decoded,'exitCode':result.returncode,'receiverOpenedFresh':True}


def await_health(name):
    endpoint='http://'+inspect_ip(name)+':8081/'
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        try:
            with urllib.request.urlopen(urllib.request.Request(endpoint,method='HEAD'),timeout=1) as response:
                if response.status==200:return
        except OSError:time.sleep(.25)
    raise RuntimeError('Isolated encoder did not become healthy')


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass


class ContinuingDecoder:
    def __init__(self):
        self.frames={'audio':0,'video':0}
        self.replacement_segment_read=False
        self.process=subprocess.Popen(['ffprobe','-v','info','-live_start_index','-1',
            '-max_reload','100','-m3u8_hold_counters','100','-show_frames',
            '-show_entries','frame=media_type','-of','compact=p=0:nk=0',
            'http://127.0.0.1:8098/index.m3u8'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        def frames():
            for line in self.process.stdout:
                for kind in ('audio','video'):
                    if 'media_type='+kind in line:self.frames[kind]+=1
        def sources():
            for line in self.process.stderr:
                if 'Opening ' in line and 'segment_b_' in line:self.replacement_segment_read=True
        self.threads=[threading.Thread(target=frames,daemon=True),threading.Thread(target=sources,daemon=True)]
        for thread in self.threads:thread.start()

    def snapshot(self):
        return {**self.frames,'pid':self.process.pid,'alive':self.process.poll() is None,
                'replacementSegmentRead':self.replacement_segment_read}

    def await_frames(self,baseline=None,require_replacement=False,timeout=90):
        baseline=baseline or {'audio':0,'video':0}
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline and self.process.poll() is None:
            current=self.snapshot()
            if (current['audio']-baseline['audio']>=120 and current['video']-baseline['video']>=90
                and (not require_replacement or current['replacementSegmentRead'])):return current
            time.sleep(.25)
        raise RuntimeError('Continuing decoder did not recover both audio and video')

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:self.process.kill();self.process.wait(timeout=3)
        for thread in self.threads:thread.join(timeout=2)


def main():
    if socket.gethostname()!='qsession-load-20261018-cf2-chi1' or os.getuid()!=0:raise ValueError('Scope')
    if (ROOT/'control.json').exists():raise ValueError('A previous rehearsal must be reviewed first')
    os.umask(0o077);key='lab'+secrets.token_hex(8);secret=secrets.token_hex(32)
    os.chown('/root/recovery-control.cjs',1000,1000);pathlib.Path('/root/recovery-control.cjs').chmod(0o400)
    control_data={'apiUrl':'http://livekit:7885','room':'qsession-LAB10A','identity':'dj-synthetic-rehearsal','key':key,'secret':secret}
    (ROOT/'control.json').write_text(json.dumps(control_data));os.chown(ROOT/'control.json',1000,1000);(ROOT/'control.json').chmod(0o400)
    (ROOT/'livekit.json').write_text(json.dumps({'port':7885,'rtc':{'tcp_port':7886,'port_range_start':55100,'port_range_end':55150,'use_external_ip':False},
       'redis':{'address':'redis:6379'},'keys':{key:secret},'logging':{'level':'warn'}}));(ROOT/'livekit.json').chmod(0o644)
    (ROOT/'egress.json').write_text(json.dumps({'api_key':key,'api_secret':secret,'ws_url':'ws://livekit:7885','redis':{'address':'redis:6379'},'health_port':8081,'prometheus_port':9091,'log_level':'warn'}));os.chown(ROOT/'egress.json',1001,0);(ROOT/'egress.json').chmod(0o400)
    (ROOT/'media').mkdir(mode=0o2775);os.chown(ROOT/'media',1001,0);(ROOT/'media').chmod(0o2775)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',8098),functools.partial(QuietHandler,directory=str(ROOT/'media')))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    publisher=None;continuing=None
    report={'startedAtUnix':time.time(),'productionChanged':False,'publicPortsPublished':False,'syntheticAudioVideo':True,
            'manualEncoderReplacement':True,'automaticFailoverTested':False,'continuousClientRecoveryTested':False,'physicalDeviceRecoveryTested':False,
            'certifiesProductionCapacity':False,'images':IMAGES,'productionAppImageUsed':False,
            'controllerSdkVersion':'2.18.0','profile':{'width':1280,'height':720,'fps':30,'videoKbps':1600,'audioKbps':128,'segmentSeconds':6}}
    try:
        docker('network','create','--internal','--label','qsession.recovery=20261018',NETWORK)
        run(NAMES[0],'redis:7-alpine','--network-alias','redis')
        report['stage']='private-livekit-startup'
        docker('run','-d','--name',NAMES[1],'--label','qsession.recovery=20261018','--network',NETWORK,'--network-alias','livekit',
               '-v',str(ROOT/'livekit.json')+':/etc/livekit.yaml:ro',IMAGES['livekit-server'],'--config','/etc/livekit.yaml')
        ip=inspect_ip(NAMES[1]);deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            try:
                with urllib.request.urlopen('http://'+ip+':7885',timeout=1) as response:
                    if response.status==200:break
            except OSError:time.sleep(.25)
        private=control('prepare');(ROOT/'publisher.json').write_text(json.dumps({'url':'ws://'+ip+':7885','token':private['token']}));del private
        with open(ROOT/'publisher.log','xb') as log:
            publisher=subprocess.Popen(['/usr/bin/timeout','--signal=TERM','--kill-after=5s','260s',str(ROOT/'venv/bin/python'),'/root/recovery-publisher.py'],stdout=log,stderr=subprocess.DEVNULL,start_new_session=True)
        deadline=time.monotonic()+25
        while time.monotonic()<deadline:
            if 'syntheticPublisherReady' in (ROOT/'publisher.log').read_text():break
            if publisher.poll() is not None:raise RuntimeError('Synthetic publisher stopped')
            time.sleep(.25)
        report['stage']='first-encoder-startup'
        for name in NAMES[2:3]:
            run(name,IMAGES['egress'],'--cpus','2','--memory','3072m','--shm-size','1g','-e','EGRESS_CONFIG_FILE=/etc/egress.yaml',
                '-v',str(ROOT/'egress.json')+':/etc/egress.yaml:ro','-v',str(ROOT/'media')+':/out/rehearsal')
        await_health(NAMES[2]);report['stage']='first-encoder-job'
        first=control('start','a');await_manifest('a');report['initialDecoder']=decode()
        continuing=ContinuingDecoder();report['continuousClientRecoveryTested']=True
        report['continuousClientRecoveryPassed']=False
        report['continuingDecoderInitial']=continuing.await_frames(timeout=25)
        report['firstEgressId']=first['egressId']
        run(NAMES[3],IMAGES['egress'],'--cpus','2','--memory','3072m','--shm-size','1g','-e','EGRESS_CONFIG_FILE=/etc/egress.yaml',
            '-v',str(ROOT/'egress.json')+':/etc/egress.yaml:ro','-v',str(ROOT/'media')+':/out/rehearsal')
        await_health(NAMES[3]);report['stage']='forced-private-encoder-failure'
        failed_at=time.time();docker('kill','--signal','KILL',NAMES[2]);report['encoderKilledAtUnix']=failed_at
        report['continuingDecoderAtFailure']=continuing.snapshot()
        observed=manifest();last=observed['last'];deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            observed=manifest()
            if observed['last']==last and time.time()-observed['mtime']>=18:break
            last=observed['last'];time.sleep(.5)
        assert time.time()-observed['mtime']>=18 and not observed['hasEndlist']
        report['frozenManifestDetectedAfterSeconds']=round(time.time()-failed_at,3)
        report['stage']='manual-encoder-replacement'
        replacement=control('start','b');await_manifest('b');report['replacementEgressId']=replacement['egressId']
        report['freshManifestAfterFailureSeconds']=round(time.time()-failed_at,3)
        report['replacementDecoder']=decode();report['decodedRecoveryAfterFailureSeconds']=round(time.time()-failed_at,3)
        baseline=continuing.snapshot();report['continuingDecoderBeforeRecoveryObservation']=baseline
        report['continuingDecoderRecovered']=continuing.await_frames(baseline,require_replacement=True,timeout=90)
        report['continuousClientRecoveryAfterFailureSeconds']=round(time.time()-failed_at,3)
        report['continuousClientRecoveryTested']=True
        report['continuingDecoderProcessUnchanged']=(report['continuingDecoderInitial']['pid']==report['continuingDecoderRecovered']['pid'])
        if not report['continuingDecoderProcessUnchanged']:raise RuntimeError('Decoder was replaced')
        report['continuousClientRecoveryPassed']=True
        report['publisherStayedConnected']=publisher.poll() is None
        assert report['publisherStayedConnected'];report['passed']=True
    except Exception as error:report.update(passed=False,errorClass=type(error).__name__)
    finally:
        if continuing:
            report['continuingDecoderFinal']=continuing.snapshot()
            continuing.close()
        if publisher and publisher.poll() is None:
            os.killpg(publisher.pid,signal.SIGTERM)
            try:publisher.wait(timeout=8)
            except subprocess.TimeoutExpired:os.killpg(publisher.pid,signal.SIGKILL);publisher.wait(timeout=3)
        for name in reversed(NAMES):
            result=subprocess.run(['docker','inspect',name],capture_output=True,timeout=10)
            if not result.returncode:
                metadata=json.loads(result.stdout)[0]
                if metadata['Config'].get('Labels',{}).get('qsession.recovery')!='20261018':report['cleanupError']='ownership-mismatch';continue
                docker('rm','-f',name)
        result=subprocess.run(['docker','network','inspect',NETWORK],capture_output=True,timeout=10)
        if not result.returncode:
            metadata=json.loads(result.stdout)[0]
            if metadata.get('Labels',{}).get('qsession.recovery')=='20261018':docker('network','rm',NETWORK)
        server.shutdown();server.server_close();thread.join()
        report['endedAtUnix']=time.time();(ROOT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
    return 0 if report.get('passed') else 2


if __name__=='__main__':raise SystemExit(main())
