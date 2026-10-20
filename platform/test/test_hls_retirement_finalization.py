"""Offline checks for retirement evidence and the finalizer's cleanup ordering."""
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import subprocess
import types
import unittest
from unittest import mock


SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


finalizer = load_script('retirement_finalization', 'finalize-guarded-retirement.py')
guard = load_script('retirement_guard_for_finalization', 'retire-load-generators.py')


class FinalizationTests(unittest.TestCase):
    def setUp(self):
        self.scope = dict(schemaVersion=1, runId='qsession-load-20261020-012345ab',
            tag='qs-retire-' + 'a' * 32, plan='vhp-8c-16gb-amd', region='ord',
            notBefore='2026-10-20T12:00:00Z', retireAt='2026-10-20T12:45:00Z',
            maximumInstances=7, budgetAuthorizationReference='call_NEW_APPROVAL_TEST_ONLY')
        self.ids = [f'11111111-1111-4111-8111-{index:012d}' for index in range(1, 8)]
        self.permanent = [dict(id='permanent-' + str(index), label='Permanent ' + str(index),
            main_ip=address, status='active', server_status='ok')
            for index, address in enumerate(sorted(guard.PERMANENT_IPS))]
        self.actions = []

    def event(self, deleted, pending=(), errors=(), **overrides):
        return dict(runId=self.scope['runId'], due=True, apply=True,
            deleted=list(deleted), pending=list(pending), errors=list(errors), **overrides)

    def split_events(self):
        return [self.event(self.ids[:5], self.ids[5:], ['target_retirement_failed']),
                self.event(self.ids[5:])]

    def output(self, rows):
        return '\n'.join(json.dumps(row) for row in rows)

    def execute_remote(self, rows, *, remaining=(), inventory=None, fingerprint=None, journal_code=0):
        """Run the actual remote body with in-memory paths, provider and processes."""
        actions = self.actions
        scope = self.scope
        inventory = self.permanent if inventory is None else inventory

        class FakePath:
            def __init__(self, value):
                self.value = str(value)

            def __truediv__(self, name):
                return FakePath(self.value + '/' + name)

            def unlink(self):
                actions.append(('unlink', self.value))

        class FakeProvider:
            def request(self, method, endpoint):
                actions.append(('provider', method, endpoint))
                if method != 'GET':
                    raise AssertionError('Finalization must never mutate provider resources')
                return {'instance': {}} if endpoint.rsplit('/', 1)[-1] in remaining else None

            def instances(self):
                actions.append(('inventory',))
                return inventory

        def private_text(path):
            if path.value.endswith('/scope.json'):
                return json.dumps(scope)
            if path.value.endswith('/vultr.key'):
                return 'offline-placeholder'
            raise AssertionError('Unexpected private path')

        fake_guard = types.SimpleNamespace(validate_scope=guard.validate_scope,
            private_text=private_text, Vultr=lambda key: FakeProvider(), PERMANENT_IPS=guard.PERMANENT_IPS)

        def run(command, **kwargs):
            actions.append(tuple(command))
            if command[0] == 'journalctl':
                return subprocess.CompletedProcess(command, journal_code, self.output(rows), '')
            if command[0] == 'systemctl':
                return subprocess.CompletedProcess(command, 0, '', '')
            raise AssertionError('External process forbidden in offline test')

        digest = fingerprint or hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()
        script = finalizer.REMOTE.replace('EXPECTED_FINGERPRINT', repr(digest))
        script = script.replace('EXPECTED_IDS', repr(self.ids))
        loader = types.SimpleNamespace(exec_module=lambda module: None)
        with mock.patch('importlib.util.spec_from_file_location', return_value=types.SimpleNamespace(loader=loader)), \
                mock.patch('importlib.util.module_from_spec', return_value=fake_guard), \
                mock.patch('pathlib.Path', FakePath), mock.patch('subprocess.run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            exec(compile(script, '<offline-finalization>', 'exec'), {})
        return json.loads(output.getvalue())

    def assert_no_cleanup(self):
        self.assertFalse(any(action[0] in ('systemctl', 'unlink') for action in self.actions))

    def test_split_successes_with_partial_failure_finalize_after_complete_absence(self):
        report = self.execute_remote(self.split_events())
        evidence = report['timerDeletionEvidence']
        self.assertEqual(evidence['deleted'], self.ids)
        self.assertEqual(evidence['contributingTimerChecks'], 2)
        self.assertEqual(evidence['checks'][0]['errors'], ['target_retirement_failed'])
        self.assertTrue(report['independentTimerDeletedAllSeven'])
        self.assertTrue(report['remoteApiCredentialRemoved'])
        self.assertEqual(sum(action[0] == 'provider' for action in self.actions), 7)
        journal_position = next(index for index, action in enumerate(self.actions) if action[0] == 'journalctl')
        self.assertTrue(all(index > journal_position for index, action in enumerate(self.actions)
                            if action[0] in ('systemctl', 'unlink')))

    def test_single_complete_event_still_finalizes(self):
        report = self.execute_remote([self.event(self.ids)])
        self.assertEqual(report['timerDeletionEvidence']['contributingTimerChecks'], 1)

    def test_foreign_or_malformed_rows_never_complete_missing_evidence(self):
        malformed = [None, [], 'message', 7,
            {**self.event(self.ids[5:]), 'runId': self.scope['runId'] + '-other'},
            {**self.event(self.ids[5:]), 'deleted': self.ids[5]},
            {**self.event(self.ids[5:]), 'deleted': [self.ids[5], self.ids[5], self.ids[6]]},
            {**self.event(self.ids[5:]), 'pending': [self.ids[5]]},
            {**self.event(self.ids[5:]), 'pending': ['unknown']},
            {**self.event(self.ids[5:]), 'errors': 'invalid'},
            {**self.event(self.ids[5:]), 'apply': False},
            {**self.event(self.ids[5:]), 'due': False},
            {**self.event(self.ids[5:]), 'deleted': self.ids[5:] + ['unknown']}]
        rows = [self.event(self.ids[:5]), *malformed]
        with self.assertRaisesRegex(SystemExit, 'evidence missing'):
            self.execute_remote(rows)
        self.assert_no_cleanup()
        with self.assertRaises(ValueError):
            finalizer.collect_timer_evidence('not json\n' + self.output(rows), self.scope['runId'], set(self.ids))

    def test_incomplete_same_run_evidence_keeps_guard_active(self):
        with self.assertRaisesRegex(SystemExit, 'evidence missing'):
            self.execute_remote([self.event(self.ids[:6])])
        self.assert_no_cleanup()

    def test_remaining_expected_instance_keeps_guard_active(self):
        with self.assertRaisesRegex(SystemExit, 'Disposable remains'):
            self.execute_remote(self.split_events(), remaining=[self.ids[-1]])
        self.assert_no_cleanup()

    def test_unknown_tagged_target_keeps_guard_active(self):
        tagged = {**self.permanent[0], 'tags': [self.scope['tag']]}
        with self.assertRaisesRegex(SystemExit, 'Unknown tagged target'):
            self.execute_remote(self.split_events(), inventory=[*self.permanent, tagged])
        self.assert_no_cleanup()

    def test_changed_permanent_inventory_keeps_guard_active(self):
        changed = [{**node, 'server_status': 'locked'} if index == 0 else node
                   for index, node in enumerate(self.permanent)]
        with self.assertRaisesRegex(SystemExit, 'Permanent inventory changed'):
            self.execute_remote(self.split_events(), inventory=changed)
        self.assert_no_cleanup()

    def test_scope_mismatch_keeps_guard_active(self):
        with self.assertRaisesRegex(SystemExit, 'Scope mismatch'):
            self.execute_remote(self.split_events(), fingerprint='0' * 64)
        self.assert_no_cleanup()

    def test_failed_journal_command_keeps_guard_active_even_with_complete_stdout(self):
        with self.assertRaisesRegex(SystemExit, 'journal unavailable'):
            self.execute_remote(self.split_events(), journal_code=1)
        self.assert_no_cleanup()


if __name__ == '__main__':
    unittest.main()
