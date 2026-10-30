"""The staging Worker file cannot name production."""
import importlib.util
import pathlib
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'scripts/check-staging-worker-config.py'
spec = importlib.util.spec_from_file_location('staging_worker_config', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StagingWorkerConfig(unittest.TestCase):
    def test_checked_in_staging_file_passes(self):
        self.assertEqual(module.main(), 0)

    def test_a_production_route_or_bucket_fails(self):
        self.assertTrue(module.problems_in(
            'name = "qsession-live-staging"\nbucket_name = "qsession-live"\n'))
        self.assertTrue(module.problems_in(
            'name = "qsession-live"\nbucket_name = "qsession-live-staging"\n'
            'pattern = "live.qsession.org/*"\n'))
        self.assertEqual(module.problems_in(
            'name = "qsession-live-staging"\n'
            'bucket_name = "qsession-live-staging"\n'
            'preview_bucket_name = "qsession-live-staging-preview"\n'
            '# live.qsession.org must not be attached\n'), [])


if __name__ == '__main__':
    unittest.main()
