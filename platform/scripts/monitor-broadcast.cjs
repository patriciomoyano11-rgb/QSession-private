'use strict';

// One read-only assessment of a deliberately redacted snapshot. This command
// does not open .env, token files, logs, credentials or protected HLS URLs.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const DEFAULT_THRESHOLDS = Object.freeze({snapshotMaxAgeSeconds: 45, manifestMaxAgeSeconds: 24,
  manifestProgressMaxAgeSeconds: 30, capacityWarningRatio: 0.9});
const ROOT_FIELDS = ['schemaVersion', 'observedAt', 'roomCode', 'expectedLive', 'app', 'encoder', 'manifest', 'admissions'];

function requireFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Invalid redacted snapshot');
  }
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid aggregate measurement');
}
function nullableInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value !== null) integer(value, min, max);
}
function validateSnapshot(input) {
  requireFields(input, ROOT_FIELDS);
  if (input.schemaVersion !== 1 || typeof input.roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(input.roomCode) || typeof input.expectedLive !== 'boolean' ||
      typeof input.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observedAt))) throw new Error('Invalid snapshot scope');
  requireFields(input.app, ['httpStatus']);
  requireFields(input.encoder, ['httpStatus']);
  nullableInteger(input.app.httpStatus, 100, 599);
  nullableInteger(input.encoder.httpStatus, 100, 599);
  requireFields(input.manifest, ['httpStatus', 'ageSeconds', 'lastProgressAgeSeconds', 'mediaSequence']);
  nullableInteger(input.manifest.httpStatus, 100, 599);
  for (const field of ['ageSeconds', 'lastProgressAgeSeconds', 'mediaSequence']) nullableInteger(input.manifest[field]);
  requireFields(input.admissions, ['configured', 'redisReady', 'redisError', 'activeSessions', 'capacity']);
  if (typeof input.admissions.configured !== 'boolean' || typeof input.admissions.redisReady !== 'boolean' ||
      typeof input.admissions.redisError !== 'boolean') throw new Error('Invalid Redis status');
  nullableInteger(input.admissions.activeSessions);
  integer(input.admissions.capacity, 1, 10000);
  // Reconstruct an allowlisted object. No arbitrary field can reach the output.
  return {
    schemaVersion: 1, observedAt: new Date(input.observedAt).toISOString(), roomCode: input.roomCode,
    expectedLive: input.expectedLive, app: {httpStatus: input.app.httpStatus}, encoder: {httpStatus: input.encoder.httpStatus},
    manifest: {httpStatus: input.manifest.httpStatus, ageSeconds: input.manifest.ageSeconds,
      lastProgressAgeSeconds: input.manifest.lastProgressAgeSeconds, mediaSequence: input.manifest.mediaSequence},
    admissions: {configured: input.admissions.configured, redisReady: input.admissions.redisReady,
      redisError: input.admissions.redisError, activeSessions: input.admissions.activeSessions, capacity: input.admissions.capacity},
  };
}

function assessSnapshot(input, {now = Date.now(), thresholds = DEFAULT_THRESHOLDS} = {}) {
  const snapshot = validateSnapshot(input);
  if (!Number.isFinite(now)) throw new Error('Invalid monitor time');
  if (!thresholds || typeof thresholds !== 'object' || Object.keys(thresholds).some(key => !Object.hasOwn(DEFAULT_THRESHOLDS, key))) throw new Error('Invalid monitor thresholds');
  const limits = {...DEFAULT_THRESHOLDS, ...thresholds};
  for (const key of ['snapshotMaxAgeSeconds', 'manifestMaxAgeSeconds', 'manifestProgressMaxAgeSeconds']) integer(limits[key], 1, 300);
  if (!Number.isFinite(limits.capacityWarningRatio) || !(limits.capacityWarningRatio >= 0.5 && limits.capacityWarningRatio <= 1)) throw new Error('Invalid capacity threshold');
  const alerts = [];
  const add = (code, level = 'critical') => alerts.push({code, level});
  const age = Math.floor((now - Date.parse(snapshot.observedAt)) / 1000);
  if (age < -5) add('snapshot_from_future');
  if (age > limits.snapshotMaxAgeSeconds) add('snapshot_stale');
  if (snapshot.app.httpStatus !== 200) add('app_unhealthy');
  if (snapshot.encoder.httpStatus !== 200) add('encoder_unhealthy');
  if (snapshot.expectedLive) {
    if (snapshot.manifest.httpStatus !== 200) add('manifest_unavailable');
    if (snapshot.manifest.ageSeconds === null || snapshot.manifest.ageSeconds > limits.manifestMaxAgeSeconds) add('manifest_stale');
    if (snapshot.manifest.lastProgressAgeSeconds === null || snapshot.manifest.lastProgressAgeSeconds > limits.manifestProgressMaxAgeSeconds) add('manifest_not_advancing');
    if (snapshot.manifest.mediaSequence === null) add('manifest_sequence_unknown');
  }
  const admission = snapshot.admissions;
  if (!admission.configured) add('admissions_unconfigured');
  if (!admission.redisReady || admission.redisError) add('redis_unavailable');
  if (admission.activeSessions === null) add('session_count_unknown');
  else if (admission.activeSessions > admission.capacity) add('session_limit_exceeded');
  else if (admission.activeSessions >= admission.capacity * limits.capacityWarningRatio) add('session_limit_near', 'warning');
  const level = alerts.some(item => item.level === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok';
  return {schemaVersion: 1, kind: 'qsession-broadcast-monitor', checkedAt: new Date(now).toISOString(),
    roomCode: snapshot.roomCode, level, alerts, measurements: {...snapshot, snapshotAgeSeconds: age}, thresholds: limits,
    capacityCertified: false, changesApplied: false, externalNotificationsSent: false};
}

function encoderStatusOnly(value, {request = http.request} = {}) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.port !== '8081' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('Encoder health must be loopback HEAD on port 8081');
  }
  return new Promise(resolve => {
    const req = request(url, {method: 'HEAD'}, response => {
      // Do not consume or inspect this body: Egress can include private job
      // configuration in its health payload while a broadcast is running.
      const status = response.statusCode;
      response.destroy();
      resolve(status);
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { resolve(null); req.destroy(); });
    req.end();
  });
}

async function getBounded(url, {fetchImpl = fetch, maxBytes = 131072} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchImpl(url, {method: 'GET', redirect: 'error', signal: controller.signal,
      headers: {'Accept': 'application/json, application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache'}});
    if (!response.ok) { await response.body?.cancel(); return {status: response.status, text: '', headers: response.headers}; }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) { controller.abort(); throw new Error('Response too large'); }
      chunks.push(Buffer.from(chunk));
    }
    return {status: response.status, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers};
  } catch { return {status: null, text: '', headers: new Headers()}; }
  finally { clearTimeout(timeout); }
}

function privatePlaybackUrl(file, roomCode) {
  if (process.platform !== 'linux' || !path.isAbsolute(file) || path.extname(file) !== '.url') throw new Error('Private playback file requires Linux and .url');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.size > 4096) throw new Error('Private playback file permissions invalid');
  return validatePlaybackUrl(fs.readFileSync(file, 'utf8').trim(), roomCode);
}
function validatePlaybackUrl(value, roomCode) {
  const url = new URL(value);
  if (!/^[A-Z0-9]{6}$/.test(roomCode) || url.protocol !== 'https:' ||
      !['qsession-live.patriciomoyano11.workers.dev', 'live.qsession.org'].includes(url.hostname) ||
      url.port || url.username || url.password || url.hash || !new RegExp(`^/live/${roomCode}-[A-Za-z0-9_-]{18}/(?:index|archive)\\.m3u8$`).test(url.pathname) ||
      [...url.searchParams.keys()].length !== 1 || url.searchParams.getAll('qsat').length !== 1 ||
      !/^v1\.[A-Za-z0-9_-]{1,1800}\.[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('qsat') || '')) throw new Error('Private playback URL scope invalid');
  return url;
}
function manifestSample(response, requestUrl, now) {
  if (response.status !== 200 || !response.text.startsWith('#EXTM3U')) return {httpStatus: response.status, valid: false};
  const sequence = /^#EXT-X-MEDIA-SEQUENCE:(\d+)\s*$/m.exec(response.text);
  const lines = response.text.split(/\r?\n/);
  const uris = lines.map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  let latest;
  try {
    if (!sequence || !uris.length) throw new Error('Missing HLS measurements');
    const base = new URL(requestUrl);
    for (const uri of uris) {
      const target = new URL(uri, base);
      if (target.origin !== base.origin || target.username || target.password || target.hash ||
          !target.pathname.startsWith(base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)) ||
          !/\/segment[^/]*\.(?:ts|m4s)$/.test(target.pathname) || target.searchParams.get('qsat') !== base.searchParams.get('qsat')) throw new Error('Invalid HLS reference');
      latest = target.pathname; // kept private, never included in evidence.
    }
    const times = lines.filter(line => line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')).map(line => Date.parse(line.slice(25))).filter(Number.isFinite);
    const last = times.length ? Math.max(...times) : Date.parse(response.headers.get('Last-Modified') || '');
    return {httpStatus: 200, valid: true, mediaSequence: Number(sequence[1]), latest,
      ageSeconds: Number.isFinite(last) && last <= now + 5000 ? Math.max(0, Math.floor((now - last) / 1000)) : null};
  } catch { return {httpStatus: response.status, valid: false}; }
}

async function observePublicRoom({roomCode, playbackUrl = null, encoderHealthUrl = null,
  fetchImpl = fetch, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), clock = Date.now} = {}) {
  if (typeof roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(roomCode)) throw new Error('Invalid room');
  const urls = ['/api/status', `/api/rooms/${roomCode}/broadcast`, `/api/rooms/${roomCode}`];
  const responses = await Promise.all(urls.map(url => getBounded('https://qsession.org' + url, {fetchImpl})));
  const parsed = responses.map(item => { try { return JSON.parse(item.text); } catch { return {}; } });
  const broadcast = parsed[1].broadcast || {};
  const aggregate = parsed[0].scale?.broadcast || {};
  const room = parsed[2].room || {};
  const mode = ['interactive', 'cdn-only'].includes(aggregate.audienceMode) ? aggregate.audienceMode : 'unknown';
  const states = ['starting', 'active', 'ending', 'complete', 'failed', 'aborted', 'limit-reached', 'inactive', 'fallback-webrtc'];
  const count = Number.isSafeInteger(room.activeBroadcastSessions) && room.activeBroadcastSessions >= 0 ? room.activeBroadcastSessions : null;
  const capacity = Number.isSafeInteger(room.broadcastEventPlan?.effectiveMaxParticipants) ? room.broadcastEventPlan.effectiveMaxParticipants :
    Number.isSafeInteger(room.billingPlan?.maxParticipants) ? room.billingPlan.maxParticipants : null;
  const report = {schemaVersion: 1, kind: 'qsession-broadcast-monitor', checkedAt: new Date(clock()).toISOString(), roomCode,
    measurements: {appHttpStatus: responses[0].status, broadcastHttpStatus: responses[1].status, roomHttpStatus: responses[2].status,
      audienceMode: mode, broadcastState: states.includes(broadcast.state) ? broadcast.state : 'unknown', broadcastReady: broadcast.ready === true,
      admissionsConfigured: aggregate.admissions?.configured === true, redisReady: aggregate.admissions?.ready === true,
      sessionCountStatus: ['ready', 'unavailable'].includes(room.broadcastSessionsStatus) ? room.broadcastSessionsStatus : 'unchecked',
      activeSessions: count, capacity, encoderHttpStatus: null, encoderLoopbackUnchecked: !encoderHealthUrl,
      privatePlaybackUnchecked: !playbackUrl, privateManifestHttpStatus: null, privateManifestAgeSeconds: null,
      privatePlaybackProgressObserved: null}, thresholds: DEFAULT_THRESHOLDS, alerts: [],
    capacityCertified: false, changesApplied: false, externalNotificationsSent: false};
  const add = (code, level = 'critical') => report.alerts.push({code, level});
  if (responses[0].status !== 200 || parsed[0].ok !== true) add('app_unhealthy');
  if (responses[1].status !== 200 || !report.measurements.broadcastReady) add('broadcast_not_ready');
  if (responses[2].status !== 200) add('room_unavailable');
  if (mode !== 'cdn-only') add('cdn_only_not_active', 'warning');
  if (!report.measurements.admissionsConfigured || !report.measurements.redisReady) add('redis_not_ready', mode === 'cdn-only' ? 'critical' : 'warning');
  if (room.broadcastSessionsStatus === 'unavailable') add('redis_session_count_unavailable');
  else if (count === null) add('session_count_unchecked', 'warning');
  else if (capacity !== null && count > capacity) add('session_limit_exceeded');
  else if (capacity !== null && count >= capacity * DEFAULT_THRESHOLDS.capacityWarningRatio) add('session_limit_near', 'warning');
  if (encoderHealthUrl) {
    report.measurements.encoderHttpStatus = await encoderStatusOnly(encoderHealthUrl);
    if (report.measurements.encoderHttpStatus !== 200) add('encoder_unhealthy');
  } else add('encoder_loopback_unchecked', 'warning');
  if (!playbackUrl) add('private_playback_unchecked', 'warning');
  else {
    const target = validatePlaybackUrl(String(playbackUrl), roomCode);
    const first = manifestSample(await getBounded(target, {fetchImpl}), target, clock());
    await wait(8000);
    const second = manifestSample(await getBounded(target, {fetchImpl}), target, clock());
    report.measurements.privateManifestHttpStatus = second.httpStatus;
    report.measurements.privateManifestAgeSeconds = second.ageSeconds ?? null;
    report.measurements.privatePlaybackProgressObserved = Boolean(first.valid && second.valid && first.latest !== second.latest);
    if (!second.valid) add('private_manifest_invalid');
    if (second.ageSeconds === null || second.ageSeconds === undefined || second.ageSeconds > DEFAULT_THRESHOLDS.manifestMaxAgeSeconds) add('private_manifest_stale');
    if (!report.measurements.privatePlaybackProgressObserved) add('private_playback_progress_unconfirmed', 'warning');
  }
  report.level = report.alerts.some(item => item.level === 'critical') ? 'critical' : report.alerts.length ? 'warning' : 'ok';
  return report;
}

function syntheticSnapshot(now) {
  return {schemaVersion: 1, observedAt: new Date(now).toISOString(), roomCode: 'PRB10A', expectedLive: true,
    app: {httpStatus: 200}, encoder: {httpStatus: 200},
    manifest: {httpStatus: 200, ageSeconds: 3, lastProgressAgeSeconds: 6, mediaSequence: 42},
    admissions: {configured: true, redisReady: true, redisError: false, activeSessions: 4, capacity: 10000}};
}
function selfTest(now = Date.now()) {
  const healthy = syntheticSnapshot(now);
  const stale = syntheticSnapshot(now); stale.manifest.ageSeconds = 60; stale.manifest.lastProgressAgeSeconds = 60;
  const redis = syntheticSnapshot(now); redis.admissions.redisReady = false; redis.admissions.redisError = true; redis.admissions.activeSessions = null;
  const full = syntheticSnapshot(now); full.admissions.activeSessions = 10001;
  const cases = [
    {name: 'healthy', input: healthy, expected: []},
    {name: 'stalled_manifest', input: stale, expected: ['manifest_stale', 'manifest_not_advancing']},
    {name: 'redis_outage', input: redis, expected: ['redis_unavailable', 'session_count_unknown']},
    {name: 'over_capacity', input: full, expected: ['session_limit_exceeded']},
  ].map(item => {
    const actual = assessSnapshot(item.input, {now}).alerts.map(alert => alert.code);
    return {name: item.name, passed: JSON.stringify(actual) === JSON.stringify(item.expected), expected: item.expected, actual};
  });
  return {schemaVersion: 1, kind: 'qsession-broadcast-monitor-self-test', synthetic: true,
    passed: cases.every(item => item.passed), cases, networkRequests: 0, changesApplied: false,
    externalNotificationsSent: false, capacityCertified: false};
}

async function main(args) {
  if (args.length === 1 && args[0] === '--self-test') {
    const report = selfTest(); process.stdout.write(JSON.stringify(report) + '\n');
    if (!report.passed) process.exitCode = 1;
    return;
  }
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Uso: node scripts/monitor-broadcast.cjs --room JNTUBY [--playback-url-file archivo-root-0600] [--encoder-health-url http://127.0.0.1:8081/]\nSnapshot ya redactado: --snapshot-file agregado.json\nAutoprueba sin red: --self-test\nSólo lectura; no envía avisos, no activa ni certifica capacidad. 0=sin alertas, 1=alertas/no comprobado, 2=entrada inválida.\n');
    return;
  }
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--snapshot-file', '--encoder-health-url', '--room', '--playback-url-file'].includes(args[i]) || !args[i + 1] || Object.hasOwn(flags, args[i])) throw new Error('Invalid flags');
    flags[args[i]] = args[i + 1];
  }
  if (flags['--room']) {
    if (flags['--snapshot-file']) throw new Error('Choose one evidence source');
    const playbackUrl = flags['--playback-url-file'] ? privatePlaybackUrl(flags['--playback-url-file'], flags['--room']) : null;
    const report = await observePublicRoom({roomCode: flags['--room'], playbackUrl, encoderHealthUrl: flags['--encoder-health-url']});
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.level !== 'ok') process.exitCode = 1;
    return;
  }
  if (!flags['--snapshot-file'] || flags['--playback-url-file']) throw new Error('Missing redacted snapshot');
  if (path.extname(flags['--snapshot-file']) !== '.json') throw new Error('Snapshot must be aggregate JSON');
  const stat = fs.statSync(flags['--snapshot-file']);
  if (!stat.isFile() || stat.size > 16 * 1024) throw new Error('Invalid snapshot file');
  const snapshot = validateSnapshot(JSON.parse(fs.readFileSync(flags['--snapshot-file'], 'utf8')));
  if (flags['--encoder-health-url']) snapshot.encoder.httpStatus = await encoderStatusOnly(flags['--encoder-health-url']);
  const report = assessSnapshot(snapshot);
  process.stdout.write(JSON.stringify(report) + '\n');
  if (report.level !== 'ok') process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  // Never include exception messages, input, URLs, file paths or response bodies.
  process.stderr.write('{"schemaVersion":1,"kind":"qsession-broadcast-monitor","level":"unknown","error":"invalid_redacted_snapshot_or_options","capacityCertified":false,"changesApplied":false,"externalNotificationsSent":false}\n');
  process.exitCode = 2;
});
module.exports = {DEFAULT_THRESHOLDS, validateSnapshot, assessSnapshot, encoderStatusOnly, selfTest,
  validatePlaybackUrl, manifestSample, observePublicRoom};
