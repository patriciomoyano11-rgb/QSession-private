"""Mint a short-lived, single-room publisher token and send directly to encoder."""
import json
import pathlib
import subprocess
import yaml

code = '''const {AccessToken,RoomServiceClient}=require('livekit-server-sdk');
(async()=>{const e=process.env;const code='PRB10A';const room='qsession-'+code;
const url=e.LIVEKIT_PUBLIC_URL;const api=(e.LIVEKIT_URL||url).replace(/^ws/,'http');
await new RoomServiceClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).createRoom({name:room,emptyTimeout:60,departureTimeout:15,maxParticipants:2});
const identity='dj-primary-prb10a';const token=new AccessToken(e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET,{identity,ttl:300});
token.addGrant({room,roomJoin:true,canPublish:true,canSubscribe:false,canPublishData:false});
console.log(JSON.stringify({url,token:await token.toJwt(),roomCode:code,identity}));
})().catch(()=>{console.error('Probe token preparation failed');process.exit(1)});'''
probe = json.loads(subprocess.check_output(['docker','exec','qsession-qsession-app-1','node','-e',code]))
config = yaml.safe_load(pathlib.Path('/opt/qsession/platform/deploy/egress.yaml').read_text())
container = json.loads(subprocess.check_output(['docker','inspect','qsession-qsession-app-1']))[0]
environment = dict(item.split('=',1) for item in container['Config']['Env'] if '=' in item)
config['api_key'] = environment['LIVEKIT_API_KEY']
config['api_secret'] = environment['LIVEKIT_API_SECRET']
config['qsession_probe'] = probe
subprocess.run(['ssh','-T','-i','/root/.ssh/qsession-encoder/config-transfer',
                '-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
                'root@45.77.192.82'],input=yaml.safe_dump(config).encode(),check=True)
print('Short-lived synthetic publisher credential delivered directly; no token displayed.')
