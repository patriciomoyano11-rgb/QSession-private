"""New paid diagnostic scope and execution gates, without cloud operations."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

SCRIPTS=pathlib.Path(__file__).resolve().parents[1]/'scripts'


def load(name,file):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


scope=load('media_scope','prepare-retirement-scope.py')
runner=load('media_runner','run-custom-domain-load.py')
SHA='6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f'


class ScopeApproval(unittest.TestCase):
    def setUp(self):
        self.previous={'authorizationReference':'call_previous_paid_scope','cleanup':{'temporaryGeneratorsRemaining':0},
            'compute':{'approvedStageCeilingUsd':3.6}}
        self.publication={'authorizationReference':'call_previous_wrangler_scope','sourceSha256':SHA,
            'status':'published-pilot-passed-session-revoked'}
        self.approval={'status':'approved','authorizationReference':'call_fresh_paid_scope_only',
            'additionalComputeLimitUsd':0.3,'maximumGenerators':1,'maximumExecutions':2,
            'clientStages':[1000,1500],'temporaryOrganizationApiAccessApproved':True,
            'temporaryPreviousIpRemovalApproved':True,'encoderIpCidr':'45.77.192.82/32',
            'restoreIpCidr':'217.138.213.4/32','retirementMinutes':45}
        self.access={'apiDisabled':True}

    def approve(self,**change):
        return scope.media_diagnostic_approval({**self.approval,**change},self.previous,self.access,self.publication)

    def test_requires_fresh_paid_permission_instead_of_reusing_previous_budget_or_oauth(self):
        self.assertEqual(self.approve(),self.approval['authorizationReference'])
        for change in ({'status':'proposed'},{'authorizationReference':'call_previous_paid_scope'},
                {'authorizationReference':'call_previous_wrangler_scope'},
                {'maximumGenerators':7},{'maximumExecutions':3},{'additionalComputeLimitUsd':2.1},
                {'clientStages':[1000,10000]},{'temporaryOrganizationApiAccessApproved':False},
                {'temporaryPreviousIpRemovalApproved':False},{'encoderIpCidr':'0.0.0.0/0'},
                {'retirementMinutes':60}):
            with self.subTest(change=change),self.assertRaises(ValueError):self.approve(**change)

    def test_requires_prior_retirement_and_the_published_diagnostic_version(self):
        for previous,access,publication in [
            ({**self.previous,'cleanup':{'temporaryGeneratorsRemaining':1}},self.access,self.publication),
            (self.previous,{'apiDisabled':False},self.publication),
            (self.previous,self.access,{**self.publication,'sourceSha256':'old-version'}),
            (self.previous,self.access,{**self.publication,'status':'prepared'})]:
            with self.assertRaises(ValueError):scope.media_diagnostic_approval(self.approval,previous,access,publication)


class DiagnosticExecutions(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.release=pathlib.Path(self.directory.name)
        self.ledger={'generators':[{'hourlyUsd':.132,'createdObservedUtc':'2026-10-20T04:00:00Z'}],
            'scope':{'maximumInstances':1},'retirementScopeFingerprint':'a'*64,
            'newBudget':{'status':'approved','authorizationReference':'call_fresh_paid_scope_only',
                'additionalComputeLimitUsd':.3,'previousObservedComputeUsd':0},
            'mediaDiagnosticStage':{'maximumExecutions':2,'clientStages':[1000,1500],
                'workerSourceSha256':SHA,'executions':[]}}

    def reserve(self,clients=1000,suffix='media-diag-first-20261020',**changes):
        return runner.reserve_media_diagnostic_execution(self.ledger,clients,changes.get('hold',60),
            changes.get('reconnect',0),changes.get('transport','aiohttp'),suffix,self.release)

    def first_result(self,**change):
        evidence={'executionPassed':True,'holdSeconds':60,'load':{'requestedClients':1000},
            'retirement':{'scopeFingerprint':'a'*64},**change}
        (self.release/self.ledger['mediaDiagnosticStage']['executions'][0]['evidence']).write_text(json.dumps(evidence))

    def test_two_runs_are_enforced_and_expansion_requires_matching_successful_first_run(self):
        self.assertTrue(self.reserve());self.first_result()
        self.assertTrue(self.reserve(1500,'media-diag-second-20261020'))
        self.assertEqual(len(self.ledger['mediaDiagnosticStage']['executions']),2)
        with self.assertRaises(ValueError):self.reserve(1500,'media-diag-third-20261020')

    def test_failure_cannot_be_retried_or_promoted_to_the_next_stage(self):
        self.reserve();self.first_result(executionPassed=False)
        for clients in (1000,1500,10000):
            with self.assertRaises(ValueError):self.reserve(clients,'media-diag-another-20261020')
        self.assertEqual(len(self.ledger['mediaDiagnosticStage']['executions']),1)

    def test_foreign_scope_evidence_and_overwriting_artifacts_are_rejected(self):
        (self.release/'custom-domain-load-execution-media-diag-first-20261020.json').write_text('{}')
        with self.assertRaises(ValueError):self.reserve()
        self.reserve(suffix='media-diag-fresh-20261020')
        self.first_result(retirement={'scopeFingerprint':'b'*64})
        with self.assertRaises(ValueError):self.reserve(1500,'media-diag-second-20261020')

    def test_no_unapproved_clients_timing_transport_or_additional_generator(self):
        for kwargs in ({'clients':10000},{'hold':620},{'reconnect':40},{'transport':'stdlib'},
                {'suffix':'../unsafe'}):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):self.reserve(**kwargs)
        self.ledger['generators']*=2
        with self.assertRaises(ValueError):self.reserve()

    def test_new_independent_budget_reserves_two_billed_hours_without_reusing_prior_money(self):
        now=__import__('datetime').datetime.fromisoformat('2026-10-20T04:01:00+00:00').timestamp()
        result=runner.validate_budget(self.ledger,now)
        self.assertEqual(result['reservedBatchUsd'],.3)
        self.assertEqual(result['previousObservedComputeUsd'],0)
        self.ledger['generators']*=2
        with self.assertRaises(ValueError):runner.validate_budget(self.ledger,now)


if __name__=='__main__':unittest.main()
