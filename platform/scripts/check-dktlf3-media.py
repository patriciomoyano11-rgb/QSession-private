"""Run on encoder: brief decode of DKTLF3 via the owned custom CDN domain.

Does not save media, change a source, mint access or certify protected playback.
"""
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    headers={'User-Agent':'QSessionSignalVerification/1.0'}
    with urllib.request.urlopen(urllib.request.Request('https://qsession.org/api/rooms/DKTLF3/broadcast',headers=headers),timeout=10) as response:
        broadcast=json.load(response)['broadcast']
    original=urllib.parse.urlparse(broadcast.get('playbackUrl',''))
    if original.scheme!='https' or original.hostname not in {'qsession-live.patriciomoyano11.workers.dev','live.qsession.org'} or original.username or original.password or original.query or original.fragment or not re.fullmatch(r'/live/DKTLF3-[A-Za-z0-9_-]{18}/index\.m3u8',original.path):
        raise ValueError('Selected playback not available')
    url=urllib.parse.urlunparse(original._replace(netloc='live.qsession.org'))
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=10) as response:
        manifest=response.read(65537).decode()
    if len(manifest)>65536:raise ValueError('Oversize manifest')
    for line in manifest.splitlines():
        if line and not line.startswith('#'):
            item=urllib.parse.urlparse(urllib.parse.urljoin(url,line))
            if item.scheme!='https' or item.netloc!='live.qsession.org' or not item.path.startswith(original.path.rsplit('/',1)[0]+'/') or item.query:
                raise ValueError('Untrusted reference')
    command=['ffprobe','-v','error','-user_agent','QSessionSignalVerification/1.0','-tls_verify','1','-ca_file','/etc/ssl/certs/ca-certificates.crt',
             '-protocol_whitelist','https,tls,tcp','-read_intervals','%+#160','-show_frames','-show_streams',
             '-show_entries','frame=media_type,best_effort_timestamp_time:stream=codec_type,codec_name,width,height,sample_rate,channels',
             '-of','json',url]
    result=subprocess.run(command,capture_output=True,timeout=30)
    if result.returncode:
        print(json.dumps({'roomCode':'DKTLF3','decoded':False,'exitCode':result.returncode,'stderrBytes':len(result.stderr)}));return 2
    media=json.loads(result.stdout);frames=media.get('frames',[])
    # Explicit allowlist: ffprobe may include tags and side data beyond entries.
    fields={'codec_type','codec_name','width','height','sample_rate','channels'}
    print(json.dumps({'roomCode':'DKTLF3','checkedAtUnix':time.time(),'deliveryHost':'live.qsession.org',
        'broadcastReady':broadcast.get('ready'),'streams':[{k:v for k,v in s.items() if k in fields} for s in media.get('streams',[])],
        'decodedVideoFrames':sum(x.get('media_type')=='video' for x in frames),
        'decodedAudioFrames':sum(x.get('media_type')=='audio' for x in frames),
        'protectedMassPathTested':False,'capacityCertified':False}));return 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'roomCode':'DKTLF3','errorClass':type(exc).__name__,
            'httpStatus':exc.code if isinstance(exc,urllib.error.HTTPError) else None,'capacityCertified':False}));raise SystemExit(2)
