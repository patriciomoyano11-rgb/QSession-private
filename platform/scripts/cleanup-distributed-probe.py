"""Release only stored PRB10A test leases and remove generator lease files."""
import base64
import argparse
import concurrent.futures
import json
import pathlib
import re
import subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12']
code=r'''
const fs=require('node:fs');const {createClient}=require('redis');const {createBroadcastAdmissions}=require('./broadcast-admissions');
(async()=>{const path='/tmp/qsession-probe-load-leases.json',p=JSON.parse(fs.readFileSync(path,'utf8')),e=process.env;
const expected=Number(process.env.QSESSION_PROBE_CLEANUP_CLIENTS||10000);
if(!Number.isSafeInteger(expected)||expected<4||expected>10000||p.scope.code!=='PRB10A'||p.scope.prefix!=='live/PRB10A-hWrdBkirH_2yHmZ9lp'||p.tokens.length!==expected)throw Error('scope');
const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
const a=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
try{let cursor=0,released=0;await Promise.all(Array.from({length:32},async()=>{for(;;){const i=cursor++;if(i>=p.tokens.length)return;try{if(await a.release(p.tokens[i]))released++;}catch(err){if(err.statusCode!==410)throw err;}}}));
const active=await a.count(p.scope);fs.unlinkSync(path);console.log(JSON.stringify({namespace:'PRB10A',released,activeAfter:active,privateMasterFileRemoved:true}));}finally{await a.close();}})().catch(()=>{console.error('Scoped cleanup failed; details suppressed');process.exitCode=1});
'''
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,default=ROOT/'release/load-generators-active-20261018.json')
    parser.add_argument('--expected-clients',type=int,default=10000)
    args=parser.parse_args()
    if not 4<=args.expected_clients<=10000:raise SystemExit('Expected client count outside probe scope')
    nodes=json.loads(args.inventory.read_text(encoding='utf-8-sig'))['generators']
    if not 1<=len(nodes)<=8 or any(not n.get('ownedForThisTest') or n.get('destroyed') is True for n in nodes):
        raise SystemExit('Refusing retired or unowned generator inventory')
    expr="eval(Buffer.from('"+base64.b64encode(code.encode()).decode()+"','base64').toString())"
    subprocess.run(SSH+['root@104.238.137.144','docker exec --env QSESSION_PROBE_CLEANUP_CLIENTS='+str(args.expected_clients)+' qsession-qsession-app-1 node -e "'+expr+'"'],check=True)
    def remove(node):
        if not node['ownedForThisTest'] or not re.fullmatch(r'qsession-load-\d{8}-[a-z0-9-]{3,32}-chi[1-8]',node['label']) or node['ip'] in {'104.238.137.144','45.77.192.82','45.77.118.43'}:raise ValueError('scope')
        script='''import pathlib,stat
p=pathlib.Path('/root/qsession-load-tokens.json')
try:s=p.lstat()
except FileNotFoundError:print('privateGeneratorLeaseFileRemoved:true')
else:
 assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==384
 p.unlink();print('privateGeneratorLeaseFileRemoved:true')
'''
        import shlex
        command='python3 -c '+shlex.quote(script)
        result=subprocess.run(SSH+['root@'+node['ip'],command],capture_output=True,timeout=20)
        return {'label':node['label'],'privateLeaseFileRemoved':result.returncode==0}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        for item in pool.map(remove,nodes):print(json.dumps(item),flush=True)
