"""Check only inventoried disposable VMs and upload the bounded HTTP client."""
import concurrent.futures
import argparse
import datetime
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
IDENTITY = 'C:/Users/maria/.ssh/qsession_deploy_ed25519'


def check_scope(node):
    if not node['ownedForThisTest'] or node.get('destroyed') is True or not re.fullmatch(r'qsession-load-\d{8}-[a-z0-9-]{3,32}-chi[1-8]', node['label']):
        raise ValueError('Not a disposable test VM')
    if node['ip'] in {'104.238.137.144','45.77.192.82','45.77.118.43'}:
        raise ValueError('Production target rejected')


def accept_host(node):
    check_scope(node)
    # OpenSSH does not serialize simultaneous additions to Windows known_hosts.
    # Seed only new inventoried hosts sequentially; changed keys still fail.
    command=['ssh','-T','-i',IDENTITY,'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
             '-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=12','root@'+node['ip'],'true']
    result=subprocess.run(command,capture_output=True,timeout=20)
    if result.returncode:raise RuntimeError('Scoped generator host verification failed')


def prepare(node):
    check_scope(node)
    ssh = ['ssh','-T','-i',IDENTITY,'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
           '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','root@'+node['ip']]
    probe = "python3 -c 'import aiohttp,os,json,time;print(json.dumps({\"hostname\":os.uname().nodename,\"cpu\":os.cpu_count(),\"unix\":time.time()}))'"
    result = subprocess.run(ssh+[probe],capture_output=True,timeout=20)
    if result.returncode:
        return {'label':node['label'],'ready':False,'exitCode':result.returncode}
    metadata=json.loads(result.stdout)
    if metadata['hostname'] != node['label']:
        raise ValueError('Host identity mismatch')
    data=(ROOT/'platform/scripts/hls-load-client.py').read_bytes()
    upload="umask 077; cat > /root/hls-load-client.py; chmod 600 /root/hls-load-client.py; python3 -m py_compile /root/hls-load-client.py"
    subprocess.run(ssh+[upload],input=data,capture_output=True,check=True,timeout=20)
    return {'label':node['label'],'ready':True,**metadata}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,default=ROOT/'release/load-generators-active-20261018.json')
    parser.add_argument('--update-inventory',action='store_true')
    args=parser.parse_args()
    inventory=json.loads(args.inventory.read_text(encoding='utf-8-sig'))
    if not 1<=len(inventory['generators'])<=8 or any(n.get('destroyed') is True for n in inventory['generators']):
        raise SystemExit('Expected one to eight active disposable generators; retired inventories must not be reused')
    for node in inventory['generators']:accept_host(node)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(prepare,inventory['generators']))
        for result in results:
            print(json.dumps(result),flush=True)
    if args.update_inventory:
        for node,result in zip(inventory['generators'],results):
            node['sshReady']=result['ready']
            if result['ready']:node['logicalCpuCount']=result['cpu']
        inventory['sshVerifiedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        args.inventory.write_text(json.dumps(inventory,indent=2)+'\n',encoding='utf8')
    if not all(result['ready'] for result in results):raise SystemExit(2)
