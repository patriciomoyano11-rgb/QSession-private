import asyncio
import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import queue
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


orchestrator = load('sustained_orchestrator', 'orchestrate-hls-load.py')
client = load('sustained_client', 'hls-load-client.py')
runner = load('sustained_runner', 'run-custom-domain-load.py')


class SustainedEvidence(unittest.TestCase):
    def test_origin_wait_includes_scheduled_tail_and_cleanup_but_is_bounded(self):
        self.assertEqual(runner.origin_wait_seconds({'plannedStopAtUnix':1100},now=1000),160)
        self.assertEqual(runner.origin_wait_seconds({'plannedStopAtUnix':1400},now=1000),180)
        self.assertEqual(runner.origin_wait_seconds({'plannedStopAtUnix':900},now=1000),30)
        for value in (None, True, '1100', float('inf')):
            self.assertEqual(runner.origin_wait_seconds({'plannedStopAtUnix':value},now=1000),90)

    def test_late_origin_cleanup_is_retained_without_hiding_controller_failure(self):
        events=queue.Queue()
        events.put({'originReady':True})
        events.put({'unparsedOriginOutput':True})
        events.put({'originReport':{'cleanupComplete':True,'cancelled':False}})
        report={'errorClass':'TimeoutExpired','executionPassed':False}
        runner.collect_origin_report(events,report)
        self.assertTrue(report['origin']['cleanupComplete'])
        self.assertEqual(report['errorClass'],'TimeoutExpired')
        self.assertFalse(report['executionPassed'])
        self.assertTrue(events.empty())

    def fixture(self):
        inventory = {'runId': 'sustained-test-1000', 'startAtUnix': 1000,
                     'holdSeconds': 620, 'httpTransport': 'aiohttp', 'reconnectAfterSeconds': 240,
                     'generators': [{'id': 'test', 'ip': '8.8.8.8', 'label': 'qsession-load-test',
                                     'clients': 1000, 'logicalCpuCount': 8}]}
        workers = []
        for index in range(4):
            workers.append({'index': index, 'exitCode': 0, 'report': {
                'requestedClients': 250, 'distinctLeaseTokensPresented': 250,
                'deliveryCheckPassed': True, 'rampSeconds': 30, 'holdSeconds': 620,
                'counts': {'reconnectStartedClients': 25, 'reconnectMediaResumedClients': 25},
                'reconnection': {'mode': 'http-session-restart', 'afterSeconds': 240,
                    'passed': True, 'expectedClients': 25, 'maximumRecoveryMilliseconds': 4000},
                'samples': [{'observedAtUnix': 1000+t, 'elapsed': t, 'recentMediaClients': 250,
                    'activeClients': 250} for t in range(38, 650, 2)]}})
        return inventory, [{'nodeReport': {'runId': inventory['runId'], 'startAtUnix': 1000,
                                           'workers': workers}}]

    def test_requires_more_than_ten_minutes_of_aligned_full_media(self):
        inventory, results = self.fixture()
        report = orchestrator.aggregate(inventory, results)
        self.assertTrue(report['httpDeliveryChecksPassed'])
        self.assertEqual(report['completeSteadySamples'], 306)
        self.assertEqual(report['requiredSteadySpanSeconds'], 610)
        self.assertEqual(report['longestCommonFullMediaSpanSeconds'], 610)
        self.assertFalse(report['decodedPlaybackTested'])

    def test_a_good_first_minute_cannot_pass_a_long_run(self):
        inventory, results = self.fixture()
        for worker in results[0]['nodeReport']['workers']:
            worker['report']['samples'] = worker['report']['samples'][:26]
        self.assertFalse(orchestrator.aggregate(inventory, results)['httpDeliveryChecksPassed'])

    def test_one_missing_listener_late_in_run_fails(self):
        inventory, results = self.fixture()
        results[0]['nodeReport']['workers'][0]['report']['samples'][-2]['recentMediaClients'] = 249
        self.assertFalse(orchestrator.aggregate(inventory, results)['httpDeliveryChecksPassed'])

    def test_reconnect_requires_every_selected_client_and_bounded_recovery(self):
        inventory, results = self.fixture()
        for change in ({'reconnectMediaResumedClients': 24}, {'reconnectStartedClients': 0}):
            trial = copy.deepcopy(results)
            trial[0]['nodeReport']['workers'][0]['report']['counts'].update(change)
            self.assertFalse(orchestrator.aggregate(inventory, trial)['httpDeliveryChecksPassed'])
        results[0]['nodeReport']['workers'][0]['report']['reconnection']['maximumRecoveryMilliseconds'] = 12001
        self.assertFalse(orchestrator.aggregate(inventory, results)['httpDeliveryChecksPassed'])

    def test_short_worker_report_cannot_be_relabeled_as_sustained(self):
        inventory, results = self.fixture()
        results[0]['nodeReport']['workers'][0]['report']['holdSeconds'] = 60
        self.assertFalse(orchestrator.aggregate(inventory, results)['httpDeliveryChecksPassed'])

    def test_timing_refuses_unbounded_or_unrecoverable_runs(self):
        for values in ({'holdSeconds': 621}, {'holdSeconds': True},
                       {'reconnectAfterSeconds': 645}, {'reconnectAfterSeconds': 20},
                       {'reconnectAfterSeconds': 240, 'httpTransport': 'stdlib'}):
            with self.assertRaises(ValueError):
                orchestrator.timing({'holdSeconds': 620, 'httpTransport': 'aiohttp', **values})
        args = types.SimpleNamespace(clients=1, ramp=30, hold=620, reconnect_after=240, transport='aiohttp')
        client.validate_run_bounds(args)
        args.hold = 621
        with self.assertRaises(ValueError): client.validate_run_bounds(args)

    def test_manifest_diagnostics_only_record_known_failure_categories(self):
        response=types.SimpleNamespace(status=503,headers={'X-QSession-Manifest-Failure':'read'})
        self.assertEqual(client.transport_failure_evidence('manifest',response,0,'HttpStatus')['manifestFailure'],'read')
        response.headers['X-QSession-Manifest-Failure']='private-token-or-error-text'
        self.assertNotIn('manifestFailure',client.transport_failure_evidence('manifest',response,0,'HttpStatus'))

    def test_passing_load_does_not_hide_failed_cleanup_or_origin(self):
        nodes = [{'label': 'qsession-load-test'}]
        report = {'load': {'httpDeliveryChecksPassed': True}, 'observerExitCode': 0,
                  'originExitCode': 0, 'origin': {'cleanupComplete': True}, 'leaseCleanupExitCode': 0,
                  'leaseCleanup': [{'namespace': 'PRB10A', 'activeAfter': 0, 'privateMasterFileRemoved': True},
                                   {'label': nodes[0]['label'], 'privateLeaseFileRemoved': True}]}
        self.assertTrue(runner.execution_passed(report, nodes))
        for changes in ({'originExitCode': 2}, {'observerExitCode': 2}, {'errorClass': 'TimeoutError'},
                        {'leaseCleanup': report['leaseCleanup'][:1]}, {'origin': {}}):
            self.assertFalse(runner.execution_passed({**report, **changes}, nodes))


class StagedResourceGates(unittest.TestCase):
    def test_repeat_accounts_for_unverified_prior_charge_without_calling_it_observed(self):
        inventory={'sustainedLoad':True,'repeatSustainedLoad':True,'newBudget':{
            'status':'approved','authorizationReference':'call_REPEAT_TEST_APPROVAL_ONLY',
            'additionalComputeLimitUsd':3.6,'previousObservedComputeUsd':1.2,
            'previousReservedComputeUsd':0.3,
            'priorAuthorizationReference':'call_905dce8a6a194df1a7f2571513fcaed9',
            'priorSustainedAuthorizationReference':'call_0178dda16f0f45d18746bba2a7b35191'},
            'generators':[{'hourlyUsd':.132,'createdObservedUtc':'2026-10-20T02:00:00Z'} for _ in range(7)]}
        now=__import__('datetime').datetime.fromisoformat('2026-10-20T02:01:00+00:00').timestamp()
        result=runner.validate_budget(inventory,now)
        self.assertEqual(result['previousObservedComputeUsd'],1.2)
        self.assertEqual(result['previousReservedComputeUsd'],0.3)
        self.assertEqual(result['projectedObservedTotalUsd'],3.6)
        self.assertTrue(result['projectionIncludesUnverifiedReservation'])
        for changes in ({'previousReservedComputeUsd':0},{'additionalComputeLimitUsd':3.3},
                        {'additionalComputeLimitUsd':3.61},{'status':'proposed'},
                        {'authorizationReference':'call_0178dda16f0f45d18746bba2a7b35191'}):
            trial=copy.deepcopy(inventory);trial['newBudget'].update(changes)
            with self.assertRaises(ValueError):runner.validate_budget(trial,now)

    def test_repeat_scope_requires_a_fresh_approval_and_the_prior_reservation(self):
        scope=load('repeat_scope','prepare-retirement-scope.py')
        value={'status':'approved','authorizationReference':'call_REPEAT_TEST_APPROVAL_ONLY',
            'additionalComputeLimitUsd':3.6,'maximumGenerators':7,'repeatSustainedLoad':True,
            'priorBatchReservationUsd':0.3,'temporaryOrganizationApiAccessApproved':True,
            'temporaryPreviousIpRemovalApproved':True,'encoderIpCidr':'45.77.192.82/32',
            'restoreIpCidr':'217.138.213.4/32'}
        observed={'newAuthorizationObservedTotalUsd':1.2,'generatorsRetired':True}
        self.assertEqual(scope.sustained_approval(value,observed),value['authorizationReference'])
        for changes in ({'status':'proposed'},{'priorBatchReservationUsd':0},
                        {'authorizationReference':'call_0178dda16f0f45d18746bba2a7b35191'}):
            with self.assertRaises(ValueError):scope.sustained_approval({**value,**changes},observed)

    def test_proposed_budget_or_old_permission_cannot_arm_the_scope(self):
        scope = load('sustained_scope', 'prepare-retirement-scope.py')
        observed = {'newAuthorizationObservedTotalUsd': 1.2, 'generatorsRetired': True}
        approval = {'status': 'approved', 'authorizationReference': 'call_NEW_TEST_APPROVAL_ONLY',
            'additionalComputeLimitUsd': 3.3, 'maximumGenerators': 7,
            'temporaryOrganizationApiAccessApproved': True, 'temporaryPreviousIpRemovalApproved': True,
            'encoderIpCidr': '45.77.192.82/32', 'restoreIpCidr': '217.138.213.4/32'}
        self.assertEqual(scope.sustained_approval(approval, observed), approval['authorizationReference'])
        for changes in ({'status': 'proposed'}, {'authorizationReference': 'call_905dce8a6a194df1a7f2571513fcaed9'},
                        {'temporaryOrganizationApiAccessApproved': False}, {'encoderIpCidr': '0.0.0.0/0'}):
            with self.assertRaises(ValueError): scope.sustained_approval({**approval, **changes}, observed)
        with self.assertRaises(ValueError): scope.sustained_approval(approval, {**observed, 'newAuthorizationObservedTotalUsd': 1.35})

    def test_full_batch_reserves_two_hours_per_node_against_explicit_expanded_ceiling(self):
        inventory = {'sustainedLoad': True, 'newBudget': {'status': 'approved',
            'authorizationReference': 'call_NEW_TEST_APPROVAL_ONLY', 'additionalComputeLimitUsd': 3.3,
            'priorAuthorizationReference': 'call_905dce8a6a194df1a7f2571513fcaed9',
            'previousObservedComputeUsd': 1.2},
            'generators': [{'hourlyUsd': .132, 'createdObservedUtc': '2026-10-20T02:00:00Z'} for _ in range(7)]}
        now = __import__('datetime').datetime.fromisoformat('2026-10-20T02:01:00+00:00').timestamp()
        result = runner.validate_budget(inventory, now)
        self.assertEqual(result['projectedObservedTotalUsd'], 3.3)
        self.assertEqual(result['reservedBatchUsd'], 2.1)
        for changes in ({'additionalComputeLimitUsd': 3}, {'additionalComputeLimitUsd': 3.31},
                        {'authorizationReference': 'call_905dce8a6a194df1a7f2571513fcaed9'}):
            trial = copy.deepcopy(inventory); trial['newBudget'].update(changes)
            with self.assertRaises(ValueError): runner.validate_budget(trial, now)

    def test_remaining_six_generators_require_two_distinct_confirmations_from_same_scope(self):
        provision = load('sustained_provision', 'provision-guarded-load.py')
        names = ['custom-domain-load-execution-sustained-pilot-a.json',
                 'custom-domain-load-execution-sustained-pilot-b.json']
        ledger = {'retirementScopeFingerprint': 'a'*64, 'confirmationExecutions': names}
        value = {'executionPassed': True, 'holdSeconds': 60,
                 'retirement': {'scopeFingerprint': 'a'*64},
                 'load': {'requestedClients': 1000, 'httpDeliveryChecksPassed': True}}
        with tempfile.TemporaryDirectory() as folder:
            release = pathlib.Path(folder)
            for name in names: (release/name).write_text(json.dumps(value))
            provision.validate_staged_confirmation(ledger, release)
            for changes in ({'confirmationExecutions': names[:1]}, {'confirmationExecutions': [names[0], names[0]]},
                            {'retirementScopeFingerprint': 'b'*64}):
                with self.assertRaises(ValueError): provision.validate_staged_confirmation({**ledger, **changes}, release)
            (release/names[1]).write_text(json.dumps({**value, 'executionPassed': False}))
            with self.assertRaises(ValueError): provision.validate_staged_confirmation(ledger, release)


class SessionRestartFlow(unittest.IsolatedAsyncioTestCase):
    async def test_closes_real_client_pool_reuses_token_and_waits_for_complete_media(self):
        # Transport fixture exercises the full async client state machine without
        # cloud traffic, TLS credentials or an optional aiohttp installation.
        started = time.monotonic()
        sessions, requests = [], []
        token = 'synthetic-test-token-0001'
        segment = b'G' + b'\x00' * (188 * 6000 - 1)

        class Content:
            def __init__(self, data): self.data = data
            async def iter_chunked(self, size):
                for offset in range(0, len(self.data), size):
                    yield self.data[offset:offset+size]

        class Request:
            def __init__(self, data, traces, timing):
                self.status = 200
                self.headers = {'Content-Length': str(len(data))}
                self.content = Content(data)
                self.traces, self.timing = traces, timing
            async def __aenter__(self):
                context = types.SimpleNamespace(trace_request_ctx=self.timing)
                for trace in self.traces:
                    for name in ('on_connection_create_start', 'on_connection_create_end', 'on_request_headers_sent'):
                        for callback in getattr(trace, name):
                            await callback(None, context, types.SimpleNamespace(url='PRIVATE', headers={'Secret':'PRIVATE'}))
                return self
            async def __aexit__(self, *args): pass

        class TraceConfig:
            def __init__(self):
                for name in ('on_connection_queued_start', 'on_connection_queued_end',
                             'on_dns_resolvehost_start', 'on_dns_resolvehost_end',
                             'on_connection_create_start', 'on_connection_create_end',
                             'on_connection_reuseconn', 'on_request_headers_sent'):
                    setattr(self, name, [])

        class Session:
            def __init__(self, **kwargs):
                self.closed = False
                self.traces = kwargs.get('trace_configs', [])
                sessions.append(self)
            async def __aenter__(self): return self
            async def __aexit__(self, *args): await self.close()
            async def close(self): self.closed = True
            def get(self, url, **kwargs):
                if self.closed: raise AssertionError('Closed session reused')
                if not self.traces or not isinstance(kwargs.get('trace_request_ctx'), client.RequestTiming):
                    raise AssertionError('Main and restarted sessions must trace the actual request context')
                requests.append((sessions.index(self), url))
                if 'index.m3u8' not in url: return Request(segment, self.traces, kwargs['trace_request_ctx'])
                sequence = int((time.monotonic() - started) // 6)
                text = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:' + str(max(0, sequence-4)) + '\n'
                for number in range(max(0, sequence-4), sequence+1):
                    text += '#EXTINF:6,\nsegment_load_0123456789abcdef_' + str(number).zfill(5) + '.ts?qsat=' + token + '\n'
                return Request(text.encode(), self.traces, kwargs['trace_request_ctx'])

        fake = types.SimpleNamespace(ClientSession=Session, TCPConnector=lambda **kwargs: None,
            ClientTimeout=lambda **kwargs: None, ClientError=type('ClientError', (Exception,), {}),
            TraceConfig=TraceConfig)
        args = types.SimpleNamespace(clients=1, ramp=1, hold=22, reconnect_after=3, transport='aiohttp',
                                     tokens_file=True, start_at_unix=0, progress=False)
        output = io.StringIO()
        with mock.patch.dict(sys.modules, {'aiohttp': fake}), \
             mock.patch.object(client, 'read_tokens', return_value=[token]), \
             mock.patch.object(client, 'proc_metrics', return_value={'availableMemoryKiB': 1000000}), contextlib.redirect_stdout(output):
            status = await client.main(args)
        report = json.loads(output.getvalue())
        self.assertEqual(status, 0, json.dumps({key: report.get(key) for key in ('stopReason', 'counts', 'errors', 'reconnection')}))
        self.assertEqual(report['counts']['reconnectStartedClients'], 1)
        self.assertEqual(report['counts']['reconnectMediaResumedClients'], 1)
        self.assertTrue(report['reconnection']['passed'])
        self.assertEqual(len(sessions), 3)
        self.assertTrue(all(session.closed for session in sessions))
        self.assertTrue(any(index == 1 for index, _ in requests))
        self.assertTrue(any(index == 2 for index, _ in requests))
        self.assertTrue(all(url.endswith('?qsat=' + token) for _, url in requests))
        self.assertEqual(len(report['transportInstrumentation']['aiohttpTraceSignals']), 8)
        phases = report['transportInstrumentation']['timings']['phases']
        self.assertIn('manifestConnectionCreateIncludingDnsTcpTls', phases)
        self.assertIn('segmentHeadersToBodyComplete', phases)
        self.assertFalse(report['transportInstrumentation']['separateTlsHandshakeObserved'])
        self.assertNotIn('PRIVATE', json.dumps(report))


if __name__ == '__main__': unittest.main()
