import contextlib
import datetime
import importlib.util
import io
import json
import pathlib
import stat
import tempfile
import types
import unittest
from unittest import mock

source=pathlib.Path(__file__).resolve().parents[1]/'scripts/renew-broadcast-admission-probe.py'
spec=importlib.util.spec_from_file_location('probe_renewal',source)
renewal=importlib.util.module_from_spec(spec)
spec.loader.exec_module(renewal)


class TechnicalProbeRenewal(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='qsession-probe-renewal-')
        self.root=pathlib.Path(self.temp.name)
        self.path=self.root/'probe.json'
        self.backup=self.root/'before.json'
        self.original=json.dumps({'schemaVersion':1,'code':'PRB10A',
            'prefix':'live/PRB10A-hWrdBkirH_2yHmZ9lp','capacity':10000,
            'generation':'synthetic-0123456789abcdef','issuedAt':'2026-10-18T00:00:00Z',
            'expiresAt':'2026-10-18T00:55:00Z'}).encode()
        self.path.write_bytes(self.original)
        self.private_path=mock.Mock(wraps=self.path)
        self.private_path.lstat.return_value=types.SimpleNamespace(st_mode=stat.S_IFREG|0o600,
            st_uid=1000,st_gid=1000,st_size=len(self.original))
        self.state={'activeProbeLeases':0,'audienceMode':'interactive',
                    'mediaJobs':[{'egressId':'synthetic-existing-source','status':1}]}

    def tearDown(self):
        self.assertEqual(self.root.resolve().parent,pathlib.Path(tempfile.gettempdir()).resolve())
        self.temp.cleanup()

    def patches(self,health_results):
        stack=contextlib.ExitStack()
        stack.enter_context(mock.patch.object(renewal,'PATH',self.private_path))
        stack.enter_context(mock.patch.object(renewal,'BACKUP',self.backup))
        stack.enter_context(mock.patch.object(renewal.os,'chown',create=True))
        stack.enter_context(mock.patch.object(renewal,'health',return_value=200))
        stack.enter_context(mock.patch.object(renewal,'state',return_value=self.state))
        stack.enter_context(mock.patch.object(renewal,'write_existing',side_effect=self.path.write_bytes))
        stack.enter_context(mock.patch.object(renewal,'await_health',side_effect=health_results))
        stack.enter_context(mock.patch.object(renewal.subprocess,'check_output',return_value=b'sha256:unchanged\n'))
        runner=stack.enter_context(mock.patch.object(renewal.subprocess,'run'))
        return stack,runner

    def test_success_renews_only_the_technical_scope_for_55_minutes(self):
        stack,runner=self.patches([True])
        with stack,contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(renewal.main(),0)
        after=json.loads(self.path.read_bytes())
        self.assertEqual(after['code'],'PRB10A')
        self.assertEqual(after['prefix'],json.loads(self.original)['prefix'])
        self.assertEqual(after['capacity'],10000)
        self.assertNotEqual(after['generation'],json.loads(self.original)['generation'])
        for field in ('issuedAt','expiresAt'):
            self.assertRegex(after[field],r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$')
        elapsed=datetime.datetime.fromisoformat(after['expiresAt'])-datetime.datetime.fromisoformat(after['issuedAt'])
        self.assertEqual(elapsed.total_seconds(),55*60)
        self.assertEqual(self.backup.read_bytes(),self.original)
        runner.assert_called_once_with(['docker','restart',renewal.APP],capture_output=True,check=True,timeout=30)
        report=json.loads(output.getvalue())
        self.assertTrue(report['appImageUnchanged'])
        self.assertTrue(report['sameMediaJobIdentifiers'])
        self.assertFalse(report['livekitOrEncoderRestarted'])

    def test_failed_health_restores_exact_configuration_and_restarts_only_api(self):
        stack,runner=self.patches([False,True])
        with stack,contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(renewal.main(),2)
        self.assertEqual(self.path.read_bytes(),self.original)
        self.assertEqual(runner.call_count,2)
        self.assertTrue(all(call.args[0]==['docker','restart',renewal.APP] for call in runner.call_args_list))
        self.assertTrue(json.loads(output.getvalue())['privateConfigRestored'])

    def test_real_room_scope_is_rejected_before_any_docker_operation(self):
        changed=json.loads(self.original);changed['code']='JNTUBY';self.path.write_text(json.dumps(changed))
        stack,runner=self.patches([])
        with stack:
            with self.assertRaises(ValueError):renewal.main()
        runner.assert_not_called()
        self.assertFalse(self.backup.exists())

    def test_retry_reuses_only_an_identical_restored_backup(self):
        self.backup.write_bytes(self.original)
        saved=mock.Mock(wraps=self.backup)
        saved.lstat.return_value=self.private_path.lstat.return_value
        stack,runner=self.patches([True])
        with stack,mock.patch.object(renewal,'BACKUP',saved),contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(renewal.main(),0)
        self.assertTrue(json.loads(output.getvalue())['backupReused'])
        self.assertEqual(self.backup.read_bytes(),self.original)
        self.assertEqual(runner.call_count,1)


if __name__=='__main__':unittest.main()
