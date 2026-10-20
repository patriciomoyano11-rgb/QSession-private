"""Run on production: renew only PRB10A, preserving the app image and media jobs.

The API reloads its private technical configuration at startup. LiveKit, Egress,
Redis, room plans and the real playback hostname are not modified.
"""
import datetime
import json
import os
import pathlib
import secrets
import stat
import subprocess
import time
import urllib.request

APP = 'qsession-qsession-app-1'
PATH = pathlib.Path('/opt/qsession/platform/deploy/private/broadcast-admission-probe.json')
BACKUP = PATH.with_name('broadcast-admission-probe.before-custom-domain-20261018.json')
CODE = r'''
const fs=require('node:fs');const {createClient}=require('redis');
const {EgressClient}=require('livekit-server-sdk');const {createBroadcastAdmissions}=require('./broadcast-admissions');
(async()=>{const e=process.env,p=JSON.parse(fs.readFileSync(e.QSESSION_BROADCAST_ADMISSION_PROBE_FILE,'utf8'));
if(p.code!=='PRB10A'||p.prefix!=='live/PRB10A-hWrdBkirH_2yHmZ9lp'||p.capacity!==10000)throw Error('scope');
if((e.QSESSION_AUDIENCE_MODE||'interactive')!=='interactive'||fs.existsSync('/tmp/qsession-probe-load-leases.json'))throw Error('state');
const jobs=await new EgressClient((e.LIVEKIT_URL||e.LIVEKIT_PUBLIC_URL).replace(/^ws/,'http'),e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).listEgress({active:true});
if(jobs.some(j=>j.roomName==='qsession-PRB10A'))throw Error('probe_writer');
const redis=createClient({url:e.QSESSION_REDIS_URL,disableOfflineQueue:true});redis.on('error',()=>{});await redis.connect();
const store=createBroadcastAdmissions({redisClient:redis,secret:e.QSESSION_BROADCAST_ADMISSION_SECRET});
try{const active=await store.count({code:p.code,prefix:p.prefix,generation:p.generation});if(active!==0)throw Error('leases');
console.log(JSON.stringify({activeProbeLeases:active,mediaJobs:jobs.map(j=>({egressId:j.egressId,status:j.status})),audienceMode:'interactive'}));}
finally{await store.close();}})().catch(()=>{console.error('Technical preflight failed; details suppressed');process.exitCode=1});
'''


def state():
    result = subprocess.run(['docker', 'exec', '-i', APP, 'node', '-'], input=CODE.encode(),
                            capture_output=True, check=True, timeout=25)
    return json.loads(result.stdout)


def health():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8090/api/status', timeout=2) as response:
            return response.status
    except Exception:
        return None


def await_health():
    for _ in range(30):
        if health() == 200:
            return True
        time.sleep(.5)
    return False


def write_existing(data):
    fd = os.open(PATH, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW)
    with os.fdopen(fd, 'wb') as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())


def main():
    os.umask(0o077)
    info = PATH.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 1000 or info.st_mode & 0o077 or info.st_size > 8192:
        raise ValueError('Unsafe private probe file')
    original = PATH.read_bytes()
    probe = json.loads(original)
    if probe['code'] != 'PRB10A' or probe['prefix'] != 'live/PRB10A-hWrdBkirH_2yHmZ9lp' or probe['capacity'] != 10000:
        raise ValueError('Unexpected probe scope')
    if PATH.with_name('broadcast-admission-pilot.json').exists():
        raise ValueError('An earlier private pilot must be cleaned up first')
    if health() != 200:
        raise ValueError('App is not healthy before renewal')
    before = state()
    image = subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', APP]).decode().strip()
    backup_reused = BACKUP.exists()
    if backup_reused:
        saved=BACKUP.lstat()
        if (not stat.S_ISREG(saved.st_mode) or saved.st_uid!=info.st_uid or saved.st_mode&0o077
                or saved.st_size>8192 or BACKUP.read_bytes()!=original):
            raise ValueError('Existing backup does not match the restored private configuration')
    else:
        descriptor = os.open(BACKUP, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as target:
            target.write(original)
        os.chown(BACKUP, info.st_uid, info.st_gid)
    now = datetime.datetime.now(datetime.timezone.utc)
    # Match the server's ISO-instant contract: no more than three fractional digits.
    probe.update(generation='synthetic-' + secrets.token_hex(8), issuedAt=now.isoformat(timespec='milliseconds'),
                 expiresAt=(now + datetime.timedelta(minutes=55)).isoformat(timespec='milliseconds'))
    try:
        write_existing(json.dumps(probe).encode())
        subprocess.run(['docker', 'restart', APP], capture_output=True, check=True, timeout=30)
        if not await_health():
            raise RuntimeError('API did not recover after technical renewal')
    except Exception as error:
        write_existing(original)
        subprocess.run(['docker', 'restart', APP], capture_output=True, check=True, timeout=30)
        healthy=await_health()
        restored=state() if healthy else None
        print(json.dumps({'renewed': False, 'renewalErrorClass':type(error).__name__,
                          'privateConfigRestored': True, 'appHealthy': healthy,
                          'mediaJobsBefore':before['mediaJobs'],
                          'mediaJobsAfter':restored['mediaJobs'] if restored else None,
                          'livekitOrEncoderRestarted':False}), flush=True)
        return 2
    after = state()
    image_after = subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', APP]).decode().strip()
    identifiers = lambda value: sorted(job['egressId'] for job in value['mediaJobs'])
    print(json.dumps({'renewed': True, 'probeCode': 'PRB10A', 'expiresAt': probe['expiresAt'],
                      'appHealthHttpStatus': 200, 'appImageUnchanged': image_after == image,
                      'audienceMode': after['audienceMode'], 'activeProbeLeases': after['activeProbeLeases'],
                      'mediaJobsBefore': before['mediaJobs'], 'mediaJobsAfter': after['mediaJobs'],
                      'sameMediaJobIdentifiers': identifiers(before) == identifiers(after),
                      'livekitOrEncoderRestarted': False, 'realRoomPlansChanged': False,
                      'productionPlaybackHostnameChanged': False, 'backupReused':backup_reused,
                      'certifiesProductionCapacity': False}), flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'errorClass': type(error).__name__, 'detailsSuppressed': True}), flush=True)
        raise SystemExit(2)
