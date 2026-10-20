"""Configure the purchased encoder. Public peer keys only; no cloud secrets."""
import os
import pathlib
import subprocess

import yaml

root = pathlib.Path('/opt/qsession-encoder')
(root / 'private').mkdir(parents=True, mode=0o700, exist_ok=True)
receiver = pathlib.Path('/usr/local/sbin/qsession-receive-egress')
receiver_source = '''#!/usr/bin/python3
import json, os, pathlib, re, sys, tempfile, yaml

LIMIT = 5 * 1024 * 1024
raw = sys.stdin.buffer.read(LIMIT + 1)
if len(raw) > LIMIT:
    raise SystemExit('Configuration exceeds the 5 MiB transfer limit')
try:
    config = yaml.safe_load(raw)
except Exception:
    raise SystemExit('Invalid configuration encoding')
if not isinstance(config, dict) or not config.get('ws_url') or not isinstance(config.get('redis'), dict):
    raise SystemExit('Invalid encoder configuration')
probe = config.pop('qsession_probe', None)
storage = config.pop('qsession_probe_storage', None)
tokens = config.pop('qsession_probe_tokens', None)
if len(yaml.safe_dump(config).encode()) > 65536 or not config.get('api_key') or not config.get('api_secret'):
    raise SystemExit('Invalid bounded base configuration')
if probe is not None and (not isinstance(probe, dict) or len(json.dumps(probe).encode()) > 65536):
    raise SystemExit('Invalid bounded publisher configuration')
if storage is not None:
    if (not isinstance(storage, dict) or len(json.dumps(storage).encode()) > 16384
            or storage.get('endpoint') != 'https://b3d60daa8319692b18a8bef39b34f14d.r2.cloudflarestorage.com'
            or storage.get('bucket') != 'qsession-live'
            or not isinstance(storage.get('accessKey'), str) or not storage['accessKey']
            or not isinstance(storage.get('secretKey'), str) or not storage['secretKey']
            or set(storage) - {'endpoint', 'bucket', 'region', 'accessKey', 'secretKey'}):
        raise SystemExit('Invalid restricted storage configuration')
if tokens is not None:
    if (not isinstance(tokens, list) or not 1 <= len(tokens) <= 10000
            or any(not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{20,2048}', token) for token in tokens)
            or len(set(tokens)) != len(tokens) or len(json.dumps(tokens).encode()) > 8 * 1024 * 1024):
        raise SystemExit('Invalid bounded lease list')
private = pathlib.Path('/opt/qsession-encoder/private')
destination = private / 'egress.yaml'
existing = yaml.safe_load(destination.read_text()) if destination.exists() else None
credentials_preserved = bool(existing and existing.get('api_key') == config['api_key']
                             and existing.get('api_secret') == config['api_secret'])
if existing and not credentials_preserved:
    raise SystemExit('This probe transfer cannot rotate encoder API credentials')

def atomic_write(target, payload, mode, uid=0):
    descriptor, name = tempfile.mkstemp(prefix='.qsession-incoming-', dir=private)
    temporary = pathlib.Path(name)
    try:
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, 0)
        with os.fdopen(descriptor, 'wb') as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)

if probe is not None:
    atomic_write(private / 'probe.json', json.dumps(probe).encode(), 0o600)
if storage is not None:
    atomic_write(private / 'probe-storage.json', json.dumps(storage).encode(), 0o600)
if tokens is not None:
    atomic_write(private / 'probe-tokens.json', json.dumps(tokens).encode(), 0o600)
config['ws_url'] = 'wss://media.qsession.org'
config.setdefault('redis', {})['address'] = '127.0.0.1:6379'
atomic_write(destination, yaml.safe_dump(config).encode(), 0o400, 1001)
print(json.dumps({'received': True, 'storageStored': storage is not None,
                  'leaseTokensStored': len(tokens) if tokens is not None else 0,
                  'apiCredentialsPreserved': credentials_preserved}))
'''
compile(receiver_source, str(receiver), 'exec')
if receiver.exists() and receiver.read_text() != receiver_source:
    backup = receiver.with_name(receiver.name + '.before-load-preparation-20261018')
    if not backup.exists():
        backup.write_text(receiver.read_text())
        backup.chmod(0o700)
receiver.write_text(receiver_source)
receiver.chmod(0o700)
ssh = pathlib.Path('/root/.ssh')
auth = ssh / 'authorized_keys'
public = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOybGfeTEYNpcxuc7+6BOqbdESL9SsdlpyYjDX1Ru910'
entry = 'from="104.238.137.144",restrict,command="/usr/local/sbin/qsession-receive-egress" ' + public + ' qsession-config-transfer'
previous = auth.read_text() if auth.exists() else ''
if public not in previous:
    auth.write_text(previous.rstrip() + '\n' + entry + '\n')
auth.chmod(0o600)
known = ssh / 'known_hosts'
host = '104.238.137.144 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINo74YR8tzHDvjQ/NZN9Gcu8VEKSWI5/T0lZBcllu+j0'
previous = known.read_text() if known.exists() else ''
if host not in previous:
    known.write_text(previous.rstrip() + '\n' + host + '\n')
known.chmod(0o600)
print('Restricted configuration receiver installed.')
print('ENCODER_HOST_PUBLIC_KEY=' + pathlib.Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().strip())
print('TUNNEL_PUBLIC_KEY=' + (ssh / 'qsession_egress_tunnel.pub').read_text().strip())
