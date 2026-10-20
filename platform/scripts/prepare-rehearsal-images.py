"""Stream two pinned app images into the existing disposable rehearsal VM.

Uses operator SSH pipes, never copies private SSH keys, runtime env or user data.
"""
import json
import argparse
import pathlib
import re
import subprocess
import time

ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12']
IMAGES={'qsession-app:qsession-20261018-camera-clock-v4':'sha256:a5eecbb6fc0cb0af68f178799eed9b92140fc2743a7321b6767309dcfb3f6165',
        'qsession-app:qsession-20261018-edge-video-v2':'sha256:af2122838b2d029542bc404577fbafb07b55105d035eb6f7f67b3480d9d1dcc5'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,required=True)
    parser.add_argument('--label',required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    inventory=json.loads(args.inventory.read_text(encoding='utf-8-sig'))
    matching=[n for n in inventory['generators'] if n['label']==args.label]
    if len(matching)!=1:raise SystemExit('Expected one explicitly inventoried rehearsal VM')
    node=matching[0]
    if (node['destroyed'] or not node['ownedForThisTest'] or not node.get('sshReady')
        or not re.fullmatch(r'qsession-load-20261018-cf2-chi1',node['label'])
        or node['ip'] in {'104.238.137.144','45.77.192.82','45.77.118.43'}):raise SystemExit('Scope mismatch')
    data=subprocess.check_output(SSH+['root@104.238.137.144','docker image inspect '+' '.join(IMAGES)],timeout=30)
    inspected=json.loads(data)
    if {i['Id'] for i in inspected}!=set(IMAGES.values()):raise SystemExit('Pinned source image changed')
    for item in inspected:
        if any(re.search(r'SECRET|PASSWORD|TOKEN|API_KEY|CREDENTIAL',entry.partition('=')[0],re.I) and entry.partition('=')[2] for entry in item['Config'].get('Env',[])):
            raise SystemExit('Image contains a credential-like environment value; no transfer performed')
    source=subprocess.Popen(SSH+['root@104.238.137.144','docker save '+' '.join(IMAGES)+' | gzip -1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    destination=subprocess.Popen(SSH+['root@'+node['ip'],'gzip -dc | docker load --quiet'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    started=last=time.monotonic();sent=0
    try:
        while True:
            chunk=source.stdout.read(1024*1024)
            if not chunk:break
            destination.stdin.write(chunk);sent+=len(chunk)
            if time.monotonic()-last>=15:
                print(json.dumps({'compressedBytesTransferred':sent,'elapsedSeconds':round(time.monotonic()-started)}),flush=True);last=time.monotonic()
            if time.monotonic()-started>540:raise TimeoutError('Bounded image transfer exceeded its time budget')
        destination.stdin.close();destination.stdin=None
        _,errors=destination.communicate(timeout=60)
        source.wait(timeout=30)
        if destination.returncode or source.returncode:raise RuntimeError('Image transfer failed; private output suppressed')
        result=json.loads(subprocess.check_output(SSH+['root@'+node['ip'],'docker image inspect '+' '.join(IMAGES)],timeout=30))
        if {i['Id'] for i in result}!=set(IMAGES.values()):raise RuntimeError('Destination image digest mismatch')
        report={'images':IMAGES,'destinationInstanceId':node['id'],'compressedBytesTransferred':sent,'elapsedSeconds':round(time.monotonic()-started,2),
                'runtimeCredentialsTransferred':False,'privateSshKeysTransferred':False,'digestVerified':True,'productionChanged':False}
        args.output.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report),flush=True)
    finally:
        for process in (source,destination):
            if process.poll() is None:process.kill();process.wait()
