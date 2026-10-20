"""Focused recovery preparation evidence and non-overwrite guards; offline only."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

path=pathlib.Path(__file__).resolve().parents[1]/'scripts/record-edge-r2-preparation.py'
spec=importlib.util.spec_from_file_location('recovery_preparation',path)
preparation=importlib.util.module_from_spec(spec);spec.loader.exec_module(preparation)


class RecoveryPreparation(unittest.TestCase):
    def test_separate_node_and_listener_results_are_counted_without_historical_suites(self):
        def tap(count):return f'# tests {count}\n# pass {count}\n# fail 0\n# skipped 0\n'
        self.assertEqual(preparation.checked_test_count(tap(85),'node')+
            preparation.checked_test_count(tap(7),'node'),92)
        self.assertEqual(preparation.checked_test_count('Ran 25 tests in 0.2s\n\nOK\n','python'),25)
        for value,kind in ((tap(85).replace('fail 0','fail 1'),'node'),
                (tap(85).replace('skipped 0','skipped 1'),'node'),('Ran 25 tests\nFAILED\n','python')):
            with self.assertRaises(ValueError):preparation.checked_test_count(value,kind)

    def test_all_new_outputs_are_checked_before_any_write_and_never_replace_proposals(self):
        with tempfile.TemporaryDirectory() as folder:
            release=pathlib.Path(folder);proposal=preparation.OUTPUTS[-1]
            (release/proposal).write_text('prior-proposal')
            with self.assertRaises(ValueError):preparation.write_new_outputs(release,{
                preparation.OUTPUTS[0]:{'passed':True},proposal:{'sourceSha256':'different'}})
            self.assertFalse((release/preparation.OUTPUTS[0]).exists())
            self.assertEqual((release/proposal).read_text(),'prior-proposal')

    def test_new_paths_preserve_old_candidate_evidence(self):
        self.assertTrue(all('edge-r2-recovery-' in name for name in preparation.OUTPUTS))
        with tempfile.TemporaryDirectory() as folder:
            release=pathlib.Path(folder);old=release/'edge-r2-publication-proposal-20261020.json'
            old.write_text('historical-ad2912')
            preparation.write_new_outputs(release,{preparation.OUTPUTS[-1]:{'sourceSha256':'new-candidate'}})
            self.assertEqual(old.read_text(),'historical-ad2912')
            self.assertEqual(json.loads((release/preparation.OUTPUTS[-1]).read_text())['sourceSha256'],'new-candidate')


if __name__=='__main__':unittest.main()
