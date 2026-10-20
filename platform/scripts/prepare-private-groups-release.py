"""Read only the deployed public runtime, then build a narrow local diff."""
import difflib
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEST = ROOT / 'release/private-groups-20261020-v1'
FILES = ('server.js', 'product-store.js', 'realtime-hub.js', 'edge-broadcast.js',
         'mass-broadcast-readiness.js', 'public/app.js', 'public/index.html', 'public/sw.js')
SSH = ['ssh', '-T', '-i', 'C:/Users/maria/.ssh/qsession_deploy_ed25519',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'ConnectTimeout=12', 'root@104.238.137.144']

if DEST.exists():
    raise SystemExit('Release directory already exists; do not overwrite its baseline')
command = 'docker exec qsession-qsession-app-1 tar -c -C /app ' + ' '.join(FILES)
result = subprocess.run(SSH + [command], capture_output=True, timeout=40)
if result.returncode or len(result.stdout) > 4000000:
    raise SystemExit('Public runtime snapshot could not be read')
baseline = {}
with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
    if set(item.name for item in archive.getmembers()) != set(FILES):
        raise SystemExit('Unexpected runtime archive entries')
    for item in archive.getmembers():
        if not item.isfile() or item.size > 2000000:
            raise SystemExit('Unsafe runtime archive entry')
        baseline[item.name] = archive.extractfile(item).read().replace(b'\r\n', b'\n')
DEST.mkdir(parents=True)
manifest, diff = {}, []
for name in FILES:
    old = baseline[name]
    new = (ROOT / 'platform' / name).read_bytes().replace(b'\r\n', b'\n')
    for folder, content in [('baseline', old), ('payload', new)]:
        target = DEST / folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    manifest[name] = {'beforeSha256': hashlib.sha256(old).hexdigest(),
                      'afterSha256': hashlib.sha256(new).hexdigest()}
    changes = list(difflib.unified_diff(old.decode('utf8').splitlines(True),
                                     new.decode('utf8').splitlines(True), 'before/' + name, 'after/' + name))
    diff.extend(changes)
    print(json.dumps({'file': name, 'addedLines': sum(line.startswith('+') and not line.startswith('+++') for line in changes),
                      'removedLines': sum(line.startswith('-') and not line.startswith('---') for line in changes)}))
(DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(DEST / 'review.patch').write_text(''.join(diff), encoding='utf8')
print(json.dumps({'prepared': True, 'published': False, 'remoteChanges': False, 'files': len(FILES)}))
