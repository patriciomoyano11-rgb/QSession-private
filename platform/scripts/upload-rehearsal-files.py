"""Upload only the two isolated-rehearsal scripts to the owned disposable VM."""
import base64
import pathlib
import subprocess
import sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','root@96.30.207.240']
for name in ('rehearsal-app.cjs','rehearse-admissions-rollback.py'):
    flags='os.O_WRONLY|os.O_TRUNC|os.O_NOFOLLOW' if '--replace' in sys.argv else 'os.O_WRONLY|os.O_CREAT|os.O_EXCL'
    guard="s=os.stat(p,follow_symlinks=False);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==384;" if '--replace' in sys.argv else ''
    code="import os,sys,socket,stat;assert socket.gethostname()=='qsession-load-20261018-atl-2';os.umask(0o077);p='/root/"+name+"';"+guard+"fd=os.open(p,"+flags+",0o600);f=os.fdopen(fd,'wb');f.write(sys.stdin.buffer.read());f.close()"
    encoded=base64.b64encode(code.encode()).decode()
    command='python3 -c "import base64;exec(base64.b64decode(\''+encoded+'\'))"'
    result=subprocess.run(SSH+[command],input=(ROOT/'platform/scripts'/name).read_bytes(),capture_output=True,timeout=20)
    if result.returncode:raise SystemExit('Scoped upload failed; private output suppressed')
    print('Uploaded isolated rehearsal source: '+name,flush=True)
