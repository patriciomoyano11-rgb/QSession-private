"""Verify zero disposable VMs before stopping the timer/removing its key."""
import json
import argparse
import inspect
import pathlib
import subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
LEDGER=ROOT/'release/load-generators-guarded-20261020.json'


def collect_timer_evidence(output, run_id, expected):
    """Combine confirmed deletions from valid apply checks of this exact batch."""
    deleted, evidence = set(), []
    for line in output.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if (not isinstance(row, dict) or row.get('runId') != run_id
                or row.get('apply') is not True or row.get('due') is not True):
            continue
        groups = [row.get(name) for name in ('deleted', 'pending', 'errors')]
        if any(not isinstance(group, list) or any(not isinstance(item, str) for item in group)
               for group in groups):
            continue
        completed, pending, errors = groups
        if (len(set(completed)) != len(completed) or len(set(pending)) != len(pending)
                or not set(completed) <= expected or not set(pending) <= expected
                or set(completed) & set(pending)):
            continue
        if completed:
            deleted.update(completed)
            evidence.append(row)
    if deleted != expected:
        raise ValueError('Independent timer deletion evidence missing')
    return {'runId': run_id, 'due': True, 'apply': True, 'deleted': sorted(deleted),
            'pending': [], 'errors': [], 'contributingTimerChecks': len(evidence),
            'checks': evidence}


REMOTE=inspect.getsource(collect_timer_evidence)+r'''
import datetime,hashlib,importlib.util,json,pathlib,subprocess
spec=importlib.util.spec_from_file_location('guard','/opt/qsession-load-guard/retire-load-generators.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
directory=pathlib.Path('/etc/qsession-load-guard');file=directory/'scope.json'
scope=guard.validate_scope(json.loads(guard.private_text(file)))
if hashlib.sha256(json.dumps(scope,sort_keys=True).encode()).hexdigest()!=EXPECTED_FINGERPRINT:raise SystemExit('Scope mismatch')
api=guard.Vultr(guard.private_text(directory/'vultr.key'))
expected=set(EXPECTED_IDS)
if not 1<=len(expected)<=scope['maximumInstances']:raise SystemExit('Invalid bounded inventory')
if any(api.request('GET','/instances/'+identifier) is not None for identifier in expected):raise SystemExit('Disposable remains; leave timer and key active')
inventory=api.instances()
if any(scope['tag'] in n.get('tags',[]) for n in inventory):raise SystemExit('Unknown tagged target remains; leave guard active')
permanent=[{'id':n['id'],'label':n['label'],'ip':n.get('main_ip'),'status':n.get('status'),'serverStatus':n.get('server_status')} for n in inventory]
if {n['ip'] for n in permanent}!=guard.PERMANENT_IPS or len(permanent)!=3 or any(n['serverStatus']!='ok' for n in permanent):raise SystemExit('Permanent inventory changed; do not close guard')
journal=subprocess.run(['journalctl','-u','qsession-load-retirement.service','-n','40','--no-pager','-o','cat'],capture_output=True,text=True,timeout=10)
if journal.returncode:raise SystemExit('Independent timer journal unavailable')
try:evidence=collect_timer_evidence(journal.stdout,scope['runId'],expected)
except ValueError:raise SystemExit('Independent timer deletion evidence missing')
subprocess.run(['systemctl','disable','--now','qsession-load-retirement.timer'],capture_output=True,check=True,timeout=20)
subprocess.run(['systemctl','stop','qsession-load-retirement.service'],capture_output=True,check=True,timeout=20)
for target in (directory/'vultr.key',file):
 guard.private_text(target);target.unlink()
print(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'temporaryGeneratorsRemaining':0,
 'independentTimerDeletedAllTargets':True,'independentTimerDeletedAllSeven':len(expected)==7,'timerDeletionEvidence':evidence,
 'permanentServers':permanent,'timerDisabledAfterRetirementVerified':True,
 'remoteApiCredentialRemoved':True,'remoteScopeRemoved':True,'providerCredentialRevocationStillRequired':True}))
'''

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--inventory',type=pathlib.Path,default=LEDGER)
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/guarded-retirement-verified-20261020.json')
    args=parser.parse_args()
    ledger=json.loads(args.inventory.read_text(encoding='utf8'))
    if ledger['activeCount']!=0 or any(n.get('destroyed') is not True for n in ledger['generators']):
        raise SystemExit('Local verified absence required before finalization')
    script=REMOTE.replace('EXPECTED_FINGERPRINT',repr(ledger['retirementScopeFingerprint'])).replace('EXPECTED_IDS',repr([n['id'] for n in ledger['generators']]))
    result=subprocess.run(['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes',
        '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','root@45.77.192.82','/usr/bin/python3 -'],
        input=script.encode(),capture_output=True,timeout=60)
    if result.returncode:raise SystemExit('Guard finalization unconfirmed; details suppressed')
    report=json.loads(result.stdout)
    args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report))

if __name__=='__main__':main()
