"""Upload and run only the isolated public-SDK recovery lab on its owned VM."""
import argparse
import base64
import hashlib
import json
import pathlib
import shlex
import subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes',
     '-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12']
LABEL='qsession-load-20261018-cf2-chi1'
NAMES=('recovery-control.cjs','recovery-publisher.py','rehearse-encoder-recovery.py')

def main(args):
    inventory=json.loads(args.inventory.read_text(encoding='utf-8-sig'))
    matches=[node for node in inventory['generators'] if node['label']==LABEL]
    if len(matches)!=1:raise ValueError('Scope')
    node=matches[0]
    if (not node.get('ownedForThisTest') or node.get('destroyed') or not node.get('sshReady')
        or node['ip'] in {'104.238.137.144','45.77.192.82','45.77.118.43'}):raise ValueError('Scope')
    payload={name:base64.b64encode((ROOT/'platform/scripts'/name).read_bytes()).decode() for name in NAMES}
    upload=r'''
import base64,json,os,pathlib,py_compile,socket,stat,sys,hashlib
if socket.gethostname()!='qsession-load-20261018-cf2-chi1':raise ValueError('Scope')
items=json.load(sys.stdin)
if set(items)!={'recovery-control.cjs','recovery-publisher.py','rehearse-encoder-recovery.py'}:raise ValueError('Scope')
out=[]
for name,encoded in items.items():
 data=base64.b64decode(encoded,validate=True);path=pathlib.Path('/root')/name
 if len(data)>100000:raise ValueError('Oversize')
 if path.exists():
  info=path.lstat()
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0:raise ValueError('Ownership')
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as handle:handle.write(data)
 path.chmod(0o600)
 if name.endswith('.py'):py_compile.compile(str(path),doraise=True)
 out.append({'file':name,'sha256':hashlib.sha256(data).hexdigest()})
print(json.dumps({'labToolsUploaded':out,'productionDataTransferred':False}))
'''
    result=subprocess.run(SSH+['root@'+node['ip'],'python3 -c '+shlex.quote(upload)],
        input=json.dumps(payload).encode(),capture_output=True,timeout=30)
    if result.returncode:raise RuntimeError('Scoped upload failed; details suppressed')
    print(result.stdout.decode().strip(),flush=True)
    if not args.run:return 0
    result=subprocess.run(SSH+['root@'+node['ip'],
        'timeout --signal=INT --kill-after=20s 300s python3 /root/rehearse-encoder-recovery.py'],
        capture_output=True,timeout=330)
    if result.returncode not in (0,2):raise RuntimeError('Scoped rehearsal did not finish cleanly; details suppressed')
    report=json.loads(result.stdout)
    if report.get('productionChanged') is not False or report.get('publicPortsPublished') is not False:
        raise RuntimeError('Unexpected rehearsal scope')
    args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'report':str(args.output),'passed':report.get('passed'),
        'stage':report.get('stage'),'errorClass':report.get('errorClass'),
        'continuousClientRecoveryTested':report.get('continuousClientRecoveryTested'),
        'temporaryVmDestructionStillRequired':True}),flush=True)
    return 0 if report.get('passed') else 2

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    parser.add_argument('--run',action='store_true')
    raise SystemExit(main(parser.parse_args()))
