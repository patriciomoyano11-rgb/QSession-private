"""Read-only public verification; no playback tokens or account information."""
import datetime
import hashlib
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
manifest = json.loads((ROOT / 'release/private-groups-20261020-v1/manifest.json').read_text())

def get(route):
    request = urllib.request.Request('https://qsession.org' + route, headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 200:
            raise ValueError('Public release endpoint is unhealthy')
        data = response.read(2000001)
        if len(data) > 2000000:
            raise ValueError('Public response exceeds expected bounds')
        return data

verified = []
for name, route in [('public/index.html', '/'), ('public/app.js', '/app.js?v=20261020-private-groups-v1'), ('public/sw.js', '/sw.js')]:
    if hashlib.sha256(get(route).replace(b'\r\n', b'\n')).hexdigest() != manifest[name]['afterSha256']:
        raise ValueError('Public source does not match the published payload: ' + name)
    verified.append(name)
status = json.loads(get('/api/status'))
if not status.get('ok') or status['scale']['broadcast']['audienceMode'] != 'interactive':
    raise ValueError('Unexpected application state')
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'publicFilesMatchReviewedPayload': verified, 'publicHealth': True,
          'audienceMode': 'interactive', 'capacityCertified': False,
          'capacityExpanded': False, 'physicalPlaybackRetested': False}
(ROOT / 'release/private-groups-public-verification-20261020.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
