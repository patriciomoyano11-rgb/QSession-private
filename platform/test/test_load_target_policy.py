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
            'untrusted.test', 'live.qsession.org.evil.test', '', None, '10.1.0.5',
        )
        for host in refused:
            with self.subTest(host=host), self.assertRaises(ValueError):
                policy.require_staging_delivery_host(host)

    def test_ssh_refuses_the_permanent_production_servers(self):
        self.assertEqual(policy.require_staging_ssh_host('10.8.0.5'), '10.8.0.5')
        self.assertEqual(policy.require_staging_ssh_host('8.8.8.8'), '8.8.8.8')
        for host in ('45.77.192.82', '104.238.137.144', '45.77.118.43', '127.0.0.1',
                     '0.0.0.0', '169.254.1.1', '224.0.0.1', 'not-an-ip', ''):
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
