"""Refresh or retire ONLY the seven UUIDs of the current guarded batch."""
import argparse
import json
import pathlib
import subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
LEDGER=ROOT/'release/load-generators-guarded-20261020.json'
SSH=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes',
     '-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','root@45.77.192.82']
REMOTE=r'''
import datetime,hashlib,importlib.util,json,pathlib,sys
spec=importlib.util.spec_from_file_location('guard','/opt/qsession-load-guard/retire-load-generators.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
scope=guard.validate_scope(json.loads(guard.private_text(pathlib.Path('/etc/qsession-load-guard/scope.json'))))
if hashlib.sha256(json.dumps(scope,sort_keys=True).encode()).hexdigest()!=EXPECTED_FINGERPRINT:raise SystemExit('Scope mismatch')
api=guard.Vultr(guard.private_text(pathlib.Path('/etc/qsession-load-guard/vultr.key')))
expected=set(EXPECTED_IDS)
if not 1<=len(expected)<=7:raise SystemExit('Invalid target UUID count')
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
results=[]
for identifier in expected:
 try:
  current=api.request('GET','/instances/'+identifier)
  if current is None:
   results.append({'id':identifier,'destroyed':True,'verifiedAbsentAt':now});continue
  instance=current['instance']
  if instance.get('id')!=identifier or not guard.matches(instance,scope):raise ValueError('Scope')
  if RETIRE_NOW:
   api.request('DELETE','/instances/'+identifier)
   if api.request('GET','/instances/'+identifier) is not None:raise ValueError('Deletion unconfirmed')
   results.append({'id':identifier,'destroyed':True,'verifiedAbsentAt':now});continue
  results.append({'id':identifier,'ip':instance.get('main_ip',''),'status':instance.get('status'),
                  'serverStatus':instance.get('server_status'),'destroyed':False})
 except Exception as error:
  results.append({'id':identifier,'errorClass':type(error).__name__})
print(json.dumps({'retireRequested':RETIRE_NOW,'nodes':results,'timerNotDisabled':True}))
'''

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retire-now',action='store_true')
    parser.add_argument('--inventory',type=pathlib.Path,default=LEDGER)
    args=parser.parse_args()
    ledger=json.loads(args.inventory.read_text(encoding='utf8'))
    script=REMOTE.replace('EXPECTED_FINGERPRINT',repr(ledger['retirementScopeFingerprint'])).replace(
        'EXPECTED_IDS',repr([n['id'] for n in ledger['generators']])).replace('RETIRE_NOW',repr(args.retire_now))
    result=subprocess.run(SSH+['/usr/bin/python3 -'],input=script.encode(),capture_output=True,timeout=100)
    if result.returncode:raise SystemExit('Scoped management failed; private output suppressed')
    public=json.loads(result.stdout)
    for node in public['nodes']:
        target=next(n for n in ledger['generators'] if n['id']==node['id'])
        target.update(node)
    ledger['activeCount']=sum(n.get('destroyed') is not True for n in ledger['generators'])
    args.inventory.write_text(json.dumps(ledger,indent=2)+'\n',encoding='utf8')
    print(json.dumps(public),flush=True)
    return 2 if any('errorClass' in n for n in public['nodes']) else 0

if __name__=='__main__':raise SystemExit(main())
