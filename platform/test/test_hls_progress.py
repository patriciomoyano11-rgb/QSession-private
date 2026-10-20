"""Progress stays provisional and uses the actual four/eight worker partition."""
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('load_progress',pathlib.Path(__file__).resolve().parents[1]/'scripts/read-guarded-load-progress.py')
progress=importlib.util.module_from_spec(spec);spec.loader.exec_module(progress)


class ProgressCounters(unittest.TestCase):
    def rows(self,count):
        return [{'samples':[{'observedAtUnix':100,'elapsed':40,'requestErrors':0,'recentMediaClients':1}
            for _ in range(count)],'finishedWorkers':[]}]

    def test_partition_is_explicit_and_bounded(self):
        self.assertEqual(progress.workers_for({}),4)
        self.assertEqual(progress.workers_for({'workersPerNode':8}),8)
        for value in (True,0,7,16,'8'):
            with self.assertRaises(ValueError):progress.workers_for({'workersPerNode':value})

    def test_fifty_six_workers_require_fifty_six_samples(self):
        self.assertTrue(progress.summarize(self.rows(56),56)['completeWorkerSamples'])
        report=progress.summarize(self.rows(28),56)
        self.assertFalse(report['completeWorkerSamples']);self.assertIsNone(report['recentMediaCount'])

    def test_incomplete_or_unaligned_reads_do_not_claim_full_media(self):
        rows=self.rows(56);rows[0]['readFailed']=True
        self.assertIsNone(progress.summarize(rows,56)['recentMediaCount'])
        rows=self.rows(56);rows[0]['samples'][0]['observedAtUnix']=102
        self.assertIsNone(progress.summarize(rows,56)['recentMediaCount'])


if __name__=='__main__':unittest.main()
