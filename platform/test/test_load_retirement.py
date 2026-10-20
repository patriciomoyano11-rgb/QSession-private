import copy
import importlib.util
import pathlib
import unittest
from unittest import mock

path = pathlib.Path(__file__).resolve().parents[1] / 'scripts/retire-load-generators.py'
spec = importlib.util.spec_from_file_location('retirement', path)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class FakeProvider:
    def __init__(self, instances):
        self.items = {item['id']: item for item in instances}
        self.calls = []
        self.fail_delete = set()
        self.retain_deleted = False
        self.change = None

    def instances(self):
        return copy.deepcopy(list(self.items.values()))

    def request(self, method, endpoint):
        self.calls.append((method, endpoint))
        identifier = endpoint.rsplit('/', 1)[-1]
        if method == 'GET':
            value = copy.deepcopy(self.items.get(identifier))
            if value is not None and self.change:
                value.update(self.change)
            return {'instance': value} if value else None
        if identifier in self.fail_delete:
            raise RuntimeError('temporary API failure')
        if not self.retain_deleted:
            self.items.pop(identifier, None)


class RetirementTests(unittest.TestCase):
    def setUp(self):
        self.scope = dict(schemaVersion=1, runId='qsession-load-20261020-012345ab',
            tag='qs-retire-' + 'a' * 32, plan='vhp-8c-16gb-amd', region='ord',
            notBefore='2026-10-20T12:00:00Z', retireAt='2026-10-20T12:45:00Z',
            maximumInstances=7, budgetAuthorizationReference='call_NEW_APPROVAL_TEST_ONLY')
        self.instance = dict(id='11111111-1111-4111-8111-111111111111',
            label=self.scope['runId'] + '-chi1', tags=[self.scope['tag']],
            plan=self.scope['plan'], region='ord', main_ip='8.8.8.8',
            date_created='2026-10-20T12:01:00Z')
        self.due = guard.instant(self.scope['retireAt'])

    def test_no_deletion_early_or_without_apply(self):
        for now, apply in ((self.due - 1, True), (self.due + 1, False)):
            api = FakeProvider([self.instance])
            report = guard.assess(api, self.scope, now, apply)
            self.assertEqual(len(report['pending']), 1)
            self.assertEqual(api.calls, [])

    def test_due_delete_is_verified_and_idempotent(self):
        api = FakeProvider([self.instance])
        report = guard.assess(api, self.scope, self.due, True)
        self.assertEqual(report['deleted'], [self.instance['id']])
        self.assertEqual([method for method, _ in api.calls], ['GET', 'DELETE', 'GET'])
        self.assertEqual(guard.assess(api, self.scope, self.due + 60, True)['pending'], [])

    def test_dedicated_batch_preserves_exact_plan_ownership_checks(self):
        self.scope['plan']='voc-c-8c-16gb-150s-amd'
        guard.validate_scope(self.scope)
        self.instance['plan']=self.scope['plan']
        api=FakeProvider([self.instance])
        self.assertEqual(guard.assess(api,self.scope,self.due,True)['deleted'],[self.instance['id']])
        api=FakeProvider([{**self.instance,'plan':'vhp-8c-16gb-amd'}])
        self.assertTrue(guard.assess(api,self.scope,self.due,True)['errors'])
        self.assertEqual(api.calls,[])

    def test_never_deletes_three_permanent_servers_even_if_mistagged(self):
        for address in guard.PERMANENT_IPS:
            api = FakeProvider([{**self.instance, 'main_ip': address}])
            report = guard.assess(api, self.scope, self.due, True)
            self.assertTrue(report['errors'])
            self.assertEqual(api.calls, [])

    def test_label_is_not_enough_without_batch_tag(self):
        api = FakeProvider([{**self.instance, 'tags': []}])
        self.assertEqual(guard.assess(api, self.scope, self.due, True)['pending'], [])
        self.assertEqual(api.calls, [])

    def test_scope_mismatch_rejected(self):
        changes = [dict(label='Qsound Produccion1'), dict(plan='different'), dict(region='mia'),
                   dict(date_created='2026-10-20T11:59:59Z'),
                   dict(date_created=self.scope['retireAt']), dict(id='../../another-server')]
        for change in changes:
            api = FakeProvider([{**self.instance, **change}])
            self.assertTrue(guard.assess(api, self.scope, self.due, True)['errors'])
            self.assertEqual(api.calls, [])

    def test_changed_target_is_checked_again_before_delete(self):
        api = FakeProvider([self.instance])
        api.change = {'main_ip': '45.77.118.43'}
        report = guard.assess(api, self.scope, self.due, True)
        self.assertTrue(report['errors'])
        self.assertNotIn('DELETE', [method for method, _ in api.calls])

    def test_provider_failure_retries_next_tick(self):
        api = FakeProvider([self.instance])
        api.fail_delete.add(self.instance['id'])
        report = guard.assess(api, self.scope, self.due, True)
        self.assertEqual(report['pending'], [self.instance['id']])
        api.fail_delete.clear()
        self.assertEqual(guard.assess(api, self.scope, self.due + 60, True)['pending'], [])

    def test_failure_on_one_target_does_not_block_other_cleanup(self):
        second = {**self.instance, 'id': '22222222-2222-4222-8222-222222222222',
                  'label': self.scope['runId'] + '-chi2'}
        api = FakeProvider([self.instance, second])
        api.fail_delete.add(self.instance['id'])
        report = guard.assess(api, self.scope, self.due, True)
        self.assertEqual(report['pending'], [self.instance['id']])
        self.assertEqual(report['deleted'], [second['id']])

    def test_delete_success_without_absence_stays_pending(self):
        api = FakeProvider([self.instance])
        api.retain_deleted = True
        report = guard.assess(api, self.scope, self.due, True)
        self.assertTrue(report['errors'])
        self.assertEqual(report['pending'], [self.instance['id']])
        self.assertEqual(report['deleted'], [])

    def test_provisioning_orphan_with_no_ip_can_be_retired(self):
        api = FakeProvider([{**self.instance, 'main_ip': ''}])
        self.assertEqual(guard.assess(api, self.scope, self.due, True)['pending'], [])

    def test_excess_targets_fail_closed(self):
        scope = {**self.scope, 'maximumInstances': 1}
        second = {**self.instance, 'id': '22222222-2222-4222-8222-222222222222'}
        api = FakeProvider([self.instance, second])
        self.assertIn('batch_size_exceeded', guard.assess(api, scope, self.due, True)['errors'])
        self.assertEqual(api.calls, [])

    def test_expired_budgets_or_unbounded_deadline_rejected_before_api(self):
        changes = [dict(budgetAuthorizationReference='call_7a6df35e769a41afaaca8f49a07ded5c'),
                   dict(budgetAuthorizationReference='PENDING'),
                   dict(retireAt='2026-10-21T12:00:00Z'), dict(tag='qsession'),
                   dict(notBefore='2026-10-20T12:00:00'), dict(maximumInstances=True)]
        for change in changes:
            api = FakeProvider([self.instance])
            with self.assertRaises((ValueError, TypeError)):
                guard.assess(api, {**self.scope, **change}, self.due, True)
            self.assertEqual(api.calls, [])

    def test_api_client_refuses_redirect_or_arbitrary_endpoints(self):
        api = guard.Vultr('not-a-real-key')
        for endpoint in ('https://other.test/instances', '/instances/../../account', '/account'):
            with self.assertRaises(ValueError):
                api.request('GET', endpoint)
        self.assertIsNone(guard.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.test'))

    def test_preflight_requires_enabled_active_timer_and_time_reserve(self):
        api = FakeProvider([self.instance])
        with mock.patch.object(guard.subprocess, 'run', return_value=mock.Mock(returncode=0)):
            proof = guard.preflight(api, self.scope, self.due - 1200)
            self.assertTrue(proof['independentTimerActive'])
            self.assertEqual(len(proof['scopeFingerprint']), 64)
            with self.assertRaises(ValueError):
                guard.preflight(api, self.scope, self.due - 899)
        with mock.patch.object(guard.subprocess, 'run', return_value=mock.Mock(returncode=1)):
            with self.assertRaises(ValueError):
                guard.preflight(api, self.scope, self.due - 1200)
        self.assertEqual(api.calls, [])


class LoadRetirementGate(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('runner_guard', path.parent / 'run-custom-domain-load.py')
        self.runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runner)
        self.now = guard.instant('2026-10-20T12:10:00Z')
        self.inventory = {'runId': 'qsession-load-20261020-012345ab',
            'retirementScopeFingerprint': 'a' * 64,
            'newBudget': {'status': 'approved', 'authorizationReference': 'call_NEW_APPROVAL_TEST_ONLY',
                          'additionalComputeLimitUsd': 3},
            'generators': [{'id': str(i), 'hourlyUsd': 0.132,
                            'createdObservedUtc': '2026-10-20T12:01:00Z'} for i in range(7)]}
        self.proof = {'runId': self.inventory['runId'], 'independentTimerActive': True,
            'scopeFingerprint': 'a' * 64, 'budgetAuthorizationReference': 'call_NEW_APPROVAL_TEST_ONLY',
            'maximumInstances': 7, 'checkedAtUnix': self.now, 'retireAt': '2026-10-20T12:45:00Z',
            'apply': False, 'due': False, 'errors': [], 'pending': [str(i) for i in range(7)]}

    def test_new_budget_reserves_two_hours_and_rejects_unapproved_proposal(self):
        result = self.runner.validate_budget(self.inventory, self.now)
        self.assertEqual(result['reservedBatchUsd'], 2.1)
        for change in ({'status': 'proposed'}, {'additionalComputeLimitUsd': 2},
                       {'authorizationReference': 'call_7a6df35e769a41afaaca8f49a07ded5c'}):
            inventory = copy.deepcopy(self.inventory)
            inventory['newBudget'].update(change)
            with self.assertRaises(ValueError):
                self.runner.validate_budget(inventory, self.now)

    def test_only_matching_fresh_remote_retirement_proof_unlocks_load(self):
        self.assertEqual(self.runner.validate_retirement(self.inventory, self.proof, self.now)['verifiedGenerators'], 7)
        changes = [{'scopeFingerprint': 'b' * 64}, {'pending': ['0']}, {'checkedAtUnix': self.now - 31},
                   {'independentTimerActive': False}, {'errors': ['API_failure']}, {'due': True},
                   {'runId': 'different'}, {'budgetAuthorizationReference': 'old'},
                   {'retireAt': '2026-10-20T12:11:00Z'}]
        for change in changes:
            with self.assertRaises(ValueError):
                self.runner.validate_retirement(self.inventory, {**self.proof, **change}, self.now)

    def test_fractional_clock_skew_allowed_but_future_proofs_rejected(self):
        proof={**self.proof,'checkedAtUnix':self.now+0.2}
        self.assertTrue(self.runner.validate_retirement(self.inventory,proof,self.now)['independentTimerActive'])
        with self.assertRaises(ValueError):
            self.runner.validate_retirement(self.inventory,{**proof,'checkedAtUnix':self.now+6},self.now)


if __name__ == '__main__':
    unittest.main()
