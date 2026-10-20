"""Start official Wrangler device sign-in; never print codes or credentials."""
import json
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
private = ROOT / 'private/cloudflare-cli'
private.mkdir(parents=True, exist_ok=True)
env = {**os.environ, 'XDG_CONFIG_HOME': str(private), 'WRANGLER_LOG_PATH': str(private / 'logs'),
       'WRANGLER_SEND_METRICS': 'false', 'NO_COLOR': '1'}
process = subprocess.Popen(['node', str(ROOT / 'release/cloudflare-tools/node_modules/wrangler/bin/wrangler.js'),
    'login', '--device', '--browser=false', '--scopes', 'account:read', 'workers_scripts:write'],
    cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8')
buffer = ''
saved = False
for line in process.stdout:
    buffer += re.sub(r'\x1b\[[0-9;]*m', '', line)
    url = re.search(r'please visit:\s+(https://dash\.cloudflare\.com/[^\s]+)', buffer)
    code = re.search(r'enter the code:\s+([A-Za-z0-9-]{6,32})', buffer)
    if url and code and not saved:
        path = private / 'pending-device-login.json'
        with open(path, 'x', encoding='utf8') as handle:
            json.dump({'verificationUrl': url[1], 'userCode': code[1],
                       'requestedScopes': ['account:read', 'workers_scripts:write']}, handle)
        saved = True
        print(json.dumps({'deviceAuthorizationPrepared': True, 'permissionGranted': False}), flush=True)
status = process.wait()
print(json.dumps({'loginProcessExitCode': status, 'deviceFlowPrepared': saved,
                  'authenticationCompleted': status == 0}), flush=True)
raise SystemExit(status)
