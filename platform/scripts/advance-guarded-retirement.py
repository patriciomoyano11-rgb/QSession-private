"""Shorten the current batch's deadline; never extend it or stop its timer.

Run only after load/lease/storage cleanup. Actual destruction is performed by
the already installed timer on its next independent minute tick.
"""
import json
import argparse
import pathlib
import subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
LEDGER=ROOT/'release/load-generators-guarded-20261020.json'
REMOTE=r'''
import datetime,hashlib,importlib.util,json,os,pathlib,subprocess
spec=importlib.util.spec_from_file_location('guard','/opt/qsession-load-guard/retire-load-generators.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
file=pathlib.Path('/etc/qsession-load-guard/scope.json')
scope=guard.validate_scope(json.loads(guard.private_text(file)))
if hashlib.sha256(json.dumps(scope,sort_keys=True).encode()).hexdigest()!=EXPECTED_FINGERPRINT:raise SystemExit('Scope mismatch')
now=datetime.datetime.now(datetime.timezone.utc)
if not guard.instant(scope['notBefore'])+300<=now.timestamp()<guard.instant(scope['retireAt']):raise SystemExit('Only shorten a future valid deadline')
if subprocess.run(['systemctl','is-active','--quiet','qsession-load-retirement.timer']).returncode:raise SystemExit('Timer not active')
old=scope['retireAt'];scope['retireAt']=now.isoformat();guard.validate_scope(scope)
temporary=file.with_name('scope.early-retirement.json')
fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as output:json.dump(scope,output);output.flush();os.fsync(output.fileno())
os.replace(temporary,file)
print(json.dumps({'previousRetireAt':old,'scope':scope,'scopeFingerprint':hashlib.sha256(json.dumps(scope,sort_keys=True).encode()).hexdigest(),
                  'timerRemainsActive':True,'destructionWillRunOnIndependentTimer':True}))
'''

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--inventory',type=pathlib.Path,default=LEDGER)
    parser.add_argument('--execution',type=pathlib.Path,default=ROOT/'release/custom-domain-load-execution-shared-edge-aiohttp-20261020.json')
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/guarded-retirement-scheduled-20261020.json')
    args=parser.parse_args()
    last=json.loads(args.execution.read_text(encoding='utf8'))
    cleaned=last.get('leaseCleanup',[])
    if (last.get('leaseCleanupExitCode')!=0 or not cleaned or cleaned[0].get('activeAfter')!=0 or
        cleaned[0].get('privateMasterFileRemoved') is not True or
        not all(n.get('privateLeaseFileRemoved') is True for n in cleaned[1:]) or
        last.get('origin',{}).get('cleanupComplete') is not True):
        raise SystemExit('Scoped load cleanup must finish before retirement')
    ledger=json.loads(args.inventory.read_text(encoding='utf8'))
    script=REMOTE.replace('EXPECTED_FINGERPRINT',repr(ledger['retirementScopeFingerprint']))
    result=subprocess.run(['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes',
        '-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12',
        'root@45.77.192.82','/usr/bin/python3 -'],input=script.encode(),capture_output=True,timeout=25)
    if result.returncode:raise SystemExit('Deadline not changed; remote output suppressed')
    public=json.loads(result.stdout)
    ledger['scope']=public['scope'];ledger['retirementScopeFingerprint']=public['scopeFingerprint']
    ledger['earlyRetirementScheduled']=True
    args.inventory.write_text(json.dumps(ledger,indent=2)+'\n',encoding='utf8')
    args.output.write_text(json.dumps(public,indent=2)+'\n',encoding='utf8')
    print(json.dumps(public),flush=True)

if __name__=='__main__':main()
