import copy
import hashlib
import importlib.util
import json
import pathlib
import types
import unittest
import uuid
from unittest import mock

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


orchestrator = load('generator_orchestrator', 'orchestrate-hls-load.py')
client = load('generator_client', 'hls-load-client.py')


class GeneratorPartitions(unittest.TestCase):
    def fixture(self, workers=4, clients=1429):
        node = {'id':'00000000-0000-0000-0000-000000000001', 'ip':'8.8.8.8',
                'label':'qsession-load-local-test', 'ownedForThisTest':True,
                'logicalCpuCount':8, 'clients':clients, 'workersPerNode':workers}
        inventory = {'runId':'local-generator-test', 'startAtUnix':1000, 'holdSeconds':620,
                     'deliveryHost':'live.staging.qsession.test',
                     'httpTransport':'aiohttp', 'reconnectAfterSeconds':240, 'generators':[node]}
        reports = []
        for index, count in enumerate(orchestrator.client_splits(node)):
            reconnects = (count+9)//10
            reports.append({'index':index, 'exitCode':0, 'report':{
                'requestedClients':count, 'distinctLeaseTokensPresented':count,
                'deliveryCheckPassed':True, 'rampSeconds':30, 'holdSeconds':620,
                'counts':{'reconnectStartedClients':reconnects, 'reconnectMediaResumedClients':reconnects},
                'reconnection':{'mode':'http-session-restart', 'afterSeconds':240,
                    'passed':True, 'expectedClients':reconnects, 'maximumRecoveryMilliseconds':4000},
                'samples':[{'observedAtUnix':1000+t, 'elapsed':t,
                    'recentMediaClients':count, 'activeClients':count, 'processCpuPercent':20,
                    'systemCpuPercent':20} for t in range(38,650,2)]}})
        results = [{'nodeReport':{'runId':inventory['runId'], 'startAtUnix':1000,
                                 'cpuVerification':{'declaredLogicalCpuCount':8,'observedLogicalCpuCount':8,
                                     'affinityCpuCount':8,'effectiveCpuCount':8,
                                     'cpuQuotaObserved':True,'cpuQuotaCores':None},
                                 'workersPerNode':workers, 'workers':reports}}]
        return inventory, results

    def test_default_four_preserves_historical_client_partition(self):
        self.assertEqual(orchestrator.client_splits({'clients':1429}), (358,357,357,357))
        self.assertEqual(orchestrator.client_splits({'clients':1428}), (357,357,357,357))
        self.assertEqual(orchestrator.workers_per_node({}), 4)

    def test_eight_balances_remainders_and_requires_explicit_cpu_count(self):
        node = {'clients':1429, 'workersPerNode':8, 'logicalCpuCount':8}
        self.assertEqual(orchestrator.client_splits(node), (179,179,179,179,179,178,178,178))
        for change in ({'logicalCpuCount':4}, {'logicalCpuCount':True}, {'workersPerNode':True},
                       {'workersPerNode':16}, {'clients':7}, {'clients':1501}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                orchestrator.client_splits({**node, **change})
        del node['logicalCpuCount']
        with self.assertRaises(ValueError): orchestrator.client_splits(node)

    def test_inventory_keeps_partition_but_never_accepts_10001(self):
        inventory, _ = self.fixture(8)
        clean = orchestrator.validate_inventory(inventory, now=990)
        self.assertEqual(clean['generators'][0]['workersPerNode'], 8)
        nodes = []
        for index in range(7):
            node = {**inventory['generators'][0], 'id':str(uuid.UUID(int=index+1)),
                    'ip':'8.8.8.'+str(index+1), 'label':'qsession-load-local-'+str(index),
                    'clients':1429 if index<6 else 1427}
            nodes.append(node)
        with self.assertRaises(ValueError):
            orchestrator.validate_inventory({**inventory, 'generators':nodes}, now=990)
        nodes[-1]['clients'] = 1426
        self.assertEqual(sum(n['clients'] for n in orchestrator.validate_inventory(
            {**inventory, 'generators':nodes}, now=990)['generators']),10000)

    def test_eight_workers_preserve_all_sustained_and_reconnection_requirements(self):
        inventory, results = self.fixture(8)
        report = orchestrator.aggregate(inventory, results)
        self.assertTrue(report['httpDeliveryChecksPassed'])
        self.assertEqual(report['expectedWorkers'],8)
        self.assertEqual(report['completeSteadySamples'],306)
        self.assertEqual(report['requiredSteadySpanSeconds'],610)
        self.assertEqual(report['nodes'][0]['expectedReconnectionClients'],144)
        self.assertEqual(report['nodes'][0]['processCpuSaturationThresholdPercent'],90)
        self.assertFalse(report['nodes'][0]['nicHeadroomObservable'])
        for mutate in ('missing', 'duplicate', 'one_listener', 'one_reconnection', 'slow_reconnection', 'cpu', 'cpu_unverified'):
            trial = copy.deepcopy(results)
            workers = trial[0]['nodeReport']['workers']
            if mutate == 'missing': workers.pop()
            if mutate == 'duplicate': workers.append(copy.deepcopy(workers[0]))
            if mutate == 'one_listener': workers[0]['report']['samples'][-1]['recentMediaClients'] -= 1
            if mutate == 'one_reconnection': workers[0]['report']['counts']['reconnectMediaResumedClients'] -= 1
            if mutate == 'slow_reconnection': workers[0]['report']['reconnection']['maximumRecoveryMilliseconds'] = 12001
            if mutate == 'cpu':
                for sample in workers[0]['report']['samples']: sample['processCpuPercent'] = 95
            if mutate == 'cpu_unverified': trial[0]['nodeReport'].pop('cpuVerification')
            with self.subTest(mutate=mutate):
                self.assertFalse(orchestrator.aggregate(inventory,trial)['httpDeliveryChecksPassed'])

    def test_mixed_nodes_have_sum_of_configured_workers_and_missing_node_fails(self):
        first, first_results = self.fixture(4)
        second, second_results = self.fixture(8)
        second['generators'][0]['id'] = 'second'
        second['generators'][0]['label'] += '-second'
        inventory = {**first, 'generators':first['generators']+second['generators']}
        report = orchestrator.aggregate(inventory,first_results+second_results)
        self.assertTrue(report['httpDeliveryChecksPassed'])
        self.assertEqual(report['expectedWorkers'],12)
        self.assertFalse(orchestrator.aggregate(inventory,first_results)['httpDeliveryChecksPassed'])

    def test_remote_cpu_and_quota_rejection_happen_before_any_token_file_access(self):
        reviewed_source = b'reviewed-client-source'
        args = ['-', 'local-generator-test', '1000', '1429', 'live.staging.qsession.test', 'aiohttp',
                '620', '240', '8', '8', hashlib.sha256(reviewed_source).hexdigest(), 'b'*64, 'c'*64]
        for cpu_count, affinity_count, quota in ((4,4,{}), (8,4,{}),
                (8,8,{'cpuQuotaObserved':True,'cpuQuotaCores':4}), (8,8,{'cpuQuotaObserved':False})):
            with self.subTest(cpus=cpu_count,affinity=affinity_count,quota=quota), \
                 mock.patch('sys.argv',args), mock.patch('os.cpu_count',return_value=cpu_count), \
                 mock.patch('os.sched_getaffinity',return_value=set(range(affinity_count)),create=True), \
                 mock.patch.object(pathlib.Path,'is_file',return_value=True), \
                 mock.patch.object(pathlib.Path,'is_symlink',return_value=False), \
                 mock.patch.object(pathlib.Path,'stat',return_value=types.SimpleNamespace(st_uid=0,st_mode=0o100600)), \
                 mock.patch.object(pathlib.Path,'read_bytes',return_value=reviewed_source), \
                 mock.patch('runpy.run_path',return_value={'cgroup_metrics':lambda:quota}), \
                 mock.patch('os.umask'), mock.patch('os.open') as token_open:
                with self.assertRaises(SystemExit):
                    exec(compile(orchestrator.REMOTE_SCRIPT,'<remote-controller>','exec'),{})
                token_open.assert_not_called()

    def test_remote_command_preserves_watchdog_scope_and_provenance_without_ssh(self):
        inventory, _ = self.fixture(8)
        clean = orchestrator.validate_inventory(inventory,now=990)
        with mock.patch.object(orchestrator.subprocess,'run',return_value=types.SimpleNamespace(
                returncode=0,stdout=b'{}',stderr=b'')) as process:
            orchestrator.run_node(clean['generators'][0],clean)
        command = process.call_args.args[0]
        self.assertEqual(command[-5:-3],['8','8'])
        self.assertTrue(all(len(value)==64 for value in command[-3:]))
        self.assertIn("'/usr/bin/timeout','--signal=TERM','--kill-after=5s'",orchestrator.REMOTE_SCRIPT)
        self.assertIn("not 60 <= hold <= 620",orchestrator.REMOTE_SCRIPT)


class ProvenanceAndCounters(unittest.TestCase):
    def test_configuration_hash_ignores_secrets_but_changes_with_actual_run_parameters(self):
        args = types.SimpleNamespace(clients=358,ramp=30,hold=620,reconnect_after=240,
            transport='aiohttp',start_at_unix=1000,tokens_file='PRIVATE',secret='PRIVATE')
        result = client.run_provenance(args)
        self.assertNotIn('PRIVATE',json.dumps(result))
        args.tokens_file = 'DIFFERENT_PRIVATE'
        self.assertEqual(result['configurationSha256'],client.run_provenance(args)['configurationSha256'])
        args.clients = 179
        self.assertNotEqual(result['configurationSha256'],client.run_provenance(args)['configurationSha256'])
        self.assertEqual(result['clientSha256'],hashlib.sha256((SCRIPTS/'hls-load-client.py').read_bytes()).hexdigest())
        self.assertIn('python',result['runtime'])
        self.assertIn('openssl',result['runtime'])

    def test_controller_hashes_match_reviewed_sources_and_effective_partition(self):
        inventory, _ = GeneratorPartitions().fixture()
        result = orchestrator.reproducibility_metadata(inventory)
        changed = copy.deepcopy(inventory)
        changed['generators'][0]['workersPerNode'] = 8
        self.assertNotEqual(result['configurationSha256'],orchestrator.reproducibility_metadata(changed)['configurationSha256'])
        self.assertEqual(result['orchestrationSha256'],hashlib.sha256((SCRIPTS/'orchestrate-hls-load.py').read_bytes()).hexdigest())

    def cgroup_fixture(self):
        return {'/proc/self/cgroup':'0::/\n',
            '/proc/self/mountinfo':'29 23 0:26 / /sys/fs/cgroup rw,nosuid,nodev,noexec - cgroup2 cgroup rw\n',
            '/sys/fs/cgroup/cgroup.controllers':'cpuset cpu io memory pids\n',
            '/sys/fs/cgroup/cpu.stat':'usage_usec 12345\nuser_usec 12000\nsystem_usec 345\n'
                'nr_periods 4\nnr_throttled 2\nthrottled_usec 1234\n'}

    def inspect_cgroup(self, files):
        def read(path, *args, **kwargs):
            value = files.get(path.as_posix(), FileNotFoundError())
            if isinstance(value, BaseException): raise value
            return value
        def entries(path):
            return iter(pathlib.Path(key) for key in files if pathlib.PurePosixPath(key).parent.as_posix()==path.as_posix())
        with mock.patch.object(pathlib.Path,'read_text',read), mock.patch.object(pathlib.Path,'iterdir',entries):
            return client.cgroup_metrics()

    def test_v2_full_root_without_cpu_max_is_observed_unlimited_with_cpu_controller_evidence(self):
        result = self.inspect_cgroup(self.cgroup_fixture())
        self.assertTrue(result['cpuQuotaObserved'])
        self.assertTrue(result['cgroupV2FullRootMountVerified'])
        self.assertTrue(result['cpuControllerAvailable'])
        self.assertTrue(result['cpuRootQuotaNotApplicable'])
        self.assertEqual(result['cpuQuotaAncestorLevelsObserved'],1)
        self.assertIsNone(result['cpuQuotaCores'])
        self.assertEqual(result['cpuThrottledPeriods'],2)
        self.assertEqual(result['cpuThrottledMicroseconds'],1234)
        self.assertNotIn('cgroupMetricsUnavailable',result)

    def test_explicit_unlimited_quota_is_distinguished_from_unobserved(self):
        files = self.cgroup_fixture()
        files['/sys/fs/cgroup/cpu.max'] = 'max 100000\n'
        result = self.inspect_cgroup(files)
        self.assertTrue(result['cpuQuotaObserved'])
        self.assertIsNone(result['cpuQuotaCores'])
        self.assertNotIn('cpuRootQuotaNotApplicable',result)
        with mock.patch.object(pathlib.Path,'read_text',side_effect=OSError):
            self.assertTrue(client.cgroup_metrics()['cgroupMetricsUnavailable'])

    def test_missing_root_quota_does_not_hide_inaccessible_or_ambiguous_hierarchy(self):
        trials = [
            ('/proc/self/cgroup','0::/\n0::/other\n'),
            ('/proc/self/mountinfo','29 23 0:26 /delegated /sys/fs/cgroup rw - cgroup2 cgroup rw\n'),
            ('/proc/self/mountinfo',PermissionError()),
            ('/sys/fs/cgroup/cgroup.controllers','memory pids\n'),
            ('/sys/fs/cgroup/cpu.stat',PermissionError()),
            ('/sys/fs/cgroup/cpu.max',PermissionError()),
        ]
        for path, value in trials:
            with self.subTest(path=path,value=str(value)):
                result = self.inspect_cgroup({**self.cgroup_fixture(),path:value})
                self.assertFalse(result['cpuQuotaObserved'])
                self.assertTrue(result['cgroupMetricsUnavailable'])
                self.assertNotIn('cpuQuotaCores',result)
        files = self.cgroup_fixture()
        with mock.patch.object(pathlib.Path,'read_text',lambda path:files[path.as_posix()]), \
             mock.patch.object(pathlib.Path,'iterdir',side_effect=PermissionError()):
            # Use a FileNotFoundError for cpu.max rather than a missing mock key.
            def read(path):
                if path.name=='cpu.max': raise FileNotFoundError()
                return files[path.as_posix()]
            with mock.patch.object(pathlib.Path,'read_text',read):
                self.assertFalse(client.cgroup_metrics()['cpuQuotaObserved'])

    def test_non_root_unlimited_child_respects_parent_quota_and_requires_every_ancestor(self):
        files = self.cgroup_fixture()
        files['/proc/self/cgroup'] = '0::/system.slice/client.service\n'
        files['/sys/fs/cgroup/system.slice/client.service/cpu.stat'] = files['/sys/fs/cgroup/cpu.stat']
        files['/sys/fs/cgroup/system.slice/client.service/cpu.max'] = 'max 100000\n'
        files['/sys/fs/cgroup/system.slice/cpu.max'] = '400000 100000\n'
        result = self.inspect_cgroup(files)
        self.assertTrue(result['cpuQuotaObserved'])
        self.assertEqual(result['cpuQuotaCores'],4)
        self.assertEqual(result['cpuQuotaAncestorLevelsObserved'],3)
        del files['/sys/fs/cgroup/system.slice/client.service/cpu.max']
        self.assertFalse(self.inspect_cgroup(files)['cpuQuotaObserved'])

    def test_remote_eight_accepts_proven_full_root_unlimited_before_opening_tokens(self):
        evidence = self.inspect_cgroup(self.cgroup_fixture())
        reviewed_source = b'reviewed-client-source'
        args = ['-', 'local-generator-test', '1000', '1429', 'live.staging.qsession.test', 'aiohttp',
                '620', '240', '8', '8', hashlib.sha256(reviewed_source).hexdigest(), 'b'*64, 'c'*64]
        with mock.patch('sys.argv',args), mock.patch('os.cpu_count',return_value=8), \
             mock.patch('os.sched_getaffinity',return_value=set(range(8)),create=True), \
             mock.patch.object(pathlib.Path,'is_file',return_value=True), \
             mock.patch.object(pathlib.Path,'is_symlink',return_value=False), \
             mock.patch.object(pathlib.Path,'stat',return_value=types.SimpleNamespace(st_uid=0,st_mode=0o100600)), \
             mock.patch.object(pathlib.Path,'read_bytes',return_value=reviewed_source), \
             mock.patch('runpy.run_path',return_value={'cgroup_metrics':lambda:evidence}), \
             mock.patch('os.umask'), mock.patch('os.open') as token_open:
            namespace = {}
            exec(compile(orchestrator.REMOTE_SCRIPT.split('descriptor = os.open')[0],'<remote-preflight>','exec'),namespace)
            self.assertTrue(namespace['quota_observed'])
            self.assertIsNone(namespace['quota_cpus'])
            token_open.assert_not_called()


class FakeTrace:
    def __init__(self):
        for name in ('on_connection_queued_start','on_connection_queued_end',
                     'on_dns_resolvehost_start','on_dns_resolvehost_end',
                     'on_connection_create_start','on_connection_create_end',
                     'on_connection_reuseconn','on_request_headers_sent'):
            setattr(self,name,[])


class AiohttpTraceEvidence(unittest.IsolatedAsyncioTestCase):
    async def test_observes_queue_dns_connection_and_body_without_inventing_tls(self):
        trace, supported = client.aiohttp_trace_config(types.SimpleNamespace(TraceConfig=FakeTrace))
        timing = client.RequestTiming(10)
        context = types.SimpleNamespace(trace_request_ctx=timing)
        secret_params = types.SimpleNamespace(url='https://PRIVATE/?qsat=PRIVATE',headers={'Secret':'PRIVATE'})
        events = [('on_connection_queued_start',10.1),('on_connection_queued_end',10.3),
                  ('on_connection_create_start',10.3),('on_dns_resolvehost_start',10.4),
                  ('on_dns_resolvehost_end',10.5),('on_connection_create_end',10.9),
                  ('on_request_headers_sent',11)]
        for name, timestamp in events:
            with mock.patch.object(client.time,'monotonic',return_value=timestamp):
                await getattr(trace,name)[0](None,context,secret_params)
        timing.headers_at, timing.first_body_at = 11.2, 11.3
        result = timing.snapshot(11.8,True)
        milliseconds = result['observedMilliseconds']
        self.assertEqual(milliseconds['connectorQueue'],200)
        self.assertEqual(milliseconds['dnsResolution'],100)
        self.assertEqual(milliseconds['connectionCreateIncludingDnsTcpTls'],600)
        self.assertEqual(milliseconds['requestToResponseHeaders'],1200)
        self.assertEqual(milliseconds['headersToFirstBodyChunk'],100)
        self.assertEqual(milliseconds['headersToBodyComplete'],600)
        self.assertNotIn('tlsHandshake',milliseconds)
        self.assertNotIn('tcpConnect',milliseconds)
        self.assertNotIn('PRIVATE',json.dumps(result))
        self.assertEqual(len(supported),8)

    async def test_timeout_preserves_incomplete_phase_and_reuse_does_not_invent_dns(self):
        trace, _ = client.aiohttp_trace_config(types.SimpleNamespace(TraceConfig=FakeTrace))
        timing = client.RequestTiming(0)
        context = types.SimpleNamespace(trace_request_ctx=timing)
        with mock.patch.object(client.time,'monotonic',return_value=1):
            await trace.on_connection_queued_start[0](None,context,object())
        self.assertEqual(timing.snapshot(8)['incompletePhases'],['connectorQueue'])
        self.assertNotIn('connectorQueue',timing.snapshot(8)['observedMilliseconds'])
        reused = client.RequestTiming(0)
        await trace.on_connection_reuseconn[0](None,types.SimpleNamespace(trace_request_ctx=reused),object())
        self.assertTrue(reused.snapshot(1)['connectionReused'])
        self.assertNotIn('dnsResolution',reused.snapshot(1)['observedMilliseconds'])
        self.assertEqual(client.aiohttp_trace_config(types.SimpleNamespace()),(None,[]))

    def test_timing_storage_is_bounded_without_losing_counts_or_peak(self):
        timings = client.TransportTimings()
        timings.observe('segmentConnectorQueue',9)
        for _ in range(5000): timings.observe('segmentConnectorQueue',.001)
        result = timings.report()['phases']['segmentConnectorQueue']
        self.assertEqual(result['observations'],5001)
        self.assertEqual(result['retainedObservations'],2048)
        self.assertEqual(result['maximumMilliseconds'],9000)
        self.assertEqual(result['percentileMilliseconds']['99'],1)


if __name__ == '__main__':
    unittest.main()
