"""Consolidate only this recovery candidate's local evidence; never authenticate."""
import datetime
import hashlib
import importlib.util
import json
import pathlib
import re

ROOT=pathlib.Path(__file__).resolve().parents[2]
RELEASE=ROOT/'release'
NAMES={
    'normal':'edge-r2-recovery-workerd-normal-20261020.json',
    'faults':'edge-r2-recovery-workerd-faults-20261020.json',
    'compatibility':'edge-r2-recovery-workerd-compatibility-20261020.json',
    'node':'edge-r2-recovery-node-20261020.tap',
    'listener':'edge-r2-recovery-listener-20261020.tap',
    'python':'edge-r2-recovery-python-20261020.log',
}
OUTPUTS=('edge-r2-recovery-workerd-local-20261020.json',
    'edge-r2-recovery-validation-20261020.json','edge-r2-recovery-readiness-20261020.json',
    'edge-r2-recovery-publication-proposal-20261020.json')


def checked_test_count(value, kind):
    if kind=='node':
        count=re.search(r'(?:ℹ|#) tests (\d+)',value)
        passed=re.search(r'(?:ℹ|#) pass (\d+)',value)
        valid=(count and passed and count[1]==passed[1]
            and re.search(r'(?:ℹ|#) fail 0(?:\r?\n|$)',value)
            and re.search(r'(?:ℹ|#) skipped 0(?:\r?\n|$)',value))
    else:
        count=re.search(r'Ran (\d+) tests',value)
        valid=count and re.search(r'^OK\s*$',value,re.M) and not re.search(r'skipped[= ]+[1-9]',value)
    if not valid or int(count[1])<=0:raise ValueError('Fresh focused suites must pass without skips')
    return int(count[1])


def write_new_outputs(release, values):
    if any((release/name).exists() for name in values):
        raise ValueError('Recovery evidence or proposal already exists; never overwrite a prior candidate')
    for name,value in values.items():
        with (release/name).open('x',encoding='utf8') as target:
            json.dump(value,target,indent=2);target.write('\n')


def main():
    if any((RELEASE/name).exists() for name in OUTPUTS):
        raise ValueError('Recovery package already exists; preserve its evidence')
    digest=hashlib.sha256((ROOT/'platform/edge/hls-worker.js').read_bytes().replace(b'\r\n',b'\n')).hexdigest()
    read=lambda name:json.loads((RELEASE/name).read_text(encoding='utf-8-sig'))
    normal,faults,compatibility=(read(NAMES[key]) for key in ('normal','faults','compatibility'))
    runtime={**normal,'scenario':'normal-and-faults','normalScenario':normal,'faultScenario':faults,
        'faultInjectionCases':faults['faultInjectionCases'],
        'verifiedBodyRecoveryChecks':faults.get('verifiedBodyRecoveryChecks',[]),
        'compatibilityScenario':compatibility}
    spec=importlib.util.spec_from_file_location('recovery_candidate_gate',ROOT/'platform/scripts/hls_candidate_readiness.py')
    gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
    if not gate.valid_runtime_evidence(runtime,digest):raise ValueError('Recovery runtime evidence is incomplete')
    if (compatibility.get('passed') is not True or compatibility.get('candidateSourceSha256')!=digest
            or compatibility.get('deliveryMode')!='shared' or compatibility.get('scenario')!='normal'
            or compatibility.get('completedRequests')!=96 or compatibility.get('fullBodiesVerified')!=96
            or compatibility.get('knownRuntimeErrors')!=[] or compatibility.get('failures')!=[]
            or compatibility.get('injectedRuntimeErrors')!=[] or compatibility.get('intentionalCancellations')!=0
            or compatibility.get('localRuntimeStopped') is not True
            or compatibility.get('outboundFetchForbidden') is not True
            or compatibility.get('cloudAuthenticationUsed') is not False
            or compatibility.get('cloudResourcesCreated')!=0):
        raise ValueError('Shared-path compatibility evidence is incomplete')
    counts={key:checked_test_count((RELEASE/NAMES[key]).read_text(encoding='utf-8-sig'),
        'python' if key=='python' else 'node') for key in ('node','listener','python')}
    components=('platform/edge/hls-worker.js','platform/public/app.js','platform/scripts/hls-load-client.py',
        'platform/scripts/orchestrate-hls-load.py','platform/scripts/prepare-retirement-scope.py',
        'platform/scripts/provision-guarded-load.py','platform/scripts/run-custom-domain-load.py',
        'platform/scripts/observe-distributed-probe.py','platform/scripts/synthetic-hls-origin.py',
        'platform/scripts/read-guarded-load-progress.py','platform/scripts/hls_candidate_readiness.py',
        'platform/scripts/publish-edge-r2-canary.py','platform/scripts/verify-edge-r2-publication.py',
        'platform/scripts/record-edge-r2-pilot.py','platform/scripts/record-edge-r2-preparation.py',
        'platform/scripts/test-edge-cache-context-local.py')
    hashes={name:hashlib.sha256((ROOT/name).read_bytes().replace(b'\r\n',b'\n')).hexdigest() for name in components}
    report={'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'status':'local-recovery-passed-publication-and-pilot-pending','passed':True,
        'sourceSha256':digest,'componentSourceSha256':hashes,
        'checks':dict.fromkeys(('edgeRegressionPassed','hlsToolingPassed','listenerRecoveryPassed','publicationGuardsPassed'),True),
        'automatedTests':{'javascript':counts['node']+counts['listener'],'python':counts['python'],
            'total':sum(counts.values()),'pythonSkipped':0,'focusedSuites':counts},
        'officialLocalRuntime':{'normalFullResponses':normal['fullBodiesVerified'],
            'compatibilityFullResponses':compatibility['fullBodiesVerified'],
            'faultCases':len(faults['faultInjectionCases']),'verifiedBodyRecoveryChecks':faults['verifiedBodyRecoveryChecks'],
            'bodyPoolMeasurementScope':'final-snapshot','privateActorRequestsInCanary':0},
        'cloudResourcesCreated':0,'cloudAuthenticationUsed':False,'newPaidLoadExecuted':False,
        'published':False,'capacityCertified':False,'decodedPlaybackTested':False,
        'limits':['Body pool measurement is a final snapshot, not a peak',
            'No real R2 or multi-datacenter throughput measured','No sustained 10000-client result for this recovery candidate'],
        'evidence':list(NAMES.values())}
    proposal={'status':'proposed','authorizationReference':None,'sourceSha256':digest,
        'previousSourceSha256':gate.BASELINE_SOURCE,'previousWorkerVersion':gate.BASELINE_VERSION,
        'worker':'qsession-live','canaryRoom':'PRB10A',
        'canaryVariable':{'name':'QSESSION_R2_EDGE_CACHE_ROOM','type':'plain_text','text':'PRB10A'},
        'temporaryOAuthScopes':['account:read','workers_scripts:write'],'revokeWranglerOnFinish':True,
        'preserveExistingSevenBindings':True,'preserveExistingNamespaceAndClass':True,
        'singleProtectedClientOnExistingEncoder':True,'newServers':0,'paidMassLoad':False,
        'dnsChanges':False,'planChanges':False,'vultrApiReactivation':False,'capacityCertified':False,
        'requiresSeparateExplicitProbeRenewalIfExpired':True}
    readiness={'sourceSha256':digest,'readyForPaidLoadPreparation':False,
        'blockers':['publication-and-fresh-protected-pilot-pending'],'capacityCertified':False,
        'createsResources':False,'authenticatesToCloud':False}
    write_new_outputs(RELEASE,dict(zip(OUTPUTS,(runtime,report,readiness,proposal))))
    print(json.dumps({'localPreparationPassed':True,'automatedTests':report['automatedTests']['total'],
        'sourceSha256':digest,'readyForPaidLoadPreparation':False,'publicationPending':True,
        'capacityCertified':False,'cloudResourcesCreated':0}))


if __name__=='__main__':main()
