'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const {assessSnapshot, validateSnapshot, encoderStatusOnly, selfTest, observePublicRoom, validatePlaybackUrl, manifestSample} = require('../scripts/monitor-broadcast.cjs');
const NOW = Date.parse('2026-10-18T20:00:00Z');
function fixture(now = NOW) {
  return {schemaVersion: 1, observedAt: new Date(now).toISOString(), roomCode: 'PRB10A', expectedLive: true,
    app: {httpStatus: 200}, encoder: {httpStatus: 200},
    manifest: {httpStatus: 200, ageSeconds: 3, lastProgressAgeSeconds: 6, mediaSequence: 12},
    admissions: {configured: true, redisReady: true, redisError: false, activeSessions: 10, capacity: 10000}};
}
function codes(value) { return assessSnapshot(value, {now: NOW}).alerts.map(item => item.code); }

test('a healthy redacted snapshot produces structured evidence without activation or capacity claims', () => {
  const report = assessSnapshot(fixture(), {now: NOW});
  assert.equal(report.level, 'ok');
  assert.equal(report.roomCode, 'PRB10A');
  assert.equal(report.measurements.admissions.activeSessions, 10);
  assert.equal(report.capacityCertified, false);
  assert.equal(report.changesApplied, false);
  assert.equal(report.externalNotificationsSent, false);
  assert.deepEqual(report.alerts, []);
});

test('freshness and progression are separate checks, independent of a successful HTTP response', () => {
  const value = fixture();
  value.manifest.ageSeconds = 60;
  value.manifest.lastProgressAgeSeconds = 60;
  assert.deepEqual(codes(value), ['manifest_stale', 'manifest_not_advancing']);
  value.expectedLive = false;
  assert.deepEqual(codes(value), []);
  value.observedAt = new Date(NOW - 60_000).toISOString();
  assert.deepEqual(codes(value), ['snapshot_stale']);
  value.observedAt = new Date(NOW + 10_000).toISOString();
  assert.deepEqual(codes(value), ['snapshot_from_future']);
});

test('Redis and count failures remain unknown or critical instead of being reported as zero sessions', () => {
  const value = fixture();
  value.admissions.redisReady = false;
  value.admissions.redisError = true;
  value.admissions.activeSessions = null;
  assert.deepEqual(codes(value), ['redis_unavailable', 'session_count_unknown']);
  const report = assessSnapshot(value, {now: NOW});
  assert.equal(report.level, 'critical');
  assert.equal(report.measurements.admissions.activeSessions, null);
});

test('capacity warning and excess have distinct severity and thresholds are bounded', () => {
  const value = fixture();
  value.admissions.activeSessions = 9000;
  assert.equal(assessSnapshot(value, {now: NOW}).level, 'warning');
  assert.deepEqual(codes(value), ['session_limit_near']);
  value.admissions.activeSessions = 10001;
  assert.deepEqual(codes(value), ['session_limit_exceeded']);
  assert.equal(assessSnapshot(value, {now: NOW}).level, 'critical');
  assert.throws(() => assessSnapshot(value, {now: NOW, thresholds: {capacityWarningRatio: 0.1}}));
  assert.throws(() => assessSnapshot(value, {now: NOW, thresholds: {manifestMaxAgeSeconds: 9999}}));
});

test('missing measurements, malformed values and fields outside the redacted schema are rejected', () => {
  for (const change of [
    {token: 'synthetic-sensitive-marker'}, {roomCode: 'not-a-room'}, {expectedLive: 'true'},
    {app: {httpStatus: 200, body: 'synthetic-sensitive-marker'}},
    {encoder: {httpStatus: 200, access_key: 'synthetic-sensitive-marker'}},
    {manifest: {httpStatus: 200}}, {admissions: {...fixture().admissions, activeSessions: '10'}},
    {admissions: {...fixture().admissions, capacity: 500000}},
  ]) assert.throws(() => validateSnapshot({...fixture(), ...change}), error => !error.message.includes('synthetic-sensitive-marker'));
});

test('encoder probe permits only loopback HEAD and destroys the response without accessing its body', async () => {
  const calls = [];
  const response = {statusCode: 200, destroy() { calls.push('response-destroy'); }};
  for (const key of ['body', 'json', 'text', 'read', 'on', 'resume']) {
    Object.defineProperty(response, key, {get() { throw new Error('Body must never be read'); }});
  }
  const status = await encoderStatusOnly('http://127.0.0.1:8081/', {request(url, options, callback) {
    calls.push({method: options.method, hostname: url.hostname});
    callback(response);
    return {on(event) { calls.push(event); }, setTimeout(milliseconds) { calls.push(milliseconds); }, end() { calls.push('end'); }};
  }});
  assert.equal(status, 200);
  assert.deepEqual(calls[0], {method: 'HEAD', hostname: '127.0.0.1'});
  assert.ok(calls.includes('response-destroy'));
  for (const url of ['https://127.0.0.1:8081/', 'http://example.test:8081/', 'http://127.0.0.1:8090/',
    'http://127.0.0.1:8081/?qsat=synthetic', 'http://user:synthetic@127.0.0.1:8081/', 'http://127.0.0.1:8081/private']) {
    assert.throws(() => encoderStatusOnly(url));
  }
});

test('the synthetic self-test exercises health, stalled manifests, Redis outage and over-capacity without networking', () => {
  const report = selfTest(NOW);
  assert.equal(report.synthetic, true);
  assert.equal(report.passed, true);
  assert.equal(report.networkRequests, 0);
  assert.equal(report.cases.length, 4);
  assert.equal(report.capacityCertified, false);
});

const WORKER_BASE = 'https://qsession-live.patriciomoyano11.workers.dev/live/PRB10A-abcdefghijklmnopqr/';
const SYNTHETIC_TOKEN = `v1.${Buffer.from('synthetic-test-payload').toString('base64url')}.${'a'.repeat(43)}`;
function publicFixture() {
  return {
    '/api/status': {ok: true, scale: {broadcast: {audienceMode: 'cdn-only', admissions: {configured: true, ready: true}}}},
    '/api/rooms/PRB10A/broadcast': {ok: true, broadcast: {ready: true, state: 'active', playbackUrl: 'synthetic-sensitive-marker'}},
    '/api/rooms/PRB10A': {room: {activeBroadcastSessions: 12, broadcastSessionsStatus: 'ready',
      broadcastEventPlan: {effectiveMaxParticipants: 10000}, billingPlan: {maxParticipants: 25}, name: 'synthetic-sensitive-marker'}},
  };
}

test('public observation is useful without a private URL and explicitly marks playback and loopback checks missing', async () => {
  const data = publicFixture();
  const calls = [];
  const report = await observePublicRoom({roomCode: 'PRB10A', clock: () => NOW,
    fetchImpl: async (url, options) => { calls.push({url, options}); return Response.json(data[new URL(url).pathname]); }});
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.options.method === 'GET' && new URL(call.url).hostname === 'qsession.org'));
  assert.equal(report.measurements.broadcastState, 'active');
  assert.equal(report.measurements.activeSessions, 12);
  assert.equal(report.measurements.capacity, 10000);
  assert.equal(report.measurements.privatePlaybackUnchecked, true);
  assert.deepEqual(report.alerts.map(item => item.code), ['encoder_loopback_unchecked', 'private_playback_unchecked']);
  assert.equal(report.level, 'warning');
  assert.ok(!JSON.stringify(report).includes('synthetic-sensitive-marker'));
});

test('private HLS observation checks freshness and advancement with the token kept out of structured evidence', async () => {
  let now = NOW;
  let manifestRequests = 0;
  const data = publicFixture();
  const report = await observePublicRoom({roomCode: 'PRB10A', clock: () => now,
    playbackUrl: `${WORKER_BASE}index.m3u8?qsat=${SYNTHETIC_TOKEN}`,
    wait: async milliseconds => { assert.equal(milliseconds, 8000); now += milliseconds; },
    fetchImpl: async (value, options) => {
      const url = new URL(value);
      if (url.hostname === 'qsession.org') return Response.json(data[url.pathname]);
      assert.equal(url.origin + url.pathname, WORKER_BASE + 'index.m3u8');
      assert.equal(url.searchParams.get('qsat'), SYNTHETIC_TOKEN);
      assert.equal(options.redirect, 'error');
      manifestRequests += 1;
      return new Response(`#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${manifestRequests}\n#EXT-X-PROGRAM-DATE-TIME:${new Date(now - 2000).toISOString()}\n#EXTINF:6,\n${WORKER_BASE}segment_${manifestRequests}.ts?qsat=${SYNTHETIC_TOKEN}\n`);
    }});
  assert.equal(manifestRequests, 2);
  assert.equal(report.measurements.privatePlaybackUnchecked, false);
  assert.equal(report.measurements.privatePlaybackProgressObserved, true);
  assert.equal(report.measurements.privateManifestAgeSeconds, 2);
  assert.equal(report.measurements.privateManifestHttpStatus, 200);
  assert.ok(!JSON.stringify(report).includes(SYNTHETIC_TOKEN));
  assert.ok(!JSON.stringify(report).includes(WORKER_BASE));
  assert.ok(!JSON.stringify(report).includes('#EXTM3U'));
});

test('public Redis failure produces explicit unknown sessions rather than fictional zero viewers', async () => {
  const data = publicFixture();
  data['/api/rooms/PRB10A'].room.activeBroadcastSessions = null;
  data['/api/rooms/PRB10A'].room.broadcastSessionsStatus = 'unavailable';
  data['/api/status'].scale.broadcast.admissions.ready = false;
  const report = await observePublicRoom({roomCode: 'PRB10A', clock: () => NOW,
    fetchImpl: async url => Response.json(data[new URL(url).pathname])});
  assert.equal(report.measurements.activeSessions, null);
  assert.equal(report.level, 'critical');
  assert.ok(report.alerts.some(item => item.code === 'redis_session_count_unavailable'));
});

test('private playback URLs and HLS references remain restricted to the expected Worker, room and token', () => {
  const good = `${WORKER_BASE}index.m3u8?qsat=${SYNTHETIC_TOKEN}`;
  assert.equal(validatePlaybackUrl(good, 'PRB10A').hostname, 'qsession-live.patriciomoyano11.workers.dev');
  assert.equal(validatePlaybackUrl(good.replace('qsession-live.patriciomoyano11.workers.dev', 'live.qsession.org'), 'PRB10A').hostname, 'live.qsession.org');
  for (const value of [
    good.replace('https:', 'http:'), good.replace('PRB10A-', 'JNTUBY-'),
    good.replace('qsession-live.patriciomoyano11.workers.dev', 'untrusted.test'),
    good.replace('qsession-live.patriciomoyano11.workers.dev', 'live.qsession.org.untrusted.test'),
    `${good}&qsat=${SYNTHETIC_TOKEN}`, `${good}&other=value`, `${good}#fragment`,
  ]) assert.throws(() => validatePlaybackUrl(value, 'PRB10A'));
  const hostile = manifestSample({status: 200, headers: new Headers(),
    text: `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\nhttps://untrusted.test/segment.ts?qsat=${SYNTHETIC_TOKEN}\n`}, good, NOW);
  assert.equal(hostile.valid, false);
  const missingTime = manifestSample({status: 200, headers: new Headers(),
    text: `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n${WORKER_BASE}segment_1.ts?qsat=${SYNTHETIC_TOKEN}\n`}, good, NOW);
  assert.equal(missingTime.valid, true);
  assert.equal(missingTime.ageSeconds, null);
});

test('CLI emits only safe JSON, uses alert exit codes and never includes raw input or exception text', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-monitor-test-'));
  const file = path.join(directory, 'snapshot.json');
  const script = path.join(__dirname, '../scripts/monitor-broadcast.cjs');
  try {
    fs.writeFileSync(file, JSON.stringify(fixture(Date.now())));
    const healthy = spawnSync(process.execPath, [script, '--snapshot-file', file], {encoding: 'utf8'});
    assert.equal(healthy.status, 0);
    assert.equal(JSON.parse(healthy.stdout).level, 'ok');
    const failed = fixture(Date.now()); failed.app.httpStatus = 503;
    fs.writeFileSync(file, JSON.stringify(failed));
    const alert = spawnSync(process.execPath, [script, '--snapshot-file', file], {encoding: 'utf8'});
    assert.equal(alert.status, 1);
    assert.equal(JSON.parse(alert.stdout).level, 'critical');
    fs.writeFileSync(file, JSON.stringify({...failed, token: 'synthetic-sensitive-marker'}));
    const rejected = spawnSync(process.execPath, [script, '--snapshot-file', file], {encoding: 'utf8'});
    assert.equal(rejected.status, 2);
    assert.equal(rejected.stdout, '');
    assert.equal(JSON.parse(rejected.stderr).level, 'unknown');
    assert.ok(!rejected.stderr.includes('synthetic-sensitive-marker'));
    assert.ok(!rejected.stderr.includes(file));
  } finally { fs.unlinkSync(file); fs.rmdirSync(directory); }
});
