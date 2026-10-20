"""Offline gate: paid load must target the exact locally checked, published canary.

Never reads credentials, opens sockets, modifies rooms or creates resources.
Local readiness is deliberately separate from 10000-viewer certification.
"""
import hashlib
import json
import pathlib
import re

# Historical preparation scripts retain these names; paid readiness below uses
# the explicit active evidence configuration instead of dated source constants.
BASELINE_SOURCE='ad2912eed16a285d0f5e6dcaef4762e23f5d9bb6fbbed8a3ed076c0aa2483858'
BASELINE_VERSION='e2aaf9e0-bda0-4dc8-b741-20740bf9aa63'
ARTIFACTS={name:f'edge-r2-recovery-{name}-20261020.json'
           for name in ('validation','workerd-local','publication','pilot')}
RECOVERY_CASES={'cache-discard','cache-reject','cache-read-error'}
ACTIVE_EVIDENCE='hls-active-evidence.json'


def load_active_evidence(root):
    value=json.loads((pathlib.Path(root)/'release'/ACTIVE_EVIDENCE).read_text(encoding='utf-8-sig'))
    artifacts=value.get('artifacts',{})
    previous=value.get('latestPaidLoad',{})
    names=list(artifacts.values())+[previous.get(key) for key in ('closeout','accessClosed','inventory')]
    if (value.get('schemaVersion')!=1 or set(artifacts)!={'validation','workerd-local','publication','pilot','closeout'}
            or any(not isinstance(name,str) or not re.fullmatch(r'[a-z0-9-]+\.json',name) for name in names)
            or len(set(names))!=len(names)
            or any(not isinstance(value.get(key),str) or not re.fullmatch(r'[a-f0-9]{64}',value[key])
                for key in ('sourceSha256','previousSourceSha256'))
            or any(not isinstance(value.get(key),str) or not value[key] for key in ('workerVersion','previousWorkerVersion'))
            or any(not isinstance(previous.get(key),str) or not previous[key]
                for key in ('runId','sourceSha256','workerVersion','authorizationReference'))
            or any(type(previous.get(key)) not in (int,float) or previous[key]<=0
                for key in ('reservationCeilingUsd','combinedReservationCeilingUsd','observedUsd'))
            or not isinstance(value.get('consumedAuthorizationReferences'),list)
            or previous.get('authorizationReference') not in value['consumedAuthorizationReferences']):
        raise ValueError('An explicit, scoped active evidence configuration is required')
    return value


def latest_paid_accounting(expected,closed,access,inventory):
    """Require the actual last batch closed; a reservation is never an invoice."""
    reference=expected.get('authorizationReference')
    nodes=inventory.get('generators',[])
    previous=inventory.get('priorStageAccounting',{})
    ips={'217.138.213.4/32','159.26.100.230/32'}
    if (closed.get('status')!='failed-and-cleaned'
            or closed.get('authorizationReference')!=reference
            or closed.get('runId')!=inventory.get('runId') or closed.get('runId')!=expected.get('runId')
            or closed.get('sourceSha256')!=expected.get('sourceSha256')
            or closed.get('workerVersion')!=expected.get('workerVersion')
            or any(closed.get(key) is not True for key in ('oneExecutionOnly','bothOriginalIpRangesRestored',
                'vultrApiDisabled','allVultrApiKeysRevokedByDisable','wranglerSessionRevoked',
                'leaseCleanupPassed','originCleanupPassed'))
            or closed.get('temporaryGeneratorsRemaining')!=0
            or closed.get('compute',{}).get('approvedAdditionalCeilingUsd')!=expected.get('reservationCeilingUsd')
            or closed.get('compute',{}).get('invoiceVerified') is not False
            or closed.get('compute',{}).get('reservationIsNotFinalCharge') is not True
            or access.get('authorizationReference')!=reference
            or any(access.get(key) is not True for key in ('apiDisabled','allApiKeysRevokedByOrganizationDisable',
                'encoderIpRemovedFromAllowlist','localTransferFileRemoved','remoteApiCredentialRemoved','remoteScopeRemoved'))
            or access.get('temporaryGeneratorsRemaining')!=0 or set(access.get('originalIpCidrsRestored',[]))!=ips
            or inventory.get('candidateSourceSha256')!=expected.get('sourceSha256')
            or inventory.get('scope',{}).get('runId')!=expected.get('runId')
            or inventory.get('scope',{}).get('budgetAuthorizationReference')!=reference
            or inventory.get('newBudget',{}).get('authorizationReference')!=reference
            or inventory.get('newBudget',{}).get('additionalComputeLimitUsd')!=expected.get('reservationCeilingUsd')
            or inventory.get('activeCount')!=0 or not isinstance(nodes,list) or len(nodes)!=7
            or any(node.get('destroyed') is not True for node in nodes)
            or previous.get('combinedReservationCeilingUsd')!=expected.get('combinedReservationCeilingUsd')
            or previous.get('observedUsd')!=expected.get('observedUsd')
            or previous.get('finalInvoiceVerified') is not False):
        raise ValueError('The latest paid run, both prior ACLs and its consumed reservation must be closed')
    return {'previousReservationCeilingUsd':previous['combinedReservationCeilingUsd'],
        'observedUsd':previous['observedUsd'],
        'unverifiedReservationsUsd':round(previous['combinedReservationCeilingUsd']-previous['observedUsd'],2),
        'latestClosedReservationUsd':expected['reservationCeilingUsd'],
        'newAdditionalReservationUsd':None,'combinedReservationCeilingUsd':None,
        'earlierRecordsPreserved':True,'finalInvoiceVerified':False,
        'priorEvidence':expected['closeout'],'priorInventory':expected['inventory'],'earlierAccounting':previous}


def valid_body_pool_snapshot(proof):
    counters=proof.get('localCounters',{})
    if not isinstance(counters,dict):return False
    pool=counters.get('bodyPool',{})
    if not isinstance(pool,dict):return False
    return (proof.get('bodyPoolSnapshotWithinLimits') is True
        and type(pool.get('byteLimit')) is int and pool['byteLimit']==32*1024*1024
        and type(pool.get('keyLimit')) is int and pool['keyLimit']==64
        and type(pool.get('payloadBytes')) is int and 0<=pool['payloadBytes']<=pool['byteLimit']
        and type(pool.get('entries')) is int and 0<=pool['entries']<=pool['keyLimit'])


def valid_runtime_evidence(runtime, digest):
    """Require separate clean traffic and deliberate-fault workerd runs."""
    if (not isinstance(runtime,dict) or runtime.get('scenario') != 'normal-and-faults' or runtime.get('passed') is not True
            or runtime.get('candidateSourceSha256') != digest):
        return False
    for name, scenario in (('normalScenario', 'normal'), ('faultScenario', 'faults')):
        proof = runtime.get(name, {})
        if (not isinstance(proof,dict) or proof.get('scenario') != scenario or proof.get('passed') is not True
                or proof.get('candidateSourceSha256') != digest or proof.get('deliveryMode') != 'r2-edge'
                or proof.get('localRuntimeStopped') is not True or proof.get('outboundFetchForbidden') is not True
                or proof.get('cloudResourcesCreated') != 0 or proof.get('cloudAuthenticationUsed') is not False
                or proof.get('localCounters', {}).get('actorRequests') != 0
                or not valid_body_pool_snapshot(proof)
                or proof.get('knownRuntimeErrors') != [] or proof.get('failures') != []
                or proof.get('unauthorizedRejected') is not True or proof.get('expiredTokenRejected') is not True
                or len(proof.get('protocolChecks', [])) < 4
                or not all(c.get('passed') is True for c in proof['protocolChecks'])):
            return False
    normal, faults = runtime['normalScenario'], runtime['faultScenario']
    recovery=faults.get('verifiedBodyRecoveryChecks')
    if (not isinstance(recovery,list) or len(recovery)!=3
            or any(not isinstance(check,dict) for check in recovery)
            or any(not isinstance(check.get('case'),str) for check in recovery)
            or {check.get('case') for check in recovery}!=RECOVERY_CASES
            or any(check.get('passed') is not True
                or type(check.get('requests')) is not int or check['requests']!=64
                or type(check.get('fullBodiesVerified')) is not int or check['fullBodiesVerified']!=64
                or type(check.get('sharedOriginReads')) is not int or check['sharedOriginReads']!=1
                for check in recovery)):
        return False
    return (normal.get('completedRequests', 0) >= 96 and normal.get('fullBodiesVerified') == normal['completedRequests']
            and normal.get('intentionalCancellations') == 0 and normal.get('injectedRuntimeErrors') == []
            and len(faults.get('faultInjectionCases', [])) >= 9
            and all(c.get('passed') is True for c in faults['faultInjectionCases'])
            and all(error == 'network connection lost' for error in faults.get('injectedRuntimeErrors', [])))


def assess_candidate(root):
    root=pathlib.Path(root);problems=[]
    def read(name):
        try:
            value=json.loads((root/'release'/name).read_text(encoding='utf8'))
            if not isinstance(value,dict):raise ValueError('Object required')
            return value
        except (OSError,ValueError):problems.append('missing-or-invalid:'+name);return {}
    try:digest=hashlib.sha256((root/'platform/edge/hls-worker.js').read_bytes().replace(b'\r\n',b'\n')).hexdigest()
    except OSError:digest=None;problems.append('candidate-source-unavailable')
    try:active=load_active_evidence(root)
    except (OSError,ValueError,TypeError,AttributeError):
        return {'sourceSha256':digest,'readyForPaidLoadPreparation':False,
            'blockers':['active-evidence:missing-or-invalid'],'capacityCertified':False,
            'createsResources':False,'authenticatesToCloud':False}
    artifacts=active['artifacts']
    if active.get('status')!='active-checked-candidate':problems.append('active-evidence:successor-not-ready')
    if active.get('status')!='active-checked-candidate':
        problems.append('active-evidence:successor-proof-and-pilot-pending')
    validation=read(artifacts['validation'])
    runtime=read(artifacts['workerd-local'])
    publication=read(artifacts['publication'])
    pilot=read(artifacts['pilot'])
    closeout=read(artifacts['closeout'])
    if digest!=active['sourceSha256']:problems.append('active-evidence:source-mismatch')
    for label,item,field in [('regressions',validation,'sourceSha256'),
            ('official-local-runtime',runtime,'candidateSourceSha256'),('publication',publication,'sourceSha256')]:
        if not digest or item.get(field)!=digest:problems.append(label+':source-mismatch')
    if validation.get('passed') is not True:problems.append('regressions:not-passed')
    for key in ('edgeRegressionPassed','hlsToolingPassed','listenerRecoveryPassed','publicationGuardsPassed'):
        if validation.get('checks',{}).get(key) is not True:problems.append('regressions:'+key)
    if not valid_runtime_evidence(runtime, digest):
        problems.append('official-local-runtime:incomplete')
    variable={'name':'QSESSION_R2_EDGE_CACHE_ROOM','type':'plain_text','text':'PRB10A'}
    if (publication.get('published') is not True or publication.get('existingBindingsPreserved') is not True
            or publication.get('worker')!='qsession-live' or publication.get('canaryRoom')!='PRB10A'
            or publication.get('canaryVariable')!=variable or publication.get('preservedBindingCount')!=7
            or publication.get('previousSourceSha256')!=active['previousSourceSha256']
            or publication.get('previousWorkerVersion')!=active['previousWorkerVersion']
            or publication.get('workerVersion')!=active['workerVersion']
            or publication.get('workerVersion')==active['previousWorkerVersion']):
        problems.append('publication:not-verified-for-PRB10A')
    if (pilot.get('passed') is not True or pilot.get('sourceSha256') != digest
            or pilot.get('workerVersion') != publication.get('workerVersion')
            or pilot.get('room') != 'PRB10A' or pilot.get('clients') != 1
            or pilot.get('fullMediaBodiesVerified') is not True or pilot.get('admissionChecksPassed') is not True
            or pilot.get('leaseCleanupVerified') is not True or pilot.get('wranglerSessionRevoked') is not True):
        problems.append('protected-single-client-pilot:not-verified')
    # A bundled grant can open Vultr preparation before the canary closeout,
    # but that state must be explicit and backed by fresh source-specific
    # approval. It is not reported as a disabled API or a finished load.
    access_closed=closeout.get('vultrApiRemainsDisabled') is True
    bundled_access=False
    if not access_closed:
        proposal_name=active.get('approvedBundledLoadProposal','')
        if isinstance(proposal_name,str) and re.fullmatch(r'[a-z0-9-]+\.json',proposal_name):
            approval=read(proposal_name)
            bundled_access=(closeout.get('vultrApiAccessState')=='approved-bundled-load-preparation'
                and closeout.get('vultrAclRestrictedToEncoder') is True
                and approval.get('status')=='approved' and approval.get('bundledPublicationAndLoadApproved') is True
                and approval.get('authorizationReference')==publication.get('authorizationReference')
                and approval.get('authorizationReference')!=active['latestPaidLoad']['authorizationReference']
                and approval.get('sourceSha256')==digest and approval.get('workerVersion')==publication.get('workerVersion')
                and approval.get('temporaryOrganizationApiAccessApproved') is True
                and approval.get('encoderIpCidr')=='45.77.192.82/32')
    valid_closeout_status=(access_closed and closeout.get('status')=='new-admission-canary-published-single-client-passed-access-closed'
        or bundled_access and closeout.get('status')=='canary-published-pilot-passed-wrangler-closed-load-preparation')
    if (not valid_closeout_status
            or closeout.get('sourceSha256')!=digest or closeout.get('workerVersion')!=active['workerVersion']
            or closeout.get('authorizationReference')!=publication.get('authorizationReference')
            or closeout.get('worker')!='qsession-live' or closeout.get('room')!='PRB10A'
            or closeout.get('bindingsPreserved')!=7 or closeout.get('pilotClients')!=1
            or closeout.get('newServersCreatedForThisPublication')!=0
            or closeout.get('temporaryGeneratorsRemaining')!=0
            or closeout.get('newPaidLoadExecutedForThisCandidate') is not False
            or not (access_closed or bundled_access)
            or any(closeout.get(key) is not True for key in ('wranglerSessionRevoked','protectedPilotPassed'))):
        problems.append('canary-closeout:not-verified')
    normal=runtime.get('normalScenario',{})
    if (normal.get('sharedColdAdmissionCoalesced') is not True or normal.get('fixtureLeaseGroups')!=1
            or normal.get('expectedBackendRequests')!=1 or normal.get('localCounters',{}).get('backendRequests')!=1):
        problems.append('official-local-runtime:cold-admission-not-coalesced')
    previous=active['latestPaidLoad'];accounting=None
    try:accounting=latest_paid_accounting(previous,read(previous['closeout']),read(previous['accessClosed']),read(previous['inventory']))
    except (ValueError,TypeError,AttributeError,KeyError):problems.append('latest-paid-load:not-closed')
    return {'sourceSha256':digest,'readyForPaidLoadPreparation':not problems,'blockers':problems,
        'workerVersion':active['workerVersion'],'evidenceArtifacts':artifacts,
        'consumedAuthorizationReferences':active['consumedAuthorizationReferences'],
        'priorStageAccounting':accounting,'capacityCertified':False,'createsResources':False,'authenticatesToCloud':False}


def require_published_candidate(root):
    report=assess_candidate(root)
    if not report['readyForPaidLoadPreparation']:
        raise ValueError('The exact checked canary must be published and verified before new paid load resources')
    return report


if __name__=='__main__':
    report=assess_candidate(pathlib.Path(__file__).resolve().parents[2]);print(json.dumps(report))
    raise SystemExit(0 if report['readyForPaidLoadPreparation'] else 2)
