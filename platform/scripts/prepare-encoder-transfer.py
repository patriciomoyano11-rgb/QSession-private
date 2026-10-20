"""Run on the production host. Emits public keys and numeric UID only."""
import json
import pathlib
import subprocess

directory = pathlib.Path('/root/.ssh/qsession-encoder')
directory.mkdir(mode=0o700, exist_ok=True)
key = directory / 'config-transfer'
if not key.exists():
    subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True)
uid = subprocess.check_output(['docker', 'exec', 'qsession-egress-1', 'id', '-u'], text=True).strip()
print(json.dumps({
    'transferPublicKey': key.with_suffix('.pub').read_text().strip(),
    'productionHostPublicKey': pathlib.Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().strip(),
    'egressUid': int(uid),
}))
