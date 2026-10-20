"""Read only bounded progress counters from an active, inventoried load run.

No token files, HTTP requests, process changes or cloud provisioning. Samples
are progress observations only; the final aligned report decides the outcome.
"""
import argparse
import concurrent.futures
import datetime
import json
import pathlib
import re
import subprocess

ROOT=pathlib.Path(__file__).resolve().parents[2]
REMOTE=r'''
import json,os,pathlib,sys
run,expected,count=sys.argv[1:]
count=int(count)
if count not in (4,8):raise SystemExit('Invalid worker count')
if os.uname().nodename!=expected:raise SystemExit('Host identity mismatch')
folder=pathlib.Path('/root/qsession-load')/run
if folder.is_symlink() or not folder.is_dir():raise SystemExit('Run folder missing')
samples=[];finished=[]
for index in range(count):
 path=folder/('worker-'+str(index)+'.progress.jsonl')
 if path.is_symlink():raise SystemExit('Unsafe progress path')
 if not path.is_file():continue
 with path.open('rb') as f:
  f.seek(max(0,path.stat().st_size-65536));lines=f.read(65536).splitlines()
 latest=None
 for line in lines:
  try:item=json.loads(line).get('progress')
  except (ValueError,AttributeError):continue
  if isinstance(item,dict):latest={k:item.get(k) for k in ('elapsed','observedAtUnix','activeClients',
      'recentMediaClients','segmentOk','requestErrors','processCpuPercent','systemCpuPercent','eventLoopLagSeconds')}
 if latest:samples.append(dict(worker=index,**latest))
 report_path=folder/('worker-'+str(index)+'.json')
 if not report_path.is_symlink() and report_path.is_file() and 0<report_path.stat().st_size<=2000000:
  try:report=json.loads(report_path.read_bytes())
  except ValueError:continue
  finished.append({'worker':index,**{k:report.get(k) for k in ('stopReason','deliveryCheckPassed',
      'errors','firstHttpFailures','firstTransportFailures')}})
print(json.dumps({'samples':samples,'finishedWorkers':finished}))
'''


def workers_for(node):
    count=node.get('workersPerNode',4)
    if type(count) is not int or count not in (4,8):raise ValueError('Invalid inventoried worker count')
    return count


def summarize(results,expected_workers):
    samples=[s for n in results for s in n.get('samples',[])]
    complete=(len(samples)==expected_workers and not any(n.get('readFailed') for n in results))
    spread=max((s['observedAtUnix'] for s in samples),default=0)-min((s['observedAtUnix'] for s in samples),default=0)
    return {'expectedWorkers':expected_workers,'completeWorkerSamples':complete,'sampleSpreadSeconds':round(spread,3),
        'minimumElapsedSeconds':min((s['elapsed'] for s in samples),default=None),
        'maximumElapsedSeconds':max((s['elapsed'] for s in samples),default=None),
        'requestErrorsObserved':sum(s['requestErrors'] for s in samples),
        'finishedWorkers':sum(len(n.get('finishedWorkers',[])) for n in results),
        'recentMediaCount':sum(s['recentMediaClients'] for s in samples) if complete and spread<=1 else None}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=pathlib.Path,required=True)
    parser.add_argument('--run-inventory',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    ledger=json.loads(args.inventory.read_text());run=json.loads(args.run_inventory.read_text())
    if (ledger.get('activeCount')!=7 or any(n.get('destroyed') or not n.get('ownedForThisTest') for n in ledger['generators'])
            or run.get('scope',{}).get('runId')!=ledger.get('runId')
            or not re.fullmatch(r'qsession-probe-10000-\d{10,12}',run.get('runId',''))):
        raise SystemExit('Require matching live seven-generator inventories')
    configured={n['id']:n for n in run['generators']}
    if len(configured)!=7 or set(configured)!={n['id'] for n in ledger['generators']}:
        raise ValueError('Progress requires the exact seven inventoried generators')
    expected_workers=sum(workers_for(n) for n in configured.values())
    def read(node):
        if not re.fullmatch(r'qsession-load-\d{8}-[a-z0-9-]{3,32}-chi[1-7]',node['label']):raise ValueError('Invalid host')
        if node['ip'] in {'45.77.118.43','104.238.137.144','45.77.192.82'}:raise ValueError('Protected host')
        cmd=['ssh','-T','-i','C:/Users/maria/.ssh/qsession_deploy_ed25519','-o','BatchMode=yes',
            '-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12',
            'root@'+node['ip'],'python3 - '+run['runId']+' '+node['label']+' '+str(workers_for(configured[node['id']]))]
        result=subprocess.run(cmd,input=REMOTE.encode(),capture_output=True,timeout=20)
        if result.returncode:return {'label':node['label'],'readFailed':True}
        return {'label':node['label'],**json.loads(result.stdout)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:results=list(pool.map(read,ledger['generators']))
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runId':run['runId'],
        'nodes':results,**summarize(results,expected_workers),
        'finalReportStillRequired':True,'capacityCertified':False}
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='nodes'}))


if __name__=='__main__':main()
