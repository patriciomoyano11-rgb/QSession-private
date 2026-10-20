"""Offline cooperative shutdown and artifact preservation after an early load exit."""
import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import queue
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

SCRIPTS=pathlib.Path(__file__).resolve().parents[1]/'scripts'


def load(name, filename):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/filename)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


runner=load('cleanup_load_runner','run-custom-domain-load.py')
observer=load('cleanup_probe_observer','observe-distributed-probe.py')
origin=load('cleanup_synthetic_origin','synthetic-hls-origin.py')
RUN='0123456789abcdef'


class RecordingInput:
    def __init__(self):self.value='';self.closed=False
    def write(self, value):self.value+=value
    def flush(self):pass
    def close(self):self.closed=True


class BlockingOutput:
    def __init__(self, first):self.events=queue.Queue();self.events.put(json.dumps(first)+'\n')
    def __iter__(self):return self
    def __next__(self):
        value=self.events.get(timeout=5)
        if value is None:raise StopIteration
        return value


class FakeOrigin:
    def __init__(self):
        self.stdin=RecordingInput();self.returncode=None
        self.stdout=BlockingOutput({'originReady':True,'runId':RUN,'plannedStopAtUnix':time.time()+774})
    def poll(self):return self.returncode
    def wait(self, timeout):
        if self.returncode is None:
            command=json.loads(self.stdin.value) if self.stdin.value else None
            reason=command['reason'] if command else None
            report={'runId':RUN,'cleanupComplete':True,'cancelled':command is not None}
            if reason:report['controlStopReason']=reason
            self.returncode=2 if reason in ('load-failed','preparation-failed') else 0
            self.stdout.events.put(json.dumps({'originReport':report})+'\n');self.stdout.events.put(None)
        return self.returncode


class FakeObserver:
    def __init__(self, stubborn=False):
        self.stdin=RecordingInput();self.returncode=None;self.stubborn=stubborn
    def poll(self):return self.returncode
    def wait(self, timeout):
        if self.returncode is None:
            if self.stubborn:raise subprocess.TimeoutExpired('offline observer',timeout)
            self.returncode=0
        return self.returncode
    def terminate(self):raise OSError('offline termination failure')
    def kill(self):self.returncode=-9


class CooperativeObserverTests(unittest.TestCase):
    def test_actual_node_observer_stops_cooperatively_and_closes_admissions(self):
        source=observer.code.replace('OBSERVATION_SAMPLES','137').replace('OBSERVATION_WATCHDOG_MS','695000')
        fixture=r'''
const vm=require('node:vm'),{PassThrough}=require('node:stream');
const input=new PassThrough(),records=[];let closed=0;
const imports={
 'node:fs':{readFileSync(){return JSON.stringify({code:'PRB10A',prefix:'live/PRB10A-hWrdBkirH_2yHmZ9lp'});}},
 redis:{createClient(){return {on(){},async connect(){}};}},
 './broadcast-admissions':{createBroadcastAdmissions(){return {async count(){queueMicrotask(()=>input.write('stop\n'));return 10000;},async close(){closed++;}};}},
 'node:readline':require('node:readline')};
(async()=>{await vm.runInNewContext(SOURCE,{require:name=>{if(!(name in imports))throw Error('Forbidden fixture import');return imports[name];},
 process:{env:{},stdin:input,exit(){throw Error('Unexpected watchdog');}},
 setTimeout,clearTimeout,console:{log:line=>records.push(JSON.parse(line)),error(){throw Error('Unexpected observer error');}}});
 console.log(JSON.stringify({records,closed}));})().catch(error=>{console.error(error.stack);process.exitCode=1;});
'''.replace('SOURCE',json.dumps(source))
        result=subprocess.run(['node','-e',fixture],capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        report=json.loads(result.stdout)
        self.assertEqual(report['closed'],1);self.assertEqual(report['records'][0]['active'],10000)
        self.assertEqual(report['records'][-1],{'observationComplete':True,'stoppedEarly':True,'samples':1})

    def test_stop_is_forwarded_and_collected_samples_are_preserved(self):
        sample={'observedAtUnix':1000,'active':10000,'namespace':'PRB10A'}
        child=FakeObserver();child.stdout=io.StringIO(json.dumps(sample)+'\n'+json.dumps({
            'observationComplete':True,'stoppedEarly':True,'samples':1})+'\n')
        with tempfile.TemporaryDirectory() as folder:
            output=pathlib.Path(folder)/'observations.json'
            with mock.patch.object(observer.subprocess,'Popen',return_value=child),contextlib.redirect_stdout(io.StringIO()):
                status=observer.run_observation(['offline-only'],output,685,io.StringIO('stop\n'))
            report=json.loads(output.read_text())
        self.assertEqual(status,0);self.assertEqual(child.stdin.value,'stop\n')
        self.assertTrue(report['cooperativeStopRequested']);self.assertTrue(report['stoppedEarly'])
        self.assertEqual(report['observations'],[sample]);self.assertEqual(report['plannedDurationSeconds'],685)

    def test_bad_output_and_process_cleanup_failure_still_preserve_prior_samples(self):
        sample={'observedAtUnix':1000,'active':9000,'namespace':'PRB10A'}
        child=FakeObserver(stubborn=True);child.stdout=io.StringIO(json.dumps(sample)+'\nnot-json\n')
        with tempfile.TemporaryDirectory() as folder:
            output=pathlib.Path(folder)/'observations.json'
            with mock.patch.object(observer.subprocess,'Popen',return_value=child),contextlib.redirect_stdout(io.StringIO()):
                status=observer.run_observation(['offline-only'],output,685,io.StringIO(''))
            report=json.loads(output.read_text())
        self.assertEqual(status,2);self.assertEqual(report['observations'],[sample])
        self.assertEqual(report['errorClass'],'JSONDecodeError');self.assertEqual(child.returncode,-9)

    def test_eof_is_not_a_stop_request(self):
        child=FakeObserver();child.stdout=io.StringIO(json.dumps({'observationComplete':True,'stoppedEarly':False})+'\n')
        with tempfile.TemporaryDirectory() as folder:
            output=pathlib.Path(folder)/'observations.json'
            with mock.patch.object(observer.subprocess,'Popen',return_value=child):
                self.assertEqual(observer.run_observation(['offline-only'],output,685,io.StringIO('')),0)
            self.assertFalse(json.loads(output.read_text())['cooperativeStopRequested'])
        self.assertEqual(child.stdin.value,'')


class OriginControlTests(unittest.TestCase):
    def test_eof_malformed_foreign_or_unsupported_commands_never_stop_origin(self):
        commands=['not-json',json.dumps([]),json.dumps({'command':'stop','runId':'other','reason':'load-completed'}),
            json.dumps({'command':'stop','runId':RUN,'reason':'unexpected'}),
            json.dumps({'command':'stop','runId':RUN,'reason':'load-completed','extra':True}),
            json.dumps({'command':'stop','runId':RUN,'reason':'load-completed','padding':'x'*1024})]
        stop=mock.Mock();origin.read_control_stop(io.StringIO('\n'.join(commands)+'\n'),RUN,stop)
        origin.read_control_stop(io.StringIO(''),RUN,stop);stop.assert_not_called()

    def test_only_one_explicit_exact_run_command_is_accepted(self):
        stop=mock.Mock();command={'command':'stop','runId':RUN,'reason':'load-failed'}
        origin.read_control_stop(io.StringIO(json.dumps(command)+'\n'+json.dumps(command)+'\n'),RUN,stop)
        stop.assert_called_once_with('load-failed')

    def run_origin(self, reason=None, control=True):
        class ClientError(Exception):pass
        class Storage:
            def __init__(self):self.items={};self.deleted=[]
            def put_object(self, **kwargs):self.items[kwargs['Key']]=kwargs['Body']
            def get_object(self, **kwargs):return {'Body':io.BytesIO(self.items.get(kwargs['Key'],b''))}
            def delete_object(self, **kwargs):self.deleted.append(kwargs['Key']);self.items.pop(kwargs['Key'],None)
            def delete_objects(self, **kwargs):
                for item in kwargs['Delete']['Objects']:self.delete_object(Key=item['Key'])
                return {}
        storage=Storage();counter=iter(range(10000))
        class ImmediateThread:
            def __init__(self, target, args, daemon):self.target=target;self.args=args
            def start(self):self.target(*self.args)
        def render(command, **kwargs):
            pathlib.Path(command[-1]).write_bytes(b'G'*188)
            return subprocess.CompletedProcess(command,0,b'',b'')
        modules={'boto3':types.SimpleNamespace(client=lambda *args,**kwargs:storage),
            'botocore':types.ModuleType('botocore'),
            'botocore.config':types.SimpleNamespace(Config=lambda **kwargs:None),
            'botocore.exceptions':types.SimpleNamespace(ClientError=ClientError)}
        command='' if reason is None else json.dumps({'command':'stop','runId':RUN,'reason':reason})+'\n'
        args=types.SimpleNamespace(delivery_host='live.qsession.org',duration=12,control_stdin=control)
        with mock.patch.dict(sys.modules,modules),mock.patch.object(origin,'read_credentials',return_value={
                'accessKey':'offline','secretKey':'offline'}),mock.patch.object(origin.secrets,'token_hex',return_value=RUN), \
                mock.patch.object(origin.subprocess,'run',side_effect=render), \
                mock.patch.object(origin,'inspect_segment',return_value={'bytes':188}), \
                mock.patch.object(origin,'signal',types.SimpleNamespace(SIGINT=2,SIGTERM=15,SIGALRM=14,
                    ITIMER_REAL=0,signal=mock.Mock(),setitimer=mock.Mock())), \
                mock.patch.object(origin.time,'sleep'),mock.patch.object(origin.time,'monotonic',side_effect=lambda:next(counter)), \
                mock.patch.object(origin.threading,'Thread',ImmediateThread),mock.patch.object(origin.sys,'stdin',io.StringIO(command)), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            status=origin.main(args)
        report=json.loads(output.getvalue().splitlines()[-1])['originReport']
        self.assertTrue(report['cleanupComplete']);self.assertEqual(storage.items,{})
        return status,report

    def test_completed_load_has_explicit_normal_stop_and_cleans_owned_objects(self):
        status,report=self.run_origin('load-completed')
        self.assertEqual(status,0);self.assertTrue(report['cancelled'])
        self.assertEqual(report['controlStopReason'],'load-completed')

    def test_failed_load_stops_and_cleans_without_becoming_success(self):
        status,report=self.run_origin('load-failed')
        self.assertEqual(status,2);self.assertTrue(report['cancelled'])
        self.assertEqual(report['controlStopReason'],'load-failed')

    def test_legacy_pilot_without_opt_in_ignores_stdin(self):
        status,report=self.run_origin('load-failed',control=False)
        self.assertEqual(status,0);self.assertFalse(report['cancelled'])
        self.assertNotIn('controlStopReason',report)


class RunnerCleanupTests(unittest.TestCase):
    def test_broken_origin_process_inspection_cannot_abort_final_cleanup(self):
        publisher=mock.Mock();publisher.poll.side_effect=OSError('offline process inspection failure')
        report={'originReady':{'runId':RUN}}
        runner.request_origin_stop(publisher,report,'load-failed')
        self.assertEqual(report['originControlErrorClass'],'OSError')
        publisher.stdin.write.assert_not_called()

    def completed_artifact(self, passed=True):
        summary={'runId':'qsession-probe-offline','startAtUnix':1000,'requestedGenerators':7,'expectedWorkers':56}
        reports=[{'nodeReport':{'runId':summary['runId'],'startAtUnix':1000,'workersPerNode':8,
            'leaseSubsetFilesRemoved':True,'workers':[{'index':index,'exitCode':0 if passed else 2}
                for index in range(8)]}} for _ in range(7)]
        return {'summary':summary,'nodeResults':reports}

    def execute_runner(self, passed, stubborn=False, incomplete=False):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);release=root/'release';scripts=root/'platform/scripts'
            release.mkdir();scripts.mkdir(parents=True)
            digest='a'*64
            (scripts/'hls_candidate_readiness.py').write_text('def require_published_candidate(root):\n return '+repr({
                'sourceSha256':digest,'readyForPaidLoadPreparation':True})+'\n')
            nodes=[{'label':f'qsession-load-offline-{index}','ownedForThisTest':True,'destroyed':False,
                'sshReady':True,'logicalCpuCount':8} for index in range(7)]
            inventory={'generators':nodes,'candidateSourceSha256':digest,'scope':{'maximumInstances':7},
                'newBudget':{'additionalComputeLimitUsd':2.10,'previousObservedComputeUsd':0},
                'fullMediaRepeatStage':{'maximumExecutions':1,'clients':10000,'holdSeconds':620,
                    'reconnectAfterSeconds':240,'workerSourceSha256':digest,'workersPerNode':8,'executions':[]},
                'priorStageAccounting':{}}
            inventory_path=release/'inventory.json';inventory_path.write_text(json.dumps(inventory))
            args=types.SimpleNamespace(inventory=inventory_path,suffix='media-full-cleanup-offline',
                clients=10000,hold=620,reconnect_after=240,workers_per_node=8,transport='aiohttp')
            publisher=FakeOrigin();watcher=FakeObserver(stubborn);calls=[]
            def popen(command, **kwargs):
                self.assertIs(kwargs['stdin'],subprocess.PIPE)
                if command[0]=='ssh':
                    self.assertIn('--control-stdin',command[-1]);return publisher
                return watcher
            def run(command, **kwargs):
                name=pathlib.Path(command[1]).name;calls.append(name)
                if name=='distribute-probe-leases.py':
                    pathlib.Path(command[command.index('--output')+1]).write_text(json.dumps(inventory))
                    return subprocess.CompletedProcess(command,0,'{}','')
                if name=='orchestrate-hls-load.py':
                    artifact=self.completed_artifact(passed)
                    if incomplete:artifact['nodeResults'][0]['nodeReport']['workers'][0]['exitCode']=None
                    pathlib.Path(command[command.index('--output')+1]).write_text(json.dumps(artifact))
                    return subprocess.CompletedProcess(command,0 if passed else 2,json.dumps({
                        'requestedClients':10000,'httpDeliveryChecksPassed':passed}),'')
                if name=='cleanup-distributed-probe.py':
                    rows=[{'namespace':'PRB10A','activeAfter':0,'privateMasterFileRemoved':True}]
                    rows.extend({'label':node['label'],'privateLeaseFileRemoved':True} for node in nodes)
                    return subprocess.CompletedProcess(command,0,'\n'.join(map(json.dumps,rows)),'')
                raise AssertionError('Unexpected external command')
            with mock.patch.object(runner,'ROOT',root),mock.patch.object(runner,'RELEASE',release), \
                    mock.patch.object(runner,'SCRIPTS',scripts),mock.patch.object(runner,'validate_budget',return_value={}), \
                    mock.patch.object(runner,'retirement_preflight',return_value={}), \
                    mock.patch.object(runner.subprocess,'Popen',side_effect=popen), \
                    mock.patch.object(runner.subprocess,'run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):
                status=runner.main(args)
            report=json.loads((release/'custom-domain-load-execution-media-full-cleanup-offline.json').read_text())
            reservations=json.loads(inventory_path.read_text())['fullMediaRepeatStage']['executions']
        return status,report,publisher,watcher,calls,reservations

    def test_early_failed_load_stops_exact_origin_and_observer_and_keeps_failure(self):
        status,report,publisher,watcher,calls,reservations=self.execute_runner(False)
        self.assertEqual(status,2);self.assertFalse(report['executionPassed'])
        self.assertNotIn('errorClass',report);self.assertEqual(watcher.stdin.value,'stop\n')
        self.assertEqual(json.loads(publisher.stdin.value),{'command':'stop','runId':RUN,'reason':'load-failed'})
        self.assertTrue(report['origin']['cleanupComplete']);self.assertEqual(report['leaseCleanupExitCode'],0)
        self.assertIn('cleanup-distributed-probe.py',calls);self.assertEqual(len(reservations),1)

    def test_broken_observer_cannot_skip_lease_origin_or_json_cleanup(self):
        status,report,publisher,watcher,calls,reservations=self.execute_runner(False,stubborn=True)
        self.assertEqual(status,2);self.assertEqual(report['observerCleanupErrorClass'],'TimeoutExpired')
        self.assertEqual(watcher.returncode,-9);self.assertTrue(report['origin']['cleanupComplete'])
        self.assertEqual(report['leaseCleanupExitCode'],0);self.assertFalse(report['executionPassed'])
        self.assertEqual(json.loads(publisher.stdin.value)['runId'],RUN);self.assertEqual(len(reservations),1)

    def test_passed_load_can_close_origin_normally_only_after_process_and_lease_cleanup(self):
        status,report,publisher,watcher,calls,reservations=self.execute_runner(True)
        self.assertEqual(status,0);self.assertTrue(report['executionPassed'])
        self.assertTrue(report['loadProcessesFinished']);self.assertEqual(report['originStopReason'],'load-completed')
        self.assertTrue(report['origin']['cancelled']);self.assertEqual(report['originExitCode'],0)
        self.assertEqual(watcher.stdin.value,'');self.assertEqual(len(reservations),1)

    def test_uncertain_worker_lifetime_never_shortens_origin_tail(self):
        status,report,publisher,*_=self.execute_runner(False,incomplete=True)
        self.assertEqual(status,2);self.assertFalse(report['loadProcessesFinished'])
        self.assertEqual(publisher.stdin.value,'');self.assertNotIn('originStopRequested',report)

    def test_cancelled_origin_without_matching_completed_load_cannot_pass(self):
        status,report,*_=self.execute_runner(True)
        nodes=[{'label':row['label']} for row in report['leaseCleanup'] if 'label' in row]
        for change in ({'loadProcessesFinished':False},{'originStopReason':'load-failed'},
                {'originStopRequested':False},{'originCleanupErrorClass':'OSError'}):
            self.assertFalse(runner.execution_passed({**report,**change},nodes))
        changed=copy.deepcopy(report);changed['origin']['controlStopReason']='load-failed'
        self.assertFalse(runner.execution_passed(changed,nodes))


if __name__=='__main__':unittest.main()
