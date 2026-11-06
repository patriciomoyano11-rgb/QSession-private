"""Stop only the uniquely identified bounded PRB10A HTTP origin, never Egress."""
import base64
import subprocess
code="""
import pathlib,os,signal,json
matches=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:a=(p/'cmdline').read_bytes().split(bytes([0]))
 except (FileNotFoundError,PermissionError):continue
 if a[:4]==[b'/opt/qsession-encoder/probe-venv/bin/python',b'/opt/qsession-encoder/ops/synthetic-hls-origin.py',b'--duration',b'180']:matches.append(int(p.name))
assert len(matches)<=1, 'Expected at most one owned bounded synthetic origin'
if matches:os.kill(matches[0],signal.SIGTERM)
print(json.dumps({'ownedSyntheticOriginStopped':bool(matches),'alreadyFinished':not matches}))
"""
encoded=base64.b64encode(code.encode()).decode()
command='python3 -c "import base64;exec(base64.b64decode(\''+encoded+'\'))"'
def main():
    raise SystemExit('Refusing to SSH to the production encoder')


if __name__=='__main__':
    main()
