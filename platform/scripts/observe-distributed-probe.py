"""Record bounded Redis seat observations for PRB10A; no private data output."""
import base64
import argparse
import json
import pathlib
import subprocess
import sys
import threading

ROOT=pathlib.Path(__file__).resolve().parents[2]
code=r'''
const fs=require('node:fs');const {createClient}=require('redis');const {createBroadcastAdmissions}=require('./broadcast-admissions');
setTimeout(()=>process.exit(2),OBSERVATION_WATCHDOG_MS).unref();
(async()=>{const e=process.env,p=JSON.parse(fs.readFileSync(e.QSESSION_BROADCAST_ADMISSION_PROBE_FILE,'utf8'));
if(p.code!=='PRB10A'||p.prefix!=='live/PRB10A-hWrdBkirH_2yHmZ9lp')throw Error('scope');
const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
const a=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
let stopping=false,wakeStop,samples=0;const stopped=new Promise(resolve=>{wakeStop=resolve;});
const input=require('node:readline').createInterface({input:process.stdin});
input.on('line',line=>{if(line==='stop'){stopping=true;wakeStop();}});
try{for(let i=0;i<OBSERVATION_SAMPLES&&!stopping;i++){console.log(JSON.stringify({observedAtUnix:Date.now()/1000,active:await a.count(p),namespace:'PRB10A'}));samples++;
await new Promise(resolve=>{const timer=setTimeout(resolve,5000);stopped.then(()=>{clearTimeout(timer);resolve();});});}}
finally{input.close();await a.close();console.log(JSON.stringify({observationComplete:true,stoppedEarly:stopping,samples}));}})().catch(()=>{console.error('Probe observation failed; details suppressed');process.exitCode=1});
'''


def run_observation(command, output, duration, stop_input=None):
    """Forward a scoped stop request and always preserve collected observations."""
    report={'observations':[],'plannedDurationSeconds':duration,
            'cooperativeStopRequested':False,'stoppedEarly':False,'observationComplete':False}
    child=None
    try:
        child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        def forward_stop():
            for line in stop_input if stop_input is not None else sys.stdin:
                if line.strip()!='stop':continue
                report['cooperativeStopRequested']=True
                try:
                    child.stdin.write('stop\n');child.stdin.flush();child.stdin.close()
                except (OSError,ValueError):pass
                break
        threading.Thread(target=forward_stop,daemon=True).start()
        for line in child.stdout:
            item=json.loads(line)
            if isinstance(item,dict) and item.get('observationComplete') is True:
                report['observationComplete']=True
                report['stoppedEarly']=item.get('stoppedEarly') is True
            elif isinstance(item,dict) and item.get('namespace')=='PRB10A' and 'observedAtUnix' in item:
                report['observations'].append(item);print(json.dumps(item),flush=True)
            else:raise ValueError('Unexpected observation record')
    except Exception as error:
        report['errorClass']=type(error).__name__
    finally:
        if child is not None:
            try:child.wait(timeout=10)
            except Exception as error:
                report.setdefault('errorClass',type(error).__name__)
                for method in ('terminate','kill'):
                    try:
                        if child.poll() is not None:break
                        getattr(child,method)();child.wait(timeout=5)
                    except Exception as cleanup_error:
                        report['processCleanupErrorClass']=type(cleanup_error).__name__
            report['remoteExitCode']=child.poll()
        if not report['observationComplete']:report.setdefault('errorClass','IncompleteObservation')
        report['exitCode']=0 if report.get('remoteExitCode')==0 and not report.get('errorClass') else 2
        output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report['exitCode']


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/load-redis-observations-20261018.json')
    parser.add_argument('--duration',type=int,default=125)
    args=parser.parse_args()
    if not 125<=args.duration<=800:raise SystemExit('Invalid observation duration')
    code=code.replace('OBSERVATION_SAMPLES',str((args.duration+4)//5))
    code=code.replace('OBSERVATION_WATCHDOG_MS',str((args.duration+10)*1000))
    expr="eval(Buffer.from('"+base64.b64encode(code.encode()).decode()+"','base64').toString())"
    cmd=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','root@104.238.137.144',
         'docker exec -i qsession-qsession-app-1 node -e "'+expr+'"']
    raise SystemExit(run_observation(cmd,args.output,args.duration))
