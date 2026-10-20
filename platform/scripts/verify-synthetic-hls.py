"""Read one synthetic HLS stream and report actual media and caching, not scale."""
import json
import re
import subprocess
import urllib.parse
import urllib.request

url = 'https://qsession-live.patriciomoyano11.workers.dev/live/PRB10A-hWrdBkirH_2yHmZ9lp/index.m3u8'
headers = {'Origin':'https://qsession.org','User-Agent':'Mozilla/5.0'}
def get(target):
    return urllib.request.urlopen(urllib.request.Request(target,headers=headers),timeout=15)
with get(url) as response:
    manifest = response.read().decode()
    result = {'synthetic':True,'concurrentViewersTested':1,'certifies10000Viewers':False,
              'manifestStatus':response.status,
              'manifestHeaders':{key:response.headers.get(key) for key in ['Content-Type','Cache-Control','Access-Control-Allow-Origin','X-QSession-Edge-Cache']},
              'manifest':manifest}
segments = [line for line in manifest.splitlines() if line and not line.startswith('#')]
if not segments:
    raise SystemExit('No synthetic HLS segment available.')
segment = urllib.parse.urljoin(url,segments[-1])
result['segmentChecks'] = []
for _ in range(2):
    with get(segment) as response:
        body = response.read()
        result['segmentChecks'].append({'status':response.status,'bytes':len(body),
            'cache':response.headers.get('X-QSession-Edge-Cache'),
            'cacheControl':response.headers.get('Cache-Control'),
            'cors':response.headers.get('Access-Control-Allow-Origin')})
probe = subprocess.run(['ffprobe','-v','error','-user_agent','Mozilla/5.0','-rw_timeout','15000000',
    '-show_entries','stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels',
    '-of','json',segment],capture_output=True,text=True,timeout=25,check=True)
result['media'] = json.loads(probe.stdout)
streams = result['media'].get('streams',[])
assert any(s.get('codec_name')=='h264' and s.get('width')==1280 and s.get('height')==720 for s in streams)
assert any(s.get('codec_name')=='aac' and s.get('sample_rate')=='48000' and s.get('channels')==2 for s in streams)
audio = subprocess.run(['ffmpeg','-hide_banner','-nostats','-user_agent','Mozilla/5.0',
    '-rw_timeout','15000000','-i',segment,'-vn','-af','volumedetect','-f','null','-'],
    capture_output=True,text=True,timeout=25,check=True)
peak = re.search(r'max_volume: ([\d.-]+) dB',audio.stderr)
assert peak and -80 < float(peak.group(1)) < -1, 'Synthetic tone missing or unexpectedly clipped.'
result['syntheticAudioPeakDbfs'] = float(peak.group(1))
print(json.dumps(result))
