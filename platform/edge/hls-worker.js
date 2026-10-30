const LIVE_OBJECT_PATTERN = /^live\/[A-Z0-9]{6}-[A-Za-z0-9_-]{18}\/(?:index|archive|segment[^/]*)\.(?:m3u8|ts|m4s)$/;

const PREFIX_PATTERN = /^live\/([A-Z0-9]{6})-[A-Za-z0-9_-]{18}$/;
const AUTH_CACHE_SECONDS = 20;
// Increased from 32768 to 65536 to improve RAM hit rate under 10k concurrent listeners.
const AUTH_APPROVAL_SLOTS = 65536;
const AUTH_APPROVAL_PROBES = 64;
// Positive approvals retain only a full SHA-256 fingerprint and absolute
// expiry: 2,621,440 backing bytes per isolate, with no per-entry heap objects.
// That table stays well under the Cloudflare Workers 128 MB isolate limit.
const AUTH_APPROVAL_BYTES = AUTH_APPROVAL_SLOTS * (8 * Uint32Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT);
const approvalHashes = new Uint32Array(AUTH_APPROVAL_SLOTS * 8);
const approvalExpirations = new Float64Array(AUTH_APPROVAL_SLOTS);
const AUTH_PENDING_LIMIT = 8192; // More headroom for concurrent admission checks at 10k scale
const AUTH_FAILURE_BACKOFF_MS = 1000;
const pendingApprovals = new Map();
const admissionStats = {ram: 0, cache: 0, evicted: 0, pendingPeak: 0, attempts: 0};
let admissionSweepAt = 0;
let admissionStatsLoggedAt = -Infinity;
const pendingCacheFills = new Map();
const CACHE_FILL_LIMIT = 64;
const CACHE_FILL_WAIT_MS = 4000;
// Bounds apply to one Worker isolate, not to a colo or the whole deployment.
// A cold fill gets less than one six-second segment interval. Waiters never
// turn an expired fill into one upstream request per listener.
const CACHE_FILL_WAITERS_PER_KEY = 192;
const CACHE_FILL_TOTAL_WAITERS = 384;
const CACHE_FILL_FAILURE_BACKOFF_MS = 1000;
let cacheFillWaiters = 0;
const pendingCanaryMetadata = new Map();
const R2_EDGE_READ_LIMIT = 4;
const R2_EDGE_READ_QUEUE_LIMIT = 16;
let r2EdgeReads = 0;
const r2EdgeReadQueue = [];
const pendingCanaryBodies = new Map();
const r2EdgeBodies = new Map();
const pendingCanaryCacheWrites = new Map();
const R2_EDGE_BODY_BYTES_LIMIT = 32 * 1024 * 1024;
const R2_EDGE_BODY_KEY_LIMIT = 64;
const R2_EDGE_BODY_TTL_MS = 12000;
const R2_EDGE_PLAYLIST_TTL_MS = 750;
const R2_EDGE_CACHE_WRITE_LIMIT = 2;
const R2_EDGE_BODY_READER_LIMIT = 256;
let r2EdgeBodyBytes = 0;
let r2EdgeBodyCount = 0;
let r2EdgeBodyReaders = 0;
const canaryCacheLogTimes = new Map();
const encoder = new TextEncoder();
const MEDIA_FAILURE_CODES = new Set(['storage-read', 'storage-body-read', 'storage-size',
  'storage-incomplete', 'object-queue', 'read-queue', 'shared-overloaded', 'shared-retryable',
  'shared-response', 'shared-metadata', 'shared-request', 'edge-fill', 'edge-stream',
  'shared-stream', 'stream-cancelled', 'edge-fill-timeout', 'edge-fill-queue',
  'edge-not-retained', 'edge-read-queue', 'edge-cache-unavailable', 'edge-body-budget', 'edge-body-readers']);
const mediaFailureLogTimes = new Map();

function mediaError(code) {
  const error = new Error('Media operation failed');
  error.qsessionMediaFailure = code;
  return error;
}

function mediaFailureCode(error, fallback) {
  if (MEDIA_FAILURE_CODES.has(error?.qsessionMediaFailure)) return error.qsessionMediaFailure;
  if (error?.overloaded === true) return 'shared-overloaded';
  if (error?.retryable === true) return 'shared-retryable';
  return fallback;
}

function recordMediaFailure(code) {
  if (!MEDIA_FAILURE_CODES.has(code)) return;
  const now = Date.now(), previous = mediaFailureLogTimes.get(code);
  if (previous !== undefined && now - previous < 30000) return;
  mediaFailureLogTimes.set(code, now);
  // Only constant codes enter logs. Never include exception text, object keys,
  // tokens or request headers. Provider event metadata supplies correlation.
  console.warn('qsession-media-failure', JSON.stringify({code}));
}

function mediaFailureHeaders(code) {
  recordMediaFailure(code);
  return {'X-QSession-Media-Failure': code};
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-None-Match',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, Accept-Ranges, X-QSession-Media-Failure, X-QSession-Edge-Cache, X-QSession-Cache-Fill, X-QSession-Cache-Fill-State, X-QSession-Cache-Recovery, X-QSession-Cache-Phase, X-QSession-Admission-Failure, X-QSession-Admission-Phase, X-QSession-Admission-Attempts, X-QSession-Admission-Stats',
  };
}

function textResponse(request, status, message, extra = {}) {
  return new Response(request.method === 'HEAD' ? null : message, {
    status,
    headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(), ...extra},
  });
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('Invalid base64url');
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function verifyToken(token, secret, room, objectKey) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, decodeBase64Url(parts[2]), encoder.encode(`v1.${parts[1]}`))) return null;
    const payload = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(decodeBase64Url(parts[1])));
    if (payload.v !== 1 || payload.aud !== 'qsession-hls' || payload.code !== room ||
        !PREFIX_PATTERN.test(payload.prefix) || !payload.prefix.startsWith(`live/${room}-`) ||
        !/^[A-Za-z0-9_-]{22,128}$/.test(payload.lease) || !Number.isSafeInteger(payload.exp) ||
        (payload.generation !== undefined && (typeof payload.generation !== 'string' || payload.generation.length > 100)) ||
        payload.exp <= Math.floor(Date.now() / 1000) || !objectKey.startsWith(`${payload.prefix}/`)) return null;
    return payload;
  } catch {
    return null;
  }
}

function approvalMatches(slot, fingerprint) {
  const offset = slot * 8;
  let difference = 0;
  for (let word = 0; word < 8; word++) difference |= approvalHashes[offset + word] ^ fingerprint[word];
  return difference === 0;
}

function rememberApproval(fingerprint, until) {
  const now = Date.now();
  if (!Number.isFinite(until) || until <= now || until > now + AUTH_CACHE_SECONDS * 1000) return;
  const home = fingerprint[0] & (AUTH_APPROVAL_SLOTS - 1);
  let vacant = -1, oldest = home, same = false;
  for (let probe = 0; probe < AUTH_APPROVAL_PROBES; probe++) {
    const slot = (home + probe) & (AUTH_APPROVAL_SLOTS - 1);
    if (approvalMatches(slot, fingerprint)) { vacant = slot; same = true; break; }
    if (approvalExpirations[slot] <= now && vacant === -1) vacant = slot;
    if (approvalExpirations[slot] < approvalExpirations[oldest]) oldest = slot;
  }
  // Search the whole bounded window for an existing fingerprint before using
  // an earlier empty/expired slot. Overflow only evicts; it can never approve a
  // different hash, and a displaced caller must check admission again.
  const target = vacant === -1 ? oldest : vacant;
  if (!same && approvalExpirations[target] > now) countAdmission('evicted');
  approvalHashes.set(fingerprint, target * 8);
  approvalExpirations[target] = until;
}

function countAdmission(name) {
  admissionStats[name] = Math.min(2147483647, admissionStats[name] + 1);
}

function memoryApproval(fingerprint) {
  const now = Date.now(), home = fingerprint[0] & (AUTH_APPROVAL_SLOTS - 1);
  // Empty and expired slots never terminate probing: a later colliding hash
  // may still be valid. Lookup does not change the absolute approval expiry.
  for (let probe = 0; probe < AUTH_APPROVAL_PROBES; probe++) {
    const slot = (home + probe) & (AUTH_APPROVAL_SLOTS - 1);
    if (approvalExpirations[slot] > now && approvalMatches(slot, fingerprint)) {
      countAdmission('ram');
      return approvalExpirations[slot];
    }
  }
  return 0;
}

function admissionErrorHeaders(phase, attempts) {
  // Only constant phases and bounded numeric counters leave this isolate.
  const safePhase = ['pending-limit', 'backoff', 'cache', 'backend', 'token-expired'].includes(phase) ? phase : 'backend';
  const safeAttempts = Math.max(0, Math.min(2, Number(attempts) || 0));
  const now = Date.now();
  if (now - admissionStatsLoggedAt >= 30000) {
    admissionStatsLoggedAt = now;
    console.warn('qsession-admission-stats', JSON.stringify({phase: safePhase, operationAttempts: safeAttempts, ...admissionStats}));
  }
  return {'X-QSession-Admission-Phase': safePhase, 'X-QSession-Admission-Attempts': String(safeAttempts),
    'X-QSession-Admission-Stats': Object.entries(admissionStats).map(([name, value]) => `${name}=${value}`).join(';')};
}

async function checkAdmission(request, env, context, room, objectKey) {
  const secret = String(env.QSESSION_ADMISSION_SECRET || '');
  let api;
  try {
    api = new URL(env.QSESSION_ADMISSION_API);
    if (api.protocol !== 'https:' || api.username || api.password || encoder.encode(secret).byteLength < 32) throw new Error('Invalid configuration');
  } catch {
    return {error: textResponse(request, 503, 'La admisión de espectadores no está disponible')};
  }
  const url = new URL(request.url);
  const tokens = url.searchParams.getAll('qsat');
  const token = tokens.length === 1 ? tokens[0] : '';
  // Every request verifies its own signature, scope and expiry before joining.
  const payload = await verifyToken(token, secret, room, objectKey);
  if (!payload) return {error: textResponse(request, 403, 'Acceso de reproducción no válido o vencido')};
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(
    `${api.href}\n${payload.code}\n${payload.prefix}\n${payload.generation ?? ''}\n${payload.lease}\n${secret}`));
  const fingerprint = new Uint32Array(digest);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const cacheKey = new Request(`${url.origin}/__qsession_admission/v1/${hash}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return {error: textResponse(request, 403, 'Acceso de reproducción no válido o vencido')};
  if (memoryApproval(fingerprint)) return {token, payload};
  const now = Date.now();
  // Backoffs share the same bounded map. Scan at most once per second, rather
  // than once per segment; a targeted expired result is also removed below.
  if (now >= admissionSweepAt) {
    admissionSweepAt = now + AUTH_FAILURE_BACKOFF_MS;
    for (const [key, item] of pendingApprovals) {
      if (item.settled && item.until <= now) pendingApprovals.delete(key);
    }
  }
  let entry = pendingApprovals.get(hash);
  if (entry?.settled && entry.until <= now) { pendingApprovals.delete(hash); entry = null; }
  const backoff = Boolean(entry?.settled);
  if (!entry) {
    if (pendingApprovals.size >= AUTH_PENDING_LIMIT) {
      return {error: textResponse(request, 503, 'No se pudo comprobar el aforo; vuelve a intentarlo', {
        'Retry-After': '1', 'X-QSession-Admission-Failure': 'edge-pending-limit',
        ...admissionErrorHeaders('pending-limit', 0),
      })};
    }
    const controller = new AbortController();
    entry = {settled: false, until: Infinity, phase: 'cache', attempts: 0};
    let expire;
    const deadline = new Promise(resolve => { expire = resolve; });
    // One unchanged four-second budget covers the entire shared check. Even a
    // non-cooperative cache/fetch stays registered until the real work settles.
    const timeout = setTimeout(() => {
      controller.abort();
      expire({status: 503, reason: 'backend-timeout', phase: entry.phase, attempts: entry.attempts});
    }, 4000);
    pendingApprovals.set(hash, entry);
    admissionStats.pendingPeak = Math.max(admissionStats.pendingPeak, pendingApprovals.size);
    const operation = Promise.resolve().then(async () => {
      try {
        if (memoryApproval(fingerprint)) return {status: 200};
        if (cache) {
          try {
            const hit = await cache.match(cacheKey);
            const saved = hit ? await hit.json() : null;
            if (controller.signal.aborted) throw new Error('Admission deadline');
            const checkedAt = Date.now();
            if (saved && Number.isFinite(saved.until) && saved.until > checkedAt && saved.until <= checkedAt + AUTH_CACHE_SECONDS * 1000) {
              rememberApproval(fingerprint, saved.until);
              countAdmission('cache');
              return {status: 200};
            }
          } catch { /* Cache errors never approve a request. */ }
        }
        if (controller.signal.aborted) throw new Error('Admission deadline');
        // Another approval may have completed while Cache API was awaited.
        if (memoryApproval(fingerprint)) return {status: 200};
        entry.phase = 'backend';
        let response, text, recovery;
        // Preserve the existing retry policy and deadlines. These checks renew
        // the same lease; they never allocate an additional seat.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (controller.signal.aborted) throw new Error('Admission deadline');
          const attemptController = new AbortController();
          const abortAttempt = () => attemptController.abort();
          controller.signal.addEventListener('abort', abortAttempt, {once: true});
          const attemptTimeout = attempt === 0 ? setTimeout(abortAttempt, 1750) : null;
          try {
            entry.attempts++;
            countAdmission('attempts');
            response = await fetch(api.href, {
              method: 'POST', redirect: 'manual', signal: attemptController.signal,
              headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
              body: JSON.stringify({token, objectKey}),
            });
            if (!attempt && [502, 503, 504, 520, 521, 522, 523, 524].includes(response.status)) {
              recovery = 'gateway';
              response.body?.cancel().catch(() => {});
              await new Promise(resolve => setTimeout(resolve, 75));
              continue;
            }
            if (response.status === 403 || response.status === 401) return {status: 403};
            if (response.status === 410) return {status: 410};
            if (!response.ok) return {status: 503, reason: `backend-${response.status}`};
            text = await response.text();
            break;
          } catch (error) {
            const message = String(error?.message || '').toLowerCase();
            const network = error?.name === 'TypeError' && /network|connection|socket|fetch failed/.test(message)
              && !/ssl|tls|certificate|redirect|invocation/.test(message);
            if (!attempt && !controller.signal.aborted && (attemptController.signal.aborted || network)) {
              recovery = attemptController.signal.aborted ? 'timeout' : 'network';
              response?.body?.cancel().catch(() => {});
              await new Promise(resolve => setTimeout(resolve, 75));
              continue;
            }
            throw error;
          } finally {
            if (attemptTimeout !== null) clearTimeout(attemptTimeout);
            controller.signal.removeEventListener('abort', abortAttempt);
          }
        }
        if (controller.signal.aborted) throw new Error('Admission deadline');
        if (text.length > 1024) return {status: 503, reason: 'backend-response-size'};
        const result = JSON.parse(text);
        if (result.ok !== true) return {status: 503, reason: 'backend-response-shape'};
        if (payload.exp <= Math.floor(Date.now() / 1000)) return {status: 403};
        const seconds = Math.max(0, Math.min(AUTH_CACHE_SECONDS, Number(result.cacheSeconds) || 0, payload.exp - Math.floor(Date.now() / 1000)));
        if (seconds > 0) {
          const until = Date.now() + seconds * 1000;
          rememberApproval(fingerprint, until);
          if (cache) context.waitUntil(Promise.resolve().then(() => cache.put(cacheKey, new Response(JSON.stringify({until}), {
            headers: {'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}`},
          }))).catch(() => {}));
        }
        return {status: 200, recovery};
      } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        const failure = error instanceof SyntaxError ? 'json' : message.includes('redirect') ? 'redirect'
          : /ssl|tls|certificate/.test(message) ? 'tls' : message.includes('dns') ? 'dns'
          : message.includes('illegal invocation') ? 'invocation' : /network|connection/.test(message) ? 'network' : 'request';
        return {status: 503, reason: controller.signal.aborted ? 'backend-timeout' : `backend-${failure}`};
      }
    }).then(result => {
      clearTimeout(timeout);
      if (controller.signal.aborted) result = {status: 503, reason: 'backend-timeout'};
      entry.settled = true;
      entry.until = Date.now() + AUTH_FAILURE_BACKOFF_MS;
      if (result.status !== 503 && pendingApprovals.get(hash) === entry) pendingApprovals.delete(hash);
      return {...result, phase: entry.phase, attempts: entry.attempts};
    });
    entry.promise = Promise.race([operation, deadline]);
    context.waitUntil(operation);
  }
  const result = await entry.promise;
  // Refreshed tokens can share a lease, but an expired waiter's own token can
  // never inherit the leader's approval or a longer token lifetime.
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return {error: textResponse(request, 403, 'Acceso de reproducción no válido o vencido',
      admissionErrorHeaders('token-expired', result.attempts))};
  }
  if (result.status !== 200) return {error: textResponse(request, result.status,
    result.status === 410 ? 'La admisión ha finalizado' : result.status === 403 ? 'Acceso de reproducción denegado' : 'No se pudo comprobar el aforo; vuelve a intentarlo', {
      ...(result.reason ? {'X-QSession-Admission-Failure': result.reason} : {}),
      ...(result.status === 503 ? {'Retry-After': '1'} : {}),
      ...admissionErrorHeaders(backoff ? 'backoff' : result.phase, backoff ? 0 : result.attempts),
    })};
  return {token, payload, admissionRecovery: result.recovery};
}
function playlistForAdmission(text, requestUrl, admission) {
  function rewrite(uri) {
    if (!uri || uri.includes('\\') || uri.includes('#')) throw new Error('Invalid HLS URI');
    const target = new URL(uri, requestUrl);
    const base = new URL(requestUrl);
    const key = decodeURIComponent(target.pathname.replace(/^\/+/, ''));
    if (target.origin !== base.origin || target.username || target.password ||
        !LIVE_OBJECT_PATTERN.test(key) || !key.startsWith(`${admission.payload.prefix}/`)) throw new Error('HLS URI outside admitted stream');
    target.searchParams.set('qsat', admission.token);
    return target.href;
  }
  return text.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) return rewrite(trimmed);
    if (!trimmed.startsWith('#EXT-X-') || !trimmed.includes('URI=')) return line;
    let count = 0;
    const rewritten = line.replace(/\bURI=("[^"]*"|[^,\s"]+)/g, (match, value) => {
      count += 1;
      return `URI="${rewrite(value.startsWith('"') ? value.slice(1, -1) : value)}"`;
    });
    if (count !== (line.match(/\bURI=/g) || []).length) throw new Error('Invalid HLS URI attribute');
    return rewritten;
  }).join('\n');
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return {offset: start, length: end - start + 1};
}

function storageResponse(object, isPlaylist, range = null, context) {
  const headers = new Headers(corsHeaders());
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(range ? range.length : object.size));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  if (isPlaylist) {
    headers.set('Content-Type', 'application/vnd.apple.mpegurl');
    headers.set('Cache-Control', 'public, max-age=1, s-maxage=2, must-revalidate');
  } else {
    headers.set('Cache-Control', 'public, max-age=86400, immutable');
  }
  let body = object.body || null;
  // workerd derives Content-Length from the stream, ignoring a manually set
  // header on an arbitrary ReadableStream. Native cached ranges need that
  // length. Pipe without buffering a complete video segment in isolate memory.
  if (body && typeof body.pipeTo === 'function' && typeof FixedLengthStream !== 'undefined') {
    const stream = new FixedLengthStream(range ? range.length : object.size);
    const piping = body.pipeTo(stream.writable).catch(error => {
      recordMediaFailure(error?.name === 'AbortError' ? 'stream-cancelled' : 'edge-stream');
    });
    context.waitUntil(piping);
    body = stream.readable;
  }
  return new Response(body, {status: range ? 206 : 200, headers});
}

async function cachedObject(cache, cacheKey, request, hasRange, requireCachedRange = false) {
  let cached;
  try { cached = await cache.match(cacheKey); } catch { return null; }
  if (!cached || !hasRange) return cached;
  const size = Number(cached.headers.get('Content-Length'));
  const range = parseRange(request.headers.get('Range'), size);
  // The full representation is used only for its metadata. Cloudflare's Cache
  // API slices the body of a cached 200 response for the subsequent Range GET.
  cached.body?.cancel().catch(() => {});
  if (!range) return textResponse(request, 416, 'Rango no válido', {
    'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes',
  });
  try {
    const partial = await cache.match(new Request(cacheKey, {
      headers: {Range: `bytes=${range.offset}-${range.offset + range.length - 1}`},
    }));
    if (partial?.status === 206) return partial;
    partial?.body?.cancel().catch(() => {});
  } catch { /* The legacy route can still perform a scoped storage read. */ }
  if (requireCachedRange) return fillFailureResponse(request, fillResult('failed', {code: 'edge-not-retained'}));
  return null;
}

function fillResult(state, extra = {}) {
  return {state, stored: state === 'stored', missing: state === 'missing', failed: state === 'failed', ...extra};
}

function cancelBody(body) {
  try { return Promise.resolve(body?.cancel?.()).catch(() => {}); }
  catch { return Promise.resolve(); }
}

async function sharedMediaOperation(operations, identity, context, perform) {
  // Failed operations have a short, bounded backoff, but missing live objects
  // are never negative cached. A timed-out upstream operation stays registered
  // until it settles, even when that upstream ignores cancellation.
  const now = Date.now();
  for (const [name, entry] of operations) {
    if (entry.settled && entry.until <= now) operations.delete(name);
  }
  let entry = operations.get(identity);
  const joined = Boolean(entry);
  if (cacheFillWaiters >= CACHE_FILL_TOTAL_WAITERS || (entry?.waiters || 0) >= CACHE_FILL_WAITERS_PER_KEY ||
      (!entry && operations.size >= CACHE_FILL_LIMIT)) {
    return fillResult('pending', {joined, code: 'edge-fill-queue'});
  }
  if (!entry) {
    const controller = new AbortController();
    entry = {controller, waiters: 0, settled: false, until: Infinity};
    let expire;
    const deadline = new Promise(resolve => { expire = resolve; });
    const timer = setTimeout(() => {
      controller.abort();
      recordMediaFailure('edge-fill-timeout');
      expire(fillResult('timed-out', {code: 'edge-fill-timeout'}));
    }, CACHE_FILL_WAIT_MS);
    // Register before starting work, including a synchronously failing source.
    operations.set(identity, entry);
    const operation = Promise.resolve().then(() => perform(controller.signal)).catch(error => {
      const code = controller.signal.aborted ? 'edge-fill-timeout' : mediaFailureCode(error, 'edge-fill');
      recordMediaFailure(code);
      return fillResult(controller.signal.aborted ? 'timed-out' : 'failed', {code});
    }).then(result => {
      clearTimeout(timer);
      if (controller.signal.aborted) result = fillResult('timed-out', {code: 'edge-fill-timeout'});
      entry.settled = true;
      entry.until = Date.now() + CACHE_FILL_FAILURE_BACKOFF_MS;
      if (result.state !== 'failed' && result.state !== 'timed-out' && operations.get(identity) === entry) {
        operations.delete(identity);
      }
      return result;
    });
    entry.promise = Promise.race([operation, deadline]);
    context.waitUntil(operation);
  }
  entry.waiters++;
  cacheFillWaiters++;
  try { return {...await entry.promise, joined}; }
  finally { entry.waiters--; cacheFillWaiters--; }
}

async function fillObjectCache(cache, cacheKey, env, key, isPlaylist, context, readObject = async () => {
  try { return await env.QSESSION_LIVE.get(key); }
  catch { throw mediaError('storage-read'); }
}) {
  return sharedMediaOperation(pendingCacheFills, cacheKey.url, context, async signal => {
    let object, response;
    const abort = () => { cancelBody(response?.body); cancelBody(object?.body); };
    signal.addEventListener('abort', abort, {once: true});
    try {
      object = await readObject(signal);
      if (signal.aborted) throw mediaError('edge-fill-timeout');
      if (!object) return fillResult('missing');
      // Only canonical bytes enter the cache. Personalized manifests never do.
      response = storageResponse(object, isPlaylist, null, context);
      await cache.put(cacheKey, response);
      if (signal.aborted) throw mediaError('edge-fill-timeout');
      // Verify retention inside the shared operation so a discarded write also
      // gets failure backoff. A later wave must not immediately refill it.
      const retained = await cache.match(cacheKey);
      if (!retained) throw mediaError('edge-not-retained');
      const valid = retained.status === 200 && Number(retained.headers.get('Content-Length')) === object.size;
      // Do not wait on a disposable cached/tee branch: its cancellation can
      // await a different consumer. The source read is closed below instead.
      cancelBody(retained.body);
      if (!valid) throw mediaError('edge-not-retained');
      return fillResult('stored');
    } catch (error) {
      throw mediaError(object?.readFailure?.() || mediaFailureCode(error, 'edge-fill'));
    } finally {
      signal.removeEventListener('abort', abort);
      // Cache rejection may leave its response/source body unread or locked.
      // The canary reader owns a cancellable source reader as well.
      await cancelBody(response?.body);
      await cancelBody(object?.body);
      await object?.closeRead?.();
    }
  });
}

function releaseR2EdgeRead() {
  const next = r2EdgeReadQueue.shift();
  if (next) {
    next.signal.removeEventListener('abort', next.abort);
    next.resolve();
  } else r2EdgeReads--;
}

async function acquireR2EdgeRead(signal) {
  if (signal.aborted) throw mediaError('edge-fill-timeout');
  if (r2EdgeReads < R2_EDGE_READ_LIMIT) { r2EdgeReads++; return; }
  if (r2EdgeReadQueue.length >= R2_EDGE_READ_QUEUE_LIMIT) throw mediaError('edge-read-queue');
  await new Promise((resolve, reject) => {
    const item = {resolve, signal, abort() {
      const index = r2EdgeReadQueue.indexOf(item);
      if (index !== -1) r2EdgeReadQueue.splice(index, 1);
      reject(mediaError('edge-fill-timeout'));
    }};
    r2EdgeReadQueue.push(item);
    signal.addEventListener('abort', item.abort, {once: true});
  });
  if (signal.aborted) { releaseR2EdgeRead(); throw mediaError('edge-fill-timeout'); }
}

function recordCanaryCachePhase(phase) {
  if (!['miss', 'readError', 'putReject', 'verifyInvalid'].includes(phase)) return;
  const now = Date.now(), previous = canaryCacheLogTimes.get(phase);
  if (previous !== undefined && now - previous < 30000) return;
  canaryCacheLogTimes.set(phase, now);
  console.warn('qsession-r2-edge-cache', JSON.stringify({phase}));
}

function releaseCanaryBody(entry) {
  if (entry.retained || entry.refs || !entry.counted) return;
  entry.counted = false;
  r2EdgeBodyBytes -= entry.reserved;
  r2EdgeBodyCount--;
  entry.blob = null;
}

function retireCanaryBody(key, entry) {
  if (r2EdgeBodies.get(key) === entry) r2EdgeBodies.delete(key);
  entry.retained = false;
  releaseCanaryBody(entry);
}

function canaryBody(key) {
  const entry = r2EdgeBodies.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) { retireCanaryBody(key, entry); return null; }
  // Looking at a body never renews its original deadline.
  return entry;
}

function makeCanaryBodyRoom(bytes, count) {
  for (const [key, entry] of r2EdgeBodies) {
    if (entry.until <= Date.now()) retireCanaryBody(key, entry);
  }
  for (const [key, entry] of r2EdgeBodies) {
    if (r2EdgeBodyBytes + bytes <= R2_EDGE_BODY_BYTES_LIMIT && r2EdgeBodyCount + count <= R2_EDGE_BODY_KEY_LIMIT) break;
    if (!entry.refs) retireCanaryBody(key, entry);
  }
  if (r2EdgeBodyBytes + bytes > R2_EDGE_BODY_BYTES_LIMIT || r2EdgeBodyCount + count > R2_EDGE_BODY_KEY_LIMIT) {
    throw mediaError('edge-body-budget');
  }
}

function reserveCanaryBody(size) {
  // Include source backing storage, normalized chunks and the Blob copy.
  // Retired bodies stay counted until every reader/writer ends.
  const reserved = size * 3;
  makeCanaryBodyRoom(reserved, 1);
  r2EdgeBodyBytes += reserved;
  r2EdgeBodyCount++;
  return {reserved, size, refs: 1, retained: false, counted: true, blob: null};
}

async function verifiedCanaryBody(body, size, metadata, signal) {
  let entry;
  try { entry = reserveCanaryBody(size); }
  catch (error) { cancelBody(body); throw error; }
  let reader, chunks = [], received = 0, completed = false;
  const abort = () => { try { reader?.cancel().catch(() => {}); } catch { /* Already closed. */ } };
  try {
    reader = body.getReader();
    signal.addEventListener('abort', abort, {once: true});
    while (true) {
      if (signal.aborted) throw mediaError('edge-fill-timeout');
      let item;
      try { item = await reader.read(); } catch { throw mediaError('storage-body-read'); }
      if (signal.aborted) throw mediaError('edge-fill-timeout');
      if (item.done) break;
      if (!ArrayBuffer.isView(item.value) || item.value.byteLength > size - received) throw mediaError('storage-incomplete');
      received += item.value.byteLength;
      // A small view can retain a much larger source ArrayBuffer. Normalize
      // owned chunks, counting any larger backing while it is being copied.
      const extra = Math.max(0, item.value.buffer.byteLength - size);
      makeCanaryBodyRoom(extra, 0);
      r2EdgeBodyBytes += extra;
      entry.reserved += extra;
      try {
        for (let offset = 0; offset < item.value.byteLength; offset += 65536) {
          const length = Math.min(65536, item.value.byteLength - offset);
          chunks.push(new Uint8Array(new Uint8Array(item.value.buffer, item.value.byteOffset + offset, length)));
        }
      } finally {
        item = null;
        entry.reserved -= extra;
        r2EdgeBodyBytes -= extra;
      }
    }
    if (received !== size) throw mediaError('storage-incomplete');
    entry.blob = new Blob(chunks);
    chunks = null;
    if (entry.blob.size !== size) throw mediaError('storage-incomplete');
    Object.assign(entry, metadata);
    entry.until = Math.min(Date.now() + metadata.ttl, metadata.until || Infinity);
    if (entry.until <= Date.now()) throw mediaError('edge-not-retained');
    r2EdgeBodyBytes -= size * 2;
    entry.reserved = size;
    completed = true;
    return entry;
  } finally {
    signal.removeEventListener('abort', abort);
    chunks = null;
    // Keep the construction reservation while cancellation can still retain
    // the source. A non-cooperative source keeps its bounded fill registered.
    try { if (reader) await reader.cancel(); else await cancelBody(body); }
    catch { /* Cancellation cannot turn an invalid body into a valid one. */ }
    finally {
      try { reader?.releaseLock(); } catch { /* Cancellation already released it. */ }
      if (!completed) { entry.refs--; releaseCanaryBody(entry); }
    }
  }
}

function canaryMetadata(headers, isPlaylist, size, until) {
  return {size, etag: headers.get('ETag') || '',
    type: isPlaylist ? 'application/vnd.apple.mpegurl' : headers.get('Content-Type') || 'application/octet-stream',
    ttl: isPlaylist ? R2_EDGE_PLAYLIST_TTL_MS : R2_EDGE_BODY_TTL_MS, until};
}

function validCanarySize(size, isPlaylist) {
  return Number.isSafeInteger(size) && size > 0 && size <= (isPlaylist ? 65536 : SHARED_OBJECT_LIMIT);
}

async function matchCanaryCache(cache, cacheKey, isPlaylist) {
  if (!cache) { recordCanaryCachePhase('miss'); return {phase: 'miss'}; }
  let response;
  try { response = await cache.match(cacheKey); }
  catch { recordCanaryCachePhase('readError'); return {phase: 'readError'}; }
  if (!response) { recordCanaryCachePhase('miss'); return {phase: 'miss'}; }
  const size = Number(response.headers.get('Content-Length'));
  const expiry = isPlaylist ? response.headers.get('X-QSession-R2-Body-Until') : null;
  const until = expiry === null ? undefined : Number(expiry);
  if (response.status !== 200 || !validCanarySize(size, isPlaylist) || !response.body ||
      (until !== undefined && (!Number.isSafeInteger(until) || until <= Date.now()))) {
    cancelBody(response.body);
    recordCanaryCachePhase('verifyInvalid');
    return {phase: 'verifyInvalid'};
  }
  return {response, size, until};
}

async function loadCanaryBody(cache, cacheKey, env, key, isPlaylist, context) {
  if (canaryBody(cacheKey.url)) return fillResult('stored', {hit: true});
  return sharedMediaOperation(pendingCanaryBodies, cacheKey.url, context, async signal => {
    if (canaryBody(cacheKey.url)) return fillResult('stored', {hit: true});
    const cached = await matchCanaryCache(cache, cacheKey, isPlaylist);
    let phase = cached.phase, entry;
    if (cached.response) {
      try {
        entry = await verifiedCanaryBody(cached.response.body, cached.size,
          canaryMetadata(cached.response.headers, isPlaylist, cached.size, cached.until), signal);
      } catch (error) {
        if (signal.aborted || error?.qsessionMediaFailure === 'edge-body-budget') throw error;
        phase = error?.qsessionMediaFailure === 'storage-incomplete' ? 'verifyInvalid' : 'readError';
        recordCanaryCachePhase(phase);
      }
    }
    if (!entry) {
      await acquireR2EdgeRead(signal);
      let object;
      try {
        try { object = await env.QSESSION_LIVE.get(key); } catch { throw mediaError('storage-read'); }
        if (signal.aborted) throw mediaError('edge-fill-timeout');
        if (!object) return fillResult('missing');
        if (!validCanarySize(object.size, isPlaylist) || !object.body) throw mediaError('storage-size');
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('ETag', object.httpEtag);
        entry = await verifiedCanaryBody(object.body, object.size,
          canaryMetadata(headers, isPlaylist, object.size), signal);
      } finally {
        await cancelBody(object?.body);
        releaseR2EdgeRead();
      }
    }
    if (signal.aborted) { entry.refs--; releaseCanaryBody(entry); throw mediaError('edge-fill-timeout'); }
    entry.retained = true;
    entry.refs--;
    entry.phase = phase;
    r2EdgeBodies.set(cacheKey.url, entry);
    if (!cached.response || phase) writeCanaryCache(cache, cacheKey, entry, isPlaylist, context);
    return fillResult('stored', {hit: Boolean(cached.response && !phase)});
  });
}

function canaryBodyStream(entry, start, length, context) {
  if (r2EdgeBodyReaders >= R2_EDGE_BODY_READER_LIMIT) throw mediaError('edge-body-readers');
  r2EdgeBodyReaders++;
  entry.refs++;
  let offset = start, closed = false, pending, streamController, released = false;
  const release = () => {
    if (released) return;
    released = true;
    r2EdgeBodyReaders--;
    entry.refs--;
    releaseCanaryBody(entry);
  };
  const stop = async error => {
    if (!closed) {
      closed = true;
      if (error) { try { streamController?.error(error); } catch { /* Already closed. */ } }
    }
    try { await pending; } catch { /* A failed slice is already reported. */ }
    release();
  };
  const source = new ReadableStream({
    start(controller) { streamController = controller; },
    async pull(controller) {
      try {
        if (closed) return;
        if (offset >= start + length) { closed = true; controller.close(); release(); return; }
        const end = Math.min(start + length, offset + 65536);
        // Only immutable bytes cross request contexts. Each request owns its
        // stream and at most one 64 KiB slice, including cancellation in flight.
        pending = entry.blob.slice(offset, end).arrayBuffer();
        const bytes = await pending;
        pending = null;
        if (!closed) { offset = end; controller.enqueue(new Uint8Array(bytes)); }
      } catch (error) {
        recordMediaFailure('edge-stream');
        await stop(error);
      }
    },
    cancel() { return stop(); },
  }, {highWaterMark: 0});
  let body = source;
  if (typeof FixedLengthStream !== 'undefined') {
    const fixed = new FixedLengthStream(length);
    context.waitUntil(source.pipeTo(fixed.writable).catch(error => {
      recordMediaFailure(error?.name === 'AbortError' ? 'stream-cancelled' : 'edge-stream');
    }));
    body = fixed.readable;
  }
  return {body, cancel: () => stop(mediaError('stream-cancelled'))};
}

function canaryBodyResponse(request, entry, isPlaylist, context, forCache = false) {
  const range = !forCache && request.method === 'GET' && !isPlaylist && request.headers.has('Range') ?
    parseRange(request.headers.get('Range'), entry.size) : null;
  if (!forCache && request.method === 'GET' && !isPlaylist && request.headers.has('Range') && !range) {
    return {response: textResponse(request, 416, 'Rango no válido', {
      'Content-Range': `bytes */${entry.size}`, 'Accept-Ranges': 'bytes',
    })};
  }
  const headers = new Headers({...corsHeaders(), 'Content-Type': entry.type,
    'Content-Length': String(range ? range.length : entry.size), 'ETag': entry.etag,
    'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': isPlaylist ? 'public, max-age=1, must-revalidate' : 'public, max-age=86400, immutable'});
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${entry.size}`);
  if (forCache && isPlaylist) headers.set('X-QSession-R2-Body-Until', String(entry.until));
  else if (entry.phase) {
    headers.set('X-QSession-Cache-Recovery', 'verified-body');
    headers.set('X-QSession-Cache-Phase', entry.phase);
    if (isPlaylist && entry.phase !== 'miss') headers.set('X-QSession-Manifest-Recovery', 'storage');
  }
  const stream = request.method === 'HEAD' ? {} : canaryBodyStream(entry, range ? range.offset : 0,
    range ? range.length : entry.size, context);
  return {...stream, response: new Response(stream.body || null, {status: range ? 206 : 200, headers})};
}

function writeCanaryCache(cache, cacheKey, entry, isPlaylist, context) {
  if (!cache || entry.cacheWriteStarted || pendingCanaryCacheWrites.has(cacheKey.url) ||
      pendingCanaryCacheWrites.size >= R2_EDGE_CACHE_WRITE_LIMIT ||
      r2EdgeBodyReaders + cacheFillWaiters >= R2_EDGE_BODY_READER_LIMIT) return;
  entry.cacheWriteStarted = true;
  entry.refs++;
  let output;
  try { output = canaryBodyResponse(new Request(cacheKey), entry, isPlaylist, context, true); }
  catch {
    entry.refs--;
    releaseCanaryBody(entry);
    recordCanaryCachePhase('putReject');
    return;
  }
  const timer = setTimeout(() => { recordCanaryCachePhase('putReject'); output.cancel(); }, CACHE_FILL_WAIT_MS);
  const work = Promise.resolve().then(async () => {
    try {
      await cache.put(cacheKey, output.response);
      const retained = await cache.match(cacheKey);
      if (!retained || retained.status !== 200 || Number(retained.headers.get('Content-Length')) !== entry.size) {
        recordCanaryCachePhase('verifyInvalid');
      }
      cancelBody(retained?.body);
    } catch { recordCanaryCachePhase('putReject'); }
    finally {
      clearTimeout(timer);
      await output.cancel();
      entry.refs--;
      releaseCanaryBody(entry);
      pendingCanaryCacheWrites.delete(cacheKey.url);
    }
  });
  pendingCanaryCacheWrites.set(cacheKey.url, work);
  context.waitUntil(work);
}

function fillFailureResponse(request, fill) {
  if (fill.missing) return textResponse(request, 404, 'La señal todavía no está disponible', {
    'X-QSession-Cache-Fill': 'missing', 'X-QSession-Cache-Fill-State': 'missing',
  });
  return textResponse(request, 503, 'El fragmento no está disponible', {
    'Retry-After': '1', 'X-QSession-Cache-Fill': fill.state,
    'X-QSession-Cache-Fill-State': fill.state, ...mediaFailureHeaders(fill.code || 'edge-not-retained'),
  });
}

async function serveR2EdgeCanary(request, env, context, key, isPlaylist, admission) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const canonical = new URL(request.url); canonical.pathname = `/${key}`; canonical.search = ''; canonical.hash = '';
  const cacheKey = new Request(canonical.toString(), {method: 'GET'});
  let entry = canaryBody(cacheKey.url);
  if (request.method === 'HEAD' && !isPlaylist && !entry) {
    const cached = await matchCanaryCache(cache, cacheKey, false);
    if (cached.response) {
      const headers = new Headers(cached.response.headers);
      headers.delete('X-QSession-R2-Body-Until');
      return serveResponse(request, new Response(cached.response.body, {headers}), admission, false, true, 'r2-edge', undefined, 'stored');
    }
    const result = await sharedMediaOperation(pendingCanaryMetadata, `head/${cacheKey.url}`, context, async signal => {
      await acquireR2EdgeRead(signal);
      try {
        let object;
        try { object = await env.QSESSION_LIVE.head(key); } catch { throw mediaError('storage-read'); }
        if (signal.aborted) throw mediaError('edge-fill-timeout');
        if (!object) return fillResult('missing');
        if (!validCanarySize(object.size, false)) throw mediaError('storage-size');
        return fillResult('stored', {object});
      } finally { releaseR2EdgeRead(); }
    });
    if (!result.stored) return fillFailureResponse(request, result);
    return serveResponse(request, storageResponse(result.object, false, null, context), admission, false, false, 'r2-edge');
  }
  const fill = entry ? fillResult('stored', {hit: true}) :
    await loadCanaryBody(cache, cacheKey, env, key, isPlaylist, context);
  if (!fill.stored) return fillFailureResponse(request, fill);
  entry = canaryBody(cacheKey.url);
  if (!entry) return fillFailureResponse(request, fillResult('failed', {code: 'edge-body-budget'}));
  try {
    const {response} = canaryBodyResponse(request, entry, isPlaylist, context);
    return serveResponse(request, response, admission, isPlaylist, fill.hit || fill.joined, 'r2-edge', undefined, 'stored');
  } catch (error) {
    return fillFailureResponse(request, fillResult('failed', {code: mediaFailureCode(error, 'edge-stream')}));
  }
}
async function readFreshManifest(env, key) {
  const object = await env.QSESSION_LIVE.get(key);
  if (!object || !Number.isSafeInteger(object.size) || object.size <= 0 || object.size > 65536) {
    object?.body?.cancel?.().catch(() => {});
    throw new Error('Manifest read unavailable');
  }
  const bytes = await new Response(object.body).arrayBuffer();
  if (bytes.byteLength !== object.size) throw new Error('Incomplete manifest read');
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

async function serveResponse(request, response, admission, isPlaylist, hit, fillState, recoverManifest, operationState) {
  if (admission && admission.payload.exp <= Math.floor(Date.now() / 1000)) {
    response.body?.cancel().catch(() => {});
    return textResponse(request, 403, 'Acceso de reproducción no válido o vencido');
  }
  const headers = new Headers(response.headers);
  headers.set('X-QSession-Edge-Cache', hit ? 'HIT' : 'MISS');
  if (fillState) headers.set('X-QSession-Cache-Fill', fillState);
  if (operationState) headers.set('X-QSession-Cache-Fill-State', operationState);
  let body = response.body;
  if (admission) {
    if (['timeout', 'network', 'gateway'].includes(admission.admissionRecovery)) {
      headers.set('X-QSession-Admission-Recovery', admission.admissionRecovery);
    }
    // Only the private Cache API stores a public, canonical representation.
    headers.set('Cache-Control', 'private, no-store');
    if (isPlaylist) {
      let text;
      try {
        text = await response.text();
      } catch {
        // A failed cached stream is a read failure, not an invalid HLS URI.
        // Read one fresh, bounded object under the already admitted key.
        try {
          if (!recoverManifest) throw new Error('Manifest read unavailable');
          text = await recoverManifest();
          headers.set('X-QSession-Edge-Cache', 'MISS');
          headers.set('X-QSession-Manifest-Recovery', 'storage');
        } catch (error) {
          const code = mediaFailureCode(error, null);
          return textResponse(request, 503, 'No se pudo leer el manifiesto', {
            'X-QSession-Manifest-Failure': 'read', ...(code ? mediaFailureHeaders(code) : {}),
          });
        }
      }
      if (admission.payload.exp <= Math.floor(Date.now() / 1000)) {
        return textResponse(request, 403, 'Acceso de reproducción no válido o vencido');
      }
      try {
        body = playlistForAdmission(text, request.url, admission);
      } catch {
        return textResponse(request, 502, 'El manifiesto contiene una referencia no válida', {'X-QSession-Manifest-Failure': 'reference'});
      }
      headers.delete('Content-Length');
      headers.delete('ETag');
    }
  }
  if (request.method === 'HEAD') cancelBody(typeof body === 'string' ? null : body);
  return new Response(request.method === 'HEAD' ? null : body, {status: response.status, headers});
}

export default {
  async fetch(request, env, context) {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: corsHeaders()});
    if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(request, 405, 'Método no permitido');

    const url = new URL(request.url);
    let key;
    try {
      key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return textResponse(request, 400, 'Ruta no válida');
    }
    if (!LIVE_OBJECT_PATTERN.test(key)) return textResponse(request, 404, 'Señal no encontrada');

    const selectedRoom = String(env.QSESSION_ADMISSION_ROOM || '').trim().toUpperCase();
    if (selectedRoom && !/^[A-Z0-9]{6}$/.test(selectedRoom)) return textResponse(request, 503, 'Configuración de admisión no válida');
    const r2EdgeRoom = String(env.QSESSION_R2_EDGE_CACHE_ROOM || '').trim();
    // This is an explicit, reversible experiment for the synthetic probe only.
    // A miss or cache failure must never expose the bucket or bypass admission.
    if (r2EdgeRoom && (r2EdgeRoom !== 'PRB10A' || selectedRoom !== r2EdgeRoom)) {
      return textResponse(request, 503, 'Configuración de caché de prueba no válida');
    }
    let admission = null;
    if (selectedRoom && key.startsWith(`live/${selectedRoom}-`)) {
      admission = await checkAdmission(request, env, context, selectedRoom, key);
      if (admission.error) return admission.error;
    }
    const isPlaylist = key.endsWith('.m3u8');
    const r2EdgeCanary = Boolean(r2EdgeRoom && key.startsWith(`live/${r2EdgeRoom}-`));
    const recoverManifest = isPlaylist && admission && !r2EdgeCanary ? () => readFreshManifest(env, key) : undefined;
    if (r2EdgeCanary) {
      return serveR2EdgeCanary(request, env, context, key, isPlaylist, admission);
    }
    // Explicit canary only. Never bypass admission or expose the private bucket.
    const sharedRoom = String(env.QSESSION_SHARED_CACHE_ROOM || '').trim();
    if (sharedRoom && key.startsWith(`live/${sharedRoom}-`)) {
      if (!admission || !env.QSESSION_SEGMENT_CACHE) return textResponse(request, 503, 'Caché compartida no disponible');
      let hash = 2166136261;
      for (const c of admission.payload.lease) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
      const id = env.QSESSION_SEGMENT_CACHE.idFromName(`${admission.payload.prefix}/${(hash >>> 0) % 64}`);
      const headers = new Headers();
      if (!isPlaylist && request.headers.has('Range')) headers.set('Range', request.headers.get('Range'));
      try {
        // Authorization is already complete above. Cache only canonical bytes
        // privately at this edge; never store a token or rewritten manifest.
        // The shared actor fills a miss, rather than forwarding every warm
        // listener's entire media stream through the actor network again.
        if (request.method === 'GET' && typeof caches !== 'undefined') {
          const cache = caches.default;
          const canonical = new URL(url.origin); canonical.pathname = `/${key}`;
          const cacheKey = new Request(canonical.toString(), {method: 'GET'});
          const ranged = !isPlaylist && request.headers.has('Range');
          const cached = await cachedObject(cache, cacheKey, request, ranged);
          if (cached) return serveResponse(request, cached, admission, isPlaylist, true, 'shared-edge', recoverManifest, 'stored');
          const readShared = async signal => {
            const response = await env.QSESSION_SEGMENT_CACHE.get(id).fetch(
              new Request(`https://qsession-private-cache.invalid/${key}`, {signal}));
            if (response.status === 404) { await response.body?.cancel(); return null; }
            const size = Number(response.headers.get('Content-Length'));
            if (response.status !== 200 || !Number.isSafeInteger(size) || size <= 0 ||
                size > (isPlaylist ? 65536 : 8 * 1024 * 1024)) {
              await response.body?.cancel();
              const reason = response.headers.get('X-QSession-Media-Failure');
              throw mediaError(MEDIA_FAILURE_CODES.has(reason) ? reason : response.status !== 200 ? 'shared-response' : 'shared-metadata');
            }
            return {body: response.body, size, httpEtag: response.headers.get('ETag') || '',
              writeHttpMetadata(target) { target.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream'); }};
          };
          const fill = await fillObjectCache(cache, cacheKey, env, key, isPlaylist, context, readShared);
          if (!fill.stored) return fillFailureResponse(request, fill);
          if (fill.stored) {
            const warmed = await cachedObject(cache, cacheKey, request, ranged);
            if (warmed) return serveResponse(request, warmed, admission, isPlaylist, fill.joined, 'shared-edge', recoverManifest, fill.state);
          }
          // Cache rejection, timeout or a discarded write is terminal for this
          // request. Calling the same actor again would amplify its overload.
          return fillFailureResponse(request, fillResult('failed', {code: 'edge-not-retained'}));
        }
        const response = await env.QSESSION_SEGMENT_CACHE.get(id).fetch(
          new Request(`https://qsession-private-cache.invalid/${key}`, {method: request.method, headers}));
        if (!response.ok) {
          response.body?.cancel().catch(() => {});
          const knownStatus = [404, 416].includes(response.status);
          const reason = response.headers.get('X-QSession-Media-Failure');
          return textResponse(request, knownStatus ? response.status : 503,
            'El fragmento no está disponible', response.status === 416 ? {'Content-Range': response.headers.get('Content-Range')} :
              knownStatus ? {} : mediaFailureHeaders(MEDIA_FAILURE_CODES.has(reason) ? reason : 'shared-response'));
        }
        return serveResponse(request, response, admission, isPlaylist,
          response.headers.get('X-QSession-Shared-Cache') === 'HIT', 'shared', recoverManifest);
      } catch (error) {
        return textResponse(request, 503, 'Caché compartida no disponible',
          mediaFailureHeaders(mediaFailureCode(error, 'shared-request')));
      }
    }
    // A personalized manifest cannot retain the source byte offsets. HTTP may
    // ignore its Range header and return the complete representation.
    const hasRange = request.method === 'GET' && !isPlaylist && Boolean(request.headers.get('Range'));
    const canCache = request.method === 'GET' && typeof caches !== 'undefined';
    const cache = canCache ? caches.default : null;
    const canonical = new URL(url.origin);
    canonical.pathname = `/${key}`;
    const cacheKey = canCache ? new Request(canonical.toString(), {method: 'GET'}) : null;
    let fillState;
    if (cache && cacheKey) {
      const cached = await cachedObject(cache, cacheKey, request, hasRange);
      if (cached) return serveResponse(request, cached, admission, isPlaylist, true, undefined, recoverManifest);
      const fill = await fillObjectCache(cache, cacheKey, env, key, isPlaylist, context);
      fillState = fill.state;
      if (fill.missing) return textResponse(request, 404, 'La señal todavía no está disponible');
      if (!fill.stored && !(fill.failed && fill.code === 'edge-fill')) return fillFailureResponse(request, fill);
      if (fill.stored) {
        const warmed = await cachedObject(cache, cacheKey, request, hasRange);
        if (warmed) return serveResponse(request, warmed, admission, isPlaylist, fill.joined, fillState, recoverManifest);
        fillState = 'not-retained';
      }
    }

    let range = null;
    let metadata;
    if (hasRange) {
      metadata = await env.QSESSION_LIVE.head(key);
      if (!metadata) return textResponse(request, 404, 'La señal todavía no está disponible');
      range = parseRange(request.headers.get('Range'), metadata.size);
      if (!range) return textResponse(request, 416, 'Rango no válido', {'Content-Range': `bytes */${metadata.size}`, 'Accept-Ranges': 'bytes'});
    }
    const object = request.method === 'HEAD' && (!isPlaylist || !admission) ? metadata || await env.QSESSION_LIVE.head(key) :
      await env.QSESSION_LIVE.get(key, range ? {range} : undefined);
    if (!object) return textResponse(request, 404, 'La señal todavía no está disponible');

    // A cache failure keeps delivery available without ever storing a partial
    // response or a per-listener manifest under the shared key.
    const response = storageResponse(object, isPlaylist, range, context);
    return serveResponse(request, response, admission, isPlaylist, false, fillState, recoverManifest);
  },
};

// Appended to hls-worker.js for dashboard deployment. This class has no public
// route. Only an admitted Worker request can obtain its private namespace stub.
const SHARED_BYTES_LIMIT = 24 * 1024 * 1024;
const SHARED_OBJECT_LIMIT = 8 * 1024 * 1024;
const sharedBytes = new Map();
let sharedBytesUsed = 0;
let sharedReads = 0;
const sharedReadQueue = [];

async function acquireSharedRead() {
  if (sharedReads < 4) { sharedReads++; return; }
  if (sharedReadQueue.length >= 256) throw mediaError('read-queue');
  await new Promise(resolve => sharedReadQueue.push(resolve));
}

function releaseSharedRead() {
  const next = sharedReadQueue.shift();
  if (next) next(); else sharedReads--;
}

function sharedEntry(key) {
  const entry = sharedBytes.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) {
    sharedBytes.delete(key); sharedBytesUsed -= entry.bytes.byteLength; return null;
  }
  sharedBytes.delete(key); sharedBytes.set(key, entry);
  return entry;
}

function storeSharedEntry(key, entry) {
  const old = sharedBytes.get(key);
  if (old) { sharedBytesUsed -= old.bytes.byteLength; sharedBytes.delete(key); }
  while (sharedBytesUsed + entry.bytes.byteLength > SHARED_BYTES_LIMIT || sharedBytes.size >= 512) {
    const oldest = sharedBytes.keys().next().value;
    const removed = sharedBytes.get(oldest);
    sharedBytes.delete(oldest); sharedBytesUsed -= removed.bytes.byteLength;
  }
  sharedBytes.set(key, entry); sharedBytesUsed += entry.bytes.byteLength;
}

export class QSessionSegmentCache {
  constructor(state, env) { this.state = state; this.env = env; this.pending = new Map(); }

  async load(key) {
    const warm = sharedEntry(key);
    if (warm) return {entry: warm, hit: true};
    let pending = this.pending.get(key);
    if (!pending) {
      if (this.pending.size >= 32) throw mediaError('object-queue');
      pending = (async () => {
        await acquireSharedRead();
        try {
          const existing = sharedEntry(key);
          if (existing) return existing;
          let object;
          try { object = await this.env.QSESSION_LIVE.get(key); }
          catch { throw mediaError('storage-read'); }
          if (!object) return null;
          const maximum = key.endsWith('.m3u8') ? 65536 : SHARED_OBJECT_LIMIT;
          if (!Number.isSafeInteger(object.size) || object.size <= 0 || object.size > maximum) {
            object.body?.cancel().catch(() => {}); throw mediaError('storage-size');
          }
          // Consume once. No R2 stream/Response is shared across request contexts.
          let bytes;
          try { bytes = new Uint8Array(await object.arrayBuffer()); }
          catch { throw mediaError('storage-body-read'); }
          if (bytes.byteLength !== object.size) throw mediaError('storage-incomplete');
          const entry = {bytes, etag: object.httpEtag,
            type: key.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : key.endsWith('.ts') ? 'video/mp2t' : 'video/mp4',
            until: Date.now() + (key.endsWith('.m3u8') ? 750 : 60000)};
          storeSharedEntry(key, entry); return entry;
        } finally { releaseSharedRead(); }
      })();
      this.pending.set(key, pending);
      pending.finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); }).catch(() => {});
    }
    return {entry: await pending, hit: false};
  }

  async fetch(request) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (url.hostname !== 'qsession-private-cache.invalid' || url.search ||
        !LIVE_OBJECT_PATTERN.test(key) || !['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {status: 404});
    }
    let result;
    try { result = await this.load(key); }
    catch (error) {
      return new Response(null, {status: 503, headers: mediaFailureHeaders(mediaFailureCode(error, 'shared-request'))});
    }
    if (!result.entry) return new Response(null, {status: 404});
    const {entry, hit} = result;
    const size = entry.bytes.byteLength;
    let range = null;
    if (request.headers.has('Range') && !key.endsWith('.m3u8') && request.method === 'GET') {
      range = parseRange(request.headers.get('Range'), size);
      if (!range) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
    }
    const start = range ? range.offset : 0, length = range ? range.length : size;
    const headers = new Headers({...corsHeaders(), 'Content-Type': entry.type,
      'Content-Length': String(length), 'ETag': entry.etag, 'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'X-QSession-Shared-Cache': hit ? 'HIT' : 'MISS'});
    if (range) headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${size}`);
    let body = null;
    if (request.method !== 'HEAD') {
      // Small chunks avoid copying a whole segment per simultaneous listener.
      // Backpressure retains only the cached bytes and one chunk per response.
      let offset = start;
      body = new ReadableStream({pull(controller) {
        if (offset >= start + length) { controller.close(); return; }
        const end = Math.min(start + length, offset + 8192);
        controller.enqueue(entry.bytes.subarray(offset, end)); offset = end;
      }}, {highWaterMark: 0});
      if (typeof FixedLengthStream !== 'undefined') {
        const fixed = new FixedLengthStream(length);
        this.state.waitUntil(body.pipeTo(fixed.writable).catch(error => {
          recordMediaFailure(error?.name === 'AbortError' ? 'stream-cancelled' : 'shared-stream');
        }));
        body = fixed.readable;
      }
    }
    return new Response(body, {status: range ? 206 : 200, headers});
  }
}
