"""Run the authorized seven-generator PRB10A load; no VM provisioning.

Synthetic R2 publication is bounded to 864 seconds. Access files and leases
are removed in finally. A separately running retirement timer is mandatory.
"""
import json
import argparse
import math
from decimal import Decimal
import datetime
import pathlib
import queue
import re
import subprocess
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from load_target_policy import require_staging_delivery_host, require_staging_ssh_host

ROOT=pathlib.Path(__file__).resolve().parents[2]
SCRIPTS=ROOT/'platform/scripts'
RELEASE=ROOT/'release'
INVENTORY=RELEASE/'load-generators-custom-domain-20261018.json'
SSH=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes',
     '-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12']


def validate_budget(inventory, now=None):
    # Use the observed minimum hourly charge, not just the advertised rate.
    # The second hour of this same seven-node batch was explicitly authorized.
    now = time.time() if now is None else now
    if 'newBudget' in inventory:
        approval = inventory['newBudget']
        reference = approval.get('authorizationReference', '')
        if (approval.get('status') != 'approved' or
                not re.fullmatch(r'call_[a-zA-Z0-9_]{8,160}', reference) or reference in {
                    'call_7a6df35e769a41afaaca8f49a07ded5c',
                    'call_20594bf6150345798708fead2c0ce86a'}):
            raise ValueError('New recorded compute authorization required')
        ceiling = Decimal(str(approval['additionalComputeLimitUsd']))
        previous = Decimal(str(approval.get('previousObservedComputeUsd', 0)))
        reserved_previous = Decimal(str(approval.get('previousReservedComputeUsd', 0)))
        dedicated=inventory.get('scope',{}).get('plan')=='voc-c-8c-16gb-150s-amd'
        if dedicated and (inventory.get('computeReservationPolicy')!={'plan':'voc-c-8c-16gb-150s-amd',
                'region':'ord','hourlyCeilingUsd':0.25,'reservedHoursPerGenerator':2,'additionalVolumes':0}
                or inventory['scope'].get('region')!='ord' or ceiling!=Decimal('3.50')
                or previous!=0 or reserved_previous!=0):
            raise ValueError('Dedicated generators require their exact fresh compute reservation')
        rate_ceiling=Decimal('0.25') if dedicated else Decimal('0.15')
        expanded = (inventory.get('sustainedLoad') is True and reference != 'call_905dce8a6a194df1a7f2571513fcaed9'
                    and approval.get('priorAuthorizationReference') == 'call_905dce8a6a194df1a7f2571513fcaed9'
                    and previous == Decimal('1.20'))
        repeat = (expanded and inventory.get('repeatSustainedLoad') is True
                  and approval.get('priorSustainedAuthorizationReference') == 'call_0178dda16f0f45d18746bba2a7b35191'
                  and reference != 'call_0178dda16f0f45d18746bba2a7b35191'
                  and reserved_previous == Decimal('0.30'))
        if inventory.get('repeatSustainedLoad') is True and not repeat:
            raise ValueError('The repeat must include its prior reservation and fresh authorization')
        if not reserved_previous.is_finite() or reserved_previous < 0 or (reserved_previous and not repeat):
            raise ValueError('Unreviewed prior compute reservation')
        if not ceiling.is_finite() or not 0 < ceiling <= (Decimal('3.50') if dedicated else Decimal('3.60') if repeat else Decimal('3.30') if expanded else Decimal('3')):
            raise ValueError('Additional compute limit outside prepared proposal')
        if not previous.is_finite() or not 0 <= previous < ceiling:
            raise ValueError('Invalid earlier compute cost under this authorization')
        batch = Decimal('0')
        for node in inventory['generators']:
            rate = Decimal(str(node['hourlyUsd']))
            if not rate.is_finite() or not 0 < rate <= rate_ceiling:
                raise ValueError('Unreviewed generator rate')
            if dedicated and (node.get('plan')!='voc-c-8c-16gb-150s-amd' or node.get('region')!='ord'
                    or node.get('additionalVolumes')!=0):
                raise ValueError('Generator differs from the approved dedicated plan')
            created = datetime.datetime.fromisoformat(node['createdObservedUtc'].replace('Z', '+00:00')).timestamp()
            if not 0 <= now - created <= 1800:
                raise ValueError('Only fresh independently guarded generators may run')
            batch += rate_ceiling * 2  # reserve two billed hours per generator
        if previous + reserved_previous + batch > ceiling:
            raise ValueError('Compute reservation exceeds newly approved budget')
        return {'authorizationReference': reference, 'additionalLimitUsd': float(ceiling),
                'previousObservedComputeUsd': float(previous), 'reservedBatchUsd': float(batch),
                'previousReservedComputeUsd':float(reserved_previous),
                'projectedObservedTotalUsd': float(previous + reserved_previous + batch),
                'projectionIncludesUnverifiedReservation':bool(reserved_previous), 'finalInvoiceStillSubjectToProvider': True}
    previous = Decimal(str(inventory.get('previousObservedTestCostUsd')))
    ceiling = Decimal(str(inventory.get('budgetLimitUsd')))
    hours = inventory.get('maximumBilledHoursPerGenerator', 1)
    expanded = inventory.get('budgetAuthorizationReference') == 'call_7a6df35e769a41afaaca8f49a07ded5c'
    if hours not in (1, 2) or (hours == 2 and not expanded):
        raise ValueError('Another billed hour requires the recorded authorization')
    if not previous.is_finite() or not ceiling.is_finite() or not 0 <= previous <= ceiling <= (6 if expanded else 5):
        raise ValueError('Invalid cumulative budget')
    batch = Decimal('0')
    for node in inventory['generators']:
        rate = Decimal(str(node['hourlyUsd']))
        if not rate.is_finite() or not 0 < rate <= Decimal('0.15'):
            raise ValueError('Generator rate outside bounded test budget')
        created = datetime.datetime.fromisoformat(node['createdObservedUtc'].replace('Z', '+00:00')).timestamp()
        if not 0 <= now-created <= hours * 3600 - 900:
            raise ValueError('Generators require 15 minutes before the authorized retirement deadline')
        batch += max(rate, Decimal('0.15')) * hours
    if previous+batch > ceiling:
        raise ValueError('Cumulative compute budget exceeded')
    return {'previousObservedUsd':float(previous),'maximumAuthorizedBatchUsd':float(batch),
            'maximumBilledHoursPerGenerator':hours,
            'projectedObservedTotalUsd':float(previous+batch),'limitUsd':float(ceiling),
            'finalInvoiceStillSubjectToProvider':True}


def validate_retirement(inventory, proof, now=None):
    now = time.time() if now is None else now
    expected = inventory.get('retirementScopeFingerprint', '')
    reference = inventory.get('newBudget', {}).get('authorizationReference')
    if (not re.fullmatch(r'[a-f0-9]{64}', expected) or proof.get('scopeFingerprint') != expected or
            proof.get('runId') != inventory['runId'] or proof.get('independentTimerActive') is not True or
            proof.get('apply') is not False or proof.get('errors') or proof.get('due') is not False or
            proof.get('budgetAuthorizationReference') != reference or not reference or
            proof.get('maximumInstances') != inventory.get('scope', {}).get('maximumInstances', len(inventory['generators'])) or
            set(proof.get('pending', [])) != {node['id'] for node in inventory['generators']}):
        raise ValueError('Matching independent retirement protection is required')
    # NTP on Windows and Linux can differ by fractions of a second. Accept at
    # most five seconds of forward skew, still reject stale or future proofs.
    if not -5 <= now - proof.get('checkedAtUnix', 0) <= 30:
        raise ValueError('Fresh retirement proof required')
    deadline = datetime.datetime.fromisoformat(proof['retireAt'].replace('Z', '+00:00')).timestamp()
    if not 900 <= deadline - now <= 2700:
        raise ValueError('Insufficient guarded run time')
    return {'independentTimerActive': True, 'retireAt': proof['retireAt'],
            'verifiedGenerators': len(inventory['generators']), 'scopeFingerprint': expected}


def retirement_preflight(inventory, encoder_host):
    # The guard runs on the staging encoder, never on a permanent production host.
    encoder_host = require_staging_ssh_host(encoder_host)
    command = ('/usr/bin/python3 /opt/qsession-load-guard/retire-load-generators.py '
               '--scope /etc/qsession-load-guard/scope.json '
               '--key-file /etc/qsession-load-guard/vultr.key --preflight')
    result = subprocess.run(SSH + ['root@'+encoder_host, command],
                            capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise ValueError('Independent retirement service unavailable; no load started')
    return validate_retirement(inventory, json.loads(result.stdout))


def execution_passed(report, generators):
    cleanup = report.get('leaseCleanup', [])
    master = [item for item in cleanup if item.get('namespace') == 'PRB10A']
    files = {item.get('label'):item.get('privateLeaseFileRemoved') for item in cleanup if 'label' in item}
    origin=report.get('origin',{})
    controlled_finish=(report.get('originStopRequested') is True
        and report.get('originStopReason')=='load-completed'
        and origin.get('controlStopReason')=='load-completed'
        and report.get('loadProcessesFinished') is True)
    return (not report.get('errorClass') and not report.get('observerCleanupErrorClass')
            and not report.get('originCleanupErrorClass') and not report.get('originWatchdogPending')
            and report.get('load', {}).get('httpDeliveryChecksPassed') is True
            and report.get('observerExitCode') == 0 and report.get('originExitCode') == 0
            and origin.get('cleanupComplete') is True and (not origin.get('cancelled') or controlled_finish)
            and report.get('leaseCleanupExitCode') == 0 and len(master) == 1
            and master[0].get('activeAfter') == 0 and master[0].get('privateMasterFileRemoved') is True
            and set(files) == {node['label'] for node in generators}
            and all(value is True for value in files.values()))


def origin_wait_seconds(origin_ready, now=None):
    """Wait for the scheduled publisher tail and bounded storage cleanup."""
    now = time.time() if now is None else now
    stop_at = origin_ready.get('plannedStopAtUnix')
    if isinstance(stop_at, bool) or not isinstance(stop_at, (int, float)) or not math.isfinite(stop_at):
        return 90
    return min(180, max(30, math.ceil(stop_at + 60 - now)))


def collect_origin_report(events, report):
    while True:
        try:
            event = events.get_nowait()
        except queue.Empty:
            return
        if isinstance(event, dict) and isinstance(event.get('originReport'), dict):
            report['origin'] = event['originReport']


def load_processes_finished(value, generators):
    """Require completed controller evidence before shortening the origin tail."""
    summary=value.get('summary',{});results=value.get('nodeResults',[])
    if len(results)!=len(generators) or summary.get('requestedGenerators')!=len(generators):return False
    workers=0
    for result in results:
        node=result.get('nodeReport',{})
        jobs=node.get('workers',[]);count=node.get('workersPerNode')
        if (node.get('runId')!=summary.get('runId') or node.get('startAtUnix')!=summary.get('startAtUnix')
                or count not in (4,8) or len(jobs)!=count or node.get('leaseSubsetFilesRemoved') is not True
                or {job.get('index') for job in jobs}!=set(range(count))
                or any(type(job.get('exitCode')) is not int for job in jobs)):
            return False
        workers+=count
    return workers==summary.get('expectedWorkers')


def finish_observer(observer, report, request_stop=True, timeout=20):
    """A broken observer must never bypass lease, origin or report cleanup."""
    if observer is None:return
    try:
        if observer.poll() is None and request_stop:
            observer.stdin.write('stop\n');observer.stdin.flush();observer.stdin.close()
            report['observerStopRequested']=True
        observer.wait(timeout=timeout)
    except Exception as error:
        report['observerCleanupErrorClass']=type(error).__name__
        for method in ('terminate','kill'):
            try:
                if observer.poll() is not None:break
                getattr(observer,method)();observer.wait(timeout=5)
            except Exception as cleanup_error:
                report['observerProcessCleanupErrorClass']=type(cleanup_error).__name__
    finally:
        report['observerExitCode']=observer.poll()


def request_origin_stop(origin, report, reason):
    if origin is None:return
    try:
        if origin.poll() is not None:return
        run_id=report.get('originReady',{}).get('runId','')
        if not isinstance(run_id,str) or not re.fullmatch(r'[a-f0-9]{16}',run_id):return
        origin.stdin.write(json.dumps({'command':'stop','runId':run_id,'reason':reason})+'\n')
        origin.stdin.flush();origin.stdin.close()
        report.update(originStopRequested=True,originStopReason=reason)
    except Exception as error:report['originControlErrorClass']=type(error).__name__


def finish_origin(origin, thread, events, report):
    if origin is None:return
    try:
        if origin.poll() is None:
            if report.get('originStopRequested'):timeout=90
            else:
                stop_at=report.get('originReady',{}).get('plannedStopAtUnix')
                timeout=(min(900,max(30,math.ceil(stop_at+60-time.time())))
                    if type(stop_at) in (int,float) and math.isfinite(stop_at) else 100)
            origin.wait(timeout=timeout)
    except subprocess.TimeoutExpired:report['originWatchdogPending']=True
    except Exception as error:report['originCleanupErrorClass']=type(error).__name__
    finally:
        if origin.poll() is not None:
            report['originExitCode']=origin.returncode
            if thread:thread.join(timeout=2)
        collect_origin_report(events,report)


def reserve_media_diagnostic_execution(inventory, clients, hold, reconnect, transport, suffix, release):
    stage=inventory.get('mediaDiagnosticStage')
    if stage is None:return False
    entries=stage.get('executions')
    if (stage.get('maximumExecutions')!=2 or stage.get('clientStages')!=[1000,1500]
            or stage.get('workerSourceSha256')!='6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f'
            or not isinstance(entries,list) or len(entries)>=2
            or len(inventory['generators'])!=1 or inventory.get('scope',{}).get('maximumInstances')!=1
            or inventory.get('newBudget',{}).get('additionalComputeLimitUsd')!=0.30
            or inventory.get('newBudget',{}).get('previousObservedComputeUsd')!=0
            or clients!=[1000,1500][len(entries)] or hold!=60 or reconnect!=0 or transport!='aiohttp'
            or not re.fullmatch(r'media-diag-[a-z0-9-]{4,45}',suffix)):
        raise ValueError('Media diagnostic exceeds the two-run single-generator scope')
    if entries:
        name=entries[0].get('evidence','')
        if not re.fullmatch(r'custom-domain-load-execution-media-diag-[a-z0-9-]{4,45}\.json',name):
            raise ValueError('Unsafe prior diagnostic evidence path')
        first=json.loads((release/name).read_text())
        if (first.get('executionPassed') is not True or first.get('holdSeconds')!=60
                or first.get('load',{}).get('requestedClients')!=1000
                or first.get('retirement',{}).get('scopeFingerprint')!=inventory['retirementScopeFingerprint']):
            raise ValueError('The first diagnostic and cleanup must pass before 1500 clients')
    name='custom-domain-load-execution-'+suffix+'.json'
    if (release/name).exists() or any(e.get('evidence')==name for e in entries):
        raise ValueError('Never overwrite or repeat reserved diagnostic evidence')
    entries.append({'clients':clients,'evidence':name})
    return True


def reserve_full_media_execution(inventory, clients, hold, reconnect, transport, suffix, release,
        candidate=None, workers_per_node=4):
    stage=inventory.get('fullMediaRepeatStage')
    if stage is None:return False
    expected_source='6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f'
    if candidate is not None:
        expected_source=candidate.get('sourceSha256')
        if (candidate.get('readyForPaidLoadPreparation') is not True or not expected_source
                or inventory.get('candidateSourceSha256')!=expected_source
                or stage.get('workersPerNode')!=8 or workers_per_node!=8):
            raise ValueError('The new scope must pin the verified candidate and eight-worker partition')
    if (inventory.get('mediaDiagnosticStage') is not None
            or stage.get('maximumExecutions')!=1 or stage.get('clients')!=10000
            or stage.get('holdSeconds')!=620 or stage.get('reconnectAfterSeconds')!=240
            or stage.get('workerSourceSha256')!=expected_source
            or stage.get('executions')!=[] or len(inventory['generators'])!=7
            or inventory.get('scope',{}).get('maximumInstances')!=7
            or inventory.get('newBudget',{}).get('additionalComputeLimitUsd')!=(3.50
                if inventory.get('scope',{}).get('plan')=='voc-c-8c-16gb-150s-amd' else 2.10)
            or inventory.get('newBudget',{}).get('previousObservedComputeUsd')!=0
            or (clients,hold,reconnect,transport)!=(10000,620,240,'aiohttp')
            or not re.fullmatch(r'media-full-[a-z0-9-]{4,45}',suffix)):
        raise ValueError('Full media repeat exceeds its single-execution scope')
    name='custom-domain-load-execution-'+suffix+'.json'
    if (release/name).exists():raise ValueError('Never overwrite prior full media evidence')
    stage['executions'].append({'clients':clients,'evidence':name})
    return True


def main(args):
    # Refuse production before any SSH, mint, or origin publication.
    delivery_host = require_staging_delivery_host(getattr(args, 'delivery_host', None))
    encoder_host = require_staging_ssh_host(getattr(args, 'encoder_host', None))
    api_host = require_staging_ssh_host(getattr(args, 'api_host', None))
    import importlib.util
    candidate_spec=importlib.util.spec_from_file_location('candidate_gate',ROOT/'platform/scripts/hls_candidate_readiness.py')
    candidate_gate=importlib.util.module_from_spec(candidate_spec);candidate_spec.loader.exec_module(candidate_gate)
    candidate_proof=candidate_gate.require_published_candidate(ROOT)
    if not re.fullmatch(r'[a-z0-9-]{8,60}',args.suffix):raise ValueError('Invalid local evidence suffix')
    hold, reconnect = args.hold, args.reconnect_after
    if not 60<=hold<=620 or (reconnect and not 30<reconnect<30+hold-18):raise ValueError('Invalid bounded timing')
    if reconnect and args.transport!='aiohttp':raise ValueError('Session restart requires aiohttp')
    duration=30+hold
    origin_duration=((duration+120+5)//6)*6 if hold>60 else 180
    inventory_path=args.inventory
    def artifact(stem):return RELEASE/(stem+'-'+args.suffix+'.json')
    inventory=json.loads(inventory_path.read_text(encoding='utf-8-sig'))
    workers_per_node=getattr(args,'workers_per_node',4)
    if (inventory.get('candidateSourceSha256')!=candidate_proof['sourceSha256']
            or inventory.get('fullMediaRepeatStage') is None):
        raise ValueError('Historical or unpinned load scopes cannot run the new candidate')
    if inventory.get('mediaDiagnosticStage') is not None and inventory.get('fullMediaRepeatStage') is not None:
        raise ValueError('Conflicting diagnostic and full-load scopes')
    nodes=inventory['generators']
    if workers_per_node==8 and any(type(n.get('logicalCpuCount')) is not int or n['logicalCpuCount']<8 for n in nodes):
        raise ValueError('Verify generator CPU metadata before starting the origin or minting leases')
    if not 1<=len(nodes)<=7 or any(not n.get('ownedForThisTest') or n.get('destroyed') or not n.get('sshReady') for n in nodes):
        raise ValueError('Expected a bounded verified disposable batch')
    if not len(nodes)*4<=args.clients<=10000 or (args.clients+len(nodes)-1)//len(nodes)>1500:
        raise ValueError('Client count exceeds the per-generator diagnostic bound')
    budget = validate_budget(inventory)
    retirement = retirement_preflight(inventory, encoder_host)
    if (reserve_media_diagnostic_execution(inventory,args.clients,hold,reconnect,args.transport,args.suffix,RELEASE)
            or reserve_full_media_execution(inventory,args.clients,hold,reconnect,args.transport,args.suffix,RELEASE,
                candidate_proof,workers_per_node)):
        inventory_path.write_text(json.dumps(inventory,indent=2)+'\n',encoding='utf8')
    report={'deliveryHost':delivery_host,'certifiesProductionCapacity':False,'startedAtUnix':time.time(),
            'budget':budget,'retirement':retirement,'httpTransport':args.transport,
            'holdSeconds':hold,'reconnectAfterSeconds':reconnect,'workersPerNode':workers_per_node}
    report['candidatePreparation']=candidate_proof
    if inventory.get('mediaDiagnosticStage') or inventory.get('fullMediaRepeatStage'):
        report['priorStageAccounting']=inventory['priorStageAccounting']
    origin=None;observer=None;thread=None;mint_attempted=False;load_started=False
    events=queue.Queue()
    try:
        origin=subprocess.Popen(SSH+['root@'+encoder_host,
            'timeout --signal=TERM --kill-after=20s '+str(origin_duration+50)+'s /opt/qsession-encoder/probe-venv/bin/python /opt/qsession-encoder/ops/synthetic-hls-origin.py --duration '+str(origin_duration)+' --delivery-host '+delivery_host+' --control-stdin'],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        def consume():
            for line in origin.stdout:
                try: events.put(json.loads(line))
                except json.JSONDecodeError: events.put({'unparsedOriginOutput':True})
        thread=threading.Thread(target=consume,daemon=True);thread.start()
        item=events.get(timeout=50)
        if not item.get('originReady'):raise RuntimeError('Origin not ready')
        report['originReady']=item;print(json.dumps({'originReady':True}),flush=True)
        mint_attempted=True
        result=subprocess.run([sys.executable,str(SCRIPTS/'distribute-probe-leases.py'),
            '--inventory',str(inventory_path),'--delivery-host',delivery_host,
            '--admission-host',api_host,
            '--clients',str(args.clients),
            '--minimum-remaining-seconds',str(max(300,duration+150)),
            '--output',str(artifact('load-run-custom-domain')),
            '--mint-report',str(artifact('load-mint-custom-domain'))],capture_output=True,text=True,timeout=65)
        if result.returncode:
            failures=[]
            for line in result.stderr.splitlines():
                try:
                    item=json.loads(line)
                    if item.get('category') in {'timeout','connection-reset','connection-timeout','host-key-verification','host-key-changed','authentication','existing-file','unclassified'}:
                        failures.append({key:item[key] for key in ('transferFailure','category','exitCode') if key in item})
                except (json.JSONDecodeError,AttributeError):pass
            report['preparationFailures']=failures
            print(json.dumps({'preparationFailed':True,'transferFailures':failures}),flush=True)
            raise RuntimeError('Mint or transfer failed; output suppressed')
        report['mint']=json.loads(result.stdout);print(json.dumps(report['mint']),flush=True)
        run_inventory_path=artifact('load-run-custom-domain')
        run_inventory=json.loads(run_inventory_path.read_text(encoding='utf-8-sig'))
        run_inventory['httpTransport']=args.transport
        run_inventory['holdSeconds']=hold
        run_inventory['reconnectAfterSeconds']=reconnect
        for node in run_inventory['generators']:node['workersPerNode']=workers_per_node
        run_inventory_path.write_text(json.dumps(run_inventory,indent=2)+'\n',encoding='utf-8')
        observer=subprocess.Popen([sys.executable,str(SCRIPTS/'observe-distributed-probe.py'),
            '--api-host',api_host,
            '--output',str(artifact('load-redis-custom-domain')),'--duration',str(max(125,duration+35))],
            stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
        load_stem='hls-10000-custom-domain' if args.clients==10000 else 'hls-diagnostic-custom-domain'
        load_started=True
        result=subprocess.run([sys.executable,str(SCRIPTS/'orchestrate-hls-load.py'),
            '--inventory',str(artifact('load-run-custom-domain')),
            '--output',str(artifact(load_stem))],capture_output=True,text=True,timeout=duration+90)
        report['loadExitCode']=result.returncode
        if result.returncode not in (0,2):raise RuntimeError('Load controller failed')
        report['load']=json.loads(result.stdout);print(json.dumps(report['load']),flush=True)
        report['loadProcessesFinished']=load_processes_finished(
            json.loads(artifact(load_stem).read_text(encoding='utf-8-sig')),nodes)
        finish_observer(observer,report,request_stop=report['load'].get('httpDeliveryChecksPassed') is not True,timeout=30)
    except Exception as exc:
        report['errorClass']=type(exc).__name__
    finally:
        try:finish_observer(observer,report)
        except Exception as error:report['observerCleanupErrorClass']=type(error).__name__
        if mint_attempted:
            try:
                cleanup=subprocess.run([sys.executable,str(SCRIPTS/'cleanup-distributed-probe.py'),
                    '--api-host',api_host,
                    '--inventory',str(inventory_path),'--expected-clients',str(args.clients)],capture_output=True,text=True,timeout=65)
                report['leaseCleanupExitCode']=cleanup.returncode
                if cleanup.returncode==0:
                    report['leaseCleanup']=[json.loads(line) for line in cleanup.stdout.splitlines()]
            except Exception as error:
                report['leaseCleanupErrorClass']=type(error).__name__
        # Only completed process evidence permits an early stop of this exact
        # publisher. An uncertain controller leaves its independent watchdog intact.
        reason=None
        if report.get('loadProcessesFinished') is True:
            reason=('load-completed' if report.get('load',{}).get('httpDeliveryChecksPassed') is True
                and report.get('loadExitCode')==0 and report.get('leaseCleanupExitCode')==0 else 'load-failed')
        elif not load_started:reason='preparation-failed'
        if reason:request_origin_stop(origin,report,reason)
        try:finish_origin(origin,thread,events,report)
        except Exception as error:report['originCleanupErrorClass']=type(error).__name__
        report['endedAtUnix']=time.time()
        try:report['executionPassed']=execution_passed(report,nodes)
        except Exception as error:
            report['verificationErrorClass']=type(error).__name__;report['executionPassed']=False
        artifact('custom-domain-load-execution').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(artifact('custom-domain-load-execution')),
        'loadPassed':report.get('load',{}).get('httpDeliveryChecksPassed',False),
        'leaseCleanupExitCode':report.get('leaseCleanupExitCode'),'errorClass':report.get('errorClass'),
        'temporaryVmDestructionStillRequired':True}),flush=True)
    return 0 if report['executionPassed'] else 2


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,default=INVENTORY)
    parser.add_argument('--suffix',default='20261018')
    parser.add_argument('--transport',choices=('stdlib','aiohttp','http2'),default='stdlib')
    parser.add_argument('--clients',type=int,default=10000)
    parser.add_argument('--hold',type=int,default=60)
    parser.add_argument('--reconnect-after',type=int,default=0)
    parser.add_argument('--workers-per-node',type=int,choices=(4,8),default=4)
    parser.add_argument('--delivery-host', required=True,
                        help='Staging playback hostname. Production hosts are refused.')
    parser.add_argument('--encoder-host', required=True,
                        help='Staging encoder IPv4. The permanent production servers are refused.')
    parser.add_argument('--api-host', required=True,
                        help='Staging API IPv4 used to mint and observe leases.')
    raise SystemExit(main(parser.parse_args()))
