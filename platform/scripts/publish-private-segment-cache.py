"""Scoped Worker upload through the approved temporary Wrangler OAuth session.

Never changes routes, domains, DNS, subscriptions or bucket permissions. Keep
all existing bindings and secrets. Only add the approved private namespace and
the explicit PRB10A canary. No token or API response body is printed.
"""
import argparse
import datetime
import email.parser
import email.policy
import hashlib
import json
import pathlib
import secrets
import tomllib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'private/cloudflare-cli'
API = 'https://api.cloudflare.com/client/v4/accounts/b3d60daa8319692b18a8bef39b34f14d/workers/scripts/qsession-live'
SOURCE = ROOT / 'platform/edge/hls-worker.js'
EXPECTED_SOURCE = '4caec677c4524b2e946af5e8c8bd777cbaada3e7f67a3a56d8f832a08e13f177'

def session_token():
    return tomllib.loads((PRIVATE / '.wrangler/config/default.toml').read_text(encoding='utf8'))['oauth_token']

def request(token, suffix='', method='GET', data=None, content_type=None):
    headers = {'Authorization': 'Bearer ' + token}
    if content_type: headers['Content-Type'] = content_type
    target = urllib.request.Request(API + suffix, data=data, headers=headers, method=method)
    # Official API endpoint is fixed; credentials cannot follow a redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    with urllib.request.build_opener(NoRedirect()).open(target, timeout=35) as response:
        return response.read(4 * 1024 * 1024), response.headers.get('Content-Type', '')

def api_json(token, suffix):
    raw, _ = request(token, suffix)
    value = json.loads(raw)
    if value.get('success') is not True: raise ValueError('API rejected read')
    return value['result']

def main(publish=False):
    token = session_token()
    settings = api_json(token, '/settings')
    bindings = settings.get('bindings', [])
    by_name = {binding['name']: binding for binding in bindings}
    if by_name['QSESSION_LIVE']['type'] != 'r2_bucket' or by_name['QSESSION_LIVE']['bucket_name'] != 'qsession-live':
        raise ValueError('Unexpected bucket binding')
    if by_name['QSESSION_ADMISSION_ROOM'].get('text') != 'PRB10A' or by_name['QSESSION_ADMISSION_API'].get('text') != 'https://qsession.org/api/broadcast/admissions/probe-check':
        raise ValueError('Unexpected admission scope')
    if set(by_name) != {'QSESSION_LIVE', 'QSESSION_ADMISSION_ROOM', 'QSESSION_ADMISSION_API', 'QSESSION_ADMISSION_SECRET'}:
        raise ValueError('Remote settings changed; review required')
    if settings.get('exports'): raise ValueError('Existing class exports require separate review')
    source = SOURCE.read_text(encoding='utf8').encode('utf8')
    if hashlib.sha256(source).hexdigest() != EXPECTED_SOURCE: raise ValueError('Reviewed local source changed')
    raw, content_type = request(token)
    if 'multipart/' in content_type:
        message = email.parser.BytesParser(policy=email.policy.default).parsebytes(
            ('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
        modules = [part for part in message.iter_parts() if part.get_filename() == 'worker.js'
                   or part.get_param('name', header='content-disposition') == 'worker.js']
        if len(modules) != 1: raise ValueError('Expected one reviewed module')
        remote_source = modules[0].get_payload(decode=True).replace(b'\r\n', b'\n')
    else: remote_source = raw.replace(b'\r\n', b'\n')
    if hashlib.sha256(remote_source).hexdigest() != EXPECTED_SOURCE: raise ValueError('Remote source changed')
    metadata = {key: settings[key] for key in ('compatibility_date', 'compatibility_flags', 'observability',
        'logpush', 'tail_consumers', 'streaming_tail_consumers', 'limits', 'placement', 'cache_options') if key in settings}
    metadata.update(main_module='worker.js', keep_bindings=sorted({item['type'] for item in bindings}),
        bindings=[{'name':'QSESSION_SEGMENT_CACHE','type':'durable_object_namespace','class_name':'QSessionSegmentCache'},
                  {'name':'QSESSION_SHARED_CACHE_ROOM','type':'plain_text','text':'PRB10A'}],
        exports={'QSessionSegmentCache': {'type':'durable-object','storage':'sqlite'}})
    report = {'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'worker':'qsession-live',
        'preflightPassed':True,'published':False,'sourceSha256LF':EXPECTED_SOURCE,'canaryRoom':'PRB10A',
        'existingBindingNames':sorted(by_name),'bindingTypesPreserved':metadata['keep_bindings'],
        'bucketPubliclyExposed':False,'routesOrDnsMutated':False,'capacityCertified':False}
    if publish:
        baseline = PRIVATE / 'before-private-cache-settings.json'
        with baseline.open('x',encoding='utf8') as handle: json.dump(settings,handle)
        boundary = 'qsession-'+secrets.token_hex(16)
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()
            +json.dumps(metadata).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode()
            +source+f'\r\n--{boundary}--\r\n'.encode())
        raw,_=request(token,method='PUT',data=body,content_type='multipart/form-data; boundary='+boundary)
        result=json.loads(raw)
        if result.get('success') is not True: raise ValueError('Upload not confirmed')
        after=api_json(token,'/settings');after_bindings={b['name']:b for b in after['bindings']}
        if any(after_bindings.get(name)!=binding for name,binding in by_name.items()):
            raise ValueError('Existing bindings differ after upload')
        if after_bindings['QSESSION_SHARED_CACHE_ROOM'].get('text')!='PRB10A':raise ValueError('Canary scope differs')
        report.update(published=True,privateNamespaceCreated=True,bindingCreated=True,
            workerVersion=result['result'].get('deployment_id'),existingBindingsPreserved=True,
            exports=after.get('exports'),namespaceId=after_bindings['QSESSION_SEGMENT_CACHE'].get('namespace_id'))
    (ROOT/'release/private-cache-publication-20261019.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true')
    args=parser.parse_args()
    try:main(args.publish)
    except Exception as error:
        print(json.dumps({'publishedOutcomeUnconfirmed':bool(args.publish),'errorClass':type(error).__name__,
            'httpStatus':error.code if isinstance(error,urllib.error.HTTPError) else None,
            'checkFailure':str(error) if isinstance(error,ValueError) and str(error) in {
                'API rejected read','Unexpected bucket binding','Unexpected admission scope',
                'Remote settings changed; review required','Existing class exports require separate review',
                'Reviewed local source changed','Expected one reviewed module','Remote source changed',
                'Upload not confirmed','Existing bindings differ after upload','Canary scope differs'} else None,
            'detailsSuppressed':True}))
        raise SystemExit(2)
