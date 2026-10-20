"""Publish the reviewed diagnostics only after fresh recorded approval.

Keeps the existing Worker settings, six bindings and private namespace. No
resource creation, DNS, audience limit or room-mode changes. Import is inert.
"""
import argparse
import datetime
import email.parser
import email.policy
import hashlib
import importlib.util
import json
import pathlib
import re
import secrets

ROOT = pathlib.Path(__file__).resolve().parents[2]
OLD = '9f6364d59898d708f64afd108cbf94d0e5f922bb599b6c61c5e1db16c0bc4534'
NEW = '6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f'
NAMESPACE = '15dc9a3675ea409ab0c9b17a2618e4b3'


def local_preflight(approval):
    if (approval.get('status') != 'approved' or
            not re.fullmatch(r'call_[A-Za-z0-9_]{8,160}', approval.get('authorizationReference', '')) or
            approval.get('sourceSha256') != NEW or approval.get('worker') != 'qsession-live' or
            approval.get('revokeWranglerOnFinish') is not True):
        raise ValueError('Fresh scoped approval required')
    source = (ROOT/'platform/edge/hls-worker.js').read_bytes().replace(b'\r\n', b'\n')
    if hashlib.sha256(source).hexdigest() != NEW:
        raise ValueError('Reviewed source changed')
    validation = json.loads((ROOT/'release/media-diagnostics-validation-20261020.json').read_text())
    if (validation.get('sourceSha256') != NEW or validation.get('passed') is not True or
            validation.get('nodeTestsPassed') != 51 or validation.get('pythonTestsPassed') != 44 or
            validation.get('publicationGuardTestsPassed') != 4):
        raise ValueError('Reviewed tests required')
    local = json.loads((ROOT/'release/media-diagnostics-workerd-local-20261020.json').read_text())
    if (local.get('passed') is not True or local.get('candidateSourceSha256') != NEW or
            local.get('completedRequests') != 96 or len(local.get('faultInjectionCases', [])) != 6 or
            not all(c.get('passed') is True for c in local['faultInjectionCases']) or
            local.get('cloudResourcesCreated') != 0 or local.get('cloudAuthenticationUsed') is not False or
            local.get('localRuntimeStopped') is not True):
        raise ValueError('Official local runtime proof required')
    return source


def module_bytes(raw, content_type):
    if 'multipart/' not in content_type:
        return raw
    message = email.parser.BytesParser(policy=email.policy.default).parsebytes(
        ('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
    modules = [p for p in message.iter_parts() if p.get_filename() == 'worker.js' or
               p.get_param('name', header='content-disposition') == 'worker.js']
    if len(modules) != 1:
        raise ValueError('Remote module differs')
    return modules[0].get_payload(decode=True)


def main(approval_path, publish=False):
    approval = json.loads(approval_path.read_text())
    source = local_preflight(approval)  # Must pass before reading credentials or contacting Cloudflare.
    spec = importlib.util.spec_from_file_location('scoped_worker_api', ROOT/'platform/scripts/publish-private-segment-cache.py')
    api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
    token = api.session_token()
    settings = api.api_json(token, '/settings')
    bindings = {b['name']: b for b in settings['bindings']}
    if set(bindings) != {'QSESSION_LIVE', 'QSESSION_ADMISSION_ROOM', 'QSESSION_ADMISSION_API',
                        'QSESSION_ADMISSION_SECRET', 'QSESSION_SHARED_CACHE_ROOM', 'QSESSION_SEGMENT_CACHE'}:
        raise ValueError('Binding scope changed')
    if (bindings['QSESSION_LIVE'].get('bucket_name') != 'qsession-live' or
            bindings['QSESSION_SEGMENT_CACHE'].get('namespace_id') != NAMESPACE or
            bindings['QSESSION_ADMISSION_ROOM'].get('text') != 'PRB10A' or
            bindings['QSESSION_SHARED_CACHE_ROOM'].get('text') != 'PRB10A' or
            bindings['QSESSION_ADMISSION_API'].get('text') != 'https://qsession.org/api/broadcast/admissions/probe-check'):
        raise ValueError('Canary configuration changed')
    exports = {'QSessionSegmentCache': {'type': 'durable-object', 'storage': 'sqlite'}}
    if settings.get('exports') not in (None, exports):
        raise ValueError('Class declaration changed')
    raw, kind = api.request(token)
    if hashlib.sha256(module_bytes(raw, kind).replace(b'\r\n', b'\n')).hexdigest() != OLD:
        raise ValueError('Remote source changed; review before retrying')
    report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'worker': 'qsession-live', 'authorizationReference': approval['authorizationReference'],
              'sourceSha256': NEW, 'previousSourceSha256': OLD, 'preflightPassed': True,
              'published': False, 'capacityCertified': False}
    if publish:
        with (api.PRIVATE/'before-media-diagnostics-settings-20261020.json').open('x') as file:
            json.dump(settings, file)
        metadata = {k: settings[k] for k in ('compatibility_date', 'compatibility_flags', 'observability',
                    'logpush', 'tail_consumers', 'streaming_tail_consumers', 'limits', 'placement', 'cache_options') if k in settings}
        metadata.update(main_module='worker.js', bindings=[], exports=exports,
                        keep_bindings=sorted({b['type'] for b in bindings.values()}))
        boundary = 'qsession-'+secrets.token_hex(16)
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()
                +json.dumps(metadata).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode()
                +source+f'\r\n--{boundary}--\r\n'.encode())
        raw, _ = api.request(token, method='PUT', data=body, content_type='multipart/form-data; boundary='+boundary)
        result = json.loads(raw)
        if result.get('success') is not True:
            raise ValueError('Publication unconfirmed')
        after = api.api_json(token, '/settings')
        if {b['name']: b for b in after['bindings']} != bindings or after.get('exports') not in (None, exports):
            raise ValueError('Post-publication bindings differ')
        raw, kind = api.request(token)
        if hashlib.sha256(module_bytes(raw, kind).replace(b'\r\n', b'\n')).hexdigest() != NEW:
            raise ValueError('Post-publication source differs')
        report.update(published=True, workerVersion=result['result'].get('deployment_id'), existingBindingsPreserved=True)
    (ROOT/'release/media-diagnostics-publication-20261020.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--approval', type=pathlib.Path, required=True)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    try:
        main(args.approval, args.publish)
    except Exception as error:
        print(json.dumps({'publicationOutcomeUnconfirmed': args.publish, 'errorClass': type(error).__name__,
                          'httpStatus': getattr(error, 'code', None), 'sensitiveDetailsSuppressed': True}))
        raise SystemExit(2)
