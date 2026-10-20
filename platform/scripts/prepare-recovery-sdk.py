"""Build a lab controller from official Node and the public LiveKit SDK only.

No production image, application source, configuration or credential is read.
"""
import hashlib
import json
import os
import pathlib
import re
import socket
import subprocess

ROOT=pathlib.Path('/root/qsession-recovery-20261018')
IMAGE='qsession-recovery-sdk:20261018'

def docker(*args,timeout=240):
    result=subprocess.run(['docker',*args],capture_output=True,timeout=timeout)
    if result.returncode:raise RuntimeError('Official SDK lab setup failed; output suppressed')
    return result.stdout

def main():
    if socket.gethostname()!='qsession-load-20261018-cf2-chi1' or os.getuid()!=0:raise ValueError('Scope')
    runtime_path=ROOT/'runtime.json'
    runtime=json.loads(runtime_path.read_text())
    directory=ROOT/'sdk-build';directory.mkdir(mode=0o700,exist_ok=False)
    docker('pull','node:22-bookworm-slim')
    image=json.loads(docker('image','inspect','node:22-bookworm-slim'))[0]
    digest=next(value for value in image['RepoDigests'] if re.fullmatch(r'node@sha256:[a-f0-9]{64}',value))
    source=('FROM '+digest+'\nWORKDIR /app\n'
            'RUN npm install --no-audit --no-fund --ignore-scripts --omit=dev livekit-server-sdk@2.18.0\n'
            'USER node\nENTRYPOINT ["node"]\n')
    (directory/'Dockerfile').write_text(source)
    docker('build','--pull=false','-t',IMAGE,str(directory))
    check="const p=require('fs').readFileSync('/app/node_modules/livekit-server-sdk/package.json','utf8');console.log(JSON.parse(p).version)"
    version=docker('run','--rm','--network','none',IMAGE,'-e',check).decode().strip()
    if version!='2.18.0':raise RuntimeError('Public SDK version mismatch')
    identity=json.loads(docker('image','inspect',IMAGE))[0]['Id']
    runtime.update(controllerImage=IMAGE,publicSdkVersion=version,productionAppImageUsed=False,
                   controllerImageId=identity,nodeBaseDigest=digest,
                   controllerDockerfileSha256=hashlib.sha256(source.encode()).hexdigest())
    runtime_path.write_text(json.dumps(runtime,indent=2))
    print(json.dumps({'officialSdkControllerReady':True,'imageId':identity,'nodeBaseDigest':digest,
                      'sdkVersion':version,'productionAppImageUsed':False}),flush=True)

if __name__=='__main__':main()
