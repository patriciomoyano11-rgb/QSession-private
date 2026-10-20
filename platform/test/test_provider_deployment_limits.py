import contextlib,io,importlib.util,pathlib,types,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('provision',ROOT/'platform/scripts/provision-guarded-load.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class ProviderDeploymentLimits(unittest.TestCase):
    def run_projection(self,ceiling,count=7,maximum=30):
        from decimal import Decimal
        plans=[{'id':'dedicated','monthly_cost':160},{'id':'permanent','monthly_cost':16}]
        current=[{'plan':'permanent'} for _ in range(3)]
        source=m.REMOTE.split("phase='provider_deployment_limits'",1)[1].split("phase='os_metadata'",1)[0]
        source=source.replace('EXPECTED_PROVIDER_LIMITS',repr({'maximumInstances':maximum,'maximumMonthlyInstanceCostUsd':ceiling})).replace('CREATE_COUNT',str(count))
        ns={'guard':types.SimpleNamespace(Vultr=lambda key:types.SimpleNamespace(instances=lambda:current)),
            'key':None,'plans':plans,'plan':plans[0],'Decimal':Decimal,'json':__import__('json')}
        with contextlib.redirect_stdout(io.StringIO()):exec(source,ns)
        return ns['projected']
    def test_current_1000_ceiling_rejects_before_any_creation(self):
        with self.assertRaises(SystemExit):self.run_projection(1000)
    def test_verified_1200_ceiling_fits_nominal_test_plans(self):
        self.assertEqual(self.run_projection(1200),1168)
    def test_instance_count_limit_is_also_preserved(self):
        with self.assertRaises(SystemExit):self.run_projection(1200,maximum=9)
