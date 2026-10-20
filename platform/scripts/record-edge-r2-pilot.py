"""Derive canary proof from a fresh raw pilot, verified publication and logout.

Offline only. Historical reports, partial media and shared-edge responses do
not establish the new R2 path. This never certifies 10000 viewers or decoding.
"""
import argparse
import datetime
import hashlib
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()


def assess(raw, publication, after, closure):
    problems=[]
    def require(condition, reason):
        if not condition:problems.append(reason)
    digest=publication.get('sourceSha256');version=publication.get('workerVersion')
    pilot=raw.get('pilot',{});runner=pilot.get('runner',{});counts=runner.get('counts',{})
    cleanup=raw.get('leaseCleanup',{});origin=pilot.get('origin',{})
    size=origin.get('segment',{}).get('bytes')
    require(publication.get('published') is True and publication.get('canaryRoom')=='PRB10A'
        and bool(digest) and bool(version),'publication-unverified')
    require(after.get('verified') is True and after.get('sourceSha256')==digest
        and after.get('workerVersion')==version and after.get('bindingsPreserved') is True,'remote-version-or-bindings-changed')
    try:
        began=pilot['startedAtUnix'];ended=pilot['endedAtUnix']
        fresh=timestamp(publication['checkedAt'])<=began<ended<=timestamp(after['checkedAt'])<=timestamp(closure['checkedAt'])
    except (KeyError,ValueError,TypeError):fresh=False
    require(fresh and bool(pilot.get('originRunId')) and pilot.get('originRunId')==origin.get('runId'),'pilot-not-fresh')
    require(raw.get('resourcesProvisioned')==0 and raw.get('requestedClients')==1
        and pilot.get('requestedClients')==1 and runner.get('requestedClients')==1
        and pilot.get('deliveryHost')=='live.qsession.org','pilot-scope-changed')
    require(pilot.get('unauthorizedManifestStatus')==403 and pilot.get('authorizedManifestStatus')==200
        and pilot.get('manifestTokensPreserved') is True and pilot.get('unauthorizedWarmRangeStatus')==403
        and pilot.get('authorizedAfter20SecondsStatus')==200
        and (cleanup.get('renewedMilliseconds') or 0)>20000,'admission-or-renewal-failed')
    require(pilot.get('coldNativeBurst',{}).get('correctRanges')==16
        and pilot.get('coldNativeBurst',{}).get('fill')=={'r2-edge':16},'cold-ranges-did-not-use-r2-canary')
    for name,start in (('nativeFirstRange',0),('nativeCachedRange',188),('nativeRangeAfterFullGet',376)):
        item=pilot.get(name,{});headers=item.get('headers',{})
        require(item.get('status')==206 and item.get('bytes')==188
            and headers.get('Content-Length')=='188'
            and headers.get('Content-Range')==f'bytes {start}-{start+187}/{size}'
            and headers.get('X-QSession-Cache-Fill')=='r2-edge',name+'-invalid')
    headers=pilot.get('authorizedSegmentHeaders',{})
    require(type(size) is int and size>0 and pilot.get('authorizedSegmentStatus')==200
        and pilot.get('authorizedSegmentBytes')==size and headers.get('Content-Length')==str(size)
        and headers.get('X-QSession-Cache-Fill')=='r2-edge','full-get-incomplete-or-wrong-route')
    require(runner.get('deliveryCheckPassed') is True and runner.get('errors')=={}
        and runner.get('stopReason')=='planned_deadline' and counts.get('segmentOk',0)>0
        and counts.get('segmentBytes',0)>0 and counts.get('segmentBytes')==counts.get('segmentBytesReceived')
        and all(counts.get(k,0)==0 for k in ('segmentsBelowNominalSize','segmentDownloadOver6Seconds',
            'missedSegments','stalledClients','incompleteSegmentResponses'))
        and counts.get('manifestCacheFill_r2-edge',0)>0 and counts.get('segmentCacheFill_r2-edge',0)>0,
        'runner-did-not-sustain-complete-r2-media')
    require(raw.get('passed') is True and pilot.get('passed') is True and origin.get('cleanupComplete') is True
        and cleanup.get('activeAfterRelease')==0 and cleanup.get('privateMasterFileRemoved') is True
        and cleanup.get('mediaJobIdsUnchanged') is True
        and raw.get('encoderCleanup',{}).get('privateEncoderTokenFileRemoved') is True,'cleanup-or-existing-media-unverified')
    require(closure.get('authorizationReference')==publication.get('authorizationReference')
        and closure.get('officialLogoutConfirmed') is True and closure.get('localOAuthConfigurationRemoved') is True
        and closure.get('pendingDeviceLoginRemoved') is True
        and closure.get('reauthenticationAttemptedAfterLogout') is False,'temporary-session-not-closed')
    passed=not problems
    return {'passed':passed,'blockers':problems,'sourceSha256':digest,'workerVersion':version,
        'room':'PRB10A','clients':1,'fullMediaBodiesVerified':passed,'admissionChecksPassed':passed,
        'leaseCleanupVerified':passed,'wranglerSessionRevoked':passed,'originRunId':pilot.get('originRunId'),
        'decodedPlaybackTested':False,'capacityCertified':False,'certifiesProductionCapacity':False}


def argument_parser():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('raw','after','closure'):parser.add_argument('--'+name,type=pathlib.Path,required=True)
    parser.add_argument('--publication',type=pathlib.Path,default=ROOT/'release/edge-r2-recovery-publication-20261020.json')
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/edge-r2-recovery-pilot-20261020.json')
    return parser


def main():
    args=argument_parser().parse_args();load=lambda path:json.loads(path.read_text(encoding='utf-8-sig'))
    report=assess(load(args.raw),load(args.publication),load(args.after),load(args.closure))
    report.update(recordedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        evidence={name:{'file':getattr(args,name).name,'sha256':hashlib.sha256(getattr(args,name).read_bytes()).hexdigest()}
            for name in ('raw','publication','after','closure')})
    with args.output.open('x',encoding='utf8') as target:json.dump(report,target,indent=2)
    print(json.dumps(report));return 0 if report['passed'] else 2


if __name__=='__main__':raise SystemExit(main())
