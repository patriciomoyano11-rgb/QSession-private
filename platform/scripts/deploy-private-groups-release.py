"""Ship the reviewed public-code overlay; never send environment or credentials."""
import hashlib
import io
import json
import pathlib
import shlex
import subprocess
import tarfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'release/private-groups-20261020-v1'
RESULT = ROOT / 'release/private-groups-published-20261020.json'
if RESULT.exists():
    raise SystemExit('A deployment outcome already exists; inspect it instead of retrying blindly')
tests = ET.parse(ROOT / 'release/private-groups-validation-final-20261020.xml').getroot()
if len(tests.findall('.//testcase')) != 96 or tests.findall('.//failure') or tests.findall('.//error'):
    raise SystemExit('The final 96 checks must pass before publication')
manifest = json.loads((SOURCE / 'manifest.json').read_text())
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
    archive.add(SOURCE / 'manifest.json', arcname='manifest.json')
    archive.add(ROOT / 'platform/scripts/publish-private-groups.py', arcname='publish-private-groups.py')
    for name, hashes in manifest.items():
        content = (SOURCE / 'payload' / name).read_bytes()
        current = (ROOT / 'platform' / name).read_bytes().replace(b'\r\n', b'\n')
        if content != current or hashlib.sha256(content).hexdigest() != hashes['afterSha256']:
            raise SystemExit('The current runtime differs from the reviewed payload')
        archive.add(SOURCE / 'payload' / name, arcname='payload/' + name)
expected = ['manifest.json', 'publish-private-groups.py'] + ['payload/' + name for name in manifest]
remote = r'''
import io,json,pathlib,subprocess,sys,tarfile
release=pathlib.Path('/opt/qsession/releases/qsession-20261020-private-groups-v1')
if release.exists() or release.is_symlink():raise SystemExit('Release directory already exists')
raw=sys.stdin.buffer.read(4000001)
if len(raw)>4000000:raise SystemExit('Oversized reviewed payload')
expected=set(EXPECTED)
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
 members=archive.getmembers()
 if len(members)!=len(expected) or {x.name for x in members}!=expected:raise SystemExit('Unexpected public-code entries')
 if any(not x.isfile() or x.size>2000000 for x in members):raise SystemExit('Unsafe archive entry')
 release.mkdir(mode=0o700)
 for item in members:
  target=release/item.name;target.parent.mkdir(parents=True,exist_ok=True)
  target.write_bytes(archive.extractfile(item).read())
result=subprocess.run(['/usr/bin/python3',str(release/'publish-private-groups.py')],capture_output=True,timeout=180)
report=release/'result.json'
if result.returncode or not report.exists():
 print(json.dumps({'published':False,'publicationOutcome':'requires-inspection','publisherExitCode':result.returncode,'capacityCertified':False}))
 raise SystemExit(1)
print(report.read_text())
'''.replace('EXPECTED', repr(expected))
ssh = ['ssh', '-T', '-i', 'C:/Users/maria/.ssh/qsession_deploy_ed25519',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'ConnectTimeout=12', 'root@104.238.137.144', '/usr/bin/python3 -c ' + shlex.quote(remote)]
result = subprocess.run(ssh, input=buffer.getvalue(), capture_output=True, timeout=210)
if result.returncode:
    print(json.dumps({'published': False, 'publicationOutcome': 'requires-inspection',
                      'exitCode': result.returncode, 'capacityCertified': False}))
    raise SystemExit(1)
report = json.loads(result.stdout)
if not report.get('published') or report.get('capacityExpanded') or not report.get('healthy'):
    raise SystemExit('Unexpected publication report')
report['automatedChecksPassed'] = 96
report['testEvidence'] = 'private-groups-validation-final-20261020.xml'
RESULT.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
