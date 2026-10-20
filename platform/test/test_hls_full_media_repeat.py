"""Fresh budget and single-attempt guards for the user-requested 10000 repeat."""
import copy
import datetime
import importlib.util
import pathlib
import tempfile
import unittest

SCRIPTS=pathlib.Path(__file__).resolve().parents[1]/'scripts'


def load(name,file):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


scope=load('full_media_scope','prepare-retirement-scope.py')
runner=load('full_media_runner','run-custom-domain-load.py')
SHA='6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f'


class FullMediaRepeat(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.release=pathlib.Path(self.directory.name)
        self.approval={'status':'approved','authorizationReference':'call_fresh_full_repeat',
            'additionalComputeLimitUsd':2.10,'maximumGenerators':7,'maximumExecutions':1,
            'clients':10000,'holdSeconds':620,'reconnectAfterSeconds':240,
            'repeatAfterDiagnosticFailureAcknowledged':True,
            'temporaryOrganizationApiAccessApproved':True,'temporaryPreviousIpRemovalApproved':True,
            'conditionalProbeRenewalApiRestartApproved':True,'encoderIpCidr':'45.77.192.82/32',
            'restoreIpCidr':'217.138.213.4/32','retirementMinutes':45}
        self.approval.update(previousIpCidrs=['217.138.213.4/32','159.26.100.230/32'],
            restoreIpCidrs=['217.138.213.4/32','159.26.100.230/32'])
        self.diagnostic={'authorizationReference':'call_previous_diagnostic',
            'status':'diagnostic-completed-retired-access-closed','cleanup':{'temporaryGeneratorsRemaining':0}}
        self.publication={'authorizationReference':'call_completed_publication','sourceSha256':SHA,
            'status':'published-pilot-passed-session-revoked'}
        self.access={'apiDisabled':True}
        now=datetime.datetime.now(datetime.timezone.utc)
        self.ledger={'generators':[{'hourlyUsd':.132,'createdObservedUtc':now.isoformat()} for _ in range(7)],
            'scope':{'maximumInstances':7},'newBudget':{'status':'approved',
                'authorizationReference':'call_fresh_full_repeat','additionalComputeLimitUsd':2.10,
                'previousObservedComputeUsd':0},
            'fullMediaRepeatStage':{'maximumExecutions':1,'clients':10000,'holdSeconds':620,
                'reconnectAfterSeconds':240,'workerSourceSha256':SHA,'executions':[]}}

    def approve(self,**changes):
        return scope.full_media_approval({**self.approval,**changes},self.diagnostic,self.access,self.publication)

    def reserve(self,**changes):
        values={'clients':10000,'hold':620,'reconnect':240,'transport':'aiohttp',
            'suffix':'media-full-test-20261020',**changes}
        return runner.reserve_full_media_execution(self.ledger,release=self.release,**values)

    def test_spent_diagnostic_and_oauth_grants_cannot_authorize_new_spending(self):
        self.assertEqual(self.approve(),'call_fresh_full_repeat')
        for ref in ('call_previous_diagnostic','call_completed_publication','call_6a51aee29d5f4d36a5bcedd4d0a61a3f',
                'call_2caf9cd1c0234d28816e9c766bf72935','call_3df9e63a99e44a099cadb98eff4cd410',
                'call_ee5fa2738f3b4373b8ec88731623c351'):
            with self.subTest(reference=ref),self.assertRaises(ValueError):self.approve(authorizationReference=ref)
        for change in ({'status':'proposed'},{'additionalComputeLimitUsd':.30},
                {'maximumExecutions':2},{'repeatAfterDiagnosticFailureAcknowledged':False},
                {'conditionalProbeRenewalApiRestartApproved':False},
                {'temporaryPreviousIpRemovalApproved':False}):
            with self.subTest(change=change),self.assertRaises(ValueError):self.approve(**change)

    def test_prior_cleanup_and_published_source_are_required(self):
        for target,key,value in ((self.access,'apiDisabled',False),
                (self.publication,'sourceSha256','old-source'),
                (self.diagnostic['cleanup'],'temporaryGeneratorsRemaining',1)):
            previous=target[key];target[key]=value
            with self.assertRaises(ValueError):self.approve()
            target[key]=previous

    def test_one_reservation_blocks_both_success_and_failure_retries(self):
        self.assertTrue(self.reserve())
        for suffix in ('media-full-retry-20261020','media-full-test-20261020'):
            with self.assertRaises(ValueError):self.reserve(suffix=suffix)
        self.assertEqual(len(self.ledger['fullMediaRepeatStage']['executions']),1)

    def test_cannot_shorten_or_expand_the_authorized_test_or_overwrite_evidence(self):
        for changes in ({'clients':9995},{'hold':60},{'reconnect':0},
                {'transport':'stdlib'},{'suffix':'../unsafe'}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.reserve(**changes)
        evidence=self.release/'custom-domain-load-execution-media-full-test-20261020.json'
        evidence.write_text('{}')
        with self.assertRaises(ValueError):self.reserve()
        self.assertEqual(self.ledger['fullMediaRepeatStage']['executions'],[])

    def test_exact_generator_count_budget_and_separate_scope(self):
        original=copy.deepcopy(self.ledger)
        self.ledger['generators'].pop()
        with self.assertRaises(ValueError):self.reserve()
        self.ledger=copy.deepcopy(original);self.ledger['newBudget']['additionalComputeLimitUsd']=.30
        with self.assertRaises(ValueError):self.reserve()
        self.ledger=copy.deepcopy(original);self.ledger['mediaDiagnosticStage']={}
        with self.assertRaises(ValueError):self.reserve()
        self.ledger=original
        self.assertEqual(runner.validate_budget(self.ledger)['reservedBatchUsd'],2.10)
        self.ledger['generators'].append(self.ledger['generators'][0].copy())
        with self.assertRaises(ValueError):runner.validate_budget(self.ledger)

    def test_new_canary_scope_requires_source_specific_approval_and_eight_workers(self):
        digest='a'*64
        candidate={'sourceSha256':digest,'readyForPaidLoadPreparation':True}
        publication={'published':True,'sourceSha256':digest,'canaryRoom':'PRB10A'}
        approval={**self.approval,'sourceSha256':digest,'workersPerNode':8}
        self.assertEqual(scope.full_media_approval(approval,self.diagnostic,self.access,publication,candidate),
            'call_fresh_full_repeat')
        for changes in ({'sourceSha256':SHA},{'workersPerNode':4},{'sourceSha256':None}):
            with self.assertRaises(ValueError):
                scope.full_media_approval({**approval,**changes},self.diagnostic,self.access,publication,candidate)
        for field in ('previousIpCidrs','restoreIpCidrs'):
            with self.assertRaises(ValueError):
                scope.full_media_approval({**approval,field:['217.138.213.4/32']},
                    self.diagnostic,self.access,publication,candidate)

    def test_new_execution_cannot_run_a_historical_scope_or_change_partition(self):
        digest='a'*64;candidate={'sourceSha256':digest,'readyForPaidLoadPreparation':True}
        options=dict(clients=10000,hold=620,reconnect=240,transport='aiohttp',suffix='media-full-new-test',
            release=self.release,candidate=candidate,workers_per_node=8)
        with self.assertRaises(ValueError):runner.reserve_full_media_execution(self.ledger,**options)
        self.ledger['candidateSourceSha256']=digest
        self.ledger['fullMediaRepeatStage'].update(workerSourceSha256=digest,workersPerNode=8)
        with self.assertRaises(ValueError):runner.reserve_full_media_execution(self.ledger,**{**options,'workers_per_node':4})
        self.assertTrue(runner.reserve_full_media_execution(self.ledger,**options))

    def test_bundled_publication_and_load_require_explicit_approval_and_exact_ready_candidate(self):
        digest='a'*64
        reference='call_fresh_bundled_unit_fixture'
        candidate={'sourceSha256':digest,'readyForPaidLoadPreparation':True}
        publication={'authorizationReference':reference,'published':True,
            'sourceSha256':digest,'canaryRoom':'PRB10A'}
        approval={**self.approval,'authorizationReference':reference,'sourceSha256':digest,'workersPerNode':8}
        for flag in (None,False,1,'true'):
            with self.subTest(flag=flag),self.assertRaises(ValueError):
                scope.full_media_approval({**approval,'bundledPublicationAndLoadApproved':flag},
                    self.diagnostic,self.access,publication,candidate)
        with self.assertRaises(ValueError):
            scope.full_media_approval(approval,self.diagnostic,self.access,publication,candidate)
        approval['bundledPublicationAndLoadApproved']=True
        self.assertEqual(scope.full_media_approval(approval,self.diagnostic,self.access,publication,candidate),reference)
        with self.assertRaises(ValueError):
            scope.full_media_approval(approval,self.diagnostic,self.access,publication)
        for old_source in ('6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f',
                'ad2912eed16a285d0f5e6dcaef4762e23f5d9bb6fbbed8a3ed076c0aa2483858'):
            for target in ('approval','publication','candidate'):
                values={'approval':approval.copy(),'publication':publication.copy(),'candidate':candidate.copy()}
                values[target]['sourceSha256']=old_source
                with self.subTest(target=target,source=old_source),self.assertRaises(ValueError):
                    scope.full_media_approval(values['approval'],self.diagnostic,self.access,
                        values['publication'],values['candidate'])
        for changed_candidate in ({**candidate,'readyForPaidLoadPreparation':False},
                {'sourceSha256':digest}):
            with self.subTest(candidate=changed_candidate),self.assertRaises(ValueError):
                scope.full_media_approval(approval,self.diagnostic,self.access,publication,changed_candidate)
        for changes in ({'published':False},{'canaryRoom':'OTHERX'}):
            with self.subTest(publication=changes),self.assertRaises(ValueError):
                scope.full_media_approval(approval,self.diagnostic,self.access,{**publication,**changes},candidate)
        for changes in ({'additionalComputeLimitUsd':.30},{'maximumGenerators':8},{'maximumExecutions':2},
                {'clients':9995},{'holdSeconds':60},{'reconnectAfterSeconds':0},{'workersPerNode':4},
                {'temporaryOrganizationApiAccessApproved':False},{'temporaryPreviousIpRemovalApproved':False},
                {'conditionalProbeRenewalApiRestartApproved':False},
                {'previousIpCidrs':['217.138.213.4/32']},{'restoreIpCidrs':['217.138.213.4/32']}):
            with self.subTest(approval=changes),self.assertRaises(ValueError):
                scope.full_media_approval({**approval,**changes},self.diagnostic,self.access,publication,candidate)
        for spent in ('call_6a51aee29d5f4d36a5bcedd4d0a61a3f',scope.SPENT_EDGE_AUTHORIZATION,
                'call_3df9e63a99e44a099cadb98eff4cd410','call_ee5fa2738f3b4373b8ec88731623c351',
                self.diagnostic['authorizationReference']):
            with self.subTest(reference=spent),self.assertRaises(ValueError):
                scope.full_media_approval({**approval,'authorizationReference':spent},
                    self.diagnostic,self.access,{**publication,'authorizationReference':spent},candidate)

    def latest_batch(self):
        reference=scope.SPENT_EDGE_AUTHORIZATION
        inventory={'runId':'previous-edge-batch','activeCount':0,'generators':[{'destroyed':True} for _ in range(7)],
            'newBudget':{'authorizationReference':reference},
            'priorStageAccounting':{'combinedReservationCeilingUsd':8.10,'observedUsd':1.20}}
        closed={'status':'failed-and-cleaned','authorizationReference':reference,'runId':inventory['runId'],
            'sourceSha256':'ad2912eed16a285d0f5e6dcaef4762e23f5d9bb6fbbed8a3ed076c0aa2483858',
            'computeAccounting':{'newReservationCeilingUsd':2.10},'cleanup':{
                'remoteKeyAndScopeRemoved':True,'temporaryProviderKeyRevoked':True,'organizationApiDisabled':True,
                'priorAclRestored':True,'temporaryGeneratorsRemaining':0,'activeProbeLeases':0}}
        access={'budgetAuthorizationReference':reference,'organizationApiDisabled':True,
            'temporaryKeyExplicitlyDeleted':True,'remoteKeyAndScopeRemoved':True,
            'restoredIpCidrsVerifiedBeforeDisable':list(scope.PRIOR_IP_CIDRS)}
        return closed,access,inventory

    def test_latest_edge_batch_closure_is_required_without_reusing_its_reservation(self):
        closed,access,inventory=self.latest_batch()
        accounting=scope.require_latest_edge_closure(closed,access,inventory)
        self.assertEqual(accounting['previousReservationCeilingUsd'],8.10)
        self.assertEqual(accounting['newAdditionalReservationUsd'],2.10)
        self.assertEqual(accounting['combinedReservationCeilingUsd'],10.20)
        self.assertFalse(accounting['finalInvoiceVerified'])
        self.assertIn('edge-r2-sustained-closeout',accounting['priorEvidence'])
        for target,key,value in ((closed['cleanup'],'temporaryGeneratorsRemaining',1),
                (access,'organizationApiDisabled',False),
                (access,'restoredIpCidrsVerifiedBeforeDisable',['217.138.213.4/32']),
                (inventory,'activeCount',1),(closed,'runId','different-batch')):
            previous=target[key];target[key]=value
            with self.assertRaises(ValueError):scope.require_latest_edge_closure(closed,access,inventory)
            target[key]=previous


if __name__=='__main__':unittest.main()


class DedicatedCompute(unittest.TestCase):
    def ledger(self):
        now=datetime.datetime.now(datetime.timezone.utc).isoformat()
        return {'scope':{'plan':'voc-c-8c-16gb-150s-amd','region':'ord','maximumInstances':7},
            'computeReservationPolicy':{'plan':'voc-c-8c-16gb-150s-amd','region':'ord',
                'hourlyCeilingUsd':0.25,'reservedHoursPerGenerator':2,'additionalVolumes':0},
            'newBudget':{'status':'approved','authorizationReference':'call_fresh_dedicated_unit',
                'additionalComputeLimitUsd':3.50,'previousObservedComputeUsd':0},
            'generators':[{'plan':'voc-c-8c-16gb-150s-amd','region':'ord','additionalVolumes':0,
                'hourlyUsd':0.219,'createdObservedUtc':now} for _ in range(7)]}

    def test_exact_dedicated_plan_reserves_two_hours_within_fresh_ceiling(self):
        ledger=self.ledger()
        report=runner.validate_budget(ledger)
        self.assertEqual(report['reservedBatchUsd'],3.50)
        self.assertTrue(report['finalInvoiceStillSubjectToProvider'])
        ledger['generators'].append(ledger['generators'][0].copy())
        with self.assertRaises(ValueError):runner.validate_budget(ledger)

    def test_wrong_plan_rate_volume_region_or_reservation_is_rejected(self):
        for changes in ({'plan':'vhp-8c-16gb-amd'},{'hourlyUsd':0.251},{'hourlyUsd':float('nan')},
                {'additionalVolumes':1},{'region':'mia'}):
            ledger=self.ledger();ledger['generators'][0].update(changes)
            with self.subTest(changes=changes),self.assertRaises(ValueError):runner.validate_budget(ledger)
        for changes in ({'hourlyCeilingUsd':0.30},{'reservedHoursPerGenerator':1},{'additionalVolumes':1}):
            ledger=self.ledger();ledger['computeReservationPolicy'].update(changes)
            with self.subTest(changes=changes),self.assertRaises(ValueError):runner.validate_budget(ledger)
