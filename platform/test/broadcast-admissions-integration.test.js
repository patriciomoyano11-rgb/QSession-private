'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {createQsessionServer} = require('../server');
const {createProductStore} = require('../product-store');
const {syntheticReadiness} = require('./fixtures/mass-readiness.cjs');
const {syntheticAdmissions} = require('./fixtures/broadcast-admissions.cjs');

const code = 'TEN10A';
const prefix = `live/${code}-xxxxxxxxxxxxxxxxxx`;
async function start({room = {}, productStore: existingStore = null, ...overrides} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-admissions-integration-'));
  const store = existingStore || createProductStore();
  if (!store.getRoomRecord(code)) store.createRoomRecord({code, name: 'Synthetic controller test', visibility: 'public', ...room});
  const admissions = syntheticAdmissions();
  let sfuCalls = 0, storeJoins = 0;
  const recordJoin = store.recordJoin;
  store.recordJoin = (...args) => { storeJoins += 1; return recordJoin(...args); };
  if (typeof overrides.broadcastEventPlan === 'function') overrides.broadcastEventPlan = overrides.broadcastEventPlan(store.getRoomRecord(code));
  let app;
  try {
    app = createQsessionServer({
      env: {}, port: 0, dataFile: path.join(directory, 'state.json'),
      mediaDirectory: path.join(directory, 'media'), privateMediaDirectory: path.join(directory, 'private'),
      promotionMediaDirectory: path.join(directory, 'promotions'), analyticsDataFile: path.join(directory, 'analytics.ndjson'),
      productStore: store, livekitUrl: 'wss://media.invalid', livekitApiKey: 'synthetic-key',
      livekitApiSecret: 'synthetic-api-secret', roomSecret: 'synthetic-room-secret',
      audienceMode: 'cdn-only', cdnOnlyRoom: code, broadcastAudienceTarget: 10000,
      massBroadcastReadiness: syntheticReadiness(code, {QSESSION_BROADCAST_AUDIENCE_TARGET: '10000'}),
      broadcastAdmissions: admissions,
      edgeBroadcast: {configured: true, provider: 'synthetic-test-only', deliveryMode: 'object-storage', playbackUrl: value => `https://cdn.invalid/live/${value}-xxxxxxxxxxxxxxxxxx/index.m3u8`},
      liveRoomActivityProvider: async () => { sfuCalls += 1; throw new Error('CDN viewers must never query SFU'); },
      ...overrides,
    });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  } catch (error) {
    fs.rmSync(directory, {recursive: true, force: true});
    throw error;
  }
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return {...app, store, admissions, url, counters: () => ({sfuCalls, storeJoins}),
    async get(route) {
      const response = await fetch(url + route);
      return {status: response.status, body: await response.json()};
    },
    async post(route, body = {}, method = 'POST', headers = {}) {
      const response = await fetch(url + route, {method, headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
      return {status: response.status, cache: response.headers.get('cache-control'), body: await response.json()};
    },
    async close() {
      await new Promise(resolve => app.server.close(resolve));
      fs.rmSync(directory, {recursive: true, force: true});
    },
  };
}
const joinPath = `/api/rooms/${code}/media-token`;
const checkPath = '/api/broadcast/admissions/check';

test('CDN listeners retain private ten-person chat, images and isolated voice without joining the broadcast SFU', async t => {
  const app = await start();
  try {
    const owner = app.store.createAccount({email: 'owner-local@example.invalid', password: 'local-test-password-123'});
    app.store.updateAccountProfile(owner.account.id, {displayName: 'Owner', visible: true, social: {allowMessages: true}});
    const auth = {Authorization: `Bearer ${app.store.createSession(owner.account.id).token}`};
    const members = Array.from({length: 10}, (_, i) => app.store.upsertProfile({
      displayName: `Member ${i}`, visible: true, social: {allowMessages: true},
    }));
    assert.equal(app.realtimeHub.status().maximumConnections, 20064);
    const joined = await app.post(joinPath, {role: 'listener'}, 'POST', auth);
    assert.equal(joined.status, 200);
    assert.deepEqual(joined.body.permissions, ['listen']);
    assert.equal(joined.body.token, undefined);
    const created = await app.post('/api/private-conversations', {type: 'group',
      memberProfileIds: members.slice(0, 9).map(member => member.id)}, 'POST', auth);
    assert.equal(created.status, 201);
    assert.equal(created.body.conversation.memberCount, 10);
    assert.equal((await app.post('/api/private-conversations', {type: 'group',
      memberProfileIds: members.map(member => member.id)}, 'POST', auth)).status, 400);
    const conversation = created.body.conversation;
    const route = `/api/private-conversations/${conversation.id}`;
    assert.equal((await app.post(`${route}/messages`, {text: 'only my group'}, 'POST', auth)).status, 201);
    const voice = await app.post(`${route}/voice-token`, {}, 'POST', auth);
    assert.equal(voice.status, 200);
    const claims = JSON.parse(Buffer.from(voice.body.token.split('.')[1], 'base64url'));
    assert.equal(claims.video.room, `qsession-private-${conversation.id}`);
    assert.notEqual(claims.video.room, `qsession-${code}`);
    assert.deepEqual(claims.video.canPublishSources, ['microphone', 'camera']);
    const photo = await app.post(`${route}/attachments`, {name: 'private.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}, 'POST', auth);
    assert.equal(photo.status, 201);
    const media = await fetch(app.url + photo.body.message.media.url, {headers: auth});
    assert.equal(media.status, 200);
    assert.ok((await media.arrayBuffer()).byteLength > 0);
    assert.equal((await fetch(app.url + photo.body.message.media.url)).status, 404);
    t.mock.method(app.store, 'getPrivateConversation', () => ({...conversation, memberCount: 11}));
    assert.equal((await app.post(`${route}/voice-token`, {}, 'POST', auth)).status, 409);
    assert.deepEqual(app.counters(), {sfuCalls: 0, storeJoins: 0});
  } finally { t.mock.restoreAll(); await app.close(); }
});

test('an authenticated listener with messaging enabled still cannot publish audio on the main SFU', async () => {
  const app = await start({audienceMode: 'interactive', room: {allowGuestCameras: false, allowPublicChat: true}});
  try {
    const person = app.store.createAccount({email: 'listener-local@example.invalid', password: 'local-test-password-123'});
    app.store.updateAccountProfile(person.account.id, {visible: true, social: {allowMessages: true}});
    const result = await app.post(joinPath, {role: 'listener'}, 'POST',
      {Authorization: `Bearer ${app.store.createSession(person.account.id).token}`});
    assert.equal(result.status, 200);
    const claims = JSON.parse(Buffer.from(result.body.token.split('.')[1], 'base64url'));
    assert.equal(claims.video.canPublish, false);
    assert.ok(!result.body.permissions.includes('chat-microphone'));
  } finally { await app.close(); }
});
function testHostToken() {
  const body = Buffer.from(JSON.stringify({code, role: 'dj', exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', 'synthetic-room-secret').update(body).digest('base64url')}`;
}
function testEventPlan(room) {
  return {schemaVersion: 1, planId: 'broadcast-event-10000', status: 'prepared', roomCode: code, roomId: room.id,
    targetViewers: 10000, maxParticipants: 10000, approvedBy: 'SYNTHETIC TEST FIXTURE', authorizationReference: 'synthetic-test-only',
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString()};
}
function testProbe() {
  return {schemaVersion: 1, code: 'PRB10A', prefix: 'live/PRB10A-hWrdBkirH_2yHmZ9lp', generation: 'synthetic-0123456789abcdef',
    capacity: 10000, issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString()};
}

test('CDN joins reserve the paid capacity through the admission dependency and reuse a lease', async () => {
  const app = await start({room: {billingCapacityLimit: 1}});
  try {
    const first = await app.post(joinPath, {role: 'listener'});
    assert.equal(first.status, 200);
    assert.equal(first.cache, 'no-store');
    assert.equal(first.body.token, undefined);
    assert.equal(first.body.delivery.fallback, null);
    assert.deepEqual(first.body.permissions, ['listen']);
    assert.equal(first.body.limits.maxParticipants, 1);
    const token = first.body.delivery.admissionToken;
    assert.equal(new URL(first.body.delivery.url).searchParams.get('qsat'), token);
    assert.equal(app.admissions.calls[0].generation, app.store.getRoomRecord(code).id);
    assert.equal(app.admissions.calls[0].prefix, prefix);
    assert.equal((await app.post(joinPath, {role: 'listener'})).status, 429);
    const resumed = await app.post(joinPath, {role: 'listener', previousAdmissionToken: token});
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.delivery.admissionToken, token);
    assert.equal(resumed.body.limits.activeAdmissions, 1);
    assert.deepEqual(app.counters(), {sfuCalls: 0, storeJoins: 0});
    const released = await app.post('/api/broadcast/admissions/release', {token});
    assert.equal(released.status, 200);
    assert.equal(released.body.released, true);
    assert.equal((await app.post(joinPath, {role: 'listener'})).status, 200);
  } finally { await app.close(); }
  assert.equal(app.admissions.closed, true);
});

test('manual aforo, purchased aforo and technical target all constrain CDN admission', async () => {
  const app = await start({room: {capacityMode: 'limited', capacity: 7, billingCapacityLimit: 25}});
  try {
    assert.equal((await app.post(joinPath)).body.limits.maxParticipants, 7);
    app.store.updateRoomConfiguration(code, {capacityMode: 'limited', capacity: 25});
    assert.equal((await app.post(joinPath)).body.limits.maxParticipants, 25);
    app.store.archiveRoom(code);
    app.store.createRoomRecord({code, billingCapacityLimit: 50000});
    assert.equal((await app.post(joinPath)).body.limits.maxParticipants, 10000);
    app.store.archiveRoom(code);
    app.store.createRoomRecord({code});
    assert.equal((await app.post(joinPath)).body.limits.maxParticipants, 10000);
    assert.deepEqual(app.counters(), {sfuCalls: 0, storeJoins: 0});
  } finally { await app.close(); }
});

test('CDN admission retains password, stars, waiting and legacy-native access guards', async () => {
  const app = await start({room: {password: 'synthetic-room-password'}});
  try {
    assert.equal((await app.post(joinPath)).status, 403);
    assert.equal(app.admissions.calls.length, 0);
    const access = await app.post(`/api/rooms/${code}/access`, {password: 'synthetic-room-password'});
    assert.equal(access.status, 200);
    assert.equal((await app.post(joinPath, {accessToken: access.body.accessToken})).status, 200);
    app.store.archiveRoom(code);
    app.store.createRoomRecord({code, starPrice: 1});
    assert.equal((await app.post(joinPath)).status, 401);
    app.store.archiveRoom(code);
    app.store.createRoomRecord({code, status: 'waiting'});
    assert.equal((await app.post(joinPath)).status, 409);
    assert.equal(app.counters().sfuCalls, 0);
    app.store.updateRoomRecord(code, {status: 'live'});
    const before = app.admissions.calls.length;
    assert.equal((await app.post(joinPath, {nativeAudio: true})).status, 409);
    assert.equal(app.admissions.calls.length, before);
  } finally { await app.close(); }
});

test('edge checks renew a scoped active lease; invalid objects and ended rooms fail closed', async () => {
  const app = await start();
  try {
    const joined = await app.post(joinPath);
    const token = joined.body.delivery.admissionToken;
    assert.equal((await app.post(checkPath, {token, objectKey: `${prefix}/segment_1.ts`})).status, 200);
    assert.equal((await app.post(checkPath, {token, objectKey: 'live/OTHER1-xxxxxxxxxxxxxxxxxx/segment_1.ts'})).status, 403);
    assert.equal((await app.post(checkPath, {token: 'invalid', objectKey: `${prefix}/index.m3u8`})).status, 403);
    app.admissions.tokens.get(token).generation = 'a-prior-room-with-the-same-code';
    const before = app.admissions.calls.length;
    assert.equal((await app.post(checkPath, {token, objectKey: `${prefix}/index.m3u8`})).status, 403);
    assert.equal(app.admissions.calls.length, before);
    app.admissions.tokens.get(token).generation = app.store.getRoomRecord(code).id;
    app.store.archiveRoom(code);
    assert.equal((await app.post(checkPath, {token, objectKey: `${prefix}/index.m3u8`})).status, 410);
    assert.equal(app.admissions.calls.length, before);
  } finally { await app.close(); }
});

test('paid duration and readiness expiry stop playback renewal before touching Redis', async t => {
  const app = await start({room: {sessionDurationMinutes: 15}});
  try {
    app.store.updateRoomRecord(code, {billingStartedAt: new Date().toISOString(), sessionDurationMinutes: 15});
    const joined = await app.post(joinPath);
    const token = joined.body.delivery.admissionToken;
    assert.ok(app.admissions.tokens.get(token).expiresAt <= Date.now() + 15 * 60000);
    const before = app.admissions.calls.length;
    app.store.updateRoomRecord(code, {billingStartedAt: new Date(Date.now() - 16 * 60000).toISOString()});
    assert.equal((await app.post(checkPath, {token, objectKey: `${prefix}/index.m3u8`})).status, 410);
    assert.equal(app.admissions.calls.length, before);
    app.store.updateRoomRecord(code, {billingStartedAt: null});
    const longJoin = await app.post(joinPath);
    const longToken = longJoin.body.delivery.admissionToken;
    const beforeExpiry = app.admissions.calls.length;
    const current = Date.now();
    t.mock.method(Date, 'now', () => current + 3601000);
    assert.equal((await app.post(checkPath, {token: longToken, objectKey: `${prefix}/index.m3u8`})).status, 503);
    assert.equal(app.admissions.calls.length, beforeExpiry);
    assert.equal((await app.post(joinPath)).status, 503);
    t.mock.restoreAll();
  } finally { t.mock.restoreAll(); await app.close(); }
});

test('an unavailable admission backend returns 503 and never uses SFU as a fallback', async () => {
  const app = await start();
  try {
    const joined = await app.post(joinPath);
    app.admissions.unavailable = true;
    const denied = await app.post(joinPath);
    assert.equal(denied.status, 503);
    assert.equal(denied.body.token, undefined);
    assert.equal((await app.post(checkPath, {token: joined.body.delivery.admissionToken, objectKey: `${prefix}/index.m3u8`})).status, 503);
    assert.deepEqual(app.counters(), {sfuCalls: 0, storeJoins: 0});
  } finally { await app.close(); }
});

test('CDN startup refuses missing Redis admission configuration even with complete test evidence', async () => {
  await assert.rejects(() => start({broadcastAdmissions: undefined}), /admisiones Redis/);
});

test('a prepared event grant preserves billing and cannot escalate the interactive room by a request field', async () => {
  const app = await start({room: {billingPlanId: 'paid-25', billingCapacityLimit: 25, sessionDurationMinutes: 15}, audienceMode: 'interactive', broadcastEventPlan: testEventPlan});
  try {
    const room = (await app.get(`/api/rooms/${code}`)).body.room;
    assert.equal(room.broadcastEventPlan.status, 'prepared');
    assert.equal(room.broadcastEventPlan.effectiveMaxParticipants, null);
    assert.equal(room.billingPlan.maxParticipants, 25);
    assert.doesNotMatch(JSON.stringify(room), /SYNTHETIC TEST FIXTURE|synthetic-test-only/);
    const denied = await app.post(`/api/rooms/${code}/configuration`, {hostToken: testHostToken(), capacity: 10000, capacityMode: 'limited', eventCapacityLimit: 10000}, 'PATCH');
    assert.equal(denied.status, 400);
    assert.equal(app.store.getRoomRecord(code).billingCapacityLimit, 25);
    assert.equal(app.store.getRoomRecord(code).sessionDurationMinutes, 15);
    assert.equal(app.store.getRoomRecord(code).capacityMode, 'expected');
  } finally { await app.close(); }
});

test('only a gated CDN event uses its scoped grant and a manual limit still constrains admission', async () => {
  const app = await start({room: {billingPlanId: 'paid-25', billingCapacityLimit: 25, sessionDurationMinutes: 15}, broadcastEventPlan: testEventPlan});
  try {
    const joined = await app.post(joinPath);
    assert.equal(joined.body.limits.maxParticipants, 10000);
    assert.ok(app.admissions.tokens.get(joined.body.delivery.admissionToken).expiresAt <= Date.now() + 600000);
    const configured = await app.post(`/api/rooms/${code}/configuration`, {hostToken: testHostToken(), capacity: 8500, capacityMode: 'limited'}, 'PATCH');
    assert.equal(configured.status, 200);
    assert.equal(configured.body.room.broadcastEventPlan.effectiveMaxParticipants, 10000);
    assert.equal((await app.post(joinPath)).body.limits.maxParticipants, 8500);
    assert.equal((await app.post(`/api/rooms/${code}/configuration`, {hostToken: testHostToken(), capacity: 10001, capacityMode: 'limited'}, 'PATCH')).status, 400);
    const preserved = app.store.getRoomRecord(code);
    assert.equal(preserved.billingCapacityLimit, 25);
    assert.equal(preserved.billingPlanId, 'paid-25');
    assert.equal(preserved.sessionDurationMinutes, 15);
  } finally { await app.close(); }
});

test('manual aforo UI keeps the purchased limit until the event grant is effective', () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const nodes = new Map();
  const context = {byId: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); }, all: () => [], syncActiveTranslationLanguages() {}, setStatus() {}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function populateActiveRoomSettings('), source.indexOf('function syncPublicChatPanel(')), context);
  const room = {billingPlan: {maxParticipants: 25}, broadcastEventPlan: {status: 'prepared', effectiveMaxParticipants: null}};
  context.populateActiveRoomSettings(room);
  assert.equal(nodes.get('activeRoomCapacity').max, '25');
  assert.match(nodes.get('activeRoomCapacityHelp').textContent, /Tu plan admite/);
  room.broadcastEventPlan.effectiveMaxParticipants = 10000;
  context.populateActiveRoomSettings(room);
  assert.equal(nodes.get('activeRoomCapacity').max, '10000');
  assert.match(nodes.get('activeRoomCapacityHelp').textContent, /Este evento permite/);
});

test('the synthetic probe only checks privately issued leases and cannot grant access to a real event', async t => {
  const probe = testProbe();
  const app = await start({audienceMode: 'interactive', broadcastAdmissionProbe: probe});
  try {
    const lease = await app.admissions.reserve({code: probe.code, prefix: probe.prefix, generation: probe.generation, capacity: 10000, expiresAt: Date.parse(probe.expiresAt)});
    const request = {token: lease.token, objectKey: `${probe.prefix}/index.m3u8`};
    assert.equal((await app.post('/api/broadcast/admissions/probe-check', request)).status, 200);
    assert.equal((await app.post(checkPath, request)).status, 403);
    assert.equal((await app.post('/api/broadcast/admissions/probe-reserve', {code: 'JNTUBY'})).status, 404);
    const wrong = await app.admissions.reserve({code: 'JNTUBY', prefix: 'live/JNTUBY-xxxxxxxxxxxxxxxxxx', generation: probe.generation, capacity: 1, expiresAt: Date.parse(probe.expiresAt)});
    assert.equal((await app.post('/api/broadcast/admissions/probe-check', {...request, token: wrong.token})).status, 403);
    app.admissions.tokens.get(lease.token).generation = 'synthetic-fedcba9876543210';
    assert.equal((await app.post('/api/broadcast/admissions/probe-check', request)).status, 403);
    const before = app.admissions.calls.length;
    const current = Date.now();
    t.mock.method(Date, 'now', () => current + 61000);
    assert.equal((await app.post('/api/broadcast/admissions/probe-check', request)).status, 410);
    assert.equal(app.admissions.calls.length, before);
    t.mock.restoreAll();
  } finally { t.mock.restoreAll(); await app.close(); }
});

test('the synthetic probe is disabled by default and refuses another code, prefix or a longer validity', async () => {
  const app = await start();
  try { assert.equal((await app.post('/api/broadcast/admissions/probe-check', {})).status, 503); }
  finally { await app.close(); }
  // Leave a real margin: a one-millisecond excess can expire during setup on Windows.
  for (const patch of [{code: 'JNTUBY'}, {prefix: 'live/JNTUBY-xxxxxxxxxxxxxxxxxx'}, {expiresAt: new Date(Date.now() + 3660000).toISOString()}, {extra: 'forbidden'}]) {
    await assert.rejects(() => start({audienceMode: 'interactive', broadcastAdmissionProbe: {...testProbe(), ...patch}}), /señal sintética/);
  }
  await assert.rejects(() => start({env: {QSESSION_BROADCAST_ADMISSION_PROBE_FILE: 'relative-probe.json'}}), /No se pudo leer/);
  await assert.rejects(() => start({env: {QSESSION_BROADCAST_EVENT_PLAN_FILE: 'relative-plan.json'}}), /No se pudo leer/);
});

test('an interactive restart after dormant probe and event expiry remains healthy without Redis admission configuration', async t => {
  const current = Date.now(), warnings = [], probe = testProbe();
  let grant, app;
  t.mock.method(console, 'warn', value => warnings.push(value));
  try {
    app = await start({audienceMode: 'interactive', broadcastAdmissionProbe: probe, broadcastEventPlan: room => {
      grant = {...testEventPlan(room), expiresAt: probe.expiresAt};
      return grant;
    }});
    const store = app.store;
    await app.close(); app = null;
    t.mock.method(Date, 'now', () => current + 61000);
    app = await start({productStore: store, audienceMode: 'interactive', broadcastAdmissionProbe: probe, broadcastEventPlan: grant, broadcastAdmissions: undefined});
    const status = await app.get('/api/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.scale.broadcast.audienceMode, 'interactive');
    assert.equal(status.body.scale.broadcast.admissions.configured, false);
    assert.equal((await app.get(`/api/rooms/${code}`)).body.room.broadcastEventPlan, undefined);
    assert.equal((await app.post('/api/broadcast/admissions/probe-check', {})).status, 503);
    assert.deepEqual(warnings, ['QSESSION_BROADCAST_ADMISSION_PROBE_EXPIRED_INACTIVE', 'QSESSION_BROADCAST_EVENT_PLAN_EXPIRED_INACTIVE']);
    await assert.rejects(() => start({productStore: store, broadcastEventPlan: grant}), /caducó/);
  } finally { t.mock.restoreAll(); if (app) await app.close(); }
});

test('expiry never suppresses invalid probe scope or an event grant for another room generation', async () => {
  const current = Date.now();
  const expiredProbe = {...testProbe(), issuedAt: new Date(current - 120000).toISOString(), expiresAt: new Date(current - 60000).toISOString()};
  await assert.rejects(() => start({audienceMode: 'interactive', broadcastAdmissionProbe: {...expiredProbe, code: 'JNTUBY'}}), /señal sintética/);
  await assert.rejects(() => start({audienceMode: 'interactive', broadcastEventPlan: room => ({...testEventPlan(room), roomId: 'room-another-generation', issuedAt: new Date(current - 120000).toISOString(), expiresAt: new Date(current - 60000).toISOString()})}), /generación/);
});

test('an event grant expiring during CDN delivery pauses new admissions instead of silently reverting to a smaller plan', async t => {
  const app = await start({room: {billingCapacityLimit: 25}, broadcastEventPlan: testEventPlan});
  try {
    assert.equal((await app.post(joinPath)).body.limits.maxParticipants, 10000);
    const before = app.admissions.calls.filter(call => call.action === 'reserve').length;
    const current = Date.now();
    t.mock.method(Date, 'now', () => current + 600001);
    assert.equal((await app.post(joinPath)).status, 503);
    assert.equal(app.admissions.calls.filter(call => call.action === 'reserve').length, before);
  } finally { t.mock.restoreAll(); await app.close(); }
});

test('room and directory show active CDN leases using one five-second cached count without viewer store writes', async () => {
  let sfuCalls = 0;
  const app = await start({liveRoomActivityProvider: async rooms => {
    sfuCalls += 1;
    return new Map(rooms.map(room => [room.code, {audioLive: true, participantCount: 1, listenerCount: 0}]));
  }});
  try {
    await app.post(joinPath);
    await app.post(joinPath);
    app.store.recordRoomActivity = () => { throw new Error('CDN counts must not write product-store activity'); };
    const first = await app.get(`/api/rooms/${code}`);
    assert.equal(first.body.room.activeBroadcastSessions, 2);
    assert.equal(first.body.room.broadcastSessionsStatus, 'ready');
    assert.equal(sfuCalls, 0);
    assert.equal((await app.get(`/api/rooms/${code}`)).body.room.activeBroadcastSessions, 2);
    const directory = await app.get('/api/rooms');
    assert.equal(directory.body.rooms[0].activeBroadcastSessions, 2);
    assert.equal(sfuCalls, 1);
    assert.equal(app.admissions.calls.filter(call => call.action === 'count').length, 1);
    assert.equal(app.counters().storeJoins, 0);
  } finally { await app.close(); }
});

test('a failed CDN count is marked unavailable instead of reporting zero and is briefly cached', async t => {
  const app = await start();
  try {
    await app.post(joinPath);
    assert.equal((await app.get(`/api/rooms/${code}`)).body.room.activeBroadcastSessions, 1);
    app.admissions.unavailable = true;
    const current = Date.now();
    t.mock.method(Date, 'now', () => current + 5100);
    const unavailable = await app.get(`/api/rooms/${code}`);
    assert.equal(unavailable.body.room.broadcastSessionsStatus, 'unavailable');
    assert.equal(unavailable.body.room.activeBroadcastSessions, null);
    await app.get(`/api/rooms/${code}`);
    assert.equal(app.admissions.calls.filter(call => call.action === 'count').length, 2);
  } finally { t.mock.restoreAll(); await app.close(); }
});

test('only the CDN DJ polls the aforo and the interface labels lease counts as active sessions', async () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const counter = {nextSibling: {nodeType: 3, textContent: ''}}, requests = [];
  const state = {currentRoomCode: code, currentRoom: {audienceMode: 'cdn-only'}, mediaRole: 'dj', mediaConnected: true, broadcastAudiencePollAt: 0};
  const context = {state, byId: () => counter, isCdnOnlyAudience: () => false, mediaParticipantCount: () => 1,
    api: async route => { requests.push(route); return {room: {activeBroadcastSessions: 12, broadcastSessionsStatus: 'ready'}}; }};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function renderMediaAudienceCount('), source.indexOf('function updateMediaConnection(')), context);
  vm.runInContext(source.slice(source.indexOf('function roomAudienceCopy('), source.indexOf('function renderPublicRooms(')), context);
  await context.refreshDjBroadcastAudience();
  assert.equal(counter.textContent, '12');
  assert.equal(counter.nextSibling.textContent, ' sesiones activas');
  assert.equal(context.roomAudienceCopy(state.currentRoom), '12 sesiones activas');
  await context.refreshDjBroadcastAudience();
  assert.equal(requests.length, 1);
  state.mediaRole = 'listener'; state.broadcastAudiencePollAt = 0;
  await context.refreshDjBroadcastAudience();
  assert.equal(requests.length, 1);
  state.currentRoom = {audienceMode: 'cdn-only', activeBroadcastSessions: null, broadcastSessionsStatus: 'unavailable'};
  context.renderMediaAudienceCount();
  assert.equal(counter.textContent, '—');
  assert.equal(context.roomAudienceCopy(state.currentRoom), 'Conteo de sesiones no disponible');
});

test('HLS browser and native playback receive the complete admission URL unchanged', async () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const requests = [], state = {currentRoomCode: code};
  class Hls {
    static isSupported() { return true; }
    static Events = {MANIFEST_PARSED: 'parsed', ERROR: 'error'};
    on() {} attachMedia() {}
    loadSource(url) { requests.push({kind: 'browser', url}); }
  }
  const context = {state, URL, window: {Hls}, byId: () => ({addEventListener() {}}), stopEdgeBroadcastPlayback() {}, syncWebMediaSubscriptions() {}, setMediaStatus() {}, isCdnOnlyAudience: () => true,
    postNativeAudioCommand: input => { requests.push({kind: 'native', url: input.url}); return true; }};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function startEdgeBroadcastPlayback('), source.indexOf('function attachRemoteTrack(')), context);
  const url = `https://cdn.invalid/${prefix}/index.m3u8?qsat=scoped-admission`;
  assert.equal(await context.startEdgeBroadcastPlayback({url, audienceMode: 'cdn-only'}), true);
  assert.deepEqual(requests, [{kind: 'native', url}, {kind: 'browser', url}]);
  assert.equal(state.broadcastDelivery.url, url);
});

test('the client remembers the admission for reconnects and releases it only on an explicit exit', async () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const storage = new Map(), requests = [];
  const state = {currentRoomCode: code, mediaRoomCode: code};
  const context = {state, sessionStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    api: async (route, request) => {
      requests.push({route, input: JSON.parse(request.body)});
      return {delivery: {admissionToken: 'scoped-test-token'}};
    },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function rememberedBroadcastAdmission('), source.indexOf('async function connectMedia(')), context);
  await context.mediaCredentials('listener');
  await context.mediaCredentials('listener');
  assert.equal(requests[0].input.previousAdmissionToken, undefined);
  assert.equal(requests[1].input.previousAdmissionToken, 'scoped-test-token');
  await context.mediaCredentials('dj');
  assert.equal(requests[2].input.previousAdmissionToken, undefined);
  await context.releaseBroadcastAdmission(code);
  assert.equal(requests[3].route, '/api/broadcast/admissions/release');
  assert.equal(requests[3].input.token, 'scoped-test-token');
  assert.equal(storage.size, 0);
  const disconnect = source.slice(source.indexOf('async function disconnectMedia('), source.indexOf('async function returnFromListenerSession('));
  assert.doesNotMatch(disconnect, /releaseBroadcastAdmission|qsession-hls-admission/);
  assert.match(source.slice(source.indexOf('async function returnFromListenerSession('), source.indexOf('async function finishBroadcast(')), /releaseBroadcastAdmission/);
});
