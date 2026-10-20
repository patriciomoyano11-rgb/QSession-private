"""Run on production: send existing bucket-scoped credentials directly to encoder.

No credentials are printed or copied to the operator's workstation. Does not change
token permissions, create tokens, touch rooms, or start a synthetic publisher.
"""
import json
import pathlib
import subprocess

import yaml

container = json.loads(subprocess.check_output(['docker', 'inspect', 'qsession-qsession-app-1']))[0]
environment = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)


def value(suffix, fallback=''):
    return environment.get('QSESSION_BROADCAST_STORAGE_' + suffix) or environment.get('QSESSION_R2_' + suffix) or fallback


storage = {'endpoint': value('ENDPOINT'), 'bucket': value('BUCKET'),
           'accessKey': value('ACCESS_KEY'), 'secretKey': value('SECRET_KEY'), 'region': value('REGION', 'auto')}
if (storage['endpoint'] != 'https://b3d60daa8319692b18a8bef39b34f14d.r2.cloudflarestorage.com'
        or storage['bucket'] != 'qsession-live' or not storage['accessKey'] or not storage['secretKey']):
    raise SystemExit('Existing project storage configuration did not match the authorized destination')
config = yaml.safe_load(pathlib.Path('/opt/qsession/platform/deploy/egress.yaml').read_text())
config['api_key'] = environment['LIVEKIT_API_KEY']
config['api_secret'] = environment['LIVEKIT_API_SECRET']
config['qsession_probe_storage'] = storage
payload = yaml.safe_dump(config).encode()
if len(payload) > 65536:
    raise SystemExit('Storage transfer exceeded its expected configuration size')
subprocess.run(['ssh', '-T', '-i', '/root/.ssh/qsession-encoder/config-transfer',
                '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ConnectTimeout=12', 'root@45.77.192.82'], input=payload, check=True)
print(json.dumps({'storageDeliveredDirectly': True, 'permissionsChanged': False,
                  'tokensCreated': False, 'publisherStarted': False}))
