"""Real HTTP-library integration on loopback; never reaches QSession or a cloud."""
import asyncio
import importlib.util
import json
import pathlib
import time
import unittest

try:
    import aiohttp
    from aiohttp import web
except ImportError:
    aiohttp = None

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('real_trace_client', ROOT/'platform/scripts/hls-load-client.py')
client = importlib.util.module_from_spec(spec);spec.loader.exec_module(client)


@unittest.skipIf(aiohttp is None, 'Run with the isolated aiohttp verification dependency')
class RealTraceIntegration(unittest.IsolatedAsyncioTestCase):
    async def test_real_queue_dns_connection_reuse_and_full_body(self):
        async def media(request):
            response = web.StreamResponse(headers={'Content-Length':'376'})
            await response.prepare(request)
            await response.write(b'G'*188)
            await asyncio.sleep(.015)
            await response.write(b'G'*188)
            await response.write_eof()
            return response
        app = web.Application();app.router.add_get('/local.ts', media)
        runner = web.AppRunner(app);await runner.setup()
        server = web.TCPSite(runner, '127.0.0.1', 0);await server.start()
        port = server._server.sockets[0].getsockname()[1]
        trace, supported = client.aiohttp_trace_config(aiohttp)
        self.assertEqual(len(supported), 8)
        timings = []
        try:
            async with aiohttp.ClientSession(trace_configs=[trace],
                    connector=aiohttp.TCPConnector(limit=1), timeout=aiohttp.ClientTimeout(total=5)) as session:
                async def fetch():
                    timing = client.RequestTiming(time.monotonic())
                    async with session.get(f'http://localhost:{port}/local.ts?private=DO_NOT_RECORD',
                            trace_request_ctx=timing) as response:
                        timing.headers_at = time.monotonic();body = bytearray()
                        async for chunk in response.content.iter_chunked(188):
                            if timing.first_body_at is None:timing.first_body_at = time.monotonic()
                            body.extend(chunk)
                        self.assertEqual(bytes(body), b'G'*376)
                        self.assertEqual(response.status, 200)
                    timings.append(timing.snapshot(time.monotonic(), True))
                await asyncio.gather(*(fetch() for _ in range(3)))
        finally:
            await runner.cleanup()
        phases = [t['observedMilliseconds'] for t in timings]
        self.assertTrue(any('connectorQueue' in p for p in phases))
        self.assertTrue(any('dnsResolution' in p for p in phases))
        self.assertTrue(any('connectionCreateIncludingDnsTcpTls' in p for p in phases))
        self.assertTrue(any(t['connectionReused'] for t in timings))
        self.assertTrue(all(t['bodyComplete'] and not t['incompletePhases'] for t in timings))
        self.assertTrue(all('headersToBodyComplete' in p for p in phases))
        self.assertNotIn('DO_NOT_RECORD', json.dumps(timings))
        self.assertTrue(all('tlsHandshake' not in p and 'tcpConnect' not in p for p in phases))


if __name__ == '__main__':unittest.main()
