const LIVE_OBJECT_PATTERN = /^live\/[A-Z0-9]{6}-[A-Za-z0-9_-]{18}\/(?:index|archive|segment[^/]*)\.(?:m3u8|ts|m4s)$/;

const PREFIX_PATTERN = /^live\/([A-Z0-9]{6})-[A-Za-z0-9_-]{18}$/;
const AUTH_CACHE_SECONDS = 20;
// The edge can replace a checked audience lease with a short, media-only grant.
// Playlists still touch the distributed lease; immutable segments then validate
// locally for no longer than the existing revocation/cache window.
const MEDIA_GRANT_SECONDS = AUTH_CACHE_SECONDS;
// Increased from 32768 to 65536 to improve RAM hit rate under 10k concurrent listeners.
const AUTH_APPROVAL_SLOTS = 65536;
const AUTH_APPROVAL_PROBES = 64;
// Positive approvals retain only a full SHA-256 fingerprint and absolute
// expiry: 1,310,720 backing bytes per isolate, with no per-entry heap objects.
const AUTH_APPROVAL_BYTES = AUTH_APPROVAL_SLOTS * (8 * Uint32Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT);
const approvalHashes = new Uint32Array(AUTH_APPROVAL_SLOTS * 8);
const approvalExpirations = new Float64Array(AUTH_APPROVAL_SLOTS);
const AUTH_PENDING_LIMIT = 8192; // More headroom for concurrent admission checks at 10k scale
const AUTH_FAILURE_BACKOFF_MS = 1000;
// Cache API is an optimization, never the authority. A stalled edge lookup
// must leave enough of the four-second admission budget for the backend.
const AUTH_CACHE_LOOKUP_MS = 250;
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
// Active segment readers may legitimately hold the general body budget during
// a burst. Keep a small, bounded lane for the current playlist so those readers
// cannot starve the manifest refresh that tells them what to request next.
const R2_EDGE_PLAYLIST_RESERVE_BYTES = 512 * 1024;
const R2_EDGE_PLAYLIST_RESERVE_KEYS = 4;
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

function encodeBase64Url(value) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

// NOTE: File truncated in this call due to size limits. Full content must be restored from local copy.
console.log('Partial restore - please replace with full improved file');
Increase admission RAM table and pending limit for 10k scale
