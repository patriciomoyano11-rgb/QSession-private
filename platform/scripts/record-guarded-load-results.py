"""Reconcile public evidence without changing readiness or capacity."""
import datetime
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]
RELEASE=ROOT/'release'
def read(name):return json.loads((RELEASE/name).read_text(encoding='utf-8-sig'))

ledger=read('load-generators-guarded-20261020.json')
retirement=read('guarded-retirement-verified-20261020.json')
access=read('guarded-vultr-access-closed-20261020.json')
wrangler=read('guarded-wrangler-session-closed-20261020.json')
publication=read('shared-edge-cache-publication-20261020.json')
pilot=read('shared-edge-post-publication-pilot-20261020.json')
runtime=read('guarded-production-status-20261020.json')
cost=read('guarded-load-observed-cost-20261020.json')
if ledger['activeCount'] or any(n.get('destroyed') is not True for n in ledger['generators']):raise ValueError('VM remains')
if not retirement['independentTimerDeletedAllSeven'] or not access['organizationApiDisabled'] or not wrangler['officialLogoutConfirmed']:raise ValueError('Cleanup incomplete')
trials=[]
for suffix in ('guarded-cache-20261020','guarded-cache-aiohttp-20261020','shared-edge-aiohttp-20261020'):
    load=read('hls-10000-custom-domain-'+suffix+'.json')
    execution=read('custom-domain-load-execution-'+suffix+'.json')
    summary=load['summary'];counts=summary['counts']
    clean=execution['leaseCleanup']
    if execution['leaseCleanupExitCode']!=0 or clean[0]['activeAfter']!=0 or not execution['origin']['cleanupComplete']:raise ValueError('Probe cleanup incomplete')
    trials.append({'report':'hls-10000-custom-domain-'+suffix+'.json',
        'workerVersion':publication['workerVersion'] if suffix.startswith('shared-edge-') else '0e1263e2950144d1a89de9be800f92ca',
        'transport':execution['httpTransport'],'requestedClients':summary['requestedClients'],
        'peakConcurrentRecentMediaClients':summary['peakConcurrentRecentMediaClients'],
        'longestCommonFullMediaSpanSeconds':summary['longestCommonFullMediaSpanSeconds'],
        'httpDeliveryChecksPassed':summary['httpDeliveryChecksPassed'],
        'completeWorkerReports':sum('report' in w for n in load['nodeResults'] for w in n.get('nodeReport',{}).get('workers',[])),
        'segmentRequestsOver6Seconds':counts.get('segmentDownloadOver6Seconds',0),
        'stalledClientsInCompleteReports':counts.get('stalledClients',0),
        'generatorHeadroomInconclusive':any(n['generatorHeadroomInconclusive'] for n in summary['nodes']),
        'allProbeLeasesReleased':True,'syntheticStorageCleaned':True})
if not pilot['passed'] or not pilot['pilot']['originCleanupComplete'] or pilot['leaseCleanup']['activeAfterRelease']!=0:raise ValueError('Pilot cleanup incomplete')
pilot['testedWorkerVersion']=publication['workerVersion'];pilot['sharedEdgeOptimizationTested']=True
(RELEASE/'shared-edge-post-publication-pilot-20261020.json').write_text(json.dumps(pilot,indent=2)+'\n',encoding='utf8')
old=read('shared-edge-protected-pilot-20261020.json')
old.update(testedWorkerVersion='0e1263e2950144d1a89de9be800f92ca',sharedEdgeOptimizationTested=False,
           interpretation='Completed before the shared-edge correction was published; not evidence of that correction.')
(RELEASE/'shared-edge-protected-pilot-20261020.json').write_text(json.dumps(old,indent=2)+'\n',encoding='utf8')
report={'schemaVersion':1,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'localDate':'2026-10-19','roomCode':'DKTLF3','capacityCertified':False,'mode10000Active':False,'mode500000Active':False,
    'runtime':runtime['measurements'],'currentCanaryWorker':publication,'trials':trials,
    'currentProtectedPilot':{'passed':True,'simultaneousNativeRanges':16,'correctRanges':pilot['pilot']['coldNativeBurst']['correctRanges'],
        'cacheFill':pilot['pilot']['coldNativeBurst']['fill'],'unauthorizedWarmRangeStatus':pilot['pilot']['unauthorizedWarmRangeStatus'],
        'renewedMilliseconds':pilot['leaseCleanup']['renewedMilliseconds'],'activeAfterRelease':0,
        'decodedPlaybackTested':False,'report':'shared-edge-post-publication-pilot-20261020.json'},
    'resourceCleanup':retirement,'temporaryAccessCleanup':access,'cloudflareSessionCleanup':wrangler,
    'cost':{'newComputeBudgetUsd':3,'newObservedComputeUsd':round(cost['observedNewBatchUsd'],2),
        'historicalObservedComputeUsd':16.52,'cumulativeObservedComputeUsd':round(16.52+cost['observedNewBatchUsd'],2),
        'historicalOverrunUsdStillUnchanged':10.52,'finalInvoiceConfirmed':False,'cloudflareUsageAndTaxesExcluded':True},
    'diagnosticLimits':['No generator link-throughput guarantee was verified',
        'Post-test TCP counters had no before-test baseline; they do not establish root cause',
        'HTTP 200 alone did not guarantee a completed body',
        'New before/after network and failure-stage instrumentation is local only, not a completed new load test'],
    'pending':['Resolve sustained delivery failures before another capacity certification attempt',
        'Validate reconnects and physical Windows/web/Android continuity on the protected massive path',
        'Implement and validate automatic encoder recovery and periodic playback alerts with confirmed delivery',
        'Refresh the selected event grant if expired and activate only after truthful readiness review']}
(RELEASE/'broadcast-10000-closeout-20261020.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
approval=read('load-retirement-authorization-20261019.json')
approval['budget'].update(resourcesCreated=7,resourcesRemaining=0,observedComputeUsd=report['cost']['newObservedComputeUsd'])
approval['retirementAccess'].update(organizationApiCurrentlyDisabled=True,
    organizationEnableExplicitConfirmationPending=False,organizationEnableAuthorizationReference='call_73df9e82d69f4cd4bec451b7c2ca6c72',
    credentialCreated=True,credentialRevoked=True,guardInstalled=True,guardTimerDisabledAfterVerifiedRetirement=True)
(RELEASE/'load-retirement-authorization-20261019.json').write_text(json.dumps(approval,indent=2)+'\n',encoding='utf8')
print(json.dumps({'recorded':True,'capacityCertified':False,'trials':len(trials),'temporaryResources':0,
                  'newObservedComputeUsd':report['cost']['newObservedComputeUsd'],'providerApiDisabled':True}))
