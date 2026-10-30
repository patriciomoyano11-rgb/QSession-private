import asyncio
import collections
import concurrent.futures
import http.server
import importlib.util
import pathlib
import threading
import time
import types
import unittest

source=pathlib.Path(__file__).resolve().parents[1]/'scripts/hls-load-client.py'
spec=importlib.util.spec_from_file_location('load_client',source)
client=importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class Handler(http.server.BaseHTTPRequestHandler):
    forwarded=0
    protocol_version='HTTP/1.1'
    connection_ports=[]
    def do_GET(self):
        Handler.connection_ports.append(self.client_address[1])
        if self.path=='/redirect':
            self.send_response(302);self.send_header('Location','/must-not-forward');self.send_header('Content-Length','0');self.end_headers();return
        if self.path=='/must-not-forward':Handler.forwarded+=1
        data=b'X'*65537 if self.path=='/oversize.m3u8' else b'G'*188
        self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def log_message(self,*args):pass


class StandardHttpTransport(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):client.close_stdlib_connections()
    @classmethod
    def setUpClass(cls):
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join()
    async def test_media_is_bounded_and_yielded(self):
        async with client.StdlibSession({}) as session:
            async with session.get(self.base+'/segment.ts',False,types.SimpleNamespace(total=2)) as response:
                self.assertEqual(response.status,200)
                sizes=[len(data) async for data in response.content.iter_chunked(64)]
                self.assertEqual(sum(sizes),188)
    async def test_redirect_never_forwards_private_request(self):
        async with client.StdlibRequest(self.base+'/redirect',{},2) as response:
            self.assertEqual(response.status,302)
        self.assertEqual(Handler.forwarded,0)
    async def test_oversize_manifest_is_rejected(self):
        with self.assertRaises(ValueError):
            async with client.StdlibRequest(self.base+'/oversize.m3u8',{},2):pass
    async def test_sequential_worker_requests_reuse_connection(self):
        def repeat():
            for _ in range(2):
                response=client.StdlibRequest(self.base+'/segment.ts',{},2).fetch()
                self.assertEqual(response.status,200)
        await asyncio.to_thread(repeat)
        self.assertEqual(Handler.connection_ports[-1],Handler.connection_ports[-2])

    async def test_thread_queue_delay_is_separated_from_network_time(self):
        loop=asyncio.get_running_loop()
        loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1))
        entered=threading.Event()
        def occupy_thread():
            entered.set()
            time.sleep(.3)
        busy=loop.run_in_executor(None,occupy_thread)
        while not entered.is_set():await asyncio.sleep(.001)
        async with client.StdlibRequest(self.base+'/segment.ts',{},2) as response:
            self.assertGreater(response.transportQueueSeconds,.2)
            self.assertLess(response.transportNetworkSeconds,.2)
            self.assertEqual(response.body,b'G'*188)
        await busy


class ProbeDomainScope(unittest.TestCase):
    def tearDown(self):
        client.configure_delivery_host('live.staging.qsession.test')

    def test_custom_domain_keeps_manifest_leases_on_the_selected_origin(self):
        client.configure_delivery_host('live.staging.qsession.test')
        token='synthetic-token'
        manifest='#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:6,\nsegment_load_0123456789abcdef_00001.ts?qsat='+token+'\n'
        url=client.segment_urls(manifest,token)[0]
        self.assertTrue(url.startswith('https://live.staging.qsession.test'+client.PREFIX))
        self.assertTrue(url.endswith('?qsat='+token))
        for host in ['live.qsession.org', 'qsession-live.patriciomoyano11.workers.dev', 'live.staging.qsession.test.untrusted.test']:
            hostile=manifest.replace('segment_load_', 'https://'+host+client.PREFIX+'segment_load_')
            with self.assertRaises(ValueError):client.parse_manifest(hostile,token)

    def test_production_and_unowned_delivery_hosts_are_rejected_before_configuration(self):
        initial=client.URL
        for host in ('untrusted.test', 'live.qsession.org', 'www.qsession.org',
                     'qsession-live.patriciomoyano11.workers.dev', 'staging.qsession.org'):
            with self.subTest(host=host), self.assertRaises(ValueError):
                client.configure_delivery_host(host)
            self.assertEqual(client.URL, initial)

    def test_known_canary_opt_in_is_not_the_load_default(self):
        client.configure_delivery_host('live.qsession.org', allow_known_canary=True)
        self.assertEqual(client.HOST, 'live.qsession.org')
        with self.assertRaises(ValueError):
            client.configure_delivery_host('live.qsession.org')


class Http2Deadline(unittest.IsolatedAsyncioTestCase):
    async def test_whole_body_deadline_closes_stream_without_accepting_partial_media(self):
        class Response:
            status_code = 200
            headers = {'Content-Length': '1431620'}
            http_version = 'HTTP/2'
            async def aiter_bytes(self, chunk_size):
                yield b'G' * min(chunk_size, 188)
                await asyncio.Event().wait()
        class Context:
            closed = False
            async def __aenter__(self): return Response()
            async def __aexit__(self, *args): self.closed = True
        context = Context()
        with self.assertRaises(TimeoutError):
            async with asyncio.timeout(.02), client.Http2Request(context) as response:
                async for _chunk in response.content.iter_chunked(65536): pass
        self.assertTrue(context.closed)

    async def test_error_body_read_is_bounded_and_stream_is_closed(self):
        class Response:
            status_code = 503
            headers = {}
            http_version = 'HTTP/2'
            async def aiter_bytes(self, chunk_size):
                yield b'E' * chunk_size
                raise AssertionError('A denial body must not be downloaded in full')
        class Context:
            closed = False
            async def __aenter__(self): return Response()
            async def __aexit__(self, *args): self.closed = True
        context = Context()
        async with client.Http2Request(context) as response:
            self.assertEqual(len(await response.content.read(4096)), 4096)
        self.assertTrue(context.closed)


class FailureEvidence(unittest.TestCase):
    def test_recovery_and_admission_diagnostics_are_allowlisted_and_counted_without_private_values(self):
        cases = (
            ('X-QSession-Media-Failure','mediaFailure','MediaFailure',('edge-body-budget','edge-body-readers','edge-not-retained')),
            ('X-QSession-Cache-Fill','cacheFill','CacheFill',('stored','r2-edge')),
            ('X-QSession-Cache-Phase','cachePhase','CachePhase',('miss','readError','putReject','verifyInvalid')),
            ('X-QSession-Cache-Recovery','cacheRecovery','CacheRecovery',('verified-body',)),
            ('X-QSession-Admission-Phase','admissionPhase','AdmissionPhase',('pending-limit','backoff','cache','backend','token-expired')),
            ('X-QSession-Admission-Attempts','admissionAttempts','AdmissionAttempts',('0','1','2')))
        for kind in ('manifest','segment'):
            for header,field,counter,allowed in cases:
                for value in allowed:
                    with self.subTest(kind=kind,header=header,value=value):
                        headers={header:value,'Authorization':'PRIVATE','X-QSession-Admission-Stats':'ram=PRIVATE;cache=PRIVATE'}
                        stats=collections.Counter({kind+'Requests':4,kind+'Ok':2})
                        client.record_response_diagnostics(stats,kind,headers)
                        self.assertEqual(stats,collections.Counter({kind+'Requests':4,kind+'Ok':2,kind+counter+'_'+value:1}))
                        evidence=client.transport_failure_evidence(kind,types.SimpleNamespace(status=503,headers=headers),0,'HttpStatus')
                        self.assertEqual(evidence[field],value)
                        self.assertNotIn('PRIVATE',str(evidence))
            for failure in ('edge-pending-limit','backend-timeout','backend-503'):
                with self.subTest(kind=kind,failure=failure):
                    evidence=client.transport_failure_evidence(kind,types.SimpleNamespace(status=503,
                        headers={'X-QSession-Admission-Failure':failure}),0,'HttpStatus')
                    self.assertEqual(evidence['admissionFailure'],failure)
        for value in ('https://private.invalid/?qsat=PRIVATE','PRIVATE','unknown','3','-1','01','1;token=PRIVATE'):
            headers={header:value for header,_,_,_ in cases}
            headers.update({'X-QSession-Admission-Failure':value,'X-QSession-Admission-Stats':value,'Set-Cookie':value})
            stats=collections.Counter({'segmentRequests':1})
            client.record_response_diagnostics(stats,'segment',headers)
            self.assertEqual(stats,collections.Counter({'segmentRequests':1}))
            evidence=client.transport_failure_evidence('segment',types.SimpleNamespace(status=503,headers=headers),0,'HttpStatus')
            self.assertTrue(all(field not in evidence for _,field,_,_ in cases))
            self.assertNotIn('admissionFailure',evidence)
            self.assertNotIn('PRIVATE',str(evidence))

    def test_media_failure_and_cache_layer_are_allowlisted_without_copying_provider_data(self):
        response = types.SimpleNamespace(status=503, headers={
            'X-QSession-Media-Failure':'storage-body-read', 'X-QSession-Cache-Fill':'shared-edge',
            'Set-Cookie':'PRIVATE', 'X-Provider-Error':'private account details'})
        result=client.transport_failure_evidence('segment',response,0,'HttpStatus')
        self.assertEqual(result['mediaFailure'],'storage-body-read')
        self.assertEqual(result['cacheFill'],'shared-edge')
        self.assertNotIn('private',str(result))
        for header in ('X-QSession-Media-Failure','X-QSession-Cache-Fill'):
            unsafe=types.SimpleNamespace(status=503,headers={header:'https://PRIVATE/?qsat=PRIVATE'})
            result=client.transport_failure_evidence('segment',unsafe,0,'HttpStatus')
            self.assertNotIn('mediaFailure',result)
            self.assertNotIn('cacheFill',result)
            self.assertNotIn('PRIVATE',str(result))

    def test_partial_body_retains_only_safe_correlation_fields(self):
        response = types.SimpleNamespace(status=200, headers={'CF-Ray': '0123456789abcdef-ORD',
            'Content-Length': '1431620', 'X-QSession-Edge-Cache': 'HIT',
            'Set-Cookie': 'PRIVATE', 'Location': 'https://private.invalid/?qsat=PRIVATE'})
        result = client.transport_failure_evidence('segment', response, 8192, 'ClientPayloadError')
        self.assertEqual(result['phase'], 'after_headers')
        self.assertEqual(result['expectedBytes'], 1431620)
        self.assertEqual(result['receivedBytes'], 8192)
        self.assertEqual(result['cloudflareRay'], '0123456789abcdef-ORD')
        self.assertNotIn('PRIVATE', str(result))
        self.assertNotIn('private.invalid', str(result))

    def test_connection_failure_never_invents_a_response_or_copies_arbitrary_headers(self):
        result = client.transport_failure_evidence('manifest', None, 0, 'TimeoutError')
        self.assertEqual(result['phase'], 'before_headers')
        self.assertNotIn('httpStatus', result)
        unsafe = types.SimpleNamespace(status=200, headers={'CF-Ray': 'https://private.invalid/?qsat=PRIVATE',
            'Content-Length': 'PRIVATE', 'X-QSession-Edge-Cache': 'PRIVATE'})
        result = client.transport_failure_evidence('segment', unsafe, 0, 'https://PRIVATE')
        self.assertNotIn('PRIVATE', str(result))

    def test_r2_canary_route_and_bounded_failure_codes_are_observable_without_private_headers(self):
        response=types.SimpleNamespace(status=503,headers={'X-QSession-Cache-Fill':'r2-edge',
            'X-QSession-Media-Failure':'edge-fill-queue','Authorization':'PRIVATE'})
        evidence=client.transport_failure_evidence('segment',response,0,'HttpStatus')
        self.assertEqual(evidence['cacheFill'],'r2-edge')
        self.assertEqual(evidence['mediaFailure'],'edge-fill-queue')
        self.assertNotIn('PRIVATE',str(evidence))
        response.headers['X-QSession-Cache-Fill']='https://private.invalid/?token=PRIVATE'
        self.assertNotIn('cacheFill',client.transport_failure_evidence('segment',response,0,'HttpStatus'))


if __name__=='__main__':unittest.main()
