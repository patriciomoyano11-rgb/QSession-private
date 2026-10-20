"""Publication guards use a fake API; never authenticate or contact Cloudflare."""
import copy
import contextlib
import io
import importlib.util
import json
import pathlib
import tempfile
import types
import unittest
from unittest import mock

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('media_publication',ROOT/'platform/scripts/publish-media-diagnostics.py')
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)


class PublicationGuards(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.root=pathlib.Path(self.directory.name)
        (self.root/'release').mkdir();(self.root/'platform/edge').mkdir(parents=True)
        for name in ('media-diagnostics-validation-20261020.json','media-diagnostics-workerd-local-20261020.json'):
            (self.root/'release'/name).write_bytes((ROOT/'release'/name).read_bytes())
        # This suite audits the already published diagnostics release, not a
        # later candidate being edited in the workspace.
        (self.root/'platform/edge/hls-worker.js').write_bytes((ROOT/'release/worker-before-edge-r2-canary-20261020.js').read_bytes())
        self.approval={'status':'approved','authorizationReference':'call_synthetic_unit_approval',
            'sourceSha256':publisher.NEW,'worker':'qsession-live','revokeWranglerOnFinish':True}
        self.approval_path=self.root/'approval.json'
        self.approval_path.write_text(json.dumps(self.approval))
        self.settings={'compatibility_date':'2026-09-25','bindings':[
            {'name':'QSESSION_LIVE','type':'r2_bucket','bucket_name':'qsession-live'},
            {'name':'QSESSION_ADMISSION_ROOM','type':'plain_text','text':'PRB10A'},
            {'name':'QSESSION_SHARED_CACHE_ROOM','type':'plain_text','text':'PRB10A'},
            {'name':'QSESSION_ADMISSION_API','type':'plain_text','text':'https://qsession.org/api/broadcast/admissions/probe-check'},
            {'name':'QSESSION_ADMISSION_SECRET','type':'secret_text','placeholder':'synthetic-secret-must-not-upload'},
            {'name':'QSESSION_SEGMENT_CACHE','type':'durable_object_namespace','namespace_id':publisher.NAMESPACE}]}
        self.requests=[]
        def request(token,suffix='',method='GET',data=None,content_type=None):
            self.requests.append({'method':method,'body':data})
            if method=='PUT':return json.dumps({'success':True,'result':{'deployment_id':'unit-test-only'}}).encode(),'application/json'
            source=(ROOT/'release/worker-before-media-diagnostics-20261020.js') if not any(r['method']=='PUT' for r in self.requests) else (self.root/'platform/edge/hls-worker.js')
            return source.read_bytes(),'application/javascript'
        self.api=types.SimpleNamespace(PRIVATE=self.root,session_token=mock.Mock(return_value='synthetic-token'),
            api_json=mock.Mock(side_effect=lambda *a:copy.deepcopy(self.settings)),request=mock.Mock(side_effect=request))
        self.root_patch=mock.patch.object(publisher,'ROOT',self.root);self.root_patch.start();self.addCleanup(self.root_patch.stop)

    def invoke(self):
        loader=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module:None))
        with mock.patch.object(publisher.importlib.util,'spec_from_file_location',return_value=loader), \
             mock.patch.object(publisher.importlib.util,'module_from_spec',return_value=self.api):
            with contextlib.redirect_stdout(io.StringIO()):
                publisher.main(self.approval_path,publish=True)

    def test_pending_or_missing_fresh_approval_never_reads_credentials_or_calls_api(self):
        for change in ({'status':'prepared'},{'authorizationReference':''},{'worker':'other-worker'},
                       {'revokeWranglerOnFinish':False}):
            self.approval_path.write_text(json.dumps({**self.approval,**change}))
            with self.assertRaises(ValueError):self.invoke()
        self.api.session_token.assert_not_called();self.api.request.assert_not_called()

    def test_changed_local_source_blocks_before_authentication(self):
        (self.root/'platform/edge/hls-worker.js').write_text('changed')
        with self.assertRaises(ValueError):self.invoke()
        self.api.session_token.assert_not_called();self.api.request.assert_not_called()

    def test_remote_binding_drift_blocks_upload(self):
        self.settings['bindings'].append({'name':'UNREVIEWED','type':'plain_text','text':'x'})
        with self.assertRaises(ValueError):self.invoke()
        self.assertFalse(any(r['method']=='PUT' for r in self.requests))

    def test_upload_preserves_secret_binding_without_reuploading_its_value_and_verifies_source(self):
        self.invoke()
        puts=[r for r in self.requests if r['method']=='PUT'];self.assertEqual(len(puts),1)
        self.assertNotIn(b'synthetic-secret-must-not-upload',puts[0]['body'])
        self.assertIn(b'"bindings": []',puts[0]['body'])
        self.assertIn(b'"secret_text"',puts[0]['body'])
        report=json.loads((self.root/'release/media-diagnostics-publication-20261020.json').read_text())
        self.assertTrue(report['published']);self.assertTrue(report['existingBindingsPreserved'])
        self.assertFalse(report['capacityCertified'])
        self.assertEqual([r['method'] for r in self.requests],['GET','PUT','GET'])


if __name__=='__main__':unittest.main()
