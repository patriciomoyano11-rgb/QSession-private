const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../edge/hls-worker.js'), 'utf8');
const PREFIX = 'live/PRB10A-abcdefghijklmnopqr';
function harness(options = {}) {
  const clock = {now: Date.now()};
  class ClockDate extends Date { static now() { return clock.now; } }
  const calls = [], objects = new Map(), logs = [];
  const scope = vm.createContext({Request, Response, Headers, URL, TextEncoder, TextDecoder,
    Uint8Array, Blob, ReadableStream, AbortController, setTimeout: options.setTimeout || setTimeout, clearTimeout, crypto: crypto.webcrypto,
    Date: ClockDate, atob, console: {warn: (...args) => logs.push(args.join(' '))}});
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {')
    .replace('export class QSessionSegmentCache', 'globalThis.CacheClass = class QSessionSegmentCache'), scope);
  const env = {QSESSION_LIVE: {async get(key) {
    calls.push(key); await new Promise(resolve => setTimeout(resolve, 2));
    const bytes = objects.get(key); if (!bytes) return null;
    return {size: bytes.length, body: new Response(bytes).body, httpEtag: '"fixture"',
      writeHttpMetadata(headers) { headers.set('Content-Type', key.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'); },
      async arrayBuffer() { return bytes; }};
  }, async head(key) {
    const bytes = objects.get(key); if (!bytes) return null;
    return {size: bytes.length, httpEtag: '"fixture"', writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp2t'); }};
  }}};
  const cache = new scope.CacheClass({waitUntil() {}}, env);
  const request = (file, init) => cache.fetch(new Request(`https://qsession-private-cache.invalid/${PREFIX}/${file}`, init));
  return {scope, env, cache, objects, calls, clock, request, logs};
}

function outerFixture(h, fetch) {
  Object.assign(h.env, {QSESSION_SHARED_CACHE_ROOM: 'PRB10A', QSESSION_ADMISSION_ROOM: 'PRB10A',
    QSESSION_ADMISSION_SECRET: 'unit-test-secret-of-at-least-32-bytes',
    QSESSION_ADMISSION_API: 'https://app.example.test/check',
    QSESSION_SEGMENT_CACHE: {idFromName: name => name, get: () => ({fetch})}});
  h.scope.fetch = async () => Response.json({ok: true, cacheSeconds: 20});
  const payload = Buffer.from(JSON.stringify({v: 1, aud: 'qsession-hls', code: 'PRB10A', prefix: PREFIX,
    lease: 'abcdefghijklmnopqrstuv', exp: Math.floor(h.clock.now / 1000) + 300})).toString('base64url');
  const token = `v1.${payload}.${crypto.createHmac('sha256', h.env.QSESSION_ADMISSION_SECRET).update(`v1.${payload}`).digest('base64url')}`;
  return () => h.scope.worker.fetch(new Request(`https://live.example.test/${PREFIX}/segment_failure.ts?qsat=${token}`),
    h.env, {waitUntil() {}});
}

test('storage failure stages are distinguishable and exception text never reaches logs or responses', async () => {
  const secret = 'private-key-and-qsat=must-never-be-logged';
  const cases = [
    ['storage-read', async () => { throw new Error(secret); }],
    ['storage-body-read', async () => ({size: 4, async arrayBuffer() { throw new Error(secret); }})],
    ['storage-size', async () => ({size: 9 * 1024 * 1024})],
    ['storage-incomplete', async () => ({size: 4, async arrayBuffer() { return new Uint8Array(2); }})],
  ];
  for (const [code, get] of cases) {
    const h = harness(); h.env.QSESSION_LIVE.get = get;
    const response = await h.request('segment_failure.ts');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-QSession-Media-Failure'), code);
    assert.equal(await response.text(), '');
    assert.equal(h.logs.length, 1); assert.match(h.logs[0], new RegExp(code));
    assert.equal(h.logs.join('').includes(secret), false);
    assert.equal(h.logs.join('').includes(PREFIX), false);
  }
});

test('object and shared read queue limits retain their bounds and report distinct reasons', async () => {
  const h = harness();
  for (let i = 0; i < 32; i++) h.cache.pending.set('occupied-' + i, Promise.resolve(null));
  const objectQueue = await h.request('segment_queue.ts');
  assert.equal(objectQueue.status, 503); assert.equal(objectQueue.headers.get('X-QSession-Media-Failure'), 'object-queue');
  assert.equal(h.calls.length, 0);
  const r = harness();
  vm.runInContext('sharedReads = 4; for (let i=0;i<256;i++) sharedReadQueue.push(() => {});', r.scope);
  const readQueue = await r.request('segment_queue.ts');
  assert.equal(readQueue.status, 503); assert.equal(readQueue.headers.get('X-QSession-Media-Failure'), 'read-queue');
  assert.equal(r.calls.length, 0);
});

test('outer failures report overload without extra retries, logging a constant code at most once per 30 seconds', async () => {
  const h = harness(); let requests = 0;
  const get = outerFixture(h, async () => { requests++; throw Object.assign(new Error('sensitive provider details'), {overloaded: true}); });
  for (let i = 0; i < 2; i++) {
    const response = await get();
    assert.equal(response.status, 503); assert.equal(response.headers.get('X-QSession-Media-Failure'), 'shared-overloaded');
    assert.equal(await response.text(), 'Caché compartida no disponible');
  }
  assert.equal(requests, 2); assert.equal(h.logs.length, 1);
  h.clock.now += 30001; await get(); assert.equal(h.logs.length, 2);
  assert.equal(h.logs.join('').includes('sensitive'), false);
  assert.equal(h.logs.join('').includes('qsat'), false);
});

test('only allowlisted private failure headers pass through the outer boundary', async () => {
  for (const [sent, expected] of [['storage-body-read', 'storage-body-read'], ['token=secret', 'shared-response']]) {
    const h = harness();
    const get = outerFixture(h, async () => new Response(null, {status: 503, headers: {'X-QSession-Media-Failure': sent}}));
    const response = await get();
    assert.equal(response.status, 503); assert.equal(response.headers.get('X-QSession-Media-Failure'), expected);
    assert.equal(h.logs.join('').includes('secret'), false);
  }
});

test('edge fill rejection still delivers the verified body and hides provider details', async () => {
  const h = harness(); let requests = 0;
  const get = outerFixture(h, async () => { requests++; return new Response('complete', {headers: {'Content-Length': '8'}}); });
  h.scope.caches = {default: {async match() {}, async put() { throw new Error('private storage details'); }}};
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'complete');
  assert.equal(requests, 1);
  assert.equal(response.headers.get('X-QSession-Cache-Fill-State'), 'verified');
  assert.equal(String(response.headers.get('X-QSession-Media-Failure') || ''), '');
  assert.equal(h.logs.join('').includes('private storage'), false);
});

test('late actor stream rejection is recorded without buffering or exposing the exception', async () => {
  for (const name of ['Error', 'AbortError']) {
    const h = harness(), waits = [];
    h.scope.FixedLengthStream = class {
      constructor() {
        this.writable = new WritableStream({write() { throw Object.assign(new Error('private stream details'), {name}); }});
        this.readable = new ReadableStream({start(controller) { controller.close(); }});
      }
    };
    h.objects.set(`${PREFIX}/segment_stream.ts`, new Uint8Array(20));
    const actor = new h.scope.CacheClass({waitUntil: value => waits.push(value)}, h.env);
    const response = await actor.fetch(new Request(`https://qsession-private-cache.invalid/${PREFIX}/segment_stream.ts`));
    assert.equal(response.status, 200); await Promise.all(waits);
    assert.match(h.logs.join(''), new RegExp(name === 'AbortError' ? 'stream-cancelled' : 'shared-stream'));
    assert.equal(h.logs.join('').includes('private stream'), false);
  }
});

test('64 admitted concurrent reads share one storage read and all retain identical bytes', async () => {
  const h = harness(), bytes = new Uint8Array(130000).fill(71);
  h.objects.set(`${PREFIX}/segment_1.ts`, bytes);
  const results = await Promise.all(Array.from({length: 64}, async () => {
    const response = await h.request('segment_1.ts');
    assert.equal(response.status, 200); return new Uint8Array(await response.arrayBuffer());
  }));
  assert.equal(h.calls.length, 1);
  for (const value of results) assert.deepEqual(value, bytes);
  assert.equal((await h.request('segment_1.ts', {method: 'HEAD'})).headers.get('Content-Length'), '130000');
});

test('300 large responses stream concurrently and tolerate cancellation without retaining extra entries', async () => {
  const h = harness(), bytes = new Uint8Array(1500000).fill(73);
  h.objects.set(`${PREFIX}/segment_many.ts`, bytes);
  await Promise.all(Array.from({length: 300}, async (_, index) => {
    const response = await h.request('segment_many.ts');
    const reader = response.body.getReader();
    let count = 0;
    while (true) {
      const item = await reader.read(); if (item.done) break;
      assert.ok(item.value.length <= 8192); count += item.value.length;
      if (index % 3 === 0) { await reader.cancel(); return; }
    }
    assert.equal(count, bytes.length);
  }));
  assert.equal(h.calls.length, 1);
  assert.equal(vm.runInContext('sharedBytesUsed', h.scope), bytes.length);
  assert.equal(vm.runInContext('sharedReads', h.scope), 0);
});

test('native ranges, suffixes, HEAD, and invalid ranges preserve full size', async () => {
  const h = harness(); h.objects.set(`${PREFIX}/segment_2.ts`, new TextEncoder().encode('0123456789'));
  for (const [range, expected] of [['bytes=2-5', '2345'], ['bytes=-3', '789']]) {
    const response = await h.request('segment_2.ts', {headers: {Range: range}});
    assert.equal(response.status, 206); assert.equal(await response.text(), expected);
    assert.match(response.headers.get('Content-Range'), /\/10$/);
  }
  const invalid = await h.request('segment_2.ts', {headers: {Range: 'bytes=11-12'}});
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('Content-Range'), 'bytes */10');
  assert.equal(await (await h.request('segment_2.ts', {method: 'HEAD'})).text(), '');
});

test('future objects and failed reads are not negative cached; manifests expire promptly', async () => {
  const h = harness(); assert.equal((await h.request('segment_new.ts')).status, 404);
  h.objects.set(`${PREFIX}/segment_new.ts`, new Uint8Array([1, 2]));
  assert.equal((await h.request('segment_new.ts')).status, 200);
  h.objects.set(`${PREFIX}/index.m3u8`, new TextEncoder().encode('#EXTM3U\nfirst'));
  assert.match(await (await h.request('index.m3u8')).text(), /first/);
  h.objects.set(`${PREFIX}/index.m3u8`, new TextEncoder().encode('#EXTM3U\nsecond'));
  h.clock.now += 751;
  assert.match(await (await h.request('index.m3u8')).text(), /second/);
  h.env.QSESSION_LIVE.get = async () => ({size: 4, async arrayBuffer() { return new Uint8Array(2); }});
  assert.equal((await h.request('segment_bad.ts')).status, 503);
  assert.equal((await h.request('segment_bad.ts')).status, 503);
});

test('bounded LRU evicts older segment bytes and rejects oversized objects before buffering', async () => {
  const h = harness();
  for (let i = 0; i < 6; i++) {
    h.objects.set(`${PREFIX}/segment_${i}.ts`, new Uint8Array(5 * 1024 * 1024));
    const response = await h.request(`segment_${i}.ts`); await response.body.cancel();
  }
  assert.equal(vm.runInContext('sharedBytesUsed <= SHARED_BYTES_LIMIT', h.scope), true);
  await h.request('segment_0.ts', {method: 'HEAD'});
  assert.equal(h.calls.length, 7);
  let consumed = false;
  h.env.QSESSION_LIVE.get = async () => ({size: 9 * 1024 * 1024, async arrayBuffer() { consumed = true; }});
  assert.equal((await h.request('segment_large.ts')).status, 503); assert.equal(consumed, false);
});

test('private object rejects query tokens, public hosts and arbitrary paths before storage', async () => {
  const h = harness();
  for (const url of [`https://public.test/${PREFIX}/segment_1.ts`,
    `https://qsession-private-cache.invalid/${PREFIX}/segment_1.ts?qsat=secret`,
    'https://qsession-private-cache.invalid/private/object']) {
    assert.equal((await h.cache.fetch(new Request(url))).status, 404);
  }
  assert.equal(h.calls.length, 0);
});

test('outer admission fails closed before private cache; only object key and Range reach the stub', async () => {
  const h = harness(); const seen = [];
  h.env.QSESSION_SHARED_CACHE_ROOM = 'PRB10A'; h.env.QSESSION_ADMISSION_ROOM = 'PRB10A';
  h.env.QSESSION_ADMISSION_SECRET = 'unit-test-secret-of-at-least-32-bytes';
  h.env.QSESSION_ADMISSION_API = 'https://app.example.test/check';
  h.env.QSESSION_SEGMENT_CACHE = {idFromName(name) { return name; }, get() { return {fetch: async request => {
    seen.push(request); return new Response('audio');
  }}; }};
  const context = {waitUntil() {}};
  const url = `https://live.example.test/${PREFIX}/segment_1.ts`;
  assert.equal((await h.scope.worker.fetch(new Request(url), h.env, context)).status, 403);
  assert.equal(seen.length, 0);
  h.scope.fetch = async () => Response.json({ok: true, cacheSeconds: 20});
  const body = Buffer.from(JSON.stringify({v: 1, aud: 'qsession-hls', code: 'PRB10A', prefix: PREFIX,
    lease: 'abcdefghijklmnopqrstuv', exp: Math.floor(h.clock.now / 1000) + 60})).toString('base64url');
  const token = `v1.${body}.${crypto.createHmac('sha256', h.env.QSESSION_ADMISSION_SECRET).update(`v1.${body}`).digest('base64url')}`;
  const response = await h.scope.worker.fetch(new Request(`${url}?qsat=${token}`, {headers: {Range: 'bytes=0-3', Cookie: 'private'}}), h.env, context);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'audio');
  assert.equal(seen.length, 1); assert.equal(new URL(seen[0].url).search, '');
  assert.deepEqual([...seen[0].headers], [['range', 'bytes=0-3']]);
  h.clock.now += 61000;
  assert.equal((await h.scope.worker.fetch(new Request(`${url}?qsat=${token}`), h.env, context)).status, 403);
  assert.equal(seen.length, 1);
});

test('shared actor fills one canonical edge object; warm clients and native ranges stay authorized', async () => {
  const h = harness(), saved = new Map(), waits = [], stubRequests = [];
  const bytes = new Uint8Array(131600).fill(71);
  h.objects.set(`${PREFIX}/segment_edge.ts`, bytes);
  h.scope.caches = {default: {
    async put(key, response) { saved.set(key.url, new Response(await response.arrayBuffer(), {status: response.status, headers: response.headers})); },
    async match(key) {
      const response = saved.get(key.url); if (!response) return undefined;
      const range = key.headers.get('Range');
      if (!range) return response.clone();
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      const full = new Uint8Array(await response.clone().arrayBuffer());
      const first = Number(match[1]), last = Number(match[2]);
      const headers = new Headers(response.headers);
      headers.set('Content-Length', String(last - first + 1));
      headers.set('Content-Range', `bytes ${first}-${last}/${full.length}`);
      return new Response(full.slice(first, last + 1), {status: 206, headers});
    },
  }};
  Object.assign(h.env, {QSESSION_SHARED_CACHE_ROOM: 'PRB10A', QSESSION_ADMISSION_ROOM: 'PRB10A',
    QSESSION_ADMISSION_SECRET: 'unit-test-secret-of-at-least-32-bytes', QSESSION_ADMISSION_API: 'https://app.example.test/check',
    QSESSION_SEGMENT_CACHE: {idFromName(name) { return name; }, get() { return {fetch(request) { stubRequests.push(request); return h.cache.fetch(request); }}; }},
  });
  h.scope.fetch = async () => Response.json({ok: true, cacheSeconds: 20});
  const context = {waitUntil(promise) { waits.push(promise); }};
  function token(lease) {
    const payload = Buffer.from(JSON.stringify({v: 1, aud: 'qsession-hls', code: 'PRB10A', prefix: PREFIX,
      lease, exp: Math.floor(h.clock.now / 1000) + 60})).toString('base64url');
    return `v1.${payload}.${crypto.createHmac('sha256', h.env.QSESSION_ADMISSION_SECRET).update(`v1.${payload}`).digest('base64url')}`;
  }
  const base = `https://live.example.test/${PREFIX}/segment_edge.ts`;
  const firstToken = token('abcdefghijklmnopqrstuv');
  const secondToken = token('zyxwvutsrqponmlkjihgfe');
  const cold = await Promise.all(Array.from({length: 32}, () => h.scope.worker.fetch(new Request(`${base}?qsat=${firstToken}`), h.env, context)));
  for (const response of cold) {
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal(stubRequests.length, 1);
  assert.equal(stubRequests[0].headers.has('Range'), false);
  assert.equal(new URL(stubRequests[0].url).search, '');
  const ranged = await h.scope.worker.fetch(new Request(`${base}?qsat=${secondToken}`, {headers: {Range: 'bytes=3-9'}}), h.env, context);
  assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 7);
  assert.equal(ranged.headers.get('X-QSession-Cache-Fill'), 'shared-edge');
  assert.equal(stubRequests.length, 1);
  assert.equal((await h.scope.worker.fetch(new Request(base), h.env, context)).status, 403);
  h.clock.now += 61000;
  assert.equal((await h.scope.worker.fetch(new Request(`${base}?qsat=${firstToken}`), h.env, context)).status, 403);
  assert.equal(stubRequests.length, 1);
  assert.ok(saved.has(base)); assert.equal([...saved.keys()].some(key => key.includes('qsat=')), false);
  await Promise.all(waits);
});

function edgeCache(h) {
  const saved = new Map(), puts = [], matches = [];
  return {saved, puts, matches,
    async put(key, response) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const seconds = Number(/s-maxage=(\d+)/.exec(response.headers.get('Cache-Control'))?.[1] ||
        /max-age=(\d+)/.exec(response.headers.get('Cache-Control'))?.[1] || 0);
      saved.set(key.url, {bytes, status: response.status, headers: new Headers(response.headers), until: h.clock.now + seconds * 1000});
      puts.push(key.url);
    },
    async match(key) {
      matches.push(key.url);
      const item = saved.get(key.url); if (!item || item.until <= h.clock.now) return undefined;
      const range = /^bytes=(\d+)-(\d+)$/.exec(key.headers.get('Range') || '');
      const headers = new Headers(item.headers);
      if (!range) return new Response(item.bytes, {status: item.status, headers});
      const start = Number(range[1]), end = Number(range[2]);
      headers.set('Content-Range', `bytes ${start}-${end}/${item.bytes.length}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(item.bytes.subarray(start, end + 1), {status: 206, headers});
    },
  };
}

function canaryFixture(h) {
  const waits = [], stubCalls = [], cache = edgeCache(h);
  Object.assign(h.env, {QSESSION_R2_EDGE_CACHE_ROOM: 'PRB10A', QSESSION_SHARED_CACHE_ROOM: 'PRB10A',
    QSESSION_ADMISSION_ROOM: 'PRB10A', QSESSION_ADMISSION_SECRET: 'unit-test-secret-of-at-least-32-bytes',
    QSESSION_ADMISSION_API: 'https://app.example.test/check', QSESSION_SEGMENT_CACHE: {
      idFromName() { stubCalls.push('id'); throw new Error('actor must not be reached in the canary'); },
    }});
  h.scope.caches = {default: cache};
  h.scope.fetch = async () => Response.json({ok: true, cacheSeconds: 20});
  const context = {waitUntil(value) { waits.push(value); }};
  function token(overrides = {}) {
    const payload = Buffer.from(JSON.stringify({v: 1, aud: 'qsession-hls', code: 'PRB10A', prefix: PREFIX,
      lease: 'abcdefghijklmnopqrstuv', exp: Math.floor(h.clock.now / 1000) + 60, ...overrides})).toString('base64url');
    return `v1.${payload}.${crypto.createHmac('sha256', h.env.QSESSION_ADMISSION_SECRET).update(`v1.${payload}`).digest('base64url')}`;
  }
  function request(file = 'segment_canary.ts', bearer = token(), init = {}) {
    const url = new URL(`https://live.example.test/${PREFIX}/${file}`);
    if (bearer !== null) url.searchParams.set('qsat', bearer);
    return h.scope.worker.fetch(new Request(url, init), h.env, context);
  }
  return {cache, stubCalls, waits, token, request, context};
}

async function until(check) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('local fixture did not reach its expected checkpoint');
}

test('a cached miss overload preserves its cause for all waiters and calls the actor once', async () => {
  const h = harness(), cache = edgeCache(h); let requests = 0;
  const get = outerFixture(h, async () => { requests++; throw Object.assign(new Error('private'), {overloaded: true}); });
  h.scope.caches = {default: cache};
  const responses = await Promise.all(Array.from({length: 64}, () => get()));
  for (const response of responses) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-QSession-Media-Failure'), 'shared-overloaded');
    assert.equal(response.headers.get('X-QSession-Cache-Fill-State'), 'failed');
  }
  assert.equal(requests, 1);
  assert.equal((await get()).status, 503); assert.equal(requests, 1, 'brief failure backoff prevents immediate re-entry');
  h.clock.now += 1001; await get(); assert.equal(requests, 2);
});

test('a timed-out fill never fans out to the same actor, including later arrivals while upstream is stuck', async () => {
  const h = harness({setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 ? 30 : ms)}), cache = edgeCache(h);
  let requests = 0, release, cancelled = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const get = outerFixture(h, async () => {
    requests++; await gate;
    return new Response(new ReadableStream({cancel() { cancelled++; }}, {highWaterMark: 0}), {headers: {'Content-Length': '8'}});
  });
  h.scope.caches = {default: cache};
  assert.equal(vm.runInContext('CACHE_FILL_WAITERS_PER_KEY', h.scope), 192);
  assert.equal(vm.runInContext('CACHE_FILL_TOTAL_WAITERS', h.scope), 384);
  // 32 arrivals past the per-key cap must still fail closed as pending.
  const overflow = vm.runInContext('CACHE_FILL_WAITERS_PER_KEY + 32', h.scope);
  const responses = await Promise.all(Array.from({length: overflow}, () => get()));
  for (const response of responses) {
    assert.equal(response.status, 503);
    assert.ok(['pending', 'timed-out'].includes(response.headers.get('X-QSession-Cache-Fill-State')));
  }
  assert.ok(responses.some(response => response.headers.get('X-QSession-Cache-Fill-State') === 'pending'));
  assert.equal(requests, 1);
  assert.equal((await get()).headers.get('X-QSession-Cache-Fill-State'), 'timed-out');
  assert.equal(requests, 1);
  release(); await until(() => cancelled === 1);
  assert.equal(cache.puts.filter(key => key.includes('/live/')).length, 0);
});

test('R2 canary groups cold clients by key, serves hot bytes from edge, and never obtains an actor', async () => {
  const h = harness(), c = canaryFixture(h), bytes = new Uint8Array(130000).fill(71);
  h.objects.set(`${PREFIX}/segment_canary.ts`, bytes);
  const cold = await Promise.all(Array.from({length: 64}, (_, i) => c.request('segment_canary.ts', c.token({lease: String(i).padStart(22, '0')}))));
  for (const response of cold) {
    assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('X-QSession-Cache-Fill'), 'r2-edge');
    assert.equal(response.headers.get('X-QSession-Cache-Fill-State'), 'stored');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal(h.calls.length, 1);
  const hot = await Promise.all(Array.from({length: 64}, () => c.request()));
  for (const response of hot) {
    assert.equal(response.headers.get('X-QSession-Edge-Cache'), 'HIT');
    assert.equal((await response.arrayBuffer()).byteLength, bytes.length);
  }
  assert.equal(h.calls.length, 1); assert.equal(c.stubCalls.length, 0);
  assert.equal(c.cache.puts.filter(key => key.includes('/live/')).length, 1);
  assert.ok([...c.cache.saved.keys()].every(key => !key.includes('qsat=')));
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
  await Promise.all(c.waits);
});

test('R2 canary limits active streaming reads and its waiting queue across distinct cold keys', async () => {
  const h = harness(), c = canaryFixture(h); let release, reads = 0, peak = 0;
  const gate = new Promise(resolve => { release = resolve; });
  h.env.QSESSION_LIVE.get = async () => {
    reads++; peak = Math.max(peak, vm.runInContext('r2EdgeReads', h.scope));
    return {size: 4, httpEtag: '"fixture"', writeHttpMetadata() {}, body: new ReadableStream({async pull(controller) {
      await gate; controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close();
    }}, {highWaterMark: 0})};
  };
  let rejected = 0;
  const pending = Array.from({length: 32}, (_, i) => c.request(`segment_${i}.ts`).then(response => {
    if (response.status === 503) rejected++;
    return response;
  }));
  await until(() => rejected === 12 && reads === 4 && vm.runInContext('r2EdgeReadQueue.length', h.scope) === 16);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 4);
  release();
  const responses = await Promise.all(pending), successful = responses.filter(response => response.status === 200);
  assert.equal(successful.length, 20); assert.equal(reads, 20); assert.equal(peak, 4);
  for (const response of responses) {
    if (response.status === 200) assert.equal((await response.arrayBuffer()).byteLength, 4);
    else {
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('X-QSession-Media-Failure'), 'edge-read-queue');
    }
  }
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
  assert.equal(vm.runInContext('r2EdgeReadQueue.length', h.scope), 0);
});

test('R2 cache rejection still delivers verified bytes with one shared origin read', async () => {
  const h = harness(), c = canaryFixture(h), bytes = new Uint8Array(131600).fill(79);
  h.objects.set(`${PREFIX}/segment_canary.ts`, bytes);
  const original = c.cache.put;
  c.cache.put = async (key, response) => {
    if (key.url.includes('/live/')) throw new Error('private cache details');
    return original(key, response);
  };
  const responses = await Promise.all(Array.from({length: 32}, () => c.request()));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  await Promise.all(c.waits);
  assert.equal(h.calls.length, 1);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0); assert.equal(c.stubCalls.length, 0);
  assert.equal(h.logs.join('').includes('private cache details'), false);
});

test('R2 source body timeout cancels its reader and late arrivals reuse the timeout instead of retrying', async () => {
  const h = harness({setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 ? 30 : ms)}), c = canaryFixture(h);
  let reads = 0, cancelled = 0;
  h.env.QSESSION_LIVE.get = async () => ({size: 4, httpEtag: '"fixture"', writeHttpMetadata() {},
    body: (++reads, new ReadableStream({cancel() { cancelled++; }}, {highWaterMark: 0}))});
  const responses = await Promise.all(Array.from({length: 64}, () => c.request()));
  for (const response of responses) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-QSession-Cache-Fill-State'), 'timed-out');
    assert.equal(response.headers.get('X-QSession-Media-Failure'), 'edge-fill-timeout');
  }
  assert.equal(reads, 1); assert.equal(cancelled, 1);
  assert.equal((await c.request()).headers.get('X-QSession-Cache-Fill-State'), 'timed-out');
  assert.equal(reads, 1);
  await Promise.all(c.waits);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
  assert.equal([...c.cache.saved.keys()].some(key => key.includes('/live/')), false);
});

test('uncancellable R2 header reads keep their slots and expired queued reads never reach storage later', async () => {
  const h = harness({setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 ? 80 : ms)}), c = canaryFixture(h);
  let reads = 0, release, cancelled = 0;
  const gate = new Promise(resolve => { release = resolve; });
  h.env.QSESSION_LIVE.get = async () => {
    reads++; await gate;
    return {size: 4, httpEtag: '"fixture"', writeHttpMetadata() {},
      body: new ReadableStream({cancel() { cancelled++; }}, {highWaterMark: 0})};
  };
  const responses = await Promise.all(Array.from({length: 20}, (_, i) => c.request(`segment_${i}.ts`)));
  assert.ok(responses.every(response => response.status === 503));
  assert.ok(responses.every(response => response.headers.get('X-QSession-Cache-Fill-State') === 'timed-out'));
  assert.equal(reads, 4); assert.equal(vm.runInContext('r2EdgeReads', h.scope), 4);
  assert.equal(vm.runInContext('r2EdgeReadQueue.length', h.scope), 0);
  assert.equal((await c.request('segment_0.ts')).status, 503); assert.equal(reads, 4);
  release(); await Promise.all(c.waits);
  assert.equal(cancelled, 4); assert.equal(reads, 4);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
  assert.equal(c.cache.puts.filter(key => key.includes('/live/')).length, 0);
});

test('R2 read and body failures cannot publish partial objects and release source readers', async () => {
  for (const mode of ['read', 'oversized', 'short', 'long', 'body']) {
    const h = harness(), c = canaryFixture(h); let source, cancelled = 0;
    h.env.QSESSION_LIVE.get = async () => {
      if (mode === 'read') throw new Error('private storage details');
      source = new ReadableStream({start(controller) {
        if (mode === 'body') controller.error(new Error('private body details'));
        else if (mode !== 'oversized') { controller.enqueue(new Uint8Array(mode === 'short' ? 2 : 5)); controller.close(); }
      }, cancel() { cancelled++; }}, {highWaterMark: 0});
      return {size: mode === 'oversized' ? 9 * 1024 * 1024 : 4, body: source, httpEtag: '"fixture"', writeHttpMetadata() {}};
    };
    const response = await c.request();
    assert.equal(response.status, 503, mode);
    assert.equal(response.headers.get('X-QSession-Media-Failure'), mode === 'read' ? 'storage-read' :
      mode === 'oversized' ? 'storage-size' : mode === 'body' ? 'storage-body-read' : 'storage-incomplete');
    assert.equal([...c.cache.saved.keys()].some(key => key.includes('/live/')), false);
    assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
    if (source) assert.equal(source.locked, false, mode);
    if (mode === 'oversized') assert.equal(cancelled, 1);
    assert.equal(h.logs.join('').includes('private'), false);
  }
});

test('R2 missing objects stay 404 while silently discarded cache writes share verified bytes', async () => {
  const h = harness(), c = canaryFixture(h);
  const missing = await c.request(); assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('X-QSession-Cache-Fill-State'), 'missing');
  h.objects.set(`${PREFIX}/segment_canary.ts`, new Uint8Array([1, 2]));
  assert.equal((await c.request()).status, 200); assert.equal(h.calls.length, 2);
  const other = harness(), d = canaryFixture(other), original = d.cache.put;
  other.objects.set(`${PREFIX}/segment_canary.ts`, new Uint8Array([1, 2]));
  d.cache.put = async (key, response) => key.url.includes('/live/') ? response.arrayBuffer().then(() => {}) : original(key, response);
  const response = await d.request(); assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2]));
  const secondWave = await Promise.all(Array.from({length: 32}, () => d.request()));
  for (const value of secondWave) {
    assert.equal(value.status, 200);
    assert.deepEqual(new Uint8Array(await value.arrayBuffer()), new Uint8Array([1, 2]));
  }
  await Promise.all(d.waits);
  assert.equal(other.calls.length, 1); assert.equal(d.stubCalls.length, 0);
});

test('an unsupported cached Range recovers exact bytes without origin reads per listener', async () => {
  const h = harness(), c = canaryFixture(h);
  h.objects.set(`${PREFIX}/segment_canary.ts`, new TextEncoder().encode('0123456789'));
  const match = c.cache.match;
  c.cache.match = async key => key.headers.has('Range') ? undefined : match(key);
  for (let i = 0; i < 2; i++) {
    const response = await c.request(undefined, c.token(), {headers: {Range: 'bytes=2-5'}});
    assert.equal(response.status, 206);
    assert.equal(await response.text(), '2345');
    assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
  }
  assert.equal(h.calls.length, 1); assert.equal(c.stubCalls.length, 0);
});

test('cache read exceptions and corrupt cached bodies recover once without exposing private errors', async () => {
  for (const mode of ['read-error', 'broken-body', 'short-body']) {
    const h = harness(), c = canaryFixture(h), bytes = new Uint8Array(131600).fill(83);
    h.objects.set(`${PREFIX}/segment_canary.ts`, bytes);
    const original = c.cache.match;
    c.cache.match = async key => {
      if (!key.url.includes('/live/')) return original(key);
      if (mode === 'read-error') throw new Error('private cache token=secret');
      return new Response(mode === 'short-body' ? new Uint8Array(3) : new ReadableStream({
        start(controller) { controller.error(new Error('private cached stream')); },
      }), {headers: {'Content-Length': String(bytes.length)}});
    };
    const responses = await Promise.all(Array.from({length: 32}, () => c.request()));
    for (const response of responses) {
      assert.equal(response.status, 200, mode);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
      assert.equal(response.headers.get('X-QSession-Cache-Recovery'), 'verified-body');
    }
    await Promise.all(c.waits);
    assert.equal(h.calls.length, 1, mode);
    assert.equal(h.logs.join('').includes('private'), false);
    assert.equal(c.stubCalls.length, 0);
  }
});

test('an unavailable Cache API and one cancelled listener cannot interrupt other verified deliveries', async () => {
  const h = harness(), c = canaryFixture(h), bytes = new Uint8Array(1500000).fill(89);
  h.objects.set(`${PREFIX}/segment_canary.ts`, bytes);
  h.scope.caches = {};
  const responses = await Promise.all(Array.from({length: 64}, () => c.request()));
  await Promise.all(responses.map(async (response, index) => {
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let received = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      assert.ok(item.value.byteLength <= 65536);
      received += item.value.byteLength;
      if (index % 4 === 0) { await reader.cancel(); return; }
    }
    assert.equal(received, bytes.length);
  }));
  await Promise.all(c.waits);
  assert.equal(h.calls.length, 1);
  assert.equal(vm.runInContext('r2EdgeBodyReaders', h.scope), 0);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
});

test('expired bodies stay budgeted while a slow listener still owns them', async () => {
  const h = harness(), c = canaryFixture(h), bytes = new Uint8Array(4 * 1024 * 1024).fill(97);
  h.scope.caches = {};
  h.objects.set(`${PREFIX}/segment_canary.ts`, bytes);
  h.objects.set(`${PREFIX}/segment_next.ts`, bytes);
  const slow = await c.request();
  assert.equal(slow.status, 200);
  h.clock.now += 13001;
  const next = await c.request('segment_next.ts');
  assert.equal(next.status, 200);
  assert.equal(vm.runInContext('r2EdgeBodyBytes', h.scope), bytes.length * 2);
  const reader = slow.body.getReader();
  assert.equal((await reader.read()).value.byteLength, 65536);
  await reader.cancel();
  assert.equal(vm.runInContext('r2EdgeBodyBytes', h.scope), bytes.length);
  assert.equal((await next.arrayBuffer()).byteLength, bytes.length);
  h.clock.now += 13001;
  await c.request('segment_next.ts', c.token(), {method: 'HEAD'});
  assert.equal(vm.runInContext('r2EdgeBodyBytes', h.scope), 0);
});

test('body construction pressure is bounded and cannot retry the origin for every waiter', async () => {
  const h = harness(), c = canaryFixture(h), bytes = new Uint8Array(8 * 1024 * 1024).fill(101);
  h.scope.caches = {};
  for (const file of ['segment_canary.ts', 'segment_second.ts', 'segment_third.ts']) h.objects.set(`${PREFIX}/${file}`, bytes);
  const held = [await c.request(), await c.request('segment_second.ts')];
  assert.ok(held.every(response => response.status === 200));
  const rejected = await Promise.all(Array.from({length: 32}, () => c.request('segment_third.ts')));
  assert.ok(rejected.every(response => response.status === 503 &&
    response.headers.get('X-QSession-Media-Failure') === 'edge-body-budget'));
  assert.equal(h.calls.length, 3);
  assert.equal((await c.request('segment_third.ts')).status, 503);
  assert.equal(h.calls.length, 3);
  assert.ok(vm.runInContext('r2EdgeBodyBytes <= R2_EDGE_BODY_BYTES_LIMIT', h.scope));
  await Promise.all(held.map(response => response.body.cancel()));
  assert.equal(vm.runInContext('r2EdgeBodyReaders', h.scope), 0);
});

test('hot body readers have a separate bound and release it on cancellation', async () => {
  const h = harness(), c = canaryFixture(h);
  h.objects.set(`${PREFIX}/segment_canary.ts`, new Uint8Array(2048).fill(103));
  assert.equal((await (await c.request()).arrayBuffer()).byteLength, 2048);
  await Promise.all(c.waits);
  const limit = vm.runInContext('R2_EDGE_BODY_READER_LIMIT', h.scope);
  const responses = await Promise.all(Array.from({length: limit + 1}, () => c.request()));
  const accepted = responses.filter(response => response.status === 200);
  assert.equal(accepted.length, limit);
  assert.equal(responses.filter(response => response.headers.get('X-QSession-Media-Failure') === 'edge-body-readers').length, 1);
  assert.equal(vm.runInContext('r2EdgeBodyReaders', h.scope), limit);
  await Promise.all(accepted.map(response => response.body.cancel()));
  assert.equal(vm.runInContext('r2EdgeBodyReaders', h.scope), 0);
  assert.equal((await (await c.request()).arrayBuffer()).byteLength, 2048);
  assert.equal(h.calls.length, 1);
});

test('a stuck optional cache write never blocks listeners or releases its ownership early', async () => {
  const h = harness({setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 ? 40 : ms)}), c = canaryFixture(h);
  const bytes = new Uint8Array(131600).fill(107);
  h.objects.set(`${PREFIX}/segment_canary.ts`, bytes);
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const original = c.cache.put;
  c.cache.put = (key, response) => key.url.includes('/live/') ? gate : original(key, response);
  const response = await c.request();
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  await new Promise(resolve => setTimeout(resolve, 60));
  h.clock.now += 13001;
  await c.request(undefined, c.token(), {method: 'HEAD'});
  assert.equal(vm.runInContext('r2EdgeBodyBytes', h.scope), bytes.length);
  assert.equal(vm.runInContext('pendingCanaryCacheWrites.size', h.scope), 1);
  finish(); await Promise.all(c.waits);
  assert.equal(vm.runInContext('r2EdgeBodyBytes', h.scope), 0);
  assert.equal(vm.runInContext('pendingCanaryCacheWrites.size', h.scope), 0);
  assert.equal(vm.runInContext('r2EdgeBodyReaders', h.scope), 0);
});

test('canary authentication precedes warm hits, ranges and HEAD; expiry is checked again after fill', async () => {
  const h = harness(), c = canaryFixture(h), bearer = c.token(); let heads = 0;
  h.objects.set(`${PREFIX}/segment_canary.ts`, new TextEncoder().encode('0123456789'));
  const head = h.env.QSESSION_LIVE.head;
  h.env.QSESSION_LIVE.head = async key => { heads++; return head(key); };
  const coldHead = await c.request(undefined, bearer, {method: 'HEAD', headers: {Range: 'bytes=0-1'}});
  assert.equal(coldHead.status, 200); assert.equal(await coldHead.text(), '');
  assert.equal(coldHead.headers.get('Content-Length'), '10'); assert.equal(coldHead.headers.get('Content-Range'), null);
  assert.equal(coldHead.headers.get('X-QSession-Cache-Fill-State'), null, 'a metadata read must not claim a stored segment');
  assert.equal(heads, 1); assert.equal(h.calls.length, 0);
  for (const [range, expected] of [['bytes=2-5', '2345'], ['bytes=-3', '789'], ['bytes=8-', '89']]) {
    const response = await c.request(undefined, bearer, {headers: {Range: range}});
    assert.equal(response.status, 206); assert.equal(await response.text(), expected);
    assert.match(response.headers.get('Content-Range'), /\/10$/);
  }
  assert.equal((await c.request(undefined, bearer, {headers: {Range: 'bytes=11-12'}})).status, 416);
  await c.request(undefined, bearer, {method: 'HEAD'}); assert.equal(heads, 1);
  const matches = c.cache.matches.length;
  for (const init of [{}, {method: 'HEAD'}, {headers: {Range: 'bytes=2-5'}}]) {
    assert.equal((await c.request(undefined, null, init)).status, 403);
  }
  assert.equal(c.cache.matches.length, matches); assert.equal(h.calls.length, 1);
  h.clock.now += 61000;
  assert.equal((await c.request(undefined, bearer)).status, 403); assert.equal(h.calls.length, 1);

  const e = harness(), f = canaryFixture(e); let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const get = e.env.QSESSION_LIVE.get;
  e.objects.set(`${PREFIX}/segment_canary.ts`, new Uint8Array([1, 2]));
  e.env.QSESSION_LIVE.get = async key => { entered(); await gate; return get(key); };
  const expiring = f.request(undefined, f.token({exp: Math.floor(e.clock.now / 1000) + 2}));
  await started; e.clock.now += 2100; release();
  assert.equal((await expiring).status, 403);
});

test('canary manifests remain fresh, canonical and individually rewritten, including recovery', async () => {
  const h = harness(), c = canaryFixture(h), a = c.token(), b = c.token({lease: 'zyxwvutsrqponmlkjihgfe'});
  const manifest = '#EXTM3U\n#EXT-X-MAP:URI="segment_init.m4s"\n#EXTINF:6,\nsegment_canary.ts\n';
  h.objects.set(`${PREFIX}/index.m3u8`, new TextEncoder().encode(manifest));
  const first = await c.request('index.m3u8', a), second = await c.request('index.m3u8', b);
  assert.ok((await first.text()).includes(`qsat=${a}`));
  const personalized = await second.text(); assert.ok(personalized.includes(`qsat=${b}`)); assert.equal(personalized.includes(a), false);
  assert.equal(second.headers.get('Content-Length'), null); assert.equal(second.headers.get('ETag'), null);
  const saved = c.cache.saved.get(`https://live.example.test/${PREFIX}/index.m3u8`);
  assert.equal(new TextDecoder().decode(saved.bytes), manifest); assert.equal(h.calls.length, 1);
  h.clock.now += 2100;
  h.objects.set(`${PREFIX}/index.m3u8`, new TextEncoder().encode('#EXTM3U\nsegment_new.ts\n'));
  assert.ok((await (await c.request('index.m3u8', b)).text()).includes('segment_new.ts')); assert.equal(h.calls.length, 2);

  const originalMatch = c.cache.match;
  let corruptHits = 0, releaseFreshRead;
  const freshGate = new Promise(resolve => { releaseFreshRead = resolve; });
  const originalGet = h.env.QSESSION_LIVE.get;
  h.env.QSESSION_LIVE.get = async key => { await freshGate; return originalGet(key); };
  h.clock.now += 751;
  c.cache.match = async key => {
    if (!key.url.endsWith('/index.m3u8')) return originalMatch(key);
    corruptHits++;
    return new Response(new ReadableStream({start(controller) {
      controller.error(new Error('private cached body details'));
    }}));
  };
  const readsBefore = h.calls.length;
  const recovering = Array.from({length: 32}, (_, i) => c.request('index.m3u8', i % 2 ? a : b));
  // The failed cache read and its replacement are both coalesced. Canonical
  // bytes are retained briefly; each viewer still receives their own token.
  await until(() => corruptHits === 1);
  await new Promise(resolve => setImmediate(resolve)); releaseFreshRead();
  const recovered = await Promise.all(recovering);
  for (let i = 0; i < recovered.length; i++) {
    assert.equal(recovered[i].headers.get('X-QSession-Manifest-Recovery'), 'storage');
    assert.ok((await recovered[i].text()).includes(`qsat=${i % 2 ? a : b}`));
  }
  assert.equal(h.calls.length, readsBefore + 1); assert.equal(c.stubCalls.length, 0);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
});

test('cold canary HEAD requests share metadata without reading a segment body', async () => {
  const h = harness(), c = canaryFixture(h); let heads = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  h.env.QSESSION_LIVE.head = async () => {
    heads++; await gate;
    return {size: 10, httpEtag: '"fixture"', writeHttpMetadata() {}};
  };
  const pending = Array.from({length: 32}, () => c.request(undefined, c.token(), {method: 'HEAD'}));
  await until(() => heads === 1);
  await new Promise(resolve => setTimeout(resolve, 10)); release();
  const responses = await Promise.all(pending);
  for (const response of responses) {
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Length'), '10');
    assert.equal(await response.text(), '');
  }
  assert.equal(heads, 1); assert.equal(h.calls.length, 0); assert.equal(c.stubCalls.length, 0);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
});

test('a canary recovery which outlives token expiry cannot return a personalized manifest', async () => {
  const h = harness(), c = canaryFixture(h); let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  h.objects.set(`${PREFIX}/index.m3u8`, new TextEncoder().encode('#EXTM3U\nsegment_canary.ts\n'));
  const match = c.cache.match;
  c.cache.match = async key => key.url.endsWith('/index.m3u8') ? new Response(new ReadableStream({start(controller) {
    controller.error(new Error('cached body unavailable'));
  }})) : match(key);
  const get = h.env.QSESSION_LIVE.get;
  h.env.QSESSION_LIVE.get = async key => { entered(); await gate; return get(key); };
  const pending = c.request('index.m3u8', c.token({exp: Math.floor(h.clock.now / 1000) + 2}));
  await started; h.clock.now += 2100; release();
  const response = await pending; assert.equal(response.status, 403);
  assert.equal((await response.text()).includes('qsat='), false);
  assert.equal(h.calls.length, 1); assert.equal(c.stubCalls.length, 0);
  assert.equal(vm.runInContext('r2EdgeReads', h.scope), 0);
});

test('invalid canary configuration and HLS references fail closed; missing objects stay 404 without Cache API', async () => {
  for (const change of [{QSESSION_R2_EDGE_CACHE_ROOM: 'OTHERX'}, {QSESSION_ADMISSION_ROOM: ''}, {QSESSION_ADMISSION_ROOM: 'OTHERX'}]) {
    const h = harness(), c = canaryFixture(h); Object.assign(h.env, change);
    assert.equal((await c.request()).status, 503); assert.equal(h.calls.length, 0); assert.equal(c.stubCalls.length, 0);
  }
  const h = harness(), c = canaryFixture(h); delete h.scope.caches;
  const response = await c.request(); assert.equal(response.status, 404);
  assert.equal(response.headers.get('X-QSession-Cache-Fill-State'), 'missing');
  assert.equal(h.calls.length, 1); assert.equal(c.stubCalls.length, 0);
  for (const uri of ['https://untrusted.test/segment_1.ts', '../OTHERX-abcdefghijklmnopqr/segment_1.ts', 'segment_1.ts#fragment']) {
    const r = harness(), d = canaryFixture(r);
    r.objects.set(`${PREFIX}/index.m3u8`, new TextEncoder().encode(`#EXTM3U\n${uri}\n`));
    assert.equal((await d.request('index.m3u8')).status, 502);
    assert.equal(r.calls.length, 1); assert.equal(d.stubCalls.length, 0);
  }
});
