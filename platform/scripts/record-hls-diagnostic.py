"""Summarize existing diagnostic artifacts; never certifies or changes service."""
import collections
import datetime
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
RELEASE = ROOT / 'release'
RUNS = [
    ('diagnostic-1000-20261020', 'shared', 'before'),
    ('diagnostic-stdlib-1000-20261020', 'shared', 'before'),
    ('diagnostic-http2-1000-20261020', 'shared', 'before'),
    ('diagnostic-direct-r2-1000-20261020', 'direct-r2', 'before'),
    ('diagnostic-retry-shared-1000-20261020', 'shared', 'after'),
    ('diagnostic-retry-shared-repeat-1000-20261020', 'shared', 'after'),
    ('diagnostic-retry-direct-r2-1000-20261020', 'direct-r2', 'after'),
]


def main():
    entries = []
    for suffix, path, patch in RUNS:
        file = RELEASE / f'hls-diagnostic-custom-domain-{suffix}.json'
        if not file.exists(): continue
        value = json.loads(file.read_text(encoding='utf8'))
        summary = value['summary']
        counts, errors, sampled_colos = summary['counts'], collections.Counter(), collections.Counter()
        for node in value['nodeResults']:
            for worker in node.get('nodeReport', {}).get('workers', []):
                result = worker.get('report', {})
                errors.update(result.get('errors', {}))
                for failure in result.get('firstTransportFailures', []):
                    if failure.get('receivedBytes', 0) and failure.get('phase') == 'after_headers':
                        sampled_colos[failure.get('cloudflareRay', 'unknown').rsplit('-', 1)[-1]] += 1
        entries.append({'report': file.name, 'cacheRoute': path, 'admissionRetry': patch,
            'clients': summary['requestedClients'],
            'peakRecentMediaClients': summary['peakConcurrentRecentMediaClients'],
            'steadyRecentMediaMinimum': summary['steadyConcurrentRecentMediaMinimum'],
            'fullRecentMediaSpanSeconds': summary['longestCommonFullMediaSpanSeconds'],
            'deliveryChecksPassed': summary['httpDeliveryChecksPassed'],
            'segmentOk': counts.get('segmentOk', 0),
            'segmentLateOverSixSeconds': counts.get('segmentDownloadOver6Seconds', 0),
            'incompleteBodyResponses': counts.get('segmentIncompleteBodyResponses', 0),
            'stalledClients': counts.get('stalledClients', 0),
            'admissionGateway520Responses': counts.get('admissionFailure_backend-520', 0),
            'errors': dict(errors), 'sampledPartialBodyColos': dict(sampled_colos),
            'transportFailureSampleLimitPerWorker': 12,
            'reportedNicCapacityUnknown': any(n.get('nicReferenceMbps') is None for n in summary['nodes']),
            'http2MultiplexingComparisonOnly': 'http2' in suffix})
    ledger = json.loads((RELEASE / 'load-generators-diagnostic-20261020.json').read_text())
    proof = {}
    for key, name in {
        'retirement': 'diagnostic-retirement-verified-20261020.json',
        'vultrAccess': 'diagnostic-vultr-access-closed-20261020.json',
        'wranglerAccess': 'diagnostic-wrangler-session-closed-20261020.json',
    }.items():
        file = RELEASE / name
        proof[key] = {'report': name, 'available': file.exists()}
    report = {'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'runId': ledger['runId'], 'technicalRoom': 'PRB10A', 'runs': entries,
        'temporaryGeneratorsRemaining': ledger['activeCount'], 'cleanupProofs': proof,
        'computeEvidence': 'diagnostic-load-observed-cost-20261020.json',
        'publishedAppEvidence': 'private-groups-published-20261020.json',
        'publishedWorkerEvidence': 'manifest-recovery-publication-20261020.json',
        'wholeRequestDeadlineSeconds': 8, 'readinessCriteriaRelaxed': False,
        'http2Interpretation': '16 pools per worker; different connection concentration. Not a physical-browser result or a controlled attribution of CDN capacity.',
        'cacheComparisonInterpretation': 'Route and time changed; observed delivery differences alone do not establish a causal actor/cache defect.',
        'rootCauseOfIncompleteMediaEstablished': False,
        'fullTenThousandLoadRetestedThisDiagnostic': False,
        'productionCapacityCertified': False,
        'realRoomAtLastRead': {'code': 'DKTLF3', 'checkedAt': '2026-10-20T01:55:16.475Z',
            'audienceMode': 'interactive', 'capacity': 25, 'broadcastState': 'inactive'},
        'remaining': ['Sustained 10000 media delivery and reconnections',
            'Protected-route Windows, Chrome and Android playback',
            'Persistent private chat, private media and voice capacity under combined load',
            'Automatic encoder recovery and delivered playback alerts']}
    candidate=RELEASE/'worker-manifest-recovery-manifest-20261020.json'
    if candidate.exists():
        manifest=json.loads(candidate.read_text(encoding='utf8'))
        local_file=RELEASE/'edge-cache-context-local-20261020.json'
        local=json.loads(local_file.read_text(encoding='utf8')) if local_file.exists() else {}
        report['manifestRecoveryCandidate']={
            'sourceSha256':manifest['afterSha256'],'unitChecksPassed':manifest['unitChecksPassed'],
            'officialLocalRuntimePassed':local.get('passed') is True,
            'localRequests':local.get('completedRequests'),
            'faultInjectionCases':local.get('faultInjectionCases',[]),
            'published':manifest.get('published') is True,
            'specificPublicationAuthorizationPending':manifest.get('published') is not True}
        if manifest.get('published') is True:
            report['manifestRecoveryCandidate']['publicationAuthorizationReference']=manifest.get('publicationAuthorizationReference')
            report['manifestRecoveryCandidate']['workerVersion']=manifest.get('workerVersion')
            pilot_file=RELEASE/'manifest-recovery-protected-pilot-20261020.json'
            if pilot_file.exists():
                pilot=json.loads(pilot_file.read_text(encoding='utf8'))
                report['manifestRecoveryCandidate']['protectedSingleClientPilotPassed']=pilot.get('passed') is True
                report['manifestRecoveryCandidate']['pilotEvidence']=pilot_file.name
            closure_file=RELEASE/'manifest-recovery-wrangler-session-closed-20261020.json'
            if closure_file.exists():
                closure=json.loads(closure_file.read_text(encoding='utf8'))
                report['manifestRecoveryCandidate']['temporarySessionClosed']=closure.get('officialLogoutConfirmed') is True
        else:
            report['manifestRecoveryCandidate']['automaticReviewReason']='Earlier authorization covered another correction and the temporary session had already been revoked.'
    target = RELEASE / 'hls-diagnostic-closeout-20261020.json'
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'report': str(target), 'completedRuns': len(entries),
        'temporaryGeneratorsRemaining': ledger['activeCount'], 'productionCapacityCertified': False}))


if __name__ == '__main__': main()
