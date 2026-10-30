const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const SOURCE = fs.readFileSync(process.env.QSESSION_ADMISSION_SOURCE || path.join(__dirname, '../edge/hls-worker.js'), 'utf8');
const ORIGIN = 'https://edge.example.test';
const PREFIX = 'live/JNTUBY-abcdefghijklmnopqr';
const SECRET = 'unit-test-only-admission-secret-32-bytes';

function mint(clock, overrides = {}, secret = SECRET) {
  const body = Buffer.from(JSON.stringify({v: 1, aud: 'qsession-hls', code: 'JNTUBY', prefix: PREFIX,
    lease: '1234567890123456789012', exp: Math.floor(clock.now / 1000) + 3600, ...overrides})).toString('base64url');
  return `v1.${body}.${crypto.createHmac('sha256', secret).update(`v1.${body}`).digest('base64url')}`;
}

function memoryCache(clock) {
  const entries = new Map();
  return {
    entries,
    async match(request) {
      const item = entries.get(request.url);
      if (!item || item.until <= clock.now) return undefined;
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') || '');
      if (range) {
        const start = Number(range[1]), end = Math.min(Number(range[2]), item.bytes.length - 1);
        const headers = new Headers(item.headers);
        headers.set('Content-Range', `bytes ${start}-${end}/${item.bytes.length}`);
        headers.set('Content-Length', String(end - start + 1));
        return new Response(item.bytes.subarray(start, end + 1), {status: 206, headers});
      }
      return new Response(item.bytes, {status: item.status, headers: item.headers});
    },
    async put(request, response) {
      assert.notEqual(response.status, 206, 'Cloudflare cannot store partial representations');
      const maxAge = Number(/(?:s-maxage|max-age)=([\d.]+)/.exec(response.headers.get('Cache-Control'))?.[1] || 0);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const headers = new Headers(response.headers);
      entries.set(request.url, {bytes, headers, status: response.status,
        response: new Response(bytes, {status: response.status, headers}), until: clock.now + maxAge * 1000});
    },
  };
}

function harness(options = {}) {
  const clock = options.clock || {now: 1_800_000_000_000};
  const cache = options.cache || memoryCache(clock);
  const calls = {api: [], gets: [], heads: [], logs: []};
  const objects = new Map(Object.entries({
    [`${PREFIX}/index.m3u8`]: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment_01.ts\n',
    [`${PREFIX}/segment_01.ts`]: '0123456789',
    [`${PREFIX}/segment_init.m4s`]: 'init',
    'live/OTHERX-abcdefghijklmnopqr/segment_01.ts': 'legacy',
    ...options.objects,
  }));
  function object(key, range, body) {
    const value = objects.get(key);
    if (value === undefined) return null;
    const data = Buffer.from(value);
    return {
      size: data.length, httpEtag: '"synthetic-etag"',
      body: body ? new Uint8Array(range ? data.subarray(range.offset, range.offset + range.length) : data) : undefined,
      writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp2t'); },
    };
  }
  const env = {
    QSESSION_ADMISSION_ROOM: 'JNTUBY', QSESSION_ADMISSION_SECRET: SECRET,
    QSESSION_ADMISSION_API: 'https://qsession.org/api/broadcast/admissions/check',
    QSESSION_ADMISSION_BACKEND: options.backend || 'required',
    QSESSION_LIVE: {
      async get(key, getOptions) {
        calls.gets.push({key, options: getOptions});
        await options.getObject?.(key, getOptions);
        return object(key, getOptions?.range, true);
      },
      async head(key) { calls.heads.push(key); return object(key, null, false); },
    },
    ...options.env,
  };
  class ClockDate extends Date { static now() { return clock.now; } }
  const scope = vm.createContext({
    Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, Uint32Array, AbortController, ReadableStream, Blob,
    Date: ClockDate, crypto: crypto.webcrypto, atob, setTimeout: options.setTimeout || setTimeout, clearTimeout,
    caches: {default: cache},
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(method => [method, (...values) => {
      calls.logs.push(values.map(value => typeof value === 'object' ? `${String(value)} ${JSON.stringify(value)}` : String(value)).join(' '));
    }])),
    async fetch(url, request) {
      const body = JSON.parse(request.body);
      calls.api.push({url, request, body});
      // Record the attempted fetch, but reject unsupported workerd modes
      // before executing the simulated backend. Node also accepts 'error'.
      if (!['manual', 'follow'].includes(request.redirect || 'follow')) {
        throw new TypeError('Unsupported workerd redirect mode');
      }
      if (options.api) return options.api(url, request, body, calls.api.length);
      return Response.json({ok: true, cacheSeconds: 20});
    },
  });
  vm.runInContext(SOURCE.replace('export default {', 'globalThis.worker = {').replace('export class QSessionSegmentCache', 'class QSessionSegmentCache'), scope);
  return {
    clock, cache, calls, env, objects, scope,
    token: overrides => mint(clock, overrides),
    async request(file = 'segment_01.ts', token, init = {}, customEnv = env) {
      const tasks = [];
      const context = {waitUntil(promise) { tasks.push(promise); }};
      const url = file.startsWith('https:') ? file : `${ORIGIN}/${PREFIX}/${file}`;
      const target = new URL(url);
      if (token !== undefined) target.searchParams.set('qsat', token);
      const response = await scope.worker.fetch(new Request(target, init), customEnv, context);
      await Promise.all(tasks.splice(0));
      return response;
    },
  };
}

test('legacy delivery remains available and query strings do not fragment shared objects', async () => {
  const h = harness({env: {QSESSION_ADMISSION_ROOM: ''}});
  const first = await h.request('segment_01.ts?foo=1');
  assert.equal(first.status, 200);
  assert.equal(await first.text(), '0123456789');
  assert.equal((await h.request('segment_01.ts?foo=2')).headers.get('X-QSession-Edge-Cache'), 'HIT');
  assert.equal(h.calls.gets.length, 1);
  assert.equal(h.calls.api.length, 0);
  const head = await h.request('segment_01.ts', undefined, {method: 'HEAD'});
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('Content-Length'), '10');
});

test('a warm legacy object cannot bypass selected-room authentication, including HEAD', async () => {
  const h = harness();
  await h.request('segment_01.ts', undefined, {}, {...h.env, QSESSION_ADMISSION_ROOM: ''});
  for (const method of ['GET', 'HEAD']) {
    const response = await h.request('segment_01.ts', undefined, {method});
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  const other = await h.request(`${ORIGIN}/live/OTHERX-abcdefghijklmnopqr/segment_01.ts`);
  assert.equal(other.status, 200);
  assert.equal(h.calls.gets.length, 2);
  assert.equal(h.calls.api.length, 0);
});

test('signature, audience, room, prefix, lease, expiry and duplicate tokens are checked locally', async () => {
  const h = harness();
  const invalid = [
    `${h.token()}x`, h.token({aud: 'another-product'}), h.token({code: 'OTHERX'}),
    h.token({prefix: 'live/JNTUBY-differentprefix123'}), h.token({lease: 'short'}),
    h.token({exp: Math.floor(h.clock.now / 1000)}), h.token({exp: 1.5}),
    h.token({generation: 12}), h.token({generation: 'x'.repeat(101)}),
    mint(h.clock, {}, 'different-secret-of-sufficient-length'), 'v2.bad.bad',
  ];
  for (const token of invalid) assert.equal((await h.request('segment_01.ts', token)).status, 403);
  const token = h.token();
  assert.equal((await h.request(`segment_01.ts?qsat=${token}&qsat=${token}`)).status, 403);
  assert.equal(h.calls.api.length, 0);
  assert.equal(h.calls.gets.length, 0);
});

test('personalized manifests rewrite native HLS URIs while canonical manifests and segments stay shared', async () => {
  const h = harness({objects: {[`${PREFIX}/index.m3u8`]:
    '#EXTM3U\n#EXT-X-MAP:URI="segment_init.m4s"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="archive.m3u8"\n#EXTINF:6,\nsegment_01.ts\n'}});
  const a = h.token();
  const b = h.token({lease: 'abcdefghijklmnopqrstuv'});
  const first = await h.request('index.m3u8', a);
  assert.equal(first.status, 200);
  const firstText = await first.text();
  assert.ok(firstText.includes(`${ORIGIN}/${PREFIX}/segment_01.ts?qsat=${a}`));
  assert.ok(firstText.includes(`URI="${ORIGIN}/${PREFIX}/segment_init.m4s?qsat=${a}"`));
  assert.ok(firstText.includes(`URI="${ORIGIN}/${PREFIX}/archive.m3u8?qsat=${a}"`));
  assert.equal(first.headers.get('ETag'), null);
  assert.equal(first.headers.get('Content-Length'), null);
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
  const second = await h.request('index.m3u8', b);
  assert.equal(second.headers.get('X-QSession-Edge-Cache'), 'HIT');
  const secondText = await second.text();
  assert.ok(secondText.includes(`qsat=${b}`));
  assert.ok(!secondText.includes(a));
  await h.request('segment_01.ts', a);
  const segment = await h.request('segment_01.ts', b);
  assert.equal(segment.headers.get('X-QSession-Edge-Cache'), 'HIT');
  assert.equal(segment.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(h.calls.gets.length, 2);
  const canonical = h.cache.entries.get(`${ORIGIN}/${PREFIX}/index.m3u8`);
  assert.ok(canonical);
  assert.ok(!(await canonical.response.clone().text()).includes('qsat'));
  for (const key of h.cache.entries.keys()) assert.ok(!key.includes(a) && !key.includes(b));
});

test('token expiry is enforced even while both object and admission approval are warm', async () => {
  const h = harness();
  const token = h.token({exp: Math.floor(h.clock.now / 1000) + 2});
  assert.equal((await h.request('segment_01.ts', token)).status, 200);
  h.clock.now += 2100;
  assert.equal((await h.request('segment_01.ts', token)).status, 403);
  assert.equal(h.calls.api.length, 1);
});

test('a token that expires during backend verification is denied before reading the object', async () => {
  const clock = {now: 1_800_000_000_000};
  const h = harness({clock, api: async () => {
    clock.now += 2100;
    return Response.json({ok: true, cacheSeconds: 20});
  }});
  const token = h.token({exp: Math.floor(clock.now / 1000) + 2});
  assert.equal((await h.request('segment_01.ts', token)).status, 403);
  assert.equal(h.calls.gets.length, 0);
});

test('a backend cannot extend the approval cache beyond the 20 second revocation window', async () => {
  const h = harness({api: async () => Response.json({ok: true, cacheSeconds: 600})});
  const token = h.token();
  await h.request('segment_01.ts', token);
  h.clock.now += 20_100;
  await h.request('segment_01.ts', token);
  assert.equal(h.calls.api.length, 2);
});

test('room generations do not reuse approvals from an earlier event with the same code', async () => {
  const h = harness();
  await h.request('segment_01.ts', h.token({generation: 'room_event_1'}));
  await h.request('segment_01.ts', h.token({generation: 'room_event_2'}));
  assert.equal(h.calls.api.length, 2);
});

test('native segment requests renew at most every 20 seconds and expired leases cannot use cached segments', async () => {
  let active = true;
  const h = harness({api: async () => active ? Response.json({ok: true, cacheSeconds: 20}) : new Response(null, {status: 410})});
  const token = h.token();
  await h.request('index.m3u8', token);
  h.clock.now += 19_000;
  await h.request('segment_01.ts', token);
  assert.equal(h.calls.api.length, 1);
  h.clock.now += 1100;
  await h.request('segment_01.ts', token);
  assert.equal(h.calls.api.length, 2);
  assert.deepEqual(h.calls.api[1].body, {token, objectKey: `${PREFIX}/segment_01.ts`});
  active = false;
  h.clock.now += 20_100;
  assert.equal((await h.request('segment_01.ts', token)).status, 410);
  assert.equal((await h.request('segment_01.ts', token)).status, 410);
  assert.equal(h.calls.api.length, 4, 'denials must not be cached');
});

test('approval cache works across isolates and remains bounded by backend TTL', async () => {
  const h = harness();
  const token = h.token();
  await h.request('segment_01.ts', token);
  const next = harness({clock: h.clock, cache: h.cache, api: async () => { throw new Error('unavailable'); }});
  assert.equal((await next.request('segment_01.ts', token)).status, 200);
  assert.equal(next.calls.api.length, 0);
  h.clock.now += 20_100;
  assert.equal((await next.request('segment_01.ts', token)).status, 503);
});

test('refreshed tokens share a lease approval while key rotation requires a new approval', async () => {
  const h = harness();
  const token = h.token();
  await h.request('segment_01.ts', token);
  const refreshed = h.token({exp: Math.floor(h.clock.now / 1000) + 7200});
  assert.equal((await h.request('segment_01.ts', refreshed)).status, 200);
  assert.equal(h.calls.api.length, 1);
  const nextSecret = 'rotated-unit-test-admission-secret-32-bytes';
  const rotatedEnv = {...h.env, QSESSION_ADMISSION_SECRET: nextSecret};
  assert.equal((await h.request('segment_01.ts', token, {}, rotatedEnv)).status, 403);
  const rotated = mint(h.clock, {}, nextSecret);
  assert.equal((await h.request('segment_01.ts', rotated, {}, rotatedEnv)).status, 200);
  assert.equal(h.calls.api.length, 2);
});

test('backend failures, malformed successes and denials fail closed without reading R2', async () => {
  for (const api of [
    async () => { throw new Error('offline'); }, async () => new Response(null, {status: 500}),
    async () => Response.json({ok: false}), async () => new Response('not JSON'),
    async () => new Response('x'.repeat(1100)),
  ]) {
    const h = harness({api});
    assert.equal((await h.request('segment_01.ts', h.token())).status, 503);
    assert.equal((await h.request('segment_01.ts', h.token())).status, 503);
    assert.equal(h.calls.gets.length, 0);
    assert.equal(h.calls.api.length, 1, 'a retryable failure has a brief, fail-closed backoff');
  }
  for (const status of [401, 403, 410]) {
    const h = harness({api: async () => new Response(null, {status})});
    assert.equal((await h.request('segment_01.ts', h.token())).status, status === 401 ? 403 : status);
  }
});

test('backend fetch uses workerd-compatible manual redirects and never follows a redirected authorization body', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const destination = 'https://untrusted.example/collect-authorization';
    const h = harness({api: async (url, request) => {
      assert.equal(url, 'https://qsession.org/api/broadcast/admissions/check');
      assert.equal(request.redirect, 'manual');
      return new Response(null, {status, headers: {Location: destination}});
    }});
    const response = await h.request('segment_01.ts', h.token());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-QSession-Admission-Failure'), `backend-${status}`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Location'), null);
    assert.equal(h.calls.api.length, 1);
    assert.ok(h.calls.api.every(call => call.url !== destination));
    assert.equal(h.calls.gets.length, 0);
    assert.equal(h.calls.heads.length, 0);
  }
});

test('transient gateway retry renews the same admission and coalesces concurrent checks', async () => {
  const h = harness({api: async (_url, _request, _body, attempt) =>
    attempt === 1 ? new Response(null, {status: 520}) : Response.json({ok: true, cacheSeconds: 20})});
  const responses = await Promise.all(Array.from({length: 20}, () => h.request('segment_01.ts', h.token())));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(h.calls.api.length, 2);
  assert.deepEqual(h.calls.api[0].body, h.calls.api[1].body);
  assert.ok(responses.every(response => response.headers.get('X-QSession-Admission-Recovery') === 'gateway'));
  assert.equal(h.calls.gets.length, 1);
});

test('a gateway retry still obeys revocation and never retries explicit denials or overload', async () => {
  for (const status of [401, 403, 410, 429]) {
    const denied = harness({api: async () => new Response(null, {status})});
    const response = await denied.request('segment_01.ts', denied.token());
    assert.equal(response.status, status === 401 ? 403 : status === 429 ? 503 : status);
    assert.equal(denied.calls.api.length, 1);
    assert.equal(denied.calls.gets.length, 0);
    const revoked = harness({api: async (_url, _request, _body, attempt) =>
      new Response(null, {status: attempt === 1 ? 520 : status})});
    assert.equal((await revoked.request('segment_01.ts', revoked.token())).status, response.status);
    assert.equal(revoked.calls.api.length, 2);
    assert.equal(revoked.calls.gets.length, 0);
  }
});

test('persistent gateway failure stops after one retry and never warms media cache', async () => {
  const h = harness({api: async () => new Response(null, {status: 520})});
  const response = await h.request('segment_01.ts', h.token());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-QSession-Admission-Failure'), 'backend-520');
  assert.equal(h.calls.api.length, 2);
  assert.equal(h.calls.gets.length, 0);
  assert.equal(h.cache.entries.size, 0);
});

function admissionTestTimer(record) {
  return (callback, milliseconds) => {
    record.push(milliseconds);
    return setTimeout(callback, milliseconds === 4000 ? 80 : milliseconds === 1750 ? 5 : milliseconds === 75 ? 1 : milliseconds);
  };
}

function stalledAdmission(signal) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
  });
}

test('a stalled fetch retries once with the identical lease inside one overall deadline', async () => {
  const timers = [], budgetsAtFetch = [];
  const h = harness({setTimeout: admissionTestTimer(timers), api: async (_url, request, _body, attempt) => {
    budgetsAtFetch.push(timers.filter(value => value === 4000).length);
    return attempt === 1 ? stalledAdmission(request.signal) : Response.json({ok: true, cacheSeconds: 20});
  }});
  const responses = await Promise.all(Array.from({length: 20}, () => h.request('segment_01.ts', h.token())));
  assert.ok(responses.every(response => response.status === 200));
  assert.ok(responses.every(response => response.headers.get('X-QSession-Admission-Recovery') === 'timeout'));
  assert.equal(h.calls.api.length, 2);
  assert.deepEqual(h.calls.api[0].body, h.calls.api[1].body);
  assert.ok(h.calls.api[0].request.signal.aborted);
  assert.deepEqual(budgetsAtFetch, [1, 1], 'the retry retains one overall deadline');
  assert.equal(h.calls.gets.length, 1);
});

test('a stalled successful response body is also bounded before the single retry', async () => {
  const timers = [];
  const h = harness({setTimeout: admissionTestTimer(timers), api: async (_url, request, _body, attempt) => {
    if (attempt !== 1) return Response.json({ok: true, cacheSeconds: 20});
    return new Response(new ReadableStream({start(controller) {
      request.signal.addEventListener('abort', () => controller.error(request.signal.reason), {once: true});
    }}));
  }});
  const response = await h.request('segment_01.ts', h.token());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-QSession-Admission-Recovery'), 'timeout');
  assert.equal(h.calls.api.length, 2);
});

test('two stalled attempts fail closed at the original overall deadline without media or approval caching', async () => {
  const timers = [];
  const h = harness({setTimeout: admissionTestTimer(timers), api: async (_url, request) => stalledAdmission(request.signal)});
  const response = await h.request('segment_01.ts', h.token());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-QSession-Admission-Failure'), 'backend-timeout');
  assert.equal(h.calls.api.length, 2);
  assert.ok(h.calls.api.every(call => call.request.signal.aborted));
  assert.equal(timers.filter(value => value === 4000).length, 1);
  assert.equal(h.calls.gets.length, 0);
  assert.equal(h.cache.entries.size, 0);
});

test('a backend result arriving after the overall deadline cannot approve playback', async () => {
  const h = harness({setTimeout: admissionTestTimer([]), api: async (_url, request, _body, attempt) => {
    if (attempt === 1) return stalledAdmission(request.signal);
    return {status: 200, ok: true, async text() {
      await new Promise(resolve => setTimeout(resolve, 110));
      return JSON.stringify({ok: true, cacheSeconds: 20});
    }};
  }});
  const response = await h.request('segment_01.ts', h.token());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-QSession-Admission-Failure'), 'backend-timeout');
  assert.equal(h.calls.gets.length, 0);
  assert.equal(h.cache.entries.size, 0);
});

test('a timeout retry still accepts definitive denial, expiry and overload without another attempt', async () => {
  for (const status of [401, 403, 410, 429]) {
    const h = harness({setTimeout: admissionTestTimer([]), api: async (_url, request, _body, attempt) =>
      attempt === 1 ? stalledAdmission(request.signal) : new Response(null, {status})});
    const response = await h.request('segment_01.ts', h.token());
    assert.equal(response.status, status === 401 ? 403 : status === 429 ? 503 : status);
    assert.equal(h.calls.api.length, 2);
    assert.equal(h.calls.gets.length, 0);
    assert.equal(h.cache.entries.size, 0);
  }
});

test('transient network errors can retry but certificate failures cannot', async () => {
  const h = harness({api: async (_url, _request, _body, attempt) => {
    if (attempt === 1) throw new TypeError('fetch failed: PRIVATE_NETWORK_DETAILS');
    return Response.json({ok: true, cacheSeconds: 20});
  }});
  const response = await h.request('segment_01.ts', h.token());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-QSession-Admission-Recovery'), 'network');
  assert.equal(h.calls.api.length, 2);
  const denied = harness({api: async () => { throw new TypeError('fetch failed: TLS certificate rejected'); }});
  assert.equal((await denied.request('segment_01.ts', denied.token())).status, 503);
  assert.equal(denied.calls.api.length, 1);
  assert.equal(denied.calls.gets.length, 0);
});

test('backend diagnostic categories never expose exception text, JWTs, URLs or backend response contents', async () => {
  for (const [message, category] of [
    ['Network connection failed', 'network'], ['TLS certificate rejected', 'tls'],
    ['DNS lookup failed', 'dns'], ['Redirect rejected', 'redirect'],
    ['Illegal invocation', 'invocation'], ['Unexpected backend failure', 'request'],
  ]) {
    const marker = 'PRIVATE_EXCEPTION_DETAILS';
    const h = harness({api: async (url, request, body) => {
      throw new Error(`${message}: ${marker} ${url}?qsat=${body.token} ${body.objectKey}`);
    }});
    const token = h.token();
    const response = await h.request('segment_01.ts', token);
    const output = JSON.stringify([...response.headers]) + await response.text() + h.calls.logs.join('\n');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-QSession-Admission-Failure'), `backend-${category}`);
    for (const privateValue of [marker, message, token, PREFIX, 'https://qsession.org/api/broadcast/admissions/check']) {
      assert.ok(!output.includes(privateValue));
    }
    assert.equal(h.calls.gets.length, 0);
    assert.equal(h.calls.heads.length, 0);
  }
  const h = harness({api: async (url, request, body) => new Response(`PRIVATE_BACKEND_RESPONSE ${url} ${body.token}`)});
  const token = h.token();
  const response = await h.request('segment_01.ts', token);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-QSession-Admission-Failure'), 'backend-json');
  const output = JSON.stringify([...response.headers]) + await response.text() + h.calls.logs.join('\n');
  assert.ok(!output.includes('PRIVATE_BACKEND_RESPONSE') && !output.includes(token) && !output.includes('https://qsession.org/'));
  assert.equal(h.calls.gets.length, 0);
});

test('simultaneous requests for one token share an in-flight renewal', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness({api: async () => { await gate; return Response.json({ok: true, cacheSeconds: 20}); }});
  const requests = Array.from({length: 12}, () => h.request('segment_01.ts', h.token()));
  while (!h.calls.api.length) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const responses = await Promise.all(requests);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(h.calls.api.length, 1);
});

test('admission coalescing regression: cache lookup belongs to one shared check and RAM is rechecked after awaits', async () => {
  const clock = {now: 1_800_000_000_000}, cache = memoryCache(clock);
  let release, lookups = 0;
  const gate = new Promise(resolve => { release = resolve; });
  cache.match = async () => { lookups++; await gate; return undefined; };
  const h = harness({clock, cache});
  const token = h.token();
  const requests = Array.from({length: 20}, () => h.request('segment_01.ts', token, {method: 'HEAD'}));
  while (!lookups) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const responses = await Promise.all(requests);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(lookups, 1, 'Cache API must not receive one lookup per waiter');
  assert.equal(h.calls.api.length, 1);

  const nextClock = {now: clock.now}, nextCache = memoryCache(nextClock);
  const next = harness({clock: nextClock, cache: nextCache});
  nextCache.match = async request => {
    const hash = new URL(request.url).pathname.split('/').pop();
    const bytes = Uint8Array.from(Buffer.from(hash, 'hex'));
    next.scope.arrivingFingerprint = new Uint32Array(bytes.buffer);
    vm.runInContext('rememberApproval(arrivingFingerprint, Date.now() + 10000)', next.scope);
    return undefined;
  };
  assert.equal((await next.request('segment_01.ts', next.token(), {method: 'HEAD'})).status, 200);
  assert.equal(next.calls.api.length, 0, 'an approval arriving during cache lookup prevents a duplicate fetch');

  const expiredClock = {now: clock.now}, expiredCache = memoryCache(expiredClock);
  expiredCache.match = async () => ({async json() {
    const until = expiredClock.now + 1;
    expiredClock.now += 2;
    return {until};
  }});
  const expired = harness({clock: expiredClock, cache: expiredCache});
  assert.equal((await expired.request('segment_01.ts', expired.token(), {method: 'HEAD'})).status, 200);
  assert.equal(expired.calls.api.length, 1, 'a cache entry which expired during JSON read cannot approve playback');
});

test('admission coalescing regression: a full pending map fails closed before cache, backend or storage', async () => {
  let lookups = 0;
  const h = harness();
  h.cache.match = async () => { lookups++; };
  assert.equal(vm.runInContext('AUTH_PENDING_LIMIT', h.scope), 8192);
  vm.runInContext('for (let i = 0; i < AUTH_PENDING_LIMIT; i++) pendingApprovals.set("occupied-" + i, {settled: false, until: Infinity})', h.scope);
  const response = await h.request('segment_01.ts', h.token(), {method: 'HEAD'});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-QSession-Admission-Failure'), 'edge-pending-limit');
  assert.equal(response.headers.get('X-QSession-Admission-Phase'), 'pending-limit');
  assert.equal(response.headers.get('X-QSession-Admission-Attempts'), '0');
  assert.match(response.headers.get('X-QSession-Admission-Stats'), /^ram=\d+;cache=\d+;evicted=\d+;pendingPeak=\d+;attempts=\d+$/);
  assert.equal(lookups, 0);
  assert.equal(h.calls.api.length, 0);
  assert.equal(h.calls.gets.length + h.calls.heads.length, 0);
  assert.equal((await h.request('segment_01.ts', 'v1.invalid.invalid')).status, 403);
  assert.equal(vm.runInContext('pendingApprovals.size', h.scope), 8192);
});

test('admission coalescing regression: failures back off briefly without becoming approvals or caching denials', async () => {
  let recovered = false;
  const h = harness({api: async () => recovered ? Response.json({ok: true, cacheSeconds: 20}) : new Response(null, {status: 500})});
  const token = h.token();
  const first = await h.request('segment_01.ts', token, {method: 'HEAD'});
  assert.equal(first.status, 503);
  recovered = true;
  for (const elapsed of [0, 999]) {
    h.clock.now += elapsed;
    const response = await h.request('segment_01.ts', token, {method: 'HEAD'});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-QSession-Admission-Failure'), 'backend-500');
    assert.equal(response.headers.get('X-QSession-Admission-Phase'), 'backoff');
    assert.equal(response.headers.get('X-QSession-Admission-Attempts'), '0');
  }
  assert.equal(h.calls.api.length, 1);
  assert.equal(first.headers.get('X-QSession-Admission-Phase'), 'backend');
  assert.equal(first.headers.get('X-QSession-Admission-Attempts'), '1');
  assert.equal(h.calls.gets.length + h.calls.heads.length, 0);
  assert.equal(h.cache.entries.size, 0);
  h.clock.now += 2;
  assert.equal((await h.request('segment_01.ts', token, {method: 'HEAD'})).status, 200);
  assert.equal(h.calls.api.length, 2);
  for (const status of [403, 410]) {
    const denied = harness({api: async () => new Response(null, {status})});
    for (let i = 0; i < 2; i++) assert.equal((await denied.request('segment_01.ts', denied.token())).status, status);
    assert.equal(denied.calls.api.length, 2);
  }
});

test('byte ranges and HEAD use correct status, bounds, length and content range', async () => {
  const h = harness();
  const token = h.token();
  const range = await h.request('segment_01.ts', token, {headers: {Range: 'bytes=2-5'}});
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '2345');
  assert.equal(range.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(range.headers.get('Content-Length'), '4');
  const suffix = await h.request('segment_01.ts', token, {headers: {Range: 'bytes=-3'}});
  assert.equal(await suffix.text(), '789');
  const open = await h.request('segment_01.ts', token, {headers: {Range: 'bytes=8-'}});
  assert.equal(await open.text(), '89');
  const head = await h.request('segment_01.ts', token, {method: 'HEAD', headers: {Range: 'bytes=0-1'}});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('Content-Range'), null);
  assert.equal(head.headers.get('Content-Length'), '10');
  for (const value of ['bytes=99-', 'bytes=8-2', 'bytes=-0', 'bytes=0-1,4-5', 'invalid']) {
    const invalid = await h.request('segment_01.ts', token, {headers: {Range: value}});
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('Content-Range'), 'bytes */10');
  }
  assert.equal([...h.cache.entries.keys()].filter(key => key.includes('/live/')).length, 1);
  assert.equal(h.calls.gets.length, 1, 'native byte ranges share one full canonical storage read');
  assert.equal(h.calls.heads.length, 1, 'only the explicit HEAD consults storage metadata');
});

test('concurrent authorized listeners share one cold storage read without sharing their admission', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const h = harness({getObject: async () => { entered(); await gate; }});
  const requests = Array.from({length: 32}, (_, index) => h.request('index.m3u8',
    h.token({lease: String(index).padStart(22, '0')})));
  await started;
  assert.equal((await h.request('index.m3u8')).status, 403, 'an unauthorized waiter cannot join a fill');
  release();
  const responses = await Promise.all(requests);
  assert.equal(h.calls.gets.length, 1);
  assert.equal(h.calls.api.length, 32);
  for (let index = 0; index < responses.length; index++) {
    const text = await responses[index].text();
    assert.ok(text.includes(`qsat=${h.token({lease: String(index).padStart(22, '0')})}`));
    assert.equal(responses[index].headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal((await h.request('index.m3u8')).status, 403);
});

test('concurrent native ranges reuse the full cached object and still enforce authorization', async () => {
  const h = harness();
  const responses = await Promise.all(Array.from({length: 20}, (_, index) =>
    h.request('segment_01.ts', h.token({lease: String(index).padStart(22, '0')}), {headers: {Range: 'bytes=2-5'}})));
  for (const response of responses) {
    assert.equal(response.status, 206);
    assert.equal(await response.text(), '2345');
    assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
  }
  assert.equal(h.calls.gets.length, 1);
  assert.equal(h.calls.heads.length, 0);
  assert.equal((await h.request('segment_01.ts', undefined, {headers: {Range: 'bytes=2-5'}})).status, 403);
});

test('a token expiring while a shared object fills cannot receive the warmed representation', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const h = harness({getObject: async () => { entered(); await gate; }});
  const pending = h.request('segment_01.ts', h.token({exp: Math.floor(h.clock.now / 1000) + 2}));
  await started;
  h.clock.now += 2100;
  release();
  const response = await pending;
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes('0123456789'));
});

test('cache write rejection falls back to storage without caching a personalized response', async () => {
  const clock = {now: 1_800_000_000_000};
  const cache = memoryCache(clock);
  const originalPut = cache.put;
  cache.put = async (request, response) => {
    if (request.url.includes('/live/')) throw new Error('synthetic cache failure');
    return originalPut(request, response);
  };
  const h = harness({clock, cache});
  const response = await h.request('segment_01.ts', h.token(), {headers: {Range: 'bytes=2-5'}});
  assert.equal(response.status, 206);
  assert.equal(await response.text(), '2345');
  assert.equal(h.calls.gets.length, 1);
  assert.equal(h.calls.heads.length, 0);
  assert.equal(response.headers.get('X-QSession-Cache-Fill-State'), 'verified');
  assert.equal([...cache.entries.keys()].filter(key => key.includes('/live/')).length, 0);
});

test('a missing cold object does not poison later delivery or admission checks', async () => {
  const h = harness();
  assert.equal((await h.request('segment_later.ts', h.token())).status, 404);
  h.objects.set(`${PREFIX}/segment_later.ts`, 'new segment');
  const response = await h.request('segment_later.ts', h.token());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'new segment');
  assert.equal(h.calls.gets.length, 2);
});

test('manifest references cannot send bearer tokens to another host or stream', async () => {
  for (const uri of [
    'https://untrusted.example/segment_01.ts', '//untrusted.example/segment_01.ts',
    '../OTHERX-abcdefghijklmnopqr/segment_01.ts', '/live/OTHERX-abcdefghijklmnopqr/segment_01.ts',
    'https://user:password@edge.example.test/live/JNTUBY-abcdefghijklmnopqr/segment_01.ts',
    'segment_01.ts#fragment', 'segment_01.ts\\evil',
  ]) {
    for (const reference of [uri, `#EXT-X-MAP:URI="${uri}"`]) {
      const h = harness({objects: {[`${PREFIX}/index.m3u8`]: `#EXTM3U\n${reference}\n`}});
      assert.equal((await h.request('index.m3u8', h.token())).status, 502, uri);
    }
  }
});

test('OPTIONS is public, invalid configuration fails closed, and transformed manifests ignore Range', async () => {
  const h = harness();
  assert.equal((await h.request('index.m3u8', undefined, {method: 'OPTIONS'})).status, 204);
  assert.equal(h.calls.api.length, 0);
  for (const env of [{QSESSION_ADMISSION_SECRET: ''}, {QSESSION_ADMISSION_API: 'http://qsession.org/check'}, {QSESSION_ADMISSION_ROOM: 'invalid'}]) {
    assert.equal((await h.request('index.m3u8', h.token(), {}, {...h.env, ...env})).status, 503);
  }
  const manifest = await h.request('index.m3u8', h.token(), {headers: {Range: 'bytes=0-2'}});
  assert.equal(manifest.status, 200);
  assert.ok((await manifest.text()).startsWith('#EXTM3U'));
  assert.equal(manifest.headers.get('Content-Range'), null);
});

function brokenManifestCache(clock, source) {
  const cache = memoryCache(clock), match = cache.match.bind(cache);
  cache.match = async request => request.url.endsWith('/index.m3u8') ?
    new Response(source ? source() : new ReadableStream({start(controller) {
      controller.error(new Error('synthetic cached stream failure'));
    }})) : match(request);
  return cache;
}

test('a failed cached manifest read recovers once from its admitted storage key', async () => {
  const clock = {now: 1_800_000_000_000};
  const h = harness({clock, cache: brokenManifestCache(clock)});
  const response = await h.request('index.m3u8', h.token());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-QSession-Manifest-Recovery'), 'storage');
  assert.equal(response.headers.get('X-QSession-Edge-Cache'), 'MISS');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.ok((await response.text()).includes(`qsat=${h.token()}`));
  assert.deepEqual(h.calls.gets.map(call => call.key), [`${PREFIX}/index.m3u8`]);
  assert.equal(h.calls.api.length, 1);
});

test('invalid manifest references remain a definitive validation failure without storage retry', async () => {
  const clock = {now: 1_800_000_000_000};
  const cache = brokenManifestCache(clock, () => '#EXTM3U\nhttps://untrusted.example/segment.ts\n');
  const h = harness({clock, cache});
  const response = await h.request('index.m3u8', h.token());
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('X-QSession-Manifest-Failure'), 'reference');
  assert.equal(h.calls.gets.length, 0);
  assert.ok(!(await response.text()).includes('untrusted.example'));
});

test('persistent manifest read failure returns a safe transient status after one fresh read', async () => {
  const clock = {now: 1_800_000_000_000};
  const h = harness({clock, cache: brokenManifestCache(clock)});
  let reads = 0;
  h.env.QSESSION_LIVE.get = async () => { reads++; throw new Error('PRIVATE_STORAGE_DETAILS'); };
  const response = await h.request('index.m3u8', h.token());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-QSession-Manifest-Failure'), 'read');
  assert.equal(reads, 1);
  assert.ok(!(await response.text()).includes('PRIVATE_STORAGE_DETAILS'));
});

test('manifest recovery rejects oversized and incomplete objects without publishing their bytes', async () => {
  for (const mode of ['oversized', 'incomplete']) {
    const clock = {now: 1_800_000_000_000};
    const h = harness({clock, cache: brokenManifestCache(clock)});
    let reads = 0;
    h.env.QSESSION_LIVE.get = async () => { reads++; return {
      size: mode === 'oversized' ? 65537 : 100, body: new Uint8Array([71]),
    }; };
    const response = await h.request('index.m3u8', h.token());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-QSession-Manifest-Failure'), 'read');
    assert.equal(reads, 1);
  }
});

test('a token expiring during a fresh manifest read cannot receive the recovered playlist', async () => {
  const clock = {now: 1_800_000_000_000};
  const h = harness({clock, cache: brokenManifestCache(clock)});
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const original = h.env.QSESSION_LIVE.get;
  h.env.QSESSION_LIVE.get = async key => { entered(); await gate; return original(key); };
  const pending = h.request('index.m3u8', h.token({exp: Math.floor(clock.now / 1000) + 2}));
  await started; clock.now += 2100; release();
  const response = await pending;
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes('#EXTM3U'));
});


test('a valid token plays while Redis is down and an expired token never reaches storage', async () => {
  const h = harness({backend: 'token', api: async () => { throw new Error('redis down'); }});
  const token = h.token();
  const played = await h.request('segment_01.ts', token);
  assert.equal(played.status, 200);
  assert.equal(await played.text(), '0123456789');
  assert.equal(played.headers.get('X-QSession-Admission-Phase'), 'token');
  assert.equal(h.calls.api.length, 0);
  assert.equal(h.calls.gets.length, 1);
  const expired = h.token({exp: Math.floor(h.clock.now / 1000)});
  assert.equal((await h.request('segment_01.ts', expired)).status, 403);
  const forged = `${token}x`;
  assert.equal((await h.request('segment_01.ts', forged)).status, 403);
  assert.equal(h.calls.gets.length, 1);
  assert.equal(h.calls.api.length, 0);
});

test('a rejected cache write still delivers the verified segment from one read', async () => {
  const h = harness({backend: 'token', cache: {
    async match() { return undefined; },
    async put(_request, response) { await response.arrayBuffer(); throw new Error('cache rejected'); },
  }});
  const response = await h.request('segment_01.ts', h.token());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '0123456789');
  assert.equal(response.headers.get('X-QSession-Cache-Fill-State'), 'verified');
  assert.equal(h.calls.gets.length, 1);
  assert.equal(h.calls.api.length, 0);
});

test('fixed admission table: full fingerprints, bounded collisions and unchanged absolute expiry', () => {
  const h = harness();
  const fingerprints = Array.from({length: 70}, (_, index) => new Uint32Array([12345, index + 1, 0, 0, 0, 0, 0, 0]));
  h.scope.fingerprints = fingerprints;
  const result = vm.runInContext(`(() => {
    const until = Date.now() + 20000;
    for (const fingerprint of fingerprints) rememberApproval(fingerprint, until);
    return {bytes: approvalHashes.byteLength + approvalExpirations.byteLength,
      hits: fingerprints.filter(fingerprint => memoryApproval(fingerprint) === until).length,
      unknown: memoryApproval(new Uint32Array([12345, 99999, 0, 0, 0, 0, 0, 0])),
      evictions: admissionStats.evicted};
  })()`, h.scope);
  assert.equal(vm.runInContext('AUTH_APPROVAL_SLOTS', h.scope), 65536);
  assert.equal(result.bytes, 2621440);
  assert.equal(result.hits, 64);
  assert.equal(result.unknown, 0, 'bucket collisions never approve another full fingerprint');
  assert.equal(result.evictions, 6);
  h.clock.now += 19999;
  assert.ok(vm.runInContext('memoryApproval(fingerprints[69])', h.scope) > h.clock.now);
  h.clock.now++;
  assert.equal(vm.runInContext('memoryApproval(fingerprints[69])', h.scope), 0, 'hits never renew the deadline');
  vm.runInContext('rememberApproval(fingerprints[0], Date.now() + 20001)', h.scope);
  assert.equal(vm.runInContext('memoryApproval(fingerprints[0])', h.scope), 0, 'longer cache approvals are not retained');
});
