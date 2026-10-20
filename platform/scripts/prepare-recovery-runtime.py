"""Install official, version-pinned lab dependencies only on the disposable VM."""
import concurrent.futures
import argparse
import json
import pathlib
import socket
import subprocess

IMAGES={'livekit-server':'livekit/livekit-server@sha256:3497163e15c48fef6e7830c78716f9e9d5edc28abf7aa90b61c86e93bbc306b1',
        'egress':'livekit/egress@sha256:bf2b648b947349c3e9ff7aa8c718f00378d5c06af7624652a3653318e00333ce'}
ROOT=pathlib.Path('/root/qsession-recovery-20261018')


def command(args):
    result=subprocess.run(args,capture_output=True,timeout=240)
    if result.returncode:raise RuntimeError('Official dependency setup failed; output suppressed')


def python_runtime():
    command(['python3','-m','venv','--system-site-packages',str(ROOT/'venv')])
    command([str(ROOT/'venv/bin/pip'),'install','--disable-pip-version-check','--index-url','https://pypi.org/simple','livekit==1.1.21'])
    return 'python-livekit-1.1.21-ffmpeg-numpy'


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hostname',choices=('qsession-load-20261018-cf2-chi1',),required=True)
    args=parser.parse_args()
    if socket.gethostname()!=args.hostname:raise SystemExit('Disposable VM scope only')
    ROOT.mkdir(mode=0o700,exist_ok=False)
    command(['apt-get','update','-qq'])
    command(['apt-get','install','-y','-qq','docker.io','ffmpeg','python3-numpy','python3-venv'])
    command(['systemctl','start','docker'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(command,['docker','pull',image]):name for name,image in IMAGES.items()}
        futures[pool.submit(python_runtime)]='python-runtime'
        for future in concurrent.futures.as_completed(futures):
            future.result();print(json.dumps({'runtimeDependencyReady':futures[future]}),flush=True)
    report={'ready':True,'images':IMAGES,'pythonLivekit':'1.1.21','productionChanged':False}
    (ROOT/'runtime.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
