"""Update only the reviewed qsession-live module, retaining all six bindings.

Uses the explicitly approved temporary Wrangler session. No DNS, routes,
namespaces, permissions, plans, or real-room scope change.
"""
import argparse
import datetime
import email.parser
import email.policy
import hashlib
import importlib.util
import json
import pathlib
import secrets
import xml.etree.ElementTree as ET

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('prior',ROOT/'platform/scripts/publish-private-segment-cache.py')
prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
NEW='759c1ffb5fe23b1e8dcdd1a737664bba569d0b61f1b2780d7e8e82dbe75b0cc1'
OLD='01d6bce1c60f9eb7d5e869a094fe1150a76b3086620f54ea0826917475f22ad0'
NAMESPACE='15dc9a3675ea409ab0c9b17a2618e4b3'


def main(publish=False):
    tests=ET.parse(ROOT/'release/hls-admission-retry-validation-20261020.xml').getroot()
    if len(tests.findall('.//testcase'))!=34 or tests.findall('.//failure') or tests.findall('.//error'):
        raise ValueError('Reviewed admission tests did not pass')
    token=prior.session_token()
    settings=prior.api_json(token,'/settings')
    bindings={b['name']:b for b in settings['bindings']}
    if set(bindings)!={'QSESSION_LIVE','QSESSION_ADMISSION_ROOM','QSESSION_ADMISSION_API',
                      'QSESSION_ADMISSION_SECRET','QSESSION_SHARED_CACHE_ROOM','QSESSION_SEGMENT_CACHE'}:
        raise ValueError('Binding scope differs')
    if (bindings['QSESSION_LIVE'].get('bucket_name')!='qsession-live' or
        bindings['QSESSION_SEGMENT_CACHE'].get('namespace_id')!=NAMESPACE or
        bindings['QSESSION_ADMISSION_ROOM'].get('text')!='PRB10A' or
        bindings['QSESSION_SHARED_CACHE_ROOM'].get('text')!='PRB10A' or
        bindings['QSESSION_ADMISSION_API'].get('text')!='https://qsession.org/api/broadcast/admissions/probe-check'):
        raise ValueError('Canary configuration differs')
    exports={'QSessionSegmentCache':{'type':'durable-object','storage':'sqlite'}}
    # The settings read omits this field on the deployed API version. Preserve
    # the exact declaration recorded when this known namespace was created.
    if settings.get('exports') not in (None,exports):raise ValueError('Class declaration differs')
    source=(ROOT/'platform/edge/hls-worker.js').read_bytes().replace(b'\r\n',b'\n')
    if hashlib.sha256(source).hexdigest()!=NEW:raise ValueError('Local source differs')
    raw,content_type=prior.request(token)
    if 'multipart/' in content_type:
        message=email.parser.BytesParser(policy=email.policy.default).parsebytes(
            ('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
        modules=[p for p in message.iter_parts() if p.get_filename()=='worker.js' or p.get_param('name',header='content-disposition')=='worker.js']
        if len(modules)!=1:raise ValueError('Module count differs')
        raw=modules[0].get_payload(decode=True)
    if hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest()!=OLD:raise ValueError('Remote source differs')
    metadata={k:settings[k] for k in ('compatibility_date','compatibility_flags','observability','logpush',
        'tail_consumers','streaming_tail_consumers','limits','placement','cache_options') if k in settings}
    metadata.update(main_module='worker.js',keep_bindings=sorted({b['type'] for b in bindings.values()}),bindings=[],exports=exports)
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'worker':'qsession-live',
        'sourceSha256':NEW,'previousSourceSha256':OLD,'preflightPassed':True,'published':False,
        'namespaceUnchanged':True,'canaryRoom':'PRB10A','routesOrDnsMutated':False,'capacityCertified':False}
    if publish:
        with (prior.PRIVATE/'before-admission-retry-settings-20261020.json').open('x',encoding='utf8') as file:json.dump(settings,file)
        boundary='qsession-'+secrets.token_hex(16)
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()
            +json.dumps(metadata).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode()
            +source+f'\r\n--{boundary}--\r\n'.encode())
        raw,_=prior.request(token,method='PUT',data=body,content_type='multipart/form-data; boundary='+boundary)
        result=json.loads(raw)
        if result.get('success') is not True:raise ValueError('Upload unconfirmed')
        after=prior.api_json(token,'/settings')
        if {b['name']:b for b in after['bindings']}!=bindings or after.get('exports') not in (None,exports):
            raise ValueError('Post-publication configuration differs')
        report.update(published=True,workerVersion=result['result'].get('deployment_id'),existingBindingsPreserved=True)
    (ROOT/'release/admission-retry-publication-20261020.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');args=parser.parse_args()
    try:main(args.publish)
    except Exception as error:
        safe={'Binding scope differs','Canary configuration differs','Class declaration differs',
              'Local source differs','Module count differs','Remote source differs','Upload unconfirmed',
              'Post-publication configuration differs','Reviewed admission tests did not pass'}
        print(json.dumps({'publishedOutcomeUnconfirmed':args.publish,'errorClass':type(error).__name__,
                          'httpStatus':getattr(error,'code',None),
                          'checkFailure':str(error) if type(error) is ValueError and str(error) in safe else None,
                          'detailsSuppressed':True}));raise SystemExit(2)
