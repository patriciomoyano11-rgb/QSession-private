"""Prepare a narrow payload and record observed results without certifying scale."""
import difflib
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEST = ROOT / 'release/private-groups-20261020-v1'
manifest = json.loads((DEST / 'manifest.json').read_text())
diffs = []
for name, item in manifest.items():
    old = (DEST / 'baseline' / name).read_bytes()
    assert hashlib.sha256(old).hexdigest() == item['beforeSha256']
    new = (ROOT / 'platform' / name).read_bytes().replace(b'\r\n', b'\n')
    (DEST / 'payload' / name).write_bytes(new)
    item['afterSha256'] = hashlib.sha256(new).hexdigest()
    diffs.extend(difflib.unified_diff(old.decode().splitlines(True), new.decode().splitlines(True),
                                    'before/' + name, 'after/' + name))
(DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(DEST / 'review.patch').write_text(''.join(diffs), encoding='utf8')
for name in ['broadcast-10000-readiness.example.json', 'mass-broadcast-readiness.example.json']:
    target = ROOT / 'platform/deploy' / name
    value = json.loads(target.read_text(encoding='utf-8-sig'))
    for key in ['privateChatAndGroups', 'privateMediaAccess', 'privateVoiceIsolation', 'privateChatLoad']:
        value['checks'][key] = {'status': 'pending', 'reference': '', 'verifiedAt': None}
    target.write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')
diagnostic = {'observedAt': '2026-10-20T01:11:00Z', 'source': 'Cloudflare dashboard, qsession-live',
    'inspectionOnly': True, 'workerSettingsChanged': False, 'eventsWindow': 'last 1 hour',
    'invocationErrorEvents': 3, 'observedErrorMessage': 'Network connection lost.',
    'errorTimesUtc': ['2026-10-20T00:26:46.518Z', '2026-10-20T00:26:46.217Z', '2026-10-20T00:26:46.211Z'],
    'errorWorkerVersion': '0e1263e2-9501-44d1-a89d-e9be800f92ca',
    'metricsWindow': 'last 24 hours', 'reportedExceededMemory': 0, 'reportedExceededCpu': 0,
    'reportedUncaughtExceptionInvocations': 0,
    'interpretation': 'Different dashboard datasets. Earlier network-loss events do not establish the cause of later shared-edge load failures. No observed memory/CPU-limit evidence supports attributing those failures to OOM.',
    'capacityCertified': False}
(ROOT / 'release/hls-provider-diagnostics-20261020.json').write_text(json.dumps(diagnostic, indent=2) + '\n')
failed = {'schemaVersion': 1, 'localOnly': True, 'passed': False, 'syntheticUsersRequested': 10000,
    'profileNotificationSocketsIncluded': True, 'requestedSockets': 20000, 'observedErrorCode': 'ENOBUFS',
    'connectionsAtFailure': 'not captured in the original attempt', 'cloudResourcesCreated': 0,
    'capacityCertified': False,
    'interpretation': 'Windows ran server and generator in one process. This is an inconclusive local generator/runtime ceiling, not a production capacity result. The subsequent groups-only test has a separate report.'}
(ROOT / 'release/private-chat-20000-sockets-inconclusive-20261020.json').write_text(json.dumps(failed, indent=2) + '\n')
print(json.dumps({'payloadRefreshed': len(manifest), 'baselinePreserved': True, 'readinessTemplatesPending': True}))
