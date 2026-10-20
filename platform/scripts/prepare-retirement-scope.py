"""Transfer the approved temporary credential and arm a bounded empty scope.

No instance creation/deletion. The local transfer file is removed immediately
after a successful SSH transfer. No key, instance payload or provider body is
printed. This script alone does not install/enable the retirement service.
"""
import datetime
import argparse
import hashlib
import json
import pathlib
import re
import secrets
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
KEY = ROOT / 'private/load-retirement/vultr.transfer'
OUTPUT = ROOT / 'release/load-generators-guarded-20261020.json'
SPENT_EDGE_AUTHORIZATION='call_2caf9cd1c0234d28816e9c766bf72935'
SPENT_AUTHORIZATIONS={SPENT_EDGE_AUTHORIZATION,'call_6a51aee29d5f4d36a5bcedd4d0a61a3f',
    'call_3df9e63a99e44a099cadb98eff4cd410','call_ee5fa2738f3b4373b8ec88731623c351'}
PRIOR_IP_CIDRS={'217.138.213.4/32','159.26.100.230/32'}
SSH = ['ssh', '-T', '-i', 'C:/Users/maria/.ssh/qsession_deploy_ed25519',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'ConnectTimeout=12', 'root@45.77.192.82']


def sustained_approval(value, observed):
    reference = value.get('authorizationReference', '')
    repeat = value.get('repeatSustainedLoad') is True
    if (value.get('status') != 'approved' or not isinstance(reference, str)
            or not re.fullmatch(r'call_[a-zA-Z0-9_]{8,160}', reference)
            or reference in {'call_905dce8a6a194df1a7f2571513fcaed9',
                             'call_7a6df35e769a41afaaca8f49a07ded5c',
                             'call_20594bf6150345798708fead2c0ce86a'}
            or value.get('additionalComputeLimitUsd') != (3.60 if repeat else 3.30)
            or value.get('maximumGenerators') != 7
            or value.get('temporaryOrganizationApiAccessApproved') is not True
            or value.get('temporaryPreviousIpRemovalApproved') is not True
            or value.get('encoderIpCidr') != '45.77.192.82/32'
            or value.get('restoreIpCidr') != '217.138.213.4/32'
            or observed.get('newAuthorizationObservedTotalUsd') != 1.20
            or observed.get('generatorsRetired') is not True):
        raise ValueError('Fresh recorded sustained-load and security approval required')
    if repeat and (reference=='call_0178dda16f0f45d18746bba2a7b35191'
                   or value.get('priorBatchReservationUsd')!=0.30):
        raise ValueError('Fresh repeat authorization must account for the retired batch')
    return reference


def media_diagnostic_approval(value, previous, access, publication):
    reference=value.get('authorizationReference','')
    if (value.get('status')!='approved' or not isinstance(reference,str)
            or not re.fullmatch(r'call_[a-zA-Z0-9_]{8,160}',reference)
            or reference in {previous.get('authorizationReference'),publication.get('authorizationReference')}
            or value.get('additionalComputeLimitUsd')!=0.30 or value.get('maximumGenerators')!=1
            or value.get('maximumExecutions')!=2 or value.get('clientStages')!=[1000,1500]
            or value.get('temporaryOrganizationApiAccessApproved') is not True
            or value.get('temporaryPreviousIpRemovalApproved') is not True
            or value.get('encoderIpCidr')!='45.77.192.82/32'
            or value.get('restoreIpCidr')!='217.138.213.4/32'
            or value.get('retirementMinutes')!=45):
        raise ValueError('Fresh bounded media-diagnostic approval required')
    if (previous.get('cleanup',{}).get('temporaryGeneratorsRemaining')!=0
            or previous.get('compute',{}).get('approvedStageCeilingUsd')!=3.60
            or access.get('apiDisabled') is not True
            or publication.get('sourceSha256')!='6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f'
            or publication.get('status')!='published-pilot-passed-session-revoked'):
        raise ValueError('Prior closure and published media diagnostics must be verified')
    return reference


def full_media_approval(value, diagnostic, access, publication, candidate=None):
    reference=value.get('authorizationReference','')
    dedicated=value.get('generatorPlan')=='voc-c-8c-16gb-150s-amd'
    if (value.get('status')!='approved' or not isinstance(reference,str)
            or not re.fullmatch(r'call_[a-zA-Z0-9_]{8,160}',reference)
            or reference in SPENT_AUTHORIZATIONS|{diagnostic.get('authorizationReference')}
            or candidate is not None and reference in candidate.get('consumedAuthorizationReferences',[])
            or (reference==publication.get('authorizationReference')
                and (value.get('bundledPublicationAndLoadApproved') is not True or candidate is None))
            or value.get('additionalComputeLimitUsd')!=(3.50 if dedicated else 2.10) or value.get('maximumGenerators')!=7
            or value.get('maximumExecutions')!=1 or value.get('clients')!=10000
            or value.get('holdSeconds')!=620 or value.get('reconnectAfterSeconds')!=240
            or value.get('repeatAfterDiagnosticFailureAcknowledged') is not True
            or value.get('temporaryOrganizationApiAccessApproved') is not True
            or value.get('temporaryPreviousIpRemovalApproved') is not True
            or value.get('conditionalProbeRenewalApiRestartApproved') is not True
            or value.get('encoderIpCidr')!='45.77.192.82/32'
            or value.get('restoreIpCidr')!='217.138.213.4/32'
            or value.get('retirementMinutes')!=45):
        raise ValueError('Fresh bounded 10000-client repeat approval required')
    source_verified=(publication.get('sourceSha256')=='6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f'
        and publication.get('status')=='published-pilot-passed-session-revoked')
    if candidate is not None:
        expected_ips=PRIOR_IP_CIDRS
        if dedicated:
            extra_reference=value.get('additionalIpRemovalAuthorizationReference','')
            if (not isinstance(extra_reference,str) or not re.fullmatch(r'call_[A-Za-z0-9_]{8,160}',extra_reference)
                    or extra_reference==reference or value.get('additionalIpCidr')!='103.216.221.80/32'):
                raise ValueError('The newly observed third IP requires separate explicit removal/restoration approval')
            expected_ips=PRIOR_IP_CIDRS|{'103.216.221.80/32'}
        for field in ('previousIpCidrs','restoreIpCidrs'):
            addresses=value.get(field)
            if (not isinstance(addresses,list) or len(addresses)!=len(expected_ips)
                    or any(not isinstance(address,str) for address in addresses)
                    or set(addresses)!=expected_ips):
                raise ValueError('The fresh approval must cover removal and restoration of all prior IP ranges')
        source_verified=(candidate.get('readyForPaidLoadPreparation') is True
            and publication.get('published') is True and publication.get('canaryRoom')=='PRB10A'
            and publication.get('sourceSha256')==candidate.get('sourceSha256')==value.get('sourceSha256')
            and value.get('workersPerNode')==8)
    if (diagnostic.get('status')!='diagnostic-completed-retired-access-closed'
            or diagnostic.get('cleanup',{}).get('temporaryGeneratorsRemaining')!=0
            or access.get('apiDisabled',access.get('organizationApiDisabled')) is not True
            or not source_verified):
        raise ValueError('Diagnostic closure and published source must be verified')
    return reference


def require_latest_edge_closure(closed,access,inventory):
    """Keep the consumed reservation and require its actual resources/access closed."""
    cleanup=closed.get('cleanup',{})
    if (closed.get('status')!='failed-and-cleaned'
            or closed.get('authorizationReference')!=SPENT_EDGE_AUTHORIZATION
            or closed.get('runId')!=inventory.get('runId')
            or closed.get('sourceSha256')!='ad2912eed16a285d0f5e6dcaef4762e23f5d9bb6fbbed8a3ed076c0aa2483858'
            or closed.get('computeAccounting',{}).get('newReservationCeilingUsd')!=2.10
            or any(cleanup.get(field) is not True for field in ('remoteKeyAndScopeRemoved',
                'temporaryProviderKeyRevoked','organizationApiDisabled','priorAclRestored'))
            or cleanup.get('temporaryGeneratorsRemaining')!=0 or cleanup.get('activeProbeLeases')!=0
            or access.get('budgetAuthorizationReference')!=SPENT_EDGE_AUTHORIZATION
            or access.get('organizationApiDisabled') is not True
            or access.get('temporaryKeyExplicitlyDeleted') is not True
            or access.get('remoteKeyAndScopeRemoved') is not True
            or set(access.get('restoredIpCidrsVerifiedBeforeDisable',[]))!=PRIOR_IP_CIDRS
            or inventory.get('newBudget',{}).get('authorizationReference')!=SPENT_EDGE_AUTHORIZATION
            or inventory.get('activeCount')!=0 or len(inventory.get('generators',[]))!=7
            or any(node.get('destroyed') is not True for node in inventory['generators'])):
        raise ValueError('The latest edge/R2 batch, reservation and both IP ranges must be closed')
    accounting=inventory.get('priorStageAccounting',{})
    if accounting.get('combinedReservationCeilingUsd')!=8.10 or accounting.get('observedUsd')!=1.20:
        raise ValueError('Changed prior accounting requires review; do not reuse the consumed reservation')
    return {'previousReservationCeilingUsd':8.10,'observedUsd':1.20,
        'unverifiedReservationsUsd':6.90,'newAdditionalReservationUsd':2.10,
        'combinedReservationCeilingUsd':10.20,'earlierRecordsPreserved':True,'finalInvoiceVerified':False,
        'priorEvidence':'edge-r2-sustained-closeout-20261020.json','priorInventory':'load-generators-edge-r2-sustained-20261020.json',
        'earlierAccounting':accounting}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--diagnostic', action='store_true')
    parser.add_argument('--approved-sustained-proposal', type=pathlib.Path)
    parser.add_argument('--approved-media-diagnostic',type=pathlib.Path)
    parser.add_argument('--approved-full-media-proposal',type=pathlib.Path)
    parser.add_argument('--inventory', type=pathlib.Path)
    args = parser.parse_args()
    # Former grants and historical evidence cannot justify hiring machines
    # before the repaired delivery path has actually been published.
    import importlib.util
    candidate_spec=importlib.util.spec_from_file_location('candidate_gate',ROOT/'platform/scripts/hls_candidate_readiness.py')
    candidate_gate=importlib.util.module_from_spec(candidate_spec);candidate_spec.loader.exec_module(candidate_gate)
    candidate_proof=candidate_gate.require_published_candidate(ROOT)
    if not args.approved_full_media_proposal:
        raise ValueError('Historical workflows are closed; require a new source-specific full-media proposal')
    if sum(bool(v) for v in (args.diagnostic,args.approved_sustained_proposal,args.approved_media_diagnostic,args.approved_full_media_proposal))>1:
        raise ValueError('Choose one guarded workflow')
    output = args.inventory or (ROOT / 'release/load-generators-diagnostic-20261020.json' if args.diagnostic else OUTPUT)
    if (args.approved_sustained_proposal or args.approved_media_diagnostic or args.approved_full_media_proposal) and args.inventory is None:
        raise ValueError('A fresh inventory path is required')
    if output.exists():
        raise ValueError('A prepared batch already exists; do not silently replace its scope')
    previous_cost = 0
    reference='call_905dce8a6a194df1a7f2571513fcaed9'
    ceiling=3
    if args.approved_full_media_proposal:
        approval=json.loads(args.approved_full_media_proposal.read_text(encoding='utf8'))
        diagnostic=json.loads((ROOT/'release/media-diagnostic-closeout-20261020.json').read_text())
        active=candidate_gate.load_active_evidence(ROOT)
        access=json.loads((ROOT/'release'/active['latestPaidLoad']['accessClosed']).read_text())
        publication=json.loads((ROOT/'release'/active['artifacts']['publication']).read_text())
        reference=full_media_approval(approval,diagnostic,access,publication,candidate_proof)
        if approval.get('workerVersion')!=candidate_proof['workerVersion']:
            raise ValueError('The new scope must pin the exact current published Worker version')
        # Plan choice is independent of source readiness. Never silently reuse
        # the former shared-CPU plan while dedicated CPUs/pricing are pending.
        if (approval.get('planSelectionStatus')!='selected'
                or approval.get('generatorPlan')!='voc-c-8c-16gb-150s-amd' or approval.get('generatorRegion')!='ord'
                or approval.get('hourlyReservationPerGeneratorUsd')!=0.25
                or approval.get('reservedHoursPerGenerator')!=2 or approval.get('additionalVolumes')!=0):
            raise ValueError('A selected plan supported by the independent retirement guard is required')
        prior_edge_accounting=dict(candidate_proof['priorStageAccounting'])
        prior_edge_accounting.update(newAdditionalReservationUsd=approval['additionalComputeLimitUsd'],
            combinedReservationCeilingUsd=round(prior_edge_accounting['previousReservationCeilingUsd']
                +approval['additionalComputeLimitUsd'],2))
        old=json.loads((ROOT/'release/load-generators-media-diagnostic-20261020.json').read_text())
        if old['activeCount'] or any(n.get('destroyed') is not True for n in old['generators']):
            raise ValueError('The diagnostic batch must already be retired')
        previous_cost=0
        ceiling=approval['additionalComputeLimitUsd']
    if args.approved_media_diagnostic:
        approval=json.loads(args.approved_media_diagnostic.read_text(encoding='utf8'))
        previous=json.loads((ROOT/'release/repeat-load-closeout-20261020.json').read_text())
        access=json.loads((ROOT/'release/repeat-vultr-access-closed-20261020.json').read_text())
        publication=json.loads((ROOT/'release/media-diagnostics-closeout-20261020.json').read_text())
        reference=media_diagnostic_approval(approval,previous,access,publication)
        old=json.loads((ROOT/'release/load-generators-repeat-20261020.json').read_text())
        if old['activeCount'] or any(n.get('destroyed') is not True for n in old['generators']):
            raise ValueError('The previous disposable batch must be retired')
        # This is a separately approved additional budget. Do not turn prior
        # unverified reservations into observed charges or silently reuse them.
        previous_cost=0
        ceiling=0.30
    if args.approved_sustained_proposal:
        observed=json.loads((ROOT/'release/diagnostic-load-observed-cost-20261020.json').read_text())
        approval=json.loads(args.approved_sustained_proposal.read_text(encoding='utf8'))
        reference=sustained_approval(approval,observed)
        for name in ('load-generators-guarded-20261020.json','load-generators-diagnostic-20261020.json'):
            old=json.loads((ROOT/'release'/name).read_text())
            if old['activeCount'] or any(node.get('destroyed') is not True for node in old['generators']):
                raise ValueError('Earlier batches must be verified retired')
        previous_cost=observed['newAuthorizationObservedTotalUsd']
        ceiling=approval['additionalComputeLimitUsd']
        if approval.get('repeatSustainedLoad') is True:
            old=json.loads((ROOT/'release/load-generators-sustained-20261020.json').read_text())
            close=json.loads((ROOT/'release/sustained-load-closeout-20261020.json').read_text())
            access=json.loads((ROOT/'release/sustained-vultr-access-closed-20261020.json').read_text())
            if (old['activeCount'] or any(n.get('destroyed') is not True for n in old['generators'])
                    or close.get('computeReservationForCreatedResourceUsd')!=0.30
                    or close.get('temporaryGeneratorsRemaining')!=0 or access.get('apiDisabled') is not True):
                raise ValueError('Previous sustained batch closure must be verified')
    if args.diagnostic:
        old = json.loads(OUTPUT.read_text(encoding='utf8'))
        observed = json.loads((ROOT / 'release/guarded-load-observed-cost-20261020.json').read_text())
        if old['activeCount'] or any(node.get('destroyed') is not True for node in old['generators']):
            raise ValueError('The earlier batch must be verified retired')
        if observed['runId'] != old['runId'] or observed['newBudgetUsd'] != 3:
            raise ValueError('Prior cost evidence does not match this authorization')
        previous_cost = observed['observedNewBatchUsd']
        if previous_cost != 1.05:
            raise ValueError('Review changed costs before preparing another diagnostic')
    now = datetime.datetime.now(datetime.timezone.utc)
    run_id = 'qsession-load-' + now.strftime('%Y%m%d') + '-' + secrets.token_hex(4)
    scope = dict(schemaVersion=1, runId=run_id, tag='qs-retire-' + secrets.token_hex(16),
                 plan=approval['generatorPlan'] if args.approved_full_media_proposal else 'vhp-8c-16gb-amd',
                 region='ord', notBefore=now.isoformat(),
                 retireAt=(now + datetime.timedelta(minutes=45)).isoformat(),
                 maximumInstances=1 if args.diagnostic or args.approved_media_diagnostic else 7,
                 budgetAuthorizationReference=reference)
    # The receiver is fixed source; the key travels only through encrypted stdin.
    source = r'''import json,os,pathlib,re,sys
data=json.load(sys.stdin)
key=data['key'].strip()
if not re.fullmatch(r'[A-Za-z0-9_-]{20,256}',key):raise SystemExit('Invalid key format')
directory=pathlib.Path('/etc/qsession-load-guard')
if directory.is_symlink():raise SystemExit('Symlink rejected')
directory.mkdir(mode=0o700,exist_ok=True)
os.chown(directory,0,0);os.chmod(directory,0o700)
for name,content in [('vultr.key',key),('scope.json',json.dumps(data['scope']))]:
 target=directory/name
 fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(content)
print(json.dumps({'privateFilesStored':True}))
'''
    import shlex
    payload = {'scope': scope, 'key': KEY.read_text(encoding='utf8').strip()}
    result = subprocess.run(SSH + ['/usr/bin/python3 -c ' + shlex.quote(source)],
                            input=json.dumps(payload).encode('utf8'), capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Private transfer failed; remote output suppressed')
    KEY.unlink()
    ledger = dict(schemaVersion=1, runId=run_id, scope=scope, generators=[], activeCount=0,
                  candidateSourceSha256=candidate_proof['sourceSha256'],
                  deliveryHost='live.qsession.org', resourcesCreated=0,
                  retirementScopeFingerprint=hashlib.sha256(json.dumps(scope, sort_keys=True).encode('utf8')).hexdigest(),
                  newBudget={'status':'approved', 'authorizationReference':scope['budgetAuthorizationReference'],
                             'additionalComputeLimitUsd':ceiling, 'previousObservedComputeUsd':previous_cost},
                  apiOrganizationEnableAuthorizationReference='call_73df9e82d69f4cd4bec451b7c2ca6c72')
    if args.approved_sustained_proposal:
        ledger.update(sustainedLoad=True,apiOrganizationEnableAuthorizationReference=reference,
                      priorAclRemovalAuthorizationReference=reference)
        ledger['newBudget']['priorAuthorizationReference']='call_905dce8a6a194df1a7f2571513fcaed9'
        if approval.get('repeatSustainedLoad') is True:
            ledger['repeatSustainedLoad']=True
            ledger['newBudget'].update(previousReservedComputeUsd=0.30,
                priorSustainedAuthorizationReference='call_0178dda16f0f45d18746bba2a7b35191')
    if args.diagnostic:
        ledger['diagnosticAccessAuthorizationReference']='call_d2d385fb49ce4e359720d41c13f0fa45'
        ledger['priorAclRemovalAuthorizationReference']='call_8e450e31cfe44bbe87cd02635bc402de'
        ledger['diagnosticComputeReservationUsd']=0.30
    if args.approved_media_diagnostic:
        ledger.update(apiOrganizationEnableAuthorizationReference=reference,
            priorAclRemovalAuthorizationReference=reference,
            mediaDiagnosticStage={'maximumExecutions':2,'clientStages':[1000,1500],
                'workerSourceSha256':publication['sourceSha256'],'executions':[]},
            priorStageAccounting={'approvedCeilingUsd':3.60,'observedUsd':1.20,
                'unverifiedReservationsUsd':2.40,'newAdditionalReservationUsd':0.30,
                'combinedReservationCeilingUsd':3.90,'earlierRecordsPreserved':True,
                'priorEvidence':'repeat-load-closeout-20261020.json'})
    if args.approved_full_media_proposal:
        ledger.update(apiOrganizationEnableAuthorizationReference=reference,
            priorAclRemovalAuthorizationReference=reference,
            computeReservationPolicy={'plan':scope['plan'],'region':'ord','hourlyCeilingUsd':0.25,
                'reservedHoursPerGenerator':2,'additionalVolumes':0},
            fullMediaRepeatStage={'maximumExecutions':1,'clients':10000,'holdSeconds':620,
                'reconnectAfterSeconds':240,'workerSourceSha256':candidate_proof['sourceSha256'],
                'workersPerNode':8,'executions':[]},
            priorStageAccounting=prior_edge_accounting)
    output.write_text(json.dumps(ledger, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'privateCredentialTransferred':True, 'localCredentialRemoved':True,
                      'runId':run_id, 'retireAt':scope['retireAt'], 'inventory':str(output),
                      'resourcesCreated':0}))


if __name__ == '__main__':
    main()
