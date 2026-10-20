"""Read back only qsession-live; never upload or create provider resources."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]


def main(output):
    spec=importlib.util.spec_from_file_location('canary_publisher',ROOT/'platform/scripts/publish-edge-r2-canary.py')
    publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
    report=json.loads((ROOT/'release'/publisher.PUBLICATION).read_text())
    if report.get('published') is not True:raise ValueError('Publication has not been reconciled')
    if output.exists():raise ValueError('Readback evidence already exists')
    api,modules=publisher.load_api_modules();token=api.session_token()
    before=json.loads((api.PRIVATE/publisher.BACKUP).read_text())
    original=publisher.checked_bindings(before)
    after=api.api_json(token,'/settings');bindings={b['name']:b for b in after['bindings']}
    if len(after['bindings'])!=7 or bindings!=original:
        raise ValueError('Namespace, bindings or canary variable changed')
    expected_exports={'QSessionSegmentCache':{'type':'durable-object','storage':'sqlite'}}
    if after.get('exports') not in (None,expected_exports):raise ValueError('Conflicting class declaration')
    raw,kind=api.request(token)
    digest=hashlib.sha256(modules.module_bytes(raw,kind).replace(b'\r\n',b'\n')).hexdigest()
    if digest!=report['sourceSha256']:raise ValueError('Live Worker source changed')
    deployment=api.api_json(token,'/deployments')['deployments'][0]
    publisher.checked_deployment(deployment,report['workerVersion'])
    proof={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'verified':True,
        'worker':'qsession-live','canaryRoom':'PRB10A','sourceSha256':digest,
        'workerVersion':report['workerVersion'],'deploymentId':deployment['id'],'bindingsPreserved':True,
        'namespaceUnchanged':True,'classNamespaceId':publisher.NAMESPACE,
        'lifecycleDeclarationsReturnedBySettings':after.get('exports') is not None,
        'resourceMutations':0,'capacityCertified':False}
    with output.open('x',encoding='utf8') as target:json.dump(proof,target,indent=2)
    print(json.dumps(proof))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'release/edge-r2-recovery-publication-readback-20261020.json')
    args=parser.parse_args()
    try:main(args.output)
    except Exception as error:
        print(json.dumps({'verified':False,'errorClass':type(error).__name__,'detailsSuppressed':True}));raise SystemExit(2)
