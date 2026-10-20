import copy
import importlib.util
import pathlib
import unittest
import uuid
from unittest import mock

source=pathlib.Path(__file__).resolve().parents[1]/'scripts/orchestrate-hls-load.py'
spec=importlib.util.spec_from_file_location('orchestrator',source)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeliveryAggregation(unittest.TestCase):
    def fixture(self):
        inventory={'runId':'bounded-test-10000','startAtUnix':1000,'generators':[]}
        results=[]
        for n in range(7):
            clients=1429 if n<6 else 1426
            node={'id':str(n),'label':'qsession-load-test-'+str(n),'ip':'8.8.8.'+str(n+1),'clients':clients}
            inventory['generators'].append(node)
            workers=[]
            for index in range(4):
                count=clients//4+(index<clients%4)
                samples=[{'observedAtUnix':1000+t,'elapsed':t,'recentMediaClients':count,'activeClients':count,
                          'processCpuPercent':20,'systemCpuPercent':20} for t in range(38,90,2)]
                workers.append({'index':index,'exitCode':0,'report':{'requestedClients':count,
                    'distinctLeaseTokensPresented':count,'deliveryCheckPassed':True,'samples':samples}})
            results.append({'nodeReport':{'runId':inventory['runId'],'startAtUnix':1000,'workers':workers}})
        return inventory,results

    def test_seven_unequal_nodes_reach_exactly_10000(self):
        inventory,results=self.fixture()
        report=module.aggregate(inventory,results)
        self.assertEqual(report['requestedClients'],10000)
        self.assertEqual(report['steadyConcurrentRecentMediaMinimum'],10000)
        self.assertTrue(report['httpDeliveryChecksPassed'])

    def test_one_missing_client_is_not_full_delivery(self):
        inventory,results=self.fixture()
        results[0]['nodeReport']['workers'][0]['report']['samples'][3]['recentMediaClients']-=1
        self.assertFalse(module.aggregate(inventory,results)['httpDeliveryChecksPassed'])

    def test_threaded_cpu_uses_verified_core_allocation(self):
        inventory,results=self.fixture()
        for node in inventory['generators']:node['logicalCpuCount']=8
        for sample in results[0]['nodeReport']['workers'][0]['report']['samples']:
            sample['processCpuPercent']=120
        self.assertTrue(module.aggregate(inventory,results)['httpDeliveryChecksPassed'])
        inventory['generators'][0]['logicalCpuCount']=4
        self.assertFalse(module.aggregate(inventory,results)['httpDeliveryChecksPassed'])

    def test_whole_system_cpu_guard_is_preserved_on_larger_vm(self):
        inventory,results=self.fixture()
        for node in inventory['generators']:node['logicalCpuCount']=8
        for sample in results[0]['nodeReport']['workers'][0]['report']['samples']:
            sample['systemCpuPercent']=92
        self.assertFalse(module.aggregate(inventory,results)['httpDeliveryChecksPassed'])

    def test_generator_own_saturation_stop_stays_inconclusive_with_sparse_samples(self):
        inventory,results=self.fixture()
        worker=results[0]['nodeReport']['workers'][0]
        worker['exitCode']=2
        worker['report']['stopReason']='generator_saturation_inconclusive'
        report=module.aggregate(inventory,results)
        self.assertTrue(report['nodes'][0]['generatorHeadroomInconclusive'])
        self.assertEqual(report['nodes'][0]['generatorSaturationStopWorkers'],[0])
        self.assertFalse(report['httpDeliveryChecksPassed'])

    def test_unaligned_node_peaks_do_not_add_to_10000(self):
        inventory,results=self.fixture()
        for sample in results[0]['nodeReport']['workers'][0]['report']['samples']:
            sample['observedAtUnix']+=4
        self.assertFalse(module.aggregate(inventory,results)['httpDeliveryChecksPassed'])

    def validated_fixture(self):
        inventory,_=self.fixture()
        for n,node in enumerate(inventory['generators']):
            node.update(id=str(uuid.UUID(int=n+1)),ownedForThisTest=True)
        return inventory

    def test_custom_domain_is_retained_in_validated_inventory(self):
        inventory=self.validated_fixture()
        inventory['deliveryHost']='live.qsession.org'
        self.assertEqual(module.validate_inventory(inventory,now=990)['deliveryHost'],'live.qsession.org')

    def test_arbitrary_delivery_hosts_are_rejected(self):
        inventory=self.validated_fixture()
        inventory['deliveryHost']='live.qsession.org.untrusted.test'
        with self.assertRaises(ValueError):module.validate_inventory(inventory,now=990)

    def test_only_explicit_supported_transport_reaches_remote_runner(self):
        inventory=self.validated_fixture()
        self.assertEqual(module.validate_inventory(inventory,now=990)['httpTransport'],'stdlib')
        inventory['httpTransport']='aiohttp'
        self.assertEqual(module.validate_inventory(inventory,now=990)['httpTransport'],'aiohttp')
        inventory['httpTransport']='http2'
        self.assertEqual(module.validate_inventory(inventory,now=990)['httpTransport'],'http2')
        inventory['httpTransport']='aiohttp --insecure'
        with self.assertRaises(ValueError):module.validate_inventory(inventory,now=990)

    def test_retired_generator_is_rejected_before_ssh(self):
        inventory=self.validated_fixture()
        inventory['generators'][0]['destroyed']=True
        with self.assertRaises(ValueError):module.validate_inventory(inventory,now=990)

    def test_preparation_cannot_upload_to_a_retired_generator(self):
        source=pathlib.Path(__file__).resolve().parents[1]/'scripts/prepare-load-generators.py'
        spec=importlib.util.spec_from_file_location('prepare_load',source)
        prepare_module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(prepare_module)
        node={'ownedForThisTest':True,'destroyed':True,'label':'qsession-load-20261018-retired','ip':'8.8.8.1'}
        with mock.patch.object(prepare_module.subprocess,'run') as ssh:
            with self.assertRaises(ValueError):prepare_module.prepare(node)
            ssh.assert_not_called()


class CumulativeBudget(unittest.TestCase):
    def setUp(self):
        path=source.parent/'run-custom-domain-load.py'
        spec=importlib.util.spec_from_file_location('load_budget',path)
        self.runner=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runner)
        self.inventory={'budgetLimitUsd':5,'previousObservedTestCostUsd':3.5,
            'generators':[{'hourlyUsd':0.132,'createdObservedUtc':'2026-10-19T02:00:00Z'} for _ in range(7)]}
        self.now=1792375500

    def test_remaining_authorization_accounts_for_minimum_hourly_charge(self):
        result=self.runner.validate_budget(self.inventory,self.now)
        self.assertEqual(result['projectedObservedTotalUsd'],4.55)

    def test_new_authorization_subtracts_already_observed_runs_before_reserving_again(self):
        current={**self.inventory,'newBudget':{'status':'approved',
            'authorizationReference':'call_905dce8a6a194df1a7f2571513fcaed9',
            'additionalComputeLimitUsd':3,'previousObservedComputeUsd':1.05}}
        # Seven fresh nodes reserve 2.10; together with 1.05 this exceeds 3.
        with self.assertRaises(ValueError):self.runner.validate_budget(current,self.now)
        current['generators']=[{**self.inventory['generators'][0],
            'createdObservedUtc':__import__('datetime').datetime.fromtimestamp(self.now,__import__('datetime').timezone.utc).isoformat()}]
        result=self.runner.validate_budget(current,self.now)
        self.assertEqual(result['projectedObservedTotalUsd'],1.35)

    def test_previous_cost_is_cumulative_and_cannot_be_omitted(self):
        for previous in (4,5,None,-1,float('nan')):
            with self.subTest(previous=previous), self.assertRaises((ValueError,ArithmeticError)):
                self.runner.validate_budget({**self.inventory,'previousObservedTestCostUsd':previous},self.now)

    def test_old_generators_cannot_silently_cross_another_hour(self):
        with self.assertRaises(ValueError):self.runner.validate_budget(self.inventory,self.now+3600)

    def test_explicit_second_hour_reserves_the_whole_batch_within_six_dollars(self):
        extended={**self.inventory,'budgetLimitUsd':6,'maximumBilledHoursPerGenerator':2,
                  'budgetAuthorizationReference':'call_7a6df35e769a41afaaca8f49a07ded5c'}
        self.assertEqual(self.runner.validate_budget(extended,self.now+3600)['projectedObservedTotalUsd'],5.6)
        with self.assertRaises(ValueError):self.runner.validate_budget(extended,self.now+7200)
        with self.assertRaises(ValueError):self.runner.validate_budget({**extended,'budgetLimitUsd':7},self.now)
        with self.assertRaises(ValueError):self.runner.validate_budget({**extended,'maximumBilledHoursPerGenerator':3},self.now)
        with self.assertRaises(ValueError):self.runner.validate_budget({**extended,'budgetAuthorizationReference':''},self.now)


if __name__=='__main__':unittest.main()
