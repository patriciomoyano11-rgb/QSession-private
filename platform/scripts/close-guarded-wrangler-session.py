"""Close only the explicitly approved local temporary Wrangler session."""
import datetime
import json
import os
import pathlib
import subprocess
import argparse
import re

ROOT=pathlib.Path(__file__).resolve().parents[2]
PRIVATE=ROOT/'private/cloudflare-cli'
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/guarded-wrangler-session-closed-20261020.json')
parser.add_argument('--authorization-reference',default='call_8b3e2d7259f9444fb6e24c5a08d6e2cd')
args=parser.parse_args()
if not re.fullmatch(r'call_[a-zA-Z0-9_]{8,160}',args.authorization_reference):raise SystemExit('Invalid authorization reference')
env={**os.environ,'XDG_CONFIG_HOME':str(PRIVATE),'WRANGLER_LOG_PATH':str(PRIVATE/'logs'),
     'WRANGLER_SEND_METRICS':'false','NO_COLOR':'1'}
result=subprocess.run(['node',str(ROOT/'release/cloudflare-tools/node_modules/wrangler/bin/wrangler.js'),'logout'],
                      cwd=ROOT,env=env,capture_output=True,timeout=40)
confirmed=result.returncode==0 and b'Successfully logged out' in result.stdout
if not confirmed:raise SystemExit('Official logout not confirmed; details suppressed')
configuration=PRIVATE/'.wrangler/config/default.toml'
pending=PRIVATE/'pending-device-login.json'
for file in (configuration,pending):
    if file.is_symlink():raise SystemExit('Unexpected private path')
    file.unlink(missing_ok=True)
removed=0
for file in (PRIVATE/'logs').glob('wrangler-*.log'):
    if file.is_file() and not file.is_symlink():file.unlink();removed+=1
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'authorizationReference':args.authorization_reference,
    'officialLogoutConfirmed':True,'localOAuthConfigurationRemoved':not configuration.exists(),
    'pendingDeviceLoginRemoved':not pending.exists(),'privateAuthenticationLogsRemoved':removed,
    'reauthenticationAttemptedAfterLogout':False}
args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(report))
