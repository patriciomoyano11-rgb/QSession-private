"""Provision only the newly approved seven-node batch behind an armed timer.

The API credential remains on the encoder. Provider responses (including root
passwords) are never printed. Each POST has its retirement tag from creation.
No automatic retries of creation requests with an unknown outcome.
"""
import base64
import argparse
from decimal import Decimal
import re
import json
import pathlib
import subprocess
import hashlib
import datetime

ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER = ROOT / 'release/load-generators-guarded-20261020.json'
SSH = ['ssh', '-T', '-i', 'C:/Users/maria/.ssh/qsession_deploy_ed25519',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'ConnectTimeout=12', 'root@45.77.192.82']
REMOTE = r'''
import base64,datetime,hashlib,importlib.util,json,pathlib,sys,time,urllib.request
from decimal import Decimal
phase='load_guard'
def safe_error(kind,error,traceback):
 print(json.dumps({'preparationFailed':True,'phase':phase,'errorClass':kind.__name__,
                   'httpStatus':getattr(error,'code',None),'sensitiveDetailsSuppressed':True}),flush=True)
sys.excepthook=safe_error
spec=importlib.util.spec_from_file_location('guard','/opt/qsession-load-guard/retire-load-generators.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
scope=guard.validate_scope(json.loads(guard.private_text(pathlib.Path('/etc/qsession-load-guard/scope.json'))))
expected=EXPECTED_FINGERPRINT
if hashlib.sha256(json.dumps(scope,sort_keys=True).encode('utf8')).hexdigest()!=expected:raise SystemExit('Scope mismatch')
if scope['budgetAuthorizationReference']!=EXPECTED_AUTHORIZATION:raise SystemExit('Budget mismatch')
key=guard.private_text(pathlib.Path('/etc/qsession-load-guard/vultr.key'))
opener=urllib.request.build_opener(guard.NoRedirect())
def request(method,endpoint,body=None):
 allowed={'/os','/ssh-keys','/plans?per_page=500','/instances'}
 if endpoint not in allowed or method not in ('GET','POST') or (method=='POST' and endpoint!='/instances'):raise ValueError('endpoint')
 req=urllib.request.Request(guard.API+endpoint,method=method,data=json.dumps(body).encode('utf8') if body is not None else None,
  headers={'Authorization':'Bearer '+key,'Accept':'application/json','Content-Type':'application/json'})
 with opener.open(req,timeout=20) as response:
  data=response.read(4000001)
  if len(data)>4000000:raise ValueError('Provider response too large')
  return json.loads(data)
now=time.time()
phase='guard_preflight'
proof=guard.preflight(guard.Vultr(key),scope,now)
if set(proof['pending'])!=set(EXPECTED_IDS) or guard.instant(scope['retireAt'])-now<1800:raise SystemExit('Require matching guarded batch and 30 minutes remaining')
phase='plan_metadata'
plans=request('GET','/plans?per_page=500')['plans']
plan=next(p for p in plans if p['id']==scope['plan'])
dedicated=scope['plan']=='voc-c-8c-16gb-150s-amd'
rate=Decimal(str(plan['hourly_cost']))
if (plan['vcpu_count']!=8 or plan['ram']!=16384 or plan['storage_type']!='local_storage' or
 not rate.is_finite() or not 0<rate<=(Decimal('0.25') if dedicated else Decimal('0.15')) or
 dedicated and (plan.get('type')!='voc' or plan.get('disk_type')!='DEDICATEDOPTIMIZED') or
 scope['region'] not in plan['locations']):raise SystemExit('Unreviewed plan')
phase='provider_deployment_limits'
limits=EXPECTED_PROVIDER_LIMITS
current=guard.Vultr(key).instances()
catalog={p['id']:p for p in plans}
nominal=sum((Decimal(str(catalog[n['plan']]['monthly_cost'])) for n in current),Decimal('0'))
projected=nominal+Decimal(str(plan['monthly_cost']))*CREATE_COUNT
if len(current)+CREATE_COUNT>limits['maximumInstances'] or projected>Decimal(str(limits['maximumMonthlyInstanceCostUsd'])):
 print(json.dumps({'creationBlockedBeforePost':True,'reason':'provider-deployment-limit',
  'projectedNominalMonthlyUsd':float(projected),'verifiedMonthlyCeilingUsd':limits['maximumMonthlyInstanceCostUsd']}),flush=True)
 raise SystemExit(2)
phase='os_metadata'
oses=request('GET','/os')['os']
osid=next(o['id'] for o in oses if o['name']=='Ubuntu 24.04 LTS x64' and o['arch']=='x64')
phase='ssh_public_key_configuration'
public_key=' '.join(EXPECTED_PUBLIC_KEY.split()[:2])
if not public_key.startswith('ssh-ed25519 '):raise ValueError('Unexpected public key algorithm')
cloud_init=('#cloud-config\npackage_update: true\npackages:\n  - python3\n  - python3-aiohttp\n'
            'disable_root: false\nssh_pwauth: false\nusers:\n  - default\n  - name: root\n'
            '    ssh_authorized_keys:\n      - '+json.dumps(public_key)+'\n')
userdata=base64.b64encode(cloud_init.encode()).decode()
print(json.dumps({'preflightPassed':True,'timerActive':True,'retireAt':scope['retireAt'],'hourlyUsd':plan['hourly_cost'],'osId':osid}),flush=True)
for index in range(FIRST_INDEX,FIRST_INDEX+CREATE_COUNT):
 if guard.instant(scope['retireAt'])-time.time()<1500:raise SystemExit('Creation time reserve exhausted')
 name=scope['runId']+'-chi'+str(index)
 body={'region':scope['region'],'plan':scope['plan'],'os_id':osid,'label':name,'hostname':name,
       'tags':[scope['tag']],'user_data':userdata,
       'backups':'disabled','ddos_protection':False,'enable_ipv6':False}
 # Do not retry a POST on timeout: discover by exact tag instead.
 try:
  instance=request('POST','/instances',body)['instance']
  if not guard.matches(instance,scope):raise ValueError('Created target does not match guard')
  node={name:instance.get(name) for name in ('id','label','plan','region','date_created','tags')}
  node.update(ip=instance.get('main_ip',''),hourlyUsd=plan['hourly_cost'],ownedForThisTest=True,
              destroyed=False,additionalVolumes=0,createdObservedUtc=instance['date_created'],sshReady=False)
  print(json.dumps({'created':node}),flush=True)
 except Exception as error:
  provider_reason='unclassified'
  if hasattr(error,'read'):
   try:
    message=str(json.loads(error.read(4096)).get('error','')).lower()
    provider_reason=('instance-limit' if 'limit' in message else 'capacity-unavailable' if 'capacity' in message or 'available' in message
      else 'billing-restriction' if 'fund' in message or 'balance' in message else 'provider-rejected')
   except Exception:pass
  print(json.dumps({'creationStopped':True,'errorClass':type(error).__name__,
                    'httpStatus':getattr(error,'code',None),'providerReason':provider_reason,
                    'timerRemainsActive':True,'unknownOutcomeMustBeDiscoveredBeforeAnyRetry':True}),flush=True)
  raise SystemExit(2)
'''


def provider_limit_proof(ledger, release, now=None):
    name=ledger.get('providerLimitEvidence','')
    if not isinstance(name,str) or not re.fullmatch(r'admission-table-vultr-current-limits(?:-[a-z0-9]+)?-\d{8}\.json',name):
        raise ValueError('Verify the actual provider deployment ceiling before any creation')
    proof=json.loads((release/name).read_text(encoding='utf8'))
    checked=datetime.datetime.fromisoformat(proof['checkedAt'].replace('Z','+00:00')).timestamp()
    now=datetime.datetime.now(datetime.timezone.utc).timestamp() if now is None else now
    screenshot=proof.get('screenshot','')
    if (proof.get('source')!='vultr-account-limits-ui' or proof.get('status')!='observed-current'
            or not -5<=now-checked<=600 or type(proof.get('maximumInstances')) is not int
            or proof['maximumInstances']<ledger['scope']['maximumInstances']
            or type(proof.get('maximumMonthlyInstanceCostUsd')) not in (int,float)
            or not Decimal(str(proof['maximumMonthlyInstanceCostUsd'])).is_finite()
            or proof['maximumMonthlyInstanceCostUsd']<=0
            or not isinstance(screenshot,str) or not re.fullmatch(r'[a-z0-9-]+\.png',screenshot)
            or hashlib.sha256((release/screenshot).read_bytes()).hexdigest()!=proof.get('screenshotSha256')):
        raise ValueError('The provider limit observation is missing, stale or unverified')
    return {key:proof[key] for key in ('maximumInstances','maximumMonthlyInstanceCostUsd')}


def validate_staged_confirmation(ledger, release):
    evidence=ledger.get('confirmationExecutions', [])
    if not isinstance(evidence, list) or len(evidence)!=2 or len(set(evidence))!=2:
        raise ValueError('Two independent passing 1000-client confirmations are required')
    for name in evidence:
        if not isinstance(name,str) or not re.fullmatch(r'custom-domain-load-execution-[a-z0-9-]{8,60}\.json',name):
            raise ValueError('Invalid confirmation evidence path')
        value=json.loads((release/name).read_text(encoding='utf8'))
        if (value.get('executionPassed') is not True or value.get('holdSeconds')!=60
                or value.get('retirement',{}).get('scopeFingerprint')!=ledger['retirementScopeFingerprint']
                or value.get('load',{}).get('requestedClients')!=1000
                or value.get('load',{}).get('httpDeliveryChecksPassed') is not True):
            raise ValueError('Confirmation evidence does not match this guarded batch')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--inventory',type=pathlib.Path,default=LEDGER)
    parser.add_argument('--additional-generators',type=int)
    parser.add_argument('--resume-reconciled-creation',action='store_true',
        help='Explicitly resume only after read-only reconciliation proves there are no unknown owned instances')
    args=parser.parse_args()
    import importlib.util
    candidate_spec=importlib.util.spec_from_file_location('candidate_gate',ROOT/'platform/scripts/hls_candidate_readiness.py')
    candidate_gate=importlib.util.module_from_spec(candidate_spec);candidate_spec.loader.exec_module(candidate_gate)
    candidate_proof=candidate_gate.require_published_candidate(ROOT)
    ledger_path=args.inventory
    ledger=json.loads(ledger_path.read_text(encoding='utf8'))
    provider_limits=provider_limit_proof(ledger,ROOT/'release')
    if ledger.get('candidateSourceSha256')!=candidate_proof['sourceSha256']:
        raise ValueError('The paid-resource scope must pin the exact checked and published candidate')
    if ledger['newBudget']['status']!='approved' or ledger.get('creationOutcomeUnknown'):
        raise ValueError('Recorded approval and resolved creation outcomes are required')
    existing=ledger['generators']
    if existing:
        if any(node.get('destroyed') or not node.get('ownedForThisTest') for node in existing):
            raise ValueError('Only the owned active batch can be continued')
        if args.resume_reconciled_creation:
            name=ledger.get('creationFailureReconciledEvidence','')
            if not isinstance(name,str) or not re.fullmatch(r'admission-table-provision-reconciled-\d{8}\.json',name):
                raise ValueError('Explicit read-only reconciliation evidence required')
            proof=json.loads((ROOT/'release'/name).read_text(encoding='utf8'))
            if (proof.get('reconciled') is not True or proof.get('readOnly') is not True
                    or proof.get('runId')!=ledger['runId'] or proof.get('unknownOwnedIds')!=[]
                    or set(proof.get('exactIds',[]))!={node['id'] for node in existing}
                    or proof.get('ownedCount')!=len(existing) or ledger.get('fullMediaRepeatStage',{}).get('executions')!=[]):
                raise ValueError('The creation outcome must be reconciled before any explicit continuation')
        else:
            if ledger.get('sustainedLoad') is not True:raise ValueError('Only an active staged batch can be expanded')
            validate_staged_confirmation(ledger,ROOT/'release')
    if len(existing)!=ledger['resourcesCreated']:raise ValueError('Inventory count differs')
    count=ledger['scope']['maximumInstances']
    create_count=args.additional_generators if args.additional_generators is not None else count-len(existing)
    if not 1<=create_count<=count-len(existing):raise ValueError('Creation count outside guarded scope')
    previous=Decimal(str(ledger['newBudget'].get('previousObservedComputeUsd',0)))
    reserved_previous=Decimal(str(ledger['newBudget'].get('previousReservedComputeUsd',0)))
    ceiling=Decimal(str(ledger['newBudget']['additionalComputeLimitUsd']))
    authorization=ledger['newBudget']['authorizationReference']
    if authorization!=ledger['scope']['budgetAuthorizationReference']:raise ValueError('Scope approval differs')
    dedicated=ledger['scope']['plan']=='voc-c-8c-16gb-150s-amd'
    if dedicated and (ledger.get('computeReservationPolicy')!={'plan':'voc-c-8c-16gb-150s-amd',
            'region':'ord','hourlyCeilingUsd':0.25,'reservedHoursPerGenerator':2,'additionalVolumes':0}
            or ledger['scope']['region']!='ord' or ceiling!=Decimal('3.50') or previous!=0 or reserved_previous!=0):
        raise ValueError('Dedicated generators require their exact fresh compute reservation')
    expanded=(ledger.get('sustainedLoad') is True and authorization!='call_905dce8a6a194df1a7f2571513fcaed9'
              and ledger['newBudget'].get('priorAuthorizationReference')=='call_905dce8a6a194df1a7f2571513fcaed9'
              and previous==Decimal('1.20'))
    repeat=(expanded and ledger.get('repeatSustainedLoad') is True
            and ledger['newBudget'].get('priorSustainedAuthorizationReference')=='call_0178dda16f0f45d18746bba2a7b35191'
            and authorization!='call_0178dda16f0f45d18746bba2a7b35191' and reserved_previous==Decimal('0.30'))
    if ledger.get('repeatSustainedLoad') is True and not repeat:
        raise ValueError('The repeat must include its prior reservation and fresh authorization')
    if (type(count) is not int or not 1<=count<=7 or not previous.is_finite() or not ceiling.is_finite()
            or not reserved_previous.is_finite() or reserved_previous<0 or (reserved_previous and not repeat)
            or not 0<=previous<ceiling<=(Decimal('3.50') if dedicated else Decimal('3.60') if repeat else Decimal('3.30') if expanded else Decimal('3'))
            or previous+reserved_previous+(Decimal('0.50') if dedicated else Decimal('0.30'))*count>ceiling):
        raise ValueError('The cumulative compute reservation exceeds the approved budget')
    public_key=pathlib.Path('C:/Users/maria/.ssh/qsession_deploy_ed25519.pub').read_text(encoding='utf8').strip()
    script=REMOTE.replace('EXPECTED_FINGERPRINT',repr(ledger['retirementScopeFingerprint'])).replace('EXPECTED_PUBLIC_KEY',repr(public_key))
    script=script.replace('EXPECTED_AUTHORIZATION',repr(authorization)).replace('EXPECTED_IDS',repr([n['id'] for n in existing]))
    script=script.replace('FIRST_INDEX',str(len(existing)+1)).replace('CREATE_COUNT',str(create_count))
    script=script.replace('EXPECTED_PROVIDER_LIMITS',repr(provider_limits))
    child=subprocess.Popen(SSH+['/usr/bin/python3 -'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    child.stdin.write(script.encode('utf8'));child.stdin.close()
    for line in child.stdout:
        item=json.loads(line)
        if item.get('unknownOutcomeMustBeDiscoveredBeforeAnyRetry'):
            ledger['creationOutcomeUnknown']=True
            ledger_path.write_text(json.dumps(ledger,indent=2)+'\n',encoding='utf8')
        if 'created' in item:
            ledger['generators'].append(item['created'])
            ledger['activeCount']=len(ledger['generators']);ledger['resourcesCreated']=ledger['activeCount']
            ledger_path.write_text(json.dumps(ledger,indent=2)+'\n',encoding='utf8')
        print(json.dumps(item),flush=True)
    code=child.wait(timeout=180)
    print(json.dumps({'exitCode':code,'registeredCreated':ledger['resourcesCreated'],
                      'providerStderrSuppressed':True,'automaticRetirementRemainsEnabled':True}),flush=True)
    return code


if __name__=='__main__':
    raise SystemExit(main())
