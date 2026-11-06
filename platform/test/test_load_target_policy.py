"""Load tools refuse production playback, SSH and storage unless staging is explicit."""
import importlib.util
import pathlib
import types
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'scripts'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


policy = load('load_target_policy_under_test', 'load_target_policy.py')
runner = load('load_runner_under_test', 'run-custom-domain-load.py')
origin = load('load_origin_under_test', 'synthetic-hls-origin.py')
orchestrator = load('load_orchestrator_under_test', 'orchestrate-hls-load.py')


class StagingDeliveryHost(unittest.TestCase):
    def test_accepts_a_staging_label_and_refuses_production_names(self):
        self.assertEqual(policy.require_staging_delivery_host('live.staging.qsession.test'),
                         'live.staging.qsession.test')
        self.assertEqual(policy.require_staging_delivery_host('qsession-live-staging.example.workers.dev'),
                         'qsession-live-staging.example.workers.dev')
        refused = (
            'live.qsession.org', 'www.qsession.org', 'qsession.org', 'media.qsession.org',
            'staging.qsession.org', 'qsession-live.patriciomoyano11.workers.dev',
            'LIVE.QSESSION.ORG.', 'live.qsession.org.staging.example.test',
            'https://live.staging.qsession.test', 'user@live.staging.qsession.test',
            'staging.qsession-live.patriciomoyano11.workers.dev',
            'untrusted.test', 'live.qsession.org.evil.test', '', None, '10.1.0.5',
        )
        for host in refused:
            with self.subTest(host=host), self.assertRaises(ValueError):
                policy.require_staging_delivery_host(host)

    def test_ssh_refuses_the_permanent_production_servers(self):
        self.assertEqual(policy.require_staging_ssh_host('10.8.0.5'), '10.8.0.5')
        allowed = policy.parse_staging_ssh_allowlist('10.8.0.5,10.8.0.6')
        self.assertEqual(policy.require_allowlisted_staging_ssh('10.8.0.6', allowed), '10.8.0.6')
        with self.assertRaises(ValueError):
            policy.require_allowlisted_staging_ssh('8.8.8.8', allowed)
        with self.assertRaises(ValueError):
            policy.parse_staging_ssh_allowlist('45.77.192.82,10.8.0.5')
        with self.assertRaises(ValueError):
            policy.parse_staging_ssh_allowlist('')
        for host in ('45.77.192.82', '104.238.137.144', '45.77.118.43', '45.76.25.22',
                     '127.0.0.1', '0.0.0.0', '169.254.1.1', '224.0.0.1', 'not-an-ip', '',
                     '045.077.192.082', '::ffff:45.77.192.82', '762413906', 'live.qsession.org',
                     'https://10.8.0.5'):
            with self.subTest(host=host), self.assertRaises(ValueError):
                policy.require_staging_ssh_host(host)

    def test_storage_refuses_the_production_bucket_and_account_endpoint(self):
        endpoint, bucket = policy.require_staging_storage(
            'https://staging.r2.invalid', 'qsession-live-staging')
        self.assertEqual((endpoint, bucket), ('https://staging.r2.invalid', 'qsession-live-staging'))
        for endpoint, bucket in (
                (policy.PRODUCTION_R2_ENDPOINT, 'qsession-live-staging'),
                ('https://staging.r2.invalid', 'qsession-live'),
                ('https://staging.r2.invalid', 'qsession-live-preview'),
                ('https://user:secret@staging.r2.invalid', 'qsession-live-staging'),
                ('http://staging.r2.invalid', 'qsession-live-staging')):
            with self.subTest(bucket=bucket), self.assertRaises(ValueError):
                policy.require_staging_storage(endpoint, bucket)


class ProductionEntrypointsStayClosed(unittest.TestCase):
    def test_known_canary_origin_and_diagnostics_do_not_open_a_socket(self):
        origin = load('origin_guard', 'synthetic-hls-origin.py')
        with mock.patch.object(origin, 'read_credentials') as credentials:
            with self.assertRaises(ValueError):
                origin.main(types.SimpleNamespace(delivery_host='live.qsession.org', known_canary=True, duration=12))
            credentials.assert_not_called()
        denial = load('denial_guard', 'diagnose-load-denial.py')
        with mock.patch.object(denial.subprocess, 'run') as ssh:
            with self.assertRaises(SystemExit):
                denial.main()
            ssh.assert_not_called()
        verify = load('verify_guard', 'verify-synthetic-hls.py')
        with mock.patch.object(verify.urllib.request, 'urlopen') as opened:
            with self.assertRaises(ValueError):
                verify.main()
            opened.assert_not_called()

    def test_pilots_diagnostics_and_encoder_ssh_fail_before_a_socket(self):
        names = (
            'prepare-hls-admission-pilot.py', 'prepare-broadcast-probe.py',
            'prepare-synthetic-storage.py', 'finish-hls-admission-pilot.py',
            'stop-synthetic-origin.py', 'check-dktlf3-media.py',
            'manage-guarded-load.py', 'install-load-retirement.py',
            'provision-guarded-load.py', 'diagnose-load-denial.py',
            'publish-synthetic-probe.py', 'finalize-guarded-retirement.py',
            'advance-guarded-retirement.py', 'prepare-retirement-scope.py',
        )
        for filename in names:
            module = load('closed_' + filename.replace('.', '_').replace('-', '_'), filename)
            with self.subTest(filename=filename), \
                    mock.patch('subprocess.run') as ssh, mock.patch('urllib.request.urlopen') as opened:
                with self.assertRaises(SystemExit):
                    module.main()
                ssh.assert_not_called()
                opened.assert_not_called()

    def test_generator_ssh_needs_a_positive_allowlist_and_rejects_disguised_production(self):
        node = {'ip': '45.76.25.22'}
        with mock.patch.object(orchestrator.subprocess, 'run') as ssh:
            with self.assertRaises(ValueError):
                orchestrator.run_node(node, {}, allowlist=('45.76.25.22', '8.8.8.8'))
            ssh.assert_not_called()
        with mock.patch.object(orchestrator.subprocess, 'run') as ssh:
            with self.assertRaises(ValueError):
                orchestrator.run_node({'ip': '8.8.8.8'}, {}, allowlist=())
            ssh.assert_not_called()
        with mock.patch.object(orchestrator.subprocess, 'run') as ssh:
            with self.assertRaises(ValueError):
                orchestrator.run_node({'ip': '045.077.192.082'}, {}, allowlist=('8.8.8.8',))
            ssh.assert_not_called()
        prepare = load('prepare_closed', 'prepare-load-generators.py')
        disposable = {'ownedForThisTest': True, 'destroyed': False,
                      'label': 'qsession-load-20261018-abc-chi1', 'ip': '45.77.192.82'}
        with mock.patch.object(prepare.subprocess, 'run') as ssh:
            with self.assertRaises(ValueError):
                prepare.prepare(disposable, allowlist=('45.77.192.82',))
            ssh.assert_not_called()


class LoadEntryPointsRefuseProduction(unittest.TestCase):
    def test_runner_stops_before_ssh_mint_or_origin(self):
        args = types.SimpleNamespace(delivery_host='live.qsession.org', encoder_host='45.77.192.82',
                                     api_host='104.238.137.144', suffix='media-full-should-not-run',
                                     clients=1000, hold=60, reconnect_after=0, transport='aiohttp',
                                     workers_per_node=4, inventory=pathlib.Path('missing.json'))
        with mock.patch.object(runner.subprocess, 'Popen') as popen, \
                mock.patch.object(runner.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                runner.main(args)
            popen.assert_not_called()
            run.assert_not_called()
        staged = types.SimpleNamespace(delivery_host='live.staging.qsession.test',
                                       encoder_host='45.76.25.22', api_host='10.8.0.6',
                                       staging_ssh_allowlist='45.76.25.22,10.8.0.6',
                                       suffix='media-full-should-not-run', clients=1000, hold=60,
                                       reconnect_after=0, transport='aiohttp', workers_per_node=4,
                                       inventory=pathlib.Path('missing.json'))
        with mock.patch.object(runner.subprocess, 'Popen') as popen, \
                mock.patch.object(runner.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                runner.main(staged)
            popen.assert_not_called()
            run.assert_not_called()

    def test_origin_refuses_production_playback_before_reading_credentials(self):
        args = types.SimpleNamespace(delivery_host='live.qsession.org', duration=12, control_stdin=False)
        with mock.patch.object(origin, 'read_credentials') as credentials:
            with self.assertRaises(ValueError):
                origin.main(args)
            credentials.assert_not_called()

    def test_origin_refuses_the_production_bucket_after_a_staging_host_is_accepted(self):
        args = types.SimpleNamespace(delivery_host='live.staging.qsession.test', duration=12, control_stdin=False)
        with mock.patch.object(origin, 'read_credentials', return_value={
                'accessKey': 'offline', 'secretKey': 'offline',
                'endpoint': policy.PRODUCTION_R2_ENDPOINT, 'bucket': 'qsession-live'}):
            with self.assertRaises(ValueError):
                origin.main(args)

    def test_remote_generator_script_rejects_production_before_opening_leases(self):
        reviewed = b'reviewed-client-source'
        args = ['-', 'local-generator-test', '1000', '1429', 'live.qsession.org', 'aiohttp',
                '620', '240', '8', '8', 'a' * 64, 'b' * 64, 'c' * 64]
        with mock.patch('sys.argv', args), mock.patch('os.cpu_count', return_value=8), \
                mock.patch('os.sched_getaffinity', return_value=set(range(8)), create=True), \
                mock.patch.object(pathlib.Path, 'is_file', return_value=True), \
                mock.patch('os.open') as token_open:
            with self.assertRaises(SystemExit):
                exec(compile(orchestrator.REMOTE_SCRIPT, '<remote-controller>', 'exec'), {})
            token_open.assert_not_called()


if __name__ == '__main__':
    unittest.main()
