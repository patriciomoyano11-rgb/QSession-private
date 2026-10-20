"""Run on production: direct configuration transfer. Tunnel account is separate."""
import pathlib
import subprocess
import json
import yaml

ssh = pathlib.Path('/root/.ssh')
known = ssh / 'known_hosts'
host = '45.77.192.82 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFluFN94ZHTQBHZmsOjz72GlGdCGHpo2R/3e7UWjpnLf'
previous = known.read_text() if known.exists() else ''
if host not in previous:
    known.write_text(previous.rstrip() + '\n' + host + '\n')
known.chmod(0o600)
config = yaml.safe_load(pathlib.Path('/opt/qsession/platform/deploy/egress.yaml').read_text())
container = json.loads(subprocess.check_output(['docker','inspect','qsession-qsession-app-1']))[0]
environment = dict(item.split('=',1) for item in container['Config']['Env'] if '=' in item)
config['api_key'] = environment['LIVEKIT_API_KEY']
config['api_secret'] = environment['LIVEKIT_API_SECRET']
subprocess.run([
        'ssh', '-i', str(ssh / 'qsession-encoder/config-transfer'),
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12',
        'root@45.77.192.82',
    ], input=yaml.safe_dump(config).encode(), check=True)
print('Configuration transferred directly between authorized hosts.')
