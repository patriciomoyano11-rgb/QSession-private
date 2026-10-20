"""Synthetic local fixtures cannot certify capacity or replay old pilot results."""
import copy
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('pilot_evidence',pathlib.Path(__file__).resolve().parents[1]/'scripts/record-edge-r2-pilot.py')
proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)


class ProtectedPilotEvidence(unittest.TestCase):
    def test_default_paths_are_new_recovery_evidence(self):
        args=proof.argument_parser().parse_args(['--raw','raw.json','--after','after.json','--closure','closure.json'])
        self.assertEqual(args.publication.name,'edge-r2-recovery-publication-20261020.json')
        self.assertEqual(args.output.name,'edge-r2-recovery-pilot-20261020.json')

    def setUp(self):
        self.publication={'published':True,'canaryRoom':'PRB10A','sourceSha256':'unit-source',
            'workerVersion':'unit-version','authorizationReference':'call_unit_approval','checkedAt':'2026-10-20T00:00:00Z'}
        self.after={'verified':True,'sourceSha256':'unit-source','workerVersion':'unit-version',
            'bindingsPreserved':True,'checkedAt':'2026-10-20T00:02:00Z'}
        self.closure={'authorizationReference':'call_unit_approval','officialLogoutConfirmed':True,
            'localOAuthConfigurationRemoved':True,'pendingDeviceLoginRemoved':True,
            'reauthenticationAttemptedAfterLogout':False,'checkedAt':'2026-10-20T00:03:00Z'}
        start=proof.timestamp('2026-10-20T00:00:10Z')
        pilot={'passed':True,'startedAtUnix':start,'endedAtUnix':start+40,'originRunId':'unit-origin',
            'origin':{'runId':'unit-origin','segment':{'bytes':1431620},'cleanupComplete':True},
            'requestedClients':1,'deliveryHost':'live.qsession.org','unauthorizedManifestStatus':403,
            'authorizedManifestStatus':200,'manifestTokensPreserved':True,'unauthorizedWarmRangeStatus':403,
            'authorizedAfter20SecondsStatus':200,'coldNativeBurst':{'correctRanges':16,'fill':{'r2-edge':16}},
            'authorizedSegmentStatus':200,'authorizedSegmentBytes':1431620,
            'authorizedSegmentHeaders':{'Content-Length':'1431620','X-QSession-Cache-Fill':'r2-edge'},
            'runner':{'requestedClients':1,'deliveryCheckPassed':True,'errors':{},'stopReason':'planned_deadline',
                'counts':{'segmentOk':5,'segmentBytes':7158100,'segmentBytesReceived':7158100,
                    'manifestCacheFill_r2-edge':14,'segmentCacheFill_r2-edge':5}}}
        for name,start in (('nativeFirstRange',0),('nativeCachedRange',188),('nativeRangeAfterFullGet',376)):
            pilot[name]={'status':206,'bytes':188,'headers':{'Content-Length':'188',
                'Content-Range':f'bytes {start}-{start+187}/1431620','X-QSession-Cache-Fill':'r2-edge'}}
        self.raw={'passed':True,'requestedClients':1,'resourcesProvisioned':0,'pilot':pilot,
            'leaseCleanup':{'renewedMilliseconds':28000,'activeAfterRelease':0,'privateMasterFileRemoved':True,
                'mediaJobIdsUnchanged':True},'encoderCleanup':{'privateEncoderTokenFileRemoved':True}}

    def result(self):return proof.assess(self.raw,self.publication,self.after,self.closure)

    def test_complete_fresh_proof_passes_without_claiming_decoding_or_capacity(self):
        report=self.result();self.assertTrue(report['passed'])
        self.assertFalse(report['decodedPlaybackTested']);self.assertFalse(report['capacityCertified'])

    def test_old_shared_route_cannot_pass_as_r2_canary(self):
        self.raw['pilot']['coldNativeBurst']['fill']={'shared-edge':16}
        self.assertIn('cold-ranges-did-not-use-r2-canary',self.result()['blockers'])

    def test_old_raw_or_changed_live_version_cannot_be_reused(self):
        self.raw['pilot']['startedAtUnix']-=300
        self.assertIn('pilot-not-fresh',self.result()['blockers'])
        self.after['workerVersion']='other-version'
        self.assertIn('remote-version-or-bindings-changed',self.result()['blockers'])

    def test_partial_or_late_media_and_post_get_range_are_rejected(self):
        original=copy.deepcopy(self.raw)
        for field,value in (('segmentBytesReceived',7158099),('segmentDownloadOver6Seconds',1),('missedSegments',1)):
            self.raw=copy.deepcopy(original);self.raw['pilot']['runner']['counts'][field]=value
            self.assertFalse(self.result()['passed'])
        self.raw=original;self.raw['pilot']['nativeRangeAfterFullGet']['status']=200
        self.assertIn('nativeRangeAfterFullGet-invalid',self.result()['blockers'])

    def test_running_leases_changed_jobs_or_unrevoked_session_block_readiness(self):
        self.raw['leaseCleanup']['mediaJobIdsUnchanged']=False
        self.closure['officialLogoutConfirmed']=False
        blockers=self.result()['blockers']
        self.assertIn('cleanup-or-existing-media-unverified',blockers)
        self.assertIn('temporary-session-not-closed',blockers)


if __name__=='__main__':unittest.main()
