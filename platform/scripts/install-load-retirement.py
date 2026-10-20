"""Install the reviewed guard on the existing encoder, after API authorization.

No API credential is transferred or printed. Root-only scope and key must
already exist on that host. This does not provision or retire test instances.
"""
import base64
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = {
    '/opt/qsession-load-guard/retire-load-generators.py': ROOT / 'platform/scripts/retire-load-generators.py',
    '/etc/systemd/system/qsession-load-retirement.service': ROOT / 'platform/deploy/qsession-load-retirement.service',
    '/etc/systemd/system/qsession-load-retirement.timer': ROOT / 'platform/deploy/qsession-load-retirement.timer',
}


def remote_script():
    payload = {target: base64.b64encode(source.read_bytes()).decode('ascii') for target, source in FILES.items()}
    return '''import base64, importlib.util, json, os, pathlib, subprocess, sys
payload = json.loads(%r)
if os.geteuid() != 0: raise SystemExit('Root required')
private = pathlib.Path('/etc/qsession-load-guard')
if private.is_symlink() or not private.is_dir(): raise SystemExit('Private guard directory must already exist')
metadata = private.stat()
if metadata.st_uid != 0 or metadata.st_mode & 0o777 != 0o700: raise SystemExit('Private directory must be root 0700')
for target, encoded in payload.items():
    destination = pathlib.Path(target)
    if destination.is_symlink() or destination.parent.is_symlink(): raise SystemExit('Symlink installation rejected')
    if not destination.parent.exists(): destination.parent.mkdir(mode=0o700)
    content = base64.b64decode(encoded, validate=True)
    temporary = destination.with_name(destination.name + '.install-new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as file: file.write(content)
    os.replace(temporary, destination)
spec = importlib.util.spec_from_file_location('guard', '/opt/qsession-load-guard/retire-load-generators.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
scope = guard.validate_scope(json.loads(guard.private_text(private / 'scope.json')))
guard.private_text(private / 'vultr.key')
# Run the read-only API check BEFORE enabling the apply timer. A future
# deadline cannot accidentally execute a deletion during installation.
import datetime
now = datetime.datetime.now(datetime.timezone.utc).timestamp()
if not 900 <= guard.instant(scope['retireAt']) - now <= 2700:
    raise SystemExit('Require a future deadline with at least 15 minutes reserve')
command = ['/usr/bin/python3', '/opt/qsession-load-guard/retire-load-generators.py',
    '--scope', str(private / 'scope.json'), '--key-file', str(private / 'vultr.key')]
preview = subprocess.run(command, capture_output=True, text=True, timeout=45)
if preview.returncode: raise SystemExit('Read-only provider check failed; timer not enabled')
data = json.loads(preview.stdout)
if data['errors'] or data['pending']: raise SystemExit('Install and verify BEFORE provisioning generators')
for command_line in (
    ['systemd-analyze', 'verify', '/etc/systemd/system/qsession-load-retirement.service', '/etc/systemd/system/qsession-load-retirement.timer'],
    ['systemctl', 'daemon-reload'],
    ['systemctl', 'enable', '--now', 'qsession-load-retirement.timer']):
    result = subprocess.run(command_line, capture_output=True, timeout=30)
    if result.returncode: raise SystemExit('Unit installation failed; no provisioning allowed')
proof = subprocess.run(command + ['--preflight'], capture_output=True, text=True, timeout=45)
if proof.returncode: raise SystemExit('Installed timer preflight failed; no provisioning allowed')
print(proof.stdout.strip())
''' % json.dumps(payload)


def main():
    # Explicit execution command. Importing this module never touches a host.
    result = subprocess.run(['ssh', '-T', '-i', 'C:/Users/maria/.ssh/qsession_deploy_ed25519',
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ConnectTimeout=12', 'root@45.77.192.82', '/usr/bin/python3 -'],
        input=remote_script().encode('utf8'), capture_output=True, timeout=180)
    if result.returncode:
        print(json.dumps({'installedAndVerified': False, 'exitCode': result.returncode,
                          'providerAndRemoteOutputSuppressed': True}))
        return 2
    proof = json.loads(result.stdout)
    print(json.dumps({'installedAndVerified': True, 'preflight': proof,
        'files': {target: hashlib.sha256(source.read_bytes()).hexdigest() for target, source in FILES.items()}}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
