"""Publication API is synthetic; no OAuth session or network is opened."""
import copy
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import types
import unittest
from unittest import mock

ROOT=pathlib.Path(__file__).resolve().parents[2]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
publisher=load('r2_publisher',ROOT/'platform/scripts/publish-edge-r2-canary.py')
fixtures=load('candidate_test_fixtures',pathlib.Path(__file__).with_name('test_hls_candidate_readiness.py'))


class CanaryPublication(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.root=pathlib.Path(self.directory.name);(self.root/'release').mkdir()
        (self.root/'platform/edge').mkdir(parents=True)
        self.source=b'unit-test-only-candidate';self.digest=hashlib.sha256(self.source).hexdigest()
        (self.root/'platform/edge/hls-worker.js').write_bytes(self.source)
        self.evidence=fixtures.evidence(self.source)
        for name,value in self.evidence.items():
            if 'publication' not in name:(self.root/'release'/name).write_text(json.dumps(value))
        self.approval={'status':'approved','authorizationReference':'call_synthetic_fresh_canary',
            'sourceSha256':self.digest,'worker':'qsession-live','canaryRoom':'PRB10A',
            'previousSourceSha256':hashlib.sha256(b'old-unit-source').hexdigest(),
            'previousWorkerVersion':publisher.OLD_VERSION,
            'revokeWranglerOnFinish':True,'canaryVariable':publisher.NEW_VARIABLE.copy()}
        self.approval_path=self.root/'approval.json';self.write_approval()
        self.settings={'compatibility_date':'2026-09-25',
            'exports':{'QSessionSegmentCache':{'type':'durable-object','storage':'sqlite'}},
            'bindings':[
                {'name':'QSESSION_LIVE','type':'r2_bucket','bucket_name':'qsession-live'},
                {'name':'QSESSION_ADMISSION_ROOM','type':'plain_text','text':'PRB10A'},
                {'name':'QSESSION_SHARED_CACHE_ROOM','type':'plain_text','text':'PRB10A'},
                {'name':'QSESSION_ADMISSION_API','type':'plain_text','text':'https://qsession.org/api/broadcast/admissions/probe-check'},
                {'name':'QSESSION_ADMISSION_SECRET','type':'secret_text','placeholder':'NEVER_UPLOAD_SYNTHETIC_SECRET'},
                {'name':'QSESSION_SEGMENT_CACHE','type':'durable_object_namespace',
                    'namespace_id':publisher.NAMESPACE,'class_name':'QSessionSegmentCache'},publisher.NEW_VARIABLE.copy()]}
        self.uploads=[];self.after_exports=None;self.before_version=publisher.OLD_VERSION
        def request(token,suffix='',method='GET',data=None,content_type=None):
            if method=='PUT':
                self.uploads.append(data)
                return json.dumps({'success':True,'result':{'deployment_id':'unit-version'}}).encode(),'application/json'
            return (self.source if self.uploads else b'old-unit-source'),'application/javascript'
        def settings(*args):
            if args[-1]=='/deployments':
                return {'deployments':[{'id':'unit-deployment','versions':[{
                    'version_id':'unit-version' if self.uploads else self.before_version,'percentage':100}]}]}
            result=copy.deepcopy(self.settings)
            if self.uploads:
                if self.after_exports is not None:result['exports']=self.after_exports
            return result
        self.api=types.SimpleNamespace(PRIVATE=self.root,session_token=mock.Mock(return_value='unit-token'),
            api_json=mock.Mock(side_effect=settings),request=mock.Mock(side_effect=request))
        self.modules=types.SimpleNamespace(module_bytes=lambda raw,kind:raw)
        self.patches=[mock.patch.object(publisher,'ROOT',self.root),
            mock.patch.object(publisher,'OLD',hashlib.sha256(b'old-unit-source').hexdigest()),
            mock.patch.object(publisher,'load_api_modules',return_value=(self.api,self.modules))]
        for patch in self.patches:patch.start();self.addCleanup(patch.stop)

    def write_approval(self):self.approval_path.write_text(json.dumps(self.approval))
    def invoke(self):
        with contextlib.redirect_stdout(io.StringIO()):publisher.main(self.approval_path,publish=True)

    def test_spent_or_incomplete_authorization_blocks_before_credentials(self):
        original=copy.deepcopy(self.approval)
        changes=[{'authorizationReference':ref} for ref in publisher.SPENT_REFERENCES]
        changes += [{'status':'prepared'},{'worker':'other-worker'},{'canaryRoom':'LIVE01'},
            {'revokeWranglerOnFinish':False},{'sourceSha256':'stale'}]
        for change in changes:
            self.approval={**original,**change};self.write_approval()
            with self.subTest(change=change),self.assertRaises(ValueError):self.invoke()
        self.api.session_token.assert_not_called();self.assertEqual(self.uploads,[])

    def test_source_or_proof_change_blocks_before_credentials(self):
        (self.root/'platform/edge/hls-worker.js').write_bytes(b'edited')
        with self.assertRaises(ValueError):self.invoke()
        self.api.session_token.assert_not_called()

    def test_binding_namespace_or_class_drift_prevents_upload(self):
        for field,value in (('namespace_id','other-namespace'),('class_name','OtherClass')):
            original=self.settings['bindings'][-2][field];self.settings['bindings'][-2][field]=value
            with self.assertRaises(ValueError):self.invoke()
            self.settings['bindings'][-2][field]=original
        self.assertEqual(self.uploads,[])

    def test_upload_preserves_seven_bindings_secret_and_namespace(self):
        old=self.root/'release/edge-r2-publication-20261020.json';old.write_text('historical')
        self.invoke();self.assertEqual(len(self.uploads),1)
        body=self.uploads[0]
        self.assertNotIn(b'NEVER_UPLOAD_SYNTHETIC_SECRET',body)
        self.assertIn(b'"secret_text"',body);self.assertIn(b'"durable_object_namespace"',body)
        self.assertIn(b'"bindings": []',body)
        self.assertNotIn(b'"QSESSION_R2_EDGE_CACHE_ROOM"',body)
        self.assertNotIn(b'"migrations"',body)
        report=json.loads((self.root/'release'/publisher.PUBLICATION).read_text())
        self.assertTrue(report['published']);self.assertTrue(report['existingBindingsPreserved'])
        self.assertFalse(report['capacityCertified'])
        self.assertEqual(report['preservedBindingCount'],7);self.assertEqual(old.read_text(),'historical')
        self.assertEqual(report['previousWorkerVersion'],publisher.OLD_VERSION)
        self.assertEqual(report['workerVersion'],'unit-version')

    def test_post_upload_missing_class_declaration_is_not_reported_as_success(self):
        self.after_exports={}
        with self.assertRaises(ValueError):self.invoke()
        self.assertFalse((self.root/'release'/publisher.PUBLICATION).exists())

    def test_api_may_omit_lifecycle_metadata_while_preserving_namespace_and_source(self):
        self.settings['exports']=None
        self.invoke()
        report=json.loads((self.root/'release'/publisher.PUBLICATION).read_text())
        self.assertTrue(report['published']);self.assertTrue(report['existingBindingsPreserved'])

    def test_existing_canary_variable_or_baseline_version_drift_blocks_upload(self):
        self.settings['bindings'][-1]['text']='OTHER1'
        with self.assertRaises(ValueError):self.invoke()
        self.settings['bindings'][-1]=publisher.NEW_VARIABLE.copy();self.before_version='different-version'
        with self.assertRaises(ValueError):self.invoke()
        self.assertEqual(self.uploads,[])

    def test_default_local_validation_never_reads_credentials(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            publisher.main(self.approval_path,publish=False)
        self.assertTrue(json.loads(output.getvalue())['localValidationPassed'])
        self.api.session_token.assert_not_called();self.api.request.assert_not_called()

    def test_existing_recovery_report_or_backup_blocks_any_repeat_upload(self):
        for target in (self.root/'release'/publisher.PUBLICATION,self.root/publisher.BACKUP):
            target.write_text('preserve')
            with self.assertRaises(ValueError):self.invoke()
            self.assertEqual(target.read_text(),'preserve');target.unlink()
        self.api.session_token.assert_not_called();self.assertEqual(self.uploads,[])


if __name__=='__main__':unittest.main()
