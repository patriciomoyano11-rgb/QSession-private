"""Publish the reviewed PRB10A-only edge/R2 canary after fresh OAuth approval.

Import and local validation do not read credentials or contact a provider.
Preserves all seven current bindings and the existing private actor namespace.
Replaces only the checked source; no DNS, buckets, class migrations or plans.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import pathlib
import re
import secrets

ROOT=pathlib.Path(__file__).resolve().parents[2]
OLD='ad2912eed16a285d0f5e6dcaef4762e23f5d9bb6fbbed8a3ed076c0aa2483858'
OLD_VERSION='e2aaf9e0-bda0-4dc8-b741-20740bf9aa63'
NAMESPACE='15dc9a3675ea409ab0c9b17a2618e4b3'
NEW_VARIABLE={'name':'QSESSION_R2_EDGE_CACHE_ROOM','type':'plain_text','text':'PRB10A'}
PUBLICATION='edge-r2-recovery-publication-20261020.json'
BACKUP='before-edge-r2-recovery-settings-20261020.json'
EXPECTED_NAMES={'QSESSION_LIVE','QSESSION_ADMISSION_ROOM','QSESSION_ADMISSION_API',
    'QSESSION_ADMISSION_SECRET','QSESSION_SHARED_CACHE_ROOM','QSESSION_SEGMENT_CACHE','QSESSION_R2_EDGE_CACHE_ROOM'}
SPENT_REFERENCES={'call_ee42755e79394eebbfcff07af67dda45',
    'call_608884c01a19419ca569a6f699db999a','call_6a51aee29d5f4d36a5bcedd4d0a61a3f',
    'call_ab26debcbd964747a98462ca1adc5f72','call_2caf9cd1c0234d28816e9c766bf72935'}


def validate_local(approval,source,validation,runtime):
    digest=hashlib.sha256(source.replace(b'\r\n',b'\n')).hexdigest()
    reference=approval.get('authorizationReference','')
    if (approval.get('status')!='approved' or not isinstance(reference,str)
            or not re.fullmatch(r'call_[A-Za-z0-9_]{8,160}',reference) or reference in SPENT_REFERENCES
            or approval.get('sourceSha256')!=digest or digest==OLD
            or approval.get('previousSourceSha256')!=OLD or approval.get('previousWorkerVersion')!=OLD_VERSION
            or approval.get('worker')!='qsession-live' or approval.get('canaryRoom')!='PRB10A'
            or approval.get('revokeWranglerOnFinish') is not True
            or approval.get('canaryVariable')!=NEW_VARIABLE):
        raise ValueError('Fresh source-specific canary and temporary OAuth approval required')
    required={'edgeRegressionPassed','hlsToolingPassed','listenerRecoveryPassed','publicationGuardsPassed'}
    if (validation.get('passed') is not True or validation.get('sourceSha256')!=digest
            or any(validation.get('checks',{}).get(k) is not True for k in required)):
        raise ValueError('Candidate regression evidence is missing or stale')
    spec=importlib.util.spec_from_file_location('candidate_local_proof',pathlib.Path(__file__).with_name('hls_candidate_readiness.py'))
    proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
    if not proof.valid_runtime_evidence(runtime,digest):
        raise ValueError('Official local canary runtime evidence is missing or stale')
    return digest


def checked_bindings(settings):
    rows=settings.get('bindings',[])
    bindings={b['name']:b for b in rows}
    if len(rows)!=len(bindings) or set(bindings)!=EXPECTED_NAMES:
        raise ValueError('Current binding inventory changed')
    if (bindings['QSESSION_LIVE'].get('type')!='r2_bucket'
            or bindings['QSESSION_LIVE'].get('bucket_name')!='qsession-live'
            or bindings['QSESSION_SEGMENT_CACHE'].get('namespace_id')!=NAMESPACE
            or bindings['QSESSION_SEGMENT_CACHE'].get('class_name')!='QSessionSegmentCache'
            or bindings['QSESSION_ADMISSION_ROOM'].get('text')!='PRB10A'
            or bindings['QSESSION_SHARED_CACHE_ROOM'].get('text')!='PRB10A'
            or bindings['QSESSION_ADMISSION_API'].get('text')!='https://qsession.org/api/broadcast/admissions/probe-check'):
        raise ValueError('Private canary binding scope changed')
    expected_types={'QSESSION_LIVE':'r2_bucket','QSESSION_SEGMENT_CACHE':'durable_object_namespace',
        'QSESSION_ADMISSION_SECRET':'secret_text'}
    if (any(binding.get('type')!=expected_types.get(name,'plain_text') for name,binding in bindings.items())
            or bindings['QSESSION_R2_EDGE_CACHE_ROOM']!=NEW_VARIABLE):
        raise ValueError('Canary binding types or room changed')
    exports={'QSessionSegmentCache':{'type':'durable-object','storage':'sqlite'}}
    if settings.get('exports') not in (None,exports):raise ValueError('Class declarations changed')
    return bindings


def checked_deployment(value, expected=None):
    versions=value.get('versions',[])
    if (len(versions)!=1 or not isinstance(versions[0].get('version_id'),str)
            or not versions[0]['version_id'] or versions[0].get('percentage')!=100
            or expected is not None and versions[0]['version_id']!=expected):
        raise ValueError('Current deployment is not the checked version')
    return versions[0]['version_id']


def load_api_modules():
    # Both modules are inert on import. Kept separate for offline guard tests.
    spec=importlib.util.spec_from_file_location('private_worker_api',ROOT/'platform/scripts/publish-private-segment-cache.py')
    api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
    spec=importlib.util.spec_from_file_location('worker_modules',ROOT/'platform/scripts/publish-media-diagnostics.py')
    modules=importlib.util.module_from_spec(spec);spec.loader.exec_module(modules)
    return api,modules


def main(approval_path,publish=False):
    approval=json.loads(approval_path.read_text())
    source=(ROOT/'platform/edge/hls-worker.js').read_bytes().replace(b'\r\n',b'\n')
    validation=json.loads((ROOT/'release/edge-r2-recovery-validation-20261020.json').read_text())
    runtime=json.loads((ROOT/'release/edge-r2-recovery-workerd-local-20261020.json').read_text())
    digest=validate_local(approval,source,validation,runtime)
    if not publish:
        print(json.dumps({'localValidationPassed':True,'sourceSha256':digest,'willPublish':False,
            'credentialsRead':False,'cloudRequests':0,'capacityCertified':False}))
        return
    output=ROOT/'release'/PUBLICATION
    if output.exists():raise ValueError('Publication evidence already exists; reconcile without another upload')
    # Credential access starts only after all local guards have passed.
    api,modules=load_api_modules()
    if (api.PRIVATE/BACKUP).exists():raise ValueError('Publication backup exists; reconcile before another upload')
    token=api.session_token()
    settings=api.api_json(token,'/settings');bindings=checked_bindings(settings)
    raw,kind=api.request(token)
    if hashlib.sha256(modules.module_bytes(raw,kind).replace(b'\r\n',b'\n')).hexdigest()!=OLD:
        raise ValueError('Remote source changed; do not retry a publication blindly')
    before_deployment=api.api_json(token,'/deployments')['deployments'][0]
    checked_deployment(before_deployment,OLD_VERSION)
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'worker':'qsession-live',
        'authorizationReference':approval['authorizationReference'],'previousSourceSha256':OLD,
        'previousWorkerVersion':OLD_VERSION,
        'sourceSha256':digest,'canaryRoom':'PRB10A','published':False,'capacityCertified':False,
        'canaryVariable':NEW_VARIABLE,'existingBindingsPreserved':False,'preservedBindingCount':7,'newServersCreated':0}
    if publish:
        with (api.PRIVATE/BACKUP).open('x') as backup:json.dump(settings,backup)
        metadata={k:settings[k] for k in ('compatibility_date','compatibility_flags','observability','logpush',
            'tail_consumers','streaming_tail_consumers','limits','placement','cache_options') if k in settings}
        metadata.update(main_module='worker.js',bindings=[],
            keep_bindings=sorted({b['type'] for b in bindings.values()}),
            exports={'QSessionSegmentCache':{'type':'durable-object','storage':'sqlite'}})
        boundary='qsession-'+secrets.token_hex(16)
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()
            +json.dumps(metadata).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode()
            +source+f'\r\n--{boundary}--\r\n'.encode())
        raw,_=api.request(token,method='PUT',data=body,content_type='multipart/form-data; boundary='+boundary)
        result=json.loads(raw)
        if result.get('success') is not True:raise ValueError('Publication outcome unconfirmed')
        after=api.api_json(token,'/settings');after_bindings={b['name']:b for b in after['bindings']}
        if (len(after['bindings'])!=7 or after_bindings!=bindings
                or after.get('exports') not in (None,{'QSessionSegmentCache':{'type':'durable-object','storage':'sqlite'}})):
            raise ValueError('Post-publication bindings differ')
        # The settings endpoint may omit lifecycle declarations (also absent
        # before this upload). The exact namespace/class binding and the full
        # exporting module must still match; an explicit conflicting declaration
        # is rejected. Never repeat an upload just because metadata was omitted.
        raw,kind=api.request(token)
        if hashlib.sha256(modules.module_bytes(raw,kind).replace(b'\r\n',b'\n')).hexdigest()!=digest:
            raise ValueError('Post-publication source differs')
        deployment=api.api_json(token,'/deployments')['deployments'][0]
        version=checked_deployment(deployment)
        if version==OLD_VERSION:raise ValueError('Post-publication deployment still points to the baseline')
        report.update(published=True,existingBindingsPreserved=True,workerVersion=version,deploymentId=deployment['id'])
    with output.open('x',encoding='utf8') as target:json.dump(report,target,indent=2)
    print(json.dumps(report))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approval',type=pathlib.Path,required=True)
    parser.add_argument('--publish',action='store_true')
    args=parser.parse_args()
    try:main(args.approval,args.publish)
    except Exception as error:
        print(json.dumps({'publicationOutcomeUnconfirmed':args.publish,'errorClass':type(error).__name__,
            'httpStatus':getattr(error,'code',None),'sensitiveDetailsSuppressed':True}));raise SystemExit(2)
