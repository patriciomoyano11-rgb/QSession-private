"""Mint PRB10A leases and pipe directly to inventoried VMs; never log tokens.

No private keys or production storage credentials leave the operator/production.
Only expiring probe leases are sent to the disposable generators.
"""
import concurrent.futures
import argparse
import json
import pathlib
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from load_target_policy import require_staging_delivery_host, require_staging_ssh_host

ROOT=pathlib.Path(__file__).resolve().parents[2]
IDENTITY='C:/Users/maria/.ssh/qsession_deploy_ed25519'
BASE=['ssh','-T','-i',IDENTITY,'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
      '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12']


def send(node,tokens):
    command="python3 -c 'import os,json,sys;os.umask(0o077);data=json.load(sys.stdin);fd=os.open(\"/root/qsession-load-tokens.json\",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);f=os.fdopen(fd,\"w\");json.dump(data,f);f.close()'"
    try:
        result=subprocess.run(BASE+['root@'+node['ip'],command],input=json.dumps(tokens).encode(),capture_output=True,timeout=15)
    except subprocess.TimeoutExpired:
        print(json.dumps({'transferFailure':node['label'],'category':'timeout'}),file=__import__('sys').stderr,flush=True)
        raise
    if result.returncode:
        markers={b'Connection reset':'connection-reset',b'Connection timed out':'connection-timeout',
            b'Host key verification failed':'host-key-verification',b'REMOTE HOST IDENTIFICATION HAS CHANGED':'host-key-changed',
            b'Permission denied':'authentication',b'File exists':'existing-file'}
        category=next((value for marker,value in markers.items() if marker in result.stderr),'unclassified')
        print(json.dumps({'transferFailure':node['label'],'category':category,'exitCode':result.returncode}),file=__import__('sys').stderr,flush=True)
        raise RuntimeError('Token transfer failed; remote details suppressed')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,default=ROOT/'release/load-generators-active-20261018.json')
    parser.add_argument('--delivery-host', required=True,
                        help='Staging playback hostname. Production hosts are refused.')
    parser.add_argument('--admission-host', required=True,
                        help='Staging API IPv4. The production app server is refused.')
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/load-run-inventory-20261018.json')
    parser.add_argument('--mint-report',type=pathlib.Path,default=ROOT/'release/load-admission-mint-20261018.json')
    parser.add_argument('--clients', type=int, default=10000)
    parser.add_argument('--minimum-remaining-seconds', type=int, default=300)
    args=parser.parse_args()
    try:
        delivery_host = require_staging_delivery_host(args.delivery_host)
        admission_host = require_staging_ssh_host(args.admission_host)
    except ValueError as error:
        raise SystemExit(str(error))
    if not 300<=args.minimum_remaining_seconds<=900:raise SystemExit('Invalid technical lease duration bound')
    inventory=json.loads(args.inventory.read_text(encoding='utf-8-sig'))
    nodes=inventory['generators']
    if not 1<=len(nodes)<=7 or any(not n['ownedForThisTest'] or n['destroyed'] for n in nodes):
        raise SystemExit('Expected a bounded owned disposable batch')
    if not len(nodes)*4<=args.clients<=10000 or (args.clients+len(nodes)-1)//len(nodes)>1500:
        raise SystemExit('Client count exceeds the per-generator diagnostic bound')
    for i,node in enumerate(nodes):
        if node['ip'] in {'104.238.137.144','45.77.192.82','45.77.118.43'}:raise SystemExit('Production target rejected')
        node['clients']=args.clients//len(nodes)+(i<args.clients%len(nodes))
    code=(ROOT/'platform/scripts/prepare-distributed-probe.cjs').read_text()
    # Source is evaluated inside /app, so resolve the installed module there.
    code=code.replace("require('../broadcast-admissions')","require('./broadcast-admissions')")
    import base64
    encoded=base64.b64encode(code.encode()).decode()
    expression="eval(Buffer.from('"+encoded+"','base64').toString())"
    command="docker exec --env QSESSION_PROBE_TEST_CLIENTS="+str(args.clients)+" --env QSESSION_PROBE_MIN_REMAINING_SECONDS="+str(args.minimum_remaining_seconds)+" qsession-qsession-app-1 node -e \""+expression+"\""
    secret_result=subprocess.run(BASE+['root@'+admission_host,command],capture_output=True,timeout=30)
    if secret_result.returncode:raise SystemExit('Probe mint failed; private output suppressed')
    private=json.loads(secret_result.stdout)
    if len(private['tokens'])!=args.clients or private['active']!=args.clients:raise SystemExit('Incorrect lease total')
    cursor=0;tasks=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        for node in nodes:
            count=node['clients'];tasks.append(pool.submit(send,node,private['tokens'][cursor:cursor+count]));cursor+=count
        for task in tasks:task.result()
    inventory['runId']='qsession-probe-'+str(args.clients)+'-'+str(int(time.time()))
    inventory['startAtUnix']=int(time.time())+25
    inventory['deliveryHost']=delivery_host
    args.output.write_text(json.dumps(inventory,indent=2),encoding='utf-8')
    public={k:v for k,v in private.items() if k not in ('tokens','scope')}
    public.update(startAtUnix=inventory['startAtUnix'],generators=len(nodes),clientsPerNode=[n['clients'] for n in nodes],namespace='PRB10A',deliveryHost=delivery_host,certifiesProductionCapacity=False)
    args.mint_report.write_text(json.dumps(public,indent=2),encoding='utf-8')
    print(json.dumps(public),flush=True)
