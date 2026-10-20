"""Offline source/proof guards, including the still-required protected pilot."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('candidate_readiness',ROOT/'platform/scripts/hls_candidate_readiness.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
NAMES={name:'unit-'+name+'.json' for name in ('validation','workerd-local','publication','pilot','closeout')}


def evidence(source=b'unit-test-only-candidate'):
    digest=hashlib.sha256(source).hexdigest()
    checks=dict.fromkeys(('edgeRegressionPassed','hlsToolingPassed','listenerRecoveryPassed','publicationGuardsPassed'),True)
    common={'passed':True,'candidateSourceSha256':digest,'deliveryMode':'r2-edge',
        'localRuntimeStopped':True,'outboundFetchForbidden':True,'cloudResourcesCreated':0,
        'cloudAuthenticationUsed':False,'localCounters':{'actorRequests':0,'bodyPool':{
            'payloadBytes':1431620,'entries':1,'byteLimit':32*1024*1024,'keyLimit':64}},
        'bodyPoolSnapshotWithinLimits':True,
        'knownRuntimeErrors':[],'failures':[],'unauthorizedRejected':True,'expiredTokenRejected':True,
        'protocolChecks':[{'passed':True} for _ in range(4)],'injectedRuntimeErrors':[]}
    runtime={**copy.deepcopy(common),'scenario':'normal-and-faults',
        'normalScenario':{**copy.deepcopy(common),'scenario':'normal','completedRequests':96,
            'fullBodiesVerified':96,'intentionalCancellations':0,'sharedColdAdmissionCoalesced':True,
            'fixtureLeaseGroups':1,'expectedBackendRequests':1},
        'faultScenario':{**copy.deepcopy(common),'scenario':'faults',
            'faultInjectionCases':[{'passed':True} for _ in range(9)],
            'verifiedBodyRecoveryChecks':[{'case':name,'requests':64,'fullBodiesVerified':64,
                'sharedOriginReads':1,'passed':True} for name in sorted(gate.RECOVERY_CASES)]}}
    runtime['normalScenario']['localCounters']['backendRequests']=1
    publication={'published':True,'sourceSha256':digest,'existingBindingsPreserved':True,
        'worker':'qsession-live','canaryRoom':'PRB10A','workerVersion':'unit-version',
        'canaryVariable':{'name':'QSESSION_R2_EDGE_CACHE_ROOM','type':'plain_text','text':'PRB10A'},
        'preservedBindingCount':7,'previousSourceSha256':gate.BASELINE_SOURCE,'previousWorkerVersion':gate.BASELINE_VERSION}
    pilot={'passed':True,'sourceSha256':digest,'workerVersion':'unit-version','room':'PRB10A','clients':1,
        'fullMediaBodiesVerified':True,'admissionChecksPassed':True,'leaseCleanupVerified':True,
        'wranglerSessionRevoked':True}
    publication['authorizationReference']='call_publication_consumed'
    previous={'closeout':'unit-paid-closeout.json','accessClosed':'unit-paid-access.json','inventory':'unit-inventory.json',
        'runId':'unit-previous-batch','authorizationReference':'call_paid_consumed','sourceSha256':'b'*64,
        'workerVersion':'previous-paid-version','reservationCeilingUsd':2.10,'combinedReservationCeilingUsd':10.20,'observedUsd':1.20}
    active={'schemaVersion':1,'status':'active-checked-candidate','sourceSha256':digest,'workerVersion':'unit-version',
        'previousSourceSha256':gate.BASELINE_SOURCE,'previousWorkerVersion':gate.BASELINE_VERSION,
        'artifacts':NAMES,'latestPaidLoad':previous,'consumedAuthorizationReferences':['call_paid_consumed','call_publication_consumed']}
    closed={'status':'failed-and-cleaned','authorizationReference':'call_paid_consumed','runId':'unit-previous-batch',
        'sourceSha256':'b'*64,'workerVersion':'previous-paid-version','temporaryGeneratorsRemaining':0,
        'compute':{'approvedAdditionalCeilingUsd':2.10,'invoiceVerified':False,'reservationIsNotFinalCharge':True}}
    closed.update(dict.fromkeys(('oneExecutionOnly','bothOriginalIpRangesRestored','vultrApiDisabled',
        'allVultrApiKeysRevokedByDisable','wranglerSessionRevoked','leaseCleanupPassed','originCleanupPassed'),True))
    access={'authorizationReference':'call_paid_consumed','temporaryGeneratorsRemaining':0,
        'originalIpCidrsRestored':['217.138.213.4/32','159.26.100.230/32']}
    access.update(dict.fromkeys(('apiDisabled','allApiKeysRevokedByOrganizationDisable','encoderIpRemovedFromAllowlist',
        'localTransferFileRemoved','remoteApiCredentialRemoved','remoteScopeRemoved'),True))
    inventory={'runId':'unit-previous-batch','candidateSourceSha256':'b'*64,'activeCount':0,
        'generators':[{'destroyed':True} for _ in range(7)],
        'scope':{'runId':'unit-previous-batch','budgetAuthorizationReference':'call_paid_consumed'},
        'newBudget':{'authorizationReference':'call_paid_consumed','additionalComputeLimitUsd':2.10},
        'priorStageAccounting':{'combinedReservationCeilingUsd':10.20,'observedUsd':1.20,'finalInvoiceVerified':False}}
    closeout={'status':'new-admission-canary-published-single-client-passed-access-closed',
        'authorizationReference':'call_publication_consumed','sourceSha256':digest,'workerVersion':'unit-version',
        'worker':'qsession-live','room':'PRB10A','bindingsPreserved':7,'pilotClients':1,
        'newServersCreatedForThisPublication':0,'temporaryGeneratorsRemaining':0,
        'newPaidLoadExecutedForThisCandidate':False,'vultrApiRemainsDisabled':True,
        'wranglerSessionRevoked':True,'protectedPilotPassed':True}
    return {NAMES['validation']:{'passed':True,'sourceSha256':digest,'checks':checks},
        NAMES['workerd-local']:runtime,NAMES['publication']:publication,NAMES['pilot']:pilot,NAMES['closeout']:closeout,
        gate.ACTIVE_EVIDENCE:active,previous['closeout']:closed,previous['accessClosed']:access,previous['inventory']:inventory}


class CandidateReadiness(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.root=pathlib.Path(self.directory.name);(self.root/'release').mkdir()
        (self.root/'platform/edge').mkdir(parents=True)
        (self.root/'platform/edge/hls-worker.js').write_bytes(b'unit-test-only-candidate')
        self.items=evidence();self.write()

    def write(self):
        for name,value in self.items.items():(self.root/'release'/name).write_text(json.dumps(value))

    def test_complete_proof_allows_preparation_but_never_certifies_capacity(self):
        report=gate.require_published_candidate(self.root)
        self.assertTrue(report['readyForPaidLoadPreparation'])
        self.assertFalse(report['capacityCertified']);self.assertFalse(report['createsResources'])

    def test_absent_publication_and_pilot_block_before_resources(self):
        for name in (NAMES['publication'],NAMES['pilot']):
            self.write();(self.root/'release'/name).unlink()
            with self.assertRaises(ValueError):gate.require_published_candidate(self.root)

    def test_changed_source_invalidates_every_old_proof(self):
        (self.root/'platform/edge/hls-worker.js').write_bytes(b'edited-after-verification')
        report=gate.assess_candidate(self.root)
        self.assertFalse(report['readyForPaidLoadPreparation'])
        self.assertIn('publication:source-mismatch',report['blockers'])

    def test_normal_runtime_cannot_hide_body_errors_or_known_runtime_failures(self):
        original=copy.deepcopy(self.items)
        for field,value in (('knownRuntimeErrors',['network connection lost']),('injectedRuntimeErrors',['network connection lost']),
                ('fullBodiesVerified',95),('intentionalCancellations',1),('localCounters',{'actorRequests':1})):
            self.items=copy.deepcopy(original)
            self.items[NAMES['workerd-local']]['normalScenario'][field]=value;self.write()
            self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])

    def test_stale_or_failed_fault_proof_cannot_be_combined_with_clean_traffic(self):
        runtime=self.items[NAMES['workerd-local']];digest=self.items[NAMES['validation']]['sourceSha256']
        for field,value in (('candidateSourceSha256','old'),('cloudResourcesCreated',1),('cloudAuthenticationUsed',True),
                ('faultInjectionCases',[{'passed':False}]*9),('knownRuntimeErrors',['memory limit'])):
            trial=copy.deepcopy(runtime);trial['faultScenario'][field]=value
            self.assertFalse(gate.valid_runtime_evidence(trial,digest))

    def test_failed_or_different_version_pilot_and_unrevoked_session_block(self):
        original=copy.deepcopy(self.items)
        for field,value in (('passed',False),('workerVersion','previous-version'),('room','OTHER1'),
                ('leaseCleanupVerified',False),('wranglerSessionRevoked',False),('clients',10000)):
            self.items=copy.deepcopy(original);self.items[NAMES['pilot']][field]=value;self.write()
            self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])

    def test_recovery_requires_all_three_exact_full_body_cases_and_one_origin_read(self):
        runtime=self.items[NAMES['workerd-local']]
        digest=self.items[NAMES['validation']]['sourceSha256']
        for changes in ({'requests':63},{'fullBodiesVerified':63},{'sharedOriginReads':2},
                {'passed':False},{'case':'unrelated'},{'requests':True}):
            trial=copy.deepcopy(runtime);trial['faultScenario']['verifiedBodyRecoveryChecks'][0].update(changes)
            self.assertFalse(gate.valid_runtime_evidence(trial,digest))
        for cases in ([],runtime['faultScenario']['verifiedBodyRecoveryChecks'][:2],
                [runtime['faultScenario']['verifiedBodyRecoveryChecks'][0]]*3):
            trial=copy.deepcopy(runtime);trial['faultScenario']['verifiedBodyRecoveryChecks']=cases
            self.assertFalse(gate.valid_runtime_evidence(trial,digest))

    def test_snapshot_must_be_measured_with_the_actual_fixed_limits(self):
        runtime=self.items[NAMES['workerd-local']]
        digest=self.items[NAMES['validation']]['sourceSha256']
        for scenario in ('normalScenario','faultScenario'):
            for changes in ({'payloadBytes':32*1024*1024+1},{'entries':65},
                    {'byteLimit':64*1024*1024},{'keyLimit':128},{'entries':True}):
                trial=copy.deepcopy(runtime);trial[scenario]['localCounters']['bodyPool'].update(changes)
                self.assertFalse(gate.valid_runtime_evidence(trial,digest))
            trial=copy.deepcopy(runtime);trial[scenario]['bodyPoolSnapshotWithinLimits']=False
            self.assertFalse(gate.valid_runtime_evidence(trial,digest))

    def test_historical_package_does_not_substitute_for_recovery_proofs(self):
        for name in NAMES.values():
            path=self.root/'release'/name
            path.rename(path.with_name('historical-'+name))
        self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])

    def test_missing_configuration_unsafe_paths_and_unexpected_version_fail_closed(self):
        config=self.items[gate.ACTIVE_EVIDENCE]
        for changes in ({'workerVersion':'different-version'},{'sourceSha256':'c'*64},
                {'status':'baseline-published-successor-pending'},
                {'artifacts':{**NAMES,'publication':'../other.json'}}):
            self.items[gate.ACTIVE_EVIDENCE]={**config,**changes};self.write()
            self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])
        (self.root/'release'/gate.ACTIVE_EVIDENCE).unlink()
        self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])

    def test_current_coalescing_and_canary_closeout_are_required(self):
        original=copy.deepcopy(self.items)
        for target,field,value in ((NAMES['closeout'],'wranglerSessionRevoked',False),
                (NAMES['closeout'],'newPaidLoadExecutedForThisCandidate',True)):
            self.items=copy.deepcopy(original);self.items[target][field]=value;self.write()
            self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])
        self.items=copy.deepcopy(original)
        self.items[NAMES['workerd-local']]['normalScenario']['localCounters']['backendRequests']=2;self.write()
        self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])

    def test_latest_paid_batch_acl_and_unverified_reservation_are_required(self):
        report=gate.assess_candidate(self.root);accounting=report['priorStageAccounting']
        self.assertEqual(accounting['previousReservationCeilingUsd'],10.20)
        self.assertEqual(accounting['latestClosedReservationUsd'],2.10)
        self.assertEqual(accounting['unverifiedReservationsUsd'],9.00)
        self.assertIsNone(accounting['newAdditionalReservationUsd']);self.assertFalse(accounting['finalInvoiceVerified'])
        original=copy.deepcopy(self.items)
        for name,field,value in (('unit-paid-closeout.json','runId','older-batch'),
                ('unit-paid-closeout.json','leaseCleanupPassed',False),
                ('unit-paid-access.json','allApiKeysRevokedByOrganizationDisable',False),
                ('unit-paid-access.json','originalIpCidrsRestored',['217.138.213.4/32']),
                ('unit-inventory.json','activeCount',1),('unit-inventory.json','runId','old-batch')):
            self.items=copy.deepcopy(original);self.items[name][field]=value;self.write()
            self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])


if __name__=='__main__':unittest.main()


class BundledAccessProof(unittest.TestCase):
    setUp=CandidateReadiness.setUp
    write=CandidateReadiness.write
    def test_open_api_is_never_reported_closed_and_needs_fresh_bundled_source_approval(self):
        active=self.items[gate.ACTIVE_EVIDENCE]
        closed=self.items[NAMES['closeout']]
        closed.update(status='canary-published-pilot-passed-wrangler-closed-load-preparation',
            vultrApiRemainsDisabled=False,vultrApiAccessState='approved-bundled-load-preparation',
            vultrAclRestrictedToEncoder=True)
        self.write();self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])
        active['approvedBundledLoadProposal']='unit-bundled-load.json'
        proposal={'status':'proposed','bundledPublicationAndLoadApproved':True,
            'authorizationReference':'call_publication_consumed','sourceSha256':active['sourceSha256'],
            'workerVersion':'unit-version','temporaryOrganizationApiAccessApproved':True,'encoderIpCidr':'45.77.192.82/32'}
        self.items['unit-bundled-load.json']=proposal;self.write()
        self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])
        proposal['status']='approved';self.write()
        self.assertTrue(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])
        closed['vultrAclRestrictedToEncoder']=False;self.write()
        self.assertFalse(gate.assess_candidate(self.root)['readyForPaidLoadPreparation'])
