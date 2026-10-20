"""Persist dedicated encoder selection; preserve local Egress as manual standby."""
import json
import pathlib
import subprocess
import yaml

root = pathlib.Path('/opt/qsession/platform/deploy')
override = root / 'compose.release.yml'
original = override.read_text()
data = yaml.safe_load(original)
data['services'].setdefault('egress', {})['profiles'] = ['legacy-encoder']
data['services']['qsession-app'].setdefault('depends_on', {})['egress'] = {'condition':'service_started','required':False}
backup = root / 'compose.release.before-dedicated-encoder.yml'
if not backup.exists():
    backup.write_text(original)
override.write_text(yaml.safe_dump(data,sort_keys=False))
try:
    subprocess.run(['docker','compose','-f',str(root/'compose.yml'),'-f',str(override),'config','--quiet'],check=True)
except Exception:
    override.write_text(original)
    raise
subprocess.run(['docker','update','--restart=no','qsession-egress-1'],check=True,stdout=subprocess.DEVNULL)
# Repair standby authentication too, but do not start it or displace the dedicated host.
configuration = root / 'egress.yaml'
before = root / 'private/egress.before-dedicated-encoder.yaml'
if not before.exists():
    before.write_bytes(configuration.read_bytes())
    before.chmod(0o600)
settings = yaml.safe_load(configuration.read_text())
container = json.loads(subprocess.check_output(['docker','inspect','qsession-qsession-app-1']))[0]
environment = dict(item.split('=',1) for item in container['Config']['Env'] if '=' in item)
settings['api_key'] = environment['LIVEKIT_API_KEY']
settings['api_secret'] = environment['LIVEKIT_API_SECRET']
configuration.write_text(yaml.safe_dump(settings))
import os
os.chown(configuration,1001,0)
configuration.chmod(0o400)
print(json.dumps({'dedicatedEncoderPrimary':True,'legacyEncoderManualProfile':'legacy-encoder','legacyRestartPolicy':'no','composeValid':True}))
