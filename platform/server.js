'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {URL} = require('node:url');
const {createProductStore, hashPassword, passwordMatches} = require('./product-store');
const {createAnalyticsStore} = require('./analytics-store');
const {createGlobalRavePresenceStore} = require('./global-rave-presence');
const {createRealtimeHub} = require('./realtime-hub');
const {createScalableChatStore} = require('./scalable-chat-store');
const {createDirectVideoUploadProvider} = require('./direct-video-upload');
const {createEdgeBroadcastProvider} = require('./edge-broadcast');
const {assessReadiness} = require('./mass-broadcast-readiness');
const {createBroadcastAdmissions} = require('./broadcast-admissions');
const {parseBroadcastEventPlan, effectiveBroadcastEventLimit, publicBroadcastEventPlan} = require('./broadcast-event-plan');
const {createBillingStore} = require('./billing-store');
const {createStarEconomyStore} = require('./star-economy');
const {calculateCustomRoomQuote} = require('./custom-room-pricing');
const {createWompiGateway} = require('./wompi');
const {createMusicLibrary} = require('./music-library');
const {createMusicPlaylists} = require('./music-playlists');
const {createMusicFeedback} = require('./music-feedback');
const {createOwnedMusicLibrary} = require('./music-owned-library');
const {interpretIntent} = require('./qdj-intent');
const {createAccountMailer} = require('./account-mailer');
const {createFirebasePushProvider} = require('./push-notifications');
const {
  createProfileMediaStore,
  createPrivateMediaStore,
  createPromotionMediaStore,
  MAX_PROFILE_MEDIA_BYTES,
  MAX_PRIVATE_ATTACHMENT_BYTES,
  MAX_PROMOTION_MEDIA_BYTES,
} = require('./profile-media');
const {version: QSESSION_VERSION} = require('./package.json');

function loadLocalEnvironment(filePath) {
  if (!fs.existsSync(filePath)) return;
  const source = fs.readFileSync(filePath, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadLocalEnvironment(path.join(__dirname, '.env.local'));

const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_RELEASE_CATALOG_FILE = path.join(PUBLIC_DIR, 'app-releases.json');
const APP_RELEASE_DOWNLOADS_DIR = path.join(PUBLIC_DIR, 'downloads');
const APP_RELEASE_ALIASES = Object.freeze({
  android: '/downloads/QSession-Android-latest.apk',
  windows: '/downloads/QSession-Windows-latest.exe',
});
const HLS_CLIENT_FILE = path.join(__dirname, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AUTH_COOKIE = 'qsession_session';
const ADMIN_COOKIE = 'qsession_admin';
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTH_ATTEMPTS = 12;
const MAX_PASSWORD_RECOVERY_ATTEMPTS = 5;
const REMEMBERED_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const DEVICE_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const ADMIN_RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const MAX_ADMIN_RECOVERY_ATTEMPTS = 5;
const MESSAGE_WINDOW_MS = 60 * 1000;
const MAX_MESSAGES_PER_WINDOW = 30;
const MAX_EFFECT_CREATIONS_PER_HOUR = 12;
const MAX_EFFECT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EFFECT_AUDIO_BYTES = 12 * 1024 * 1024;
const EFFECT_CREATOR_WINDOW_MS = 60 * 60 * 1000;
const UPLOAD_INTENT_WINDOW_MS = 60 * 60 * 1000;
const MAX_UPLOAD_INTENTS_PER_HOUR = 12;
const MAX_JSON_BYTES = Math.ceil(MAX_PROFILE_MEDIA_BYTES * 1.4) + 4096;
const MAX_PRIVATE_MEDIA_JSON_BYTES = Math.ceil(MAX_PRIVATE_ATTACHMENT_BYTES * 1.4) + 4096;
const MAX_PROMOTION_MEDIA_JSON_BYTES = Math.ceil(MAX_PROMOTION_MEDIA_BYTES * 1.4) + 4096;
const contentTypes = {
  '.apk': 'application/vnd.android.package-archive',
  '.css': 'text/css; charset=utf-8',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.task': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
};

async function loadAppReleaseCatalog() {
  const parsed = JSON.parse(await fs.promises.readFile(APP_RELEASE_CATALOG_FILE, 'utf8'));
  const catalog = {};
  for (const platformName of ['android', 'windows']) {
    const release = parsed?.[platformName];
    const extension = platformName === 'android' ? 'apk' : 'exe';
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(release?.version || '')) throw new Error(`Versión ${platformName} inválida`);
    if (release.url !== APP_RELEASE_ALIASES[platformName]) throw new Error(`Ruta latest ${platformName} inválida`);
    if (!new RegExp(`^[A-Za-z0-9._-]+\\.${extension}$`).test(release.filename || '')) throw new Error(`Nombre ${platformName} inválido`);
    if (!new RegExp(`^[A-Za-z0-9._-]+\\.${extension}$`).test(release.artifact || '')) throw new Error(`Artefacto ${platformName} inválido`);
    if (!/^[a-f0-9]{64}$/.test(release.sha256 || '')) throw new Error(`Huella ${platformName} inválida`);
    const artifactPath = path.resolve(APP_RELEASE_DOWNLOADS_DIR, release.artifact);
    if (!artifactPath.startsWith(`${path.resolve(APP_RELEASE_DOWNLOADS_DIR)}${path.sep}`)) throw new Error(`Artefacto ${platformName} fuera de downloads`);
    const info = await fs.promises.stat(artifactPath);
    if (!info.isFile() || info.size !== release.byteLength) throw new Error(`Artefacto ${platformName} ausente o incompleto`);
    catalog[platformName] = {
      version: release.version,
      url: `${release.url}?version=${encodeURIComponent(release.version)}`,
      filename: release.filename,
      artifact: release.artifact,
      byteLength: info.size,
      sha256: release.sha256,
    };
  }
  return catalog;
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizePublicUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('QSESSION_PUBLIC_URL debe usar HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeLiveKitUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  const parsed = new URL(raw.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:'));
  if (parsed.protocol !== 'wss:' && parsed.hostname !== 'localhost') {
    throw new Error('LIVEKIT_PUBLIC_URL debe usar WSS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeLiveKitApiUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  const parsed = new URL(raw);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('LIVEKIT_URL debe usar HTTP, HTTPS, WS o WSS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf('=');
    return separator < 0 ? [item, ''] : [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
  }));
}

function requestToken(req) {
  const authorization = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return parseCookies(req)[AUTH_COOKIE] || '';
}

function sessionCookie(req, token, maxAge = 30 * 24 * 60 * 60) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const secure = forwarded === 'https' || Boolean(req.socket.encrypted);
  const persistence = Number.isFinite(maxAge) ? `; Max-Age=${Math.max(0, Math.floor(maxAge))}` : '';
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${persistence}${secure ? '; Secure' : ''}`;
}

function adminSessionCookie(req, token, maxAge = 8 * 60 * 60) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const secure = forwarded === 'https' || Boolean(req.socket.encrypted);
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new Error('La solicitud es demasiado grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('La información enviada no es válida');
  }
}

function requestedByteRange(value, size) {
  if (!value) return null;
  const match = String(value).trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return {invalid: true};
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return {invalid: true};
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return {invalid: true};
  }
  return {start, end: Math.min(end, size - 1)};
}

function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function consumeRateLimit(buckets, key, maximum, duration) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, {count: 1, resetAt: now + duration});
    return true;
  }
  current.count += 1;
  return current.count <= maximum;
}

function storedAdminPasswordHash(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const value = String(payload?.passwordHash || '');
    return /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(value) ? value : '';
  } catch {
    return '';
  }
}

function persistAdminPasswordHash(filePath, passwordHash) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, {recursive: true});
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({version: 1, passwordHash, updatedAt: new Date().toISOString()})}\n`, {mode: 0o600});
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function decodeEffectDataUrl(value, kind) {
  const pattern = kind === 'image'
    ? /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i
    : /^data:(audio\/(?:webm|ogg|wav|mpeg|mp4|x-m4a));base64,([a-z0-9+/=]+)$/i;
  const match = String(value || '').match(pattern);
  if (!match) throw new Error(kind === 'image' ? 'La referencia debe ser JPG, PNG o WebP' : 'La grabación de voz no tiene un formato compatible');
  const buffer = Buffer.from(match[2], 'base64');
  const limit = kind === 'image' ? MAX_EFFECT_IMAGE_BYTES : MAX_EFFECT_AUDIO_BYTES;
  if (!buffer.length || buffer.length > limit) throw new Error(`El archivo supera el límite de ${Math.round(limit / 1024 / 1024)} MB`);
  return {buffer, contentType: match[1].toLowerCase()};
}

function effectPrompt(kind, instructions, hasReference) {
  const common = 'Create a premium, original visual asset for a live DJ camera. No text, logos, borders, rectangular canvas, scenery, or photographic background. Avoid copying effects from existing social platforms.';
  if (kind === 'mask') return `${common} ${hasReference ? 'Use the reference only as the subject. Precisely isolate the important face, hair, ears and requested details; remove every corner, room, wall, clothing background and all irrelevant pixels.' : ''} Produce a front-facing wearable face mask, centered, symmetrical enough for eye tracking, with generous transparent margin. Preserve transparent background and clean feathered edges. User direction: ${instructions}`;
  if (kind === 'filter') return `${common} Produce an abstract full-frame transparent PNG texture made for overlay blending, with strong visual character while keeping the DJ recognizable. User direction: ${instructions}`;
  return `${common} Produce one abstract transparent VJ overlay frame with bold luminous shapes around an open central performance area; it will be animated with rotation, pulse and audio intensity. User direction: ${instructions}`;
}

async function openAiJson(response) {
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(String(payload?.error?.message || 'El servicio de creación no respondió correctamente').slice(0, 300));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function createRoomCode(store) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    if (!store.getRoomRecord(code)) return code;
  }
  throw new Error('No fue posible crear un código de sala');
}

function signPayload(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPayload(token, secret) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return Number(payload.exp) > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

function customPlanFromQuote(quoteId, quote) {
  return {
    id: `custom-quote-${quoteId}`,
    name: `Sala personalizada · ${quote.capacity.toLocaleString('es-CO')} personas`,
    description: `${quote.sessions} ${quote.sessions === 1 ? 'sala' : 'salas'} de ${quote.durationMinutes} minutos, configuradas a medida.`,
    priceCents: quote.priceCents,
    requiresReview: quote.requiresReview === true,
    priceStatus: quote.priceStatus,
    deliveryMode: quote.deliveryMode,
    capacityValidated: false,
    currency: 'COP',
    maxParticipants: quote.capacity,
    durationMinutes: quote.durationMinutes,
    creditsPerPurchase: quote.sessions,
    billingInterval: 'one_time',
    segment: 'event',
    highlighted: false,
    features: quote.features,
    active: false,
    sortOrder: 20_000,
    revision: 1,
  };
}

function createLiveKitToken({apiKey, apiSecret, code, roomName = null, identity, name, role, canPublishCamera = true, canPublishAudio = false, canPublishScreenAudio = false, metadata = null, hidden = false, expiresInSeconds = 6 * 60 * 60}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({alg: 'HS256', typ: 'JWT'}));
  const sources = role === 'dj'
    ? ['microphone', 'camera', 'screen_share', 'screen_share_audio']
    : [
        ...(canPublishAudio ? ['microphone'] : []),
        ...(canPublishCamera ? ['camera'] : []),
        ...(canPublishScreenAudio ? ['screen_share_audio'] : []),
      ];
  const payload = base64url(JSON.stringify({
    iss: apiKey,
    sub: identity,
    name,
    ...(metadata ? {metadata: JSON.stringify(metadata)} : {}),
    nbf: now - 5,
    exp: now + Math.max(60, Math.min(6 * 60 * 60, Number(expiresInSeconds) || 6 * 60 * 60)),
    video: {
      roomJoin: true,
      room: roomName || `qsession-${code}`,
      ...(hidden ? {hidden: true} : {}),
      canPublish: role === 'dj' || canPublishAudio || canPublishCamera || canPublishScreenAudio,
      canPublishSources: sources,
      canSubscribe: true,
      canPublishData: !hidden,
      canUpdateOwnMetadata: !hidden,
    },
  }));
  const signature = crypto.createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function createLiveKitServiceToken({apiKey, apiSecret, videoGrant}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({alg: 'HS256', typ: 'JWT'}));
  const payload = base64url(JSON.stringify({
    iss: apiKey,
    sub: 'qsession-live-directory',
    nbf: now - 5,
    exp: now + 60,
    video: videoGrant,
  }));
  const signature = crypto.createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function liveKitRoomServiceRequest({apiUrl, apiKey, apiSecret, method, body, videoGrant}) {
  const token = createLiveKitServiceToken({apiKey, apiSecret, videoGrant});
  const response = await fetch(`${apiUrl}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`LiveKit ${method} respondió ${response.status}`);
  return response.json();
}

function normalizedEnum(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function isActiveLiveKitParticipant(participant) {
  const state = normalizedEnum(participant?.state);
  return state !== 'DISCONNECTED' && state !== 3;
}

function isLiveKitAudioTrack(track) {
  const type = normalizedEnum(track?.type);
  const source = normalizedEnum(track?.source);
  return type === 'AUDIO' || type === 0 || type === '0'
    || source === 'MICROPHONE' || source === 2 || source === '2'
    || source === 'SCREEN_SHARE_AUDIO' || source === 4 || source === '4';
}

function isLiveKitCameraTrack(track) {
  const type = normalizedEnum(track?.type);
  const source = normalizedEnum(track?.source);
  return source === 'CAMERA' || source === 1 || source === '1'
    || ((type === 'VIDEO' || type === 1 || type === '1') && source !== 'SCREEN_SHARE' && source !== 3 && source !== '3');
}

function liveRoomActivityFromParticipants(participants = []) {
  const connected = participants.filter(isActiveLiveKitParticipant);
  const hosts = connected.filter(participant => String(participant?.identity || '').startsWith('dj-'));
  const host = hosts.find(participant => (participant.tracks || []).some(track => isLiveKitAudioTrack(track) && !track.muted));
  if (!host) return null;
  const listenerAccountIds = [...new Set(connected
    .map(participant => String(participant?.identity || ''))
    .filter(identity => identity.startsWith('listener-'))
    .map(identity => identity.slice('listener-'.length))
    .filter(Boolean))];
  return {
    participantCount: connected.length,
    listenerCount: listenerAccountIds.length,
    listenerAccountIds,
    audioLive: true,
    cameraLive: (host.tracks || []).some(track => isLiveKitCameraTrack(track) && !track.muted),
  };
}

async function listLiveKitRoomActivity({rooms, apiUrl, apiKey, apiSecret}) {
  const roomNames = rooms.map(room => `qsession-${room.code}`);
  if (!roomNames.length) return new Map();
  const listed = await liveKitRoomServiceRequest({
    apiUrl,
    apiKey,
    apiSecret,
    method: 'ListRooms',
    body: {names: roomNames},
    videoGrant: {roomList: true},
  });
  const activeNames = new Set((listed.rooms || []).map(room => String(room.name || '')));
  const candidates = rooms.filter(room => activeNames.has(`qsession-${room.code}`));
  const activity = new Map();
  let cursor = 0;
  const workers = Array.from({length: Math.min(6, candidates.length)}, async () => {
    while (cursor < candidates.length) {
      const room = candidates[cursor];
      cursor += 1;
      const roomName = `qsession-${room.code}`;
      try {
        const listedParticipants = await liveKitRoomServiceRequest({
          apiUrl,
          apiKey,
          apiSecret,
          method: 'ListParticipants',
          body: {room: roomName},
          videoGrant: {roomAdmin: true, room: roomName},
        });
        const snapshot = liveRoomActivityFromParticipants(listedParticipants.participants || []);
        if (snapshot) activity.set(room.code, snapshot);
      } catch {
        // Una sala dudosa se omite: la portada nunca debe prometer una señal que no pudo comprobar.
      }
    }
  });
  await Promise.all(workers);
  return activity;
}

function roomChatPresenceFromParticipants(participants = [], accountId = '', profileId = '') {
  const connected = participants.filter(isActiveLiveKitParticipant);
  const expectedIdentities = new Set([
    `listener-${accountId}`,
    `dj-${accountId}`,
  ]);
  const profileIsConnected = participant => {
    if (!profileId) return false;
    try {
      const metadata = typeof participant?.metadata === 'string'
        ? JSON.parse(participant.metadata || '{}')
        : participant?.metadata;
      return String(metadata?.profileId || '') === profileId;
    } catch {
      return false;
    }
  };
  return {
    active: Boolean(accountId && connected.some(participant => (
      expectedIdentities.has(String(participant?.identity || '')) || profileIsConnected(participant)
    ))),
    participantCount: connected.length,
  };
}

async function liveKitRoomChatPresence({room, accountId, profileId, apiUrl, apiKey, apiSecret}) {
  const roomName = `qsession-${room.code}`;
  const listed = await liveKitRoomServiceRequest({
    apiUrl,
    apiKey,
    apiSecret,
    method: 'ListParticipants',
    body: {room: roomName},
    videoGrant: {roomAdmin: true, room: roomName},
  });
  return roomChatPresenceFromParticipants(listed.participants || [], accountId, profileId);
}

async function closeLiveKitRoom({room, apiUrl, apiKey, apiSecret}) {
  const roomName = `qsession-${room.code}`;
  await liveKitRoomServiceRequest({
    apiUrl,
    apiKey,
    apiSecret,
    method: 'DeleteRoom',
    body: {room: roomName},
    videoGrant: {roomAdmin: true, room: roomName},
  });
}

async function removeExistingDesktopAudioParticipants({code, apiUrl, apiKey, apiSecret}) {
  const roomName = `qsession-${code}`;
  const listed = await liveKitRoomServiceRequest({
    apiUrl,
    apiKey,
    apiSecret,
    method: 'ListParticipants',
    body: {room: roomName},
    videoGrant: {roomAdmin: true, room: roomName},
  });
  const identities = (listed.participants || [])
    .filter(isActiveLiveKitParticipant)
    .map(participant => String(participant?.identity || ''))
    .filter(identity => identity.startsWith('desktop-tab-audio-'));
  await Promise.all(identities.map(identity => liveKitRoomServiceRequest({
    apiUrl,
    apiKey,
    apiSecret,
    method: 'RemoveParticipant',
    body: {room: roomName, identity},
    videoGrant: {roomAdmin: true, room: roomName},
  })));
  return identities;
}

function hostedRoomHistory(room) {
  const startedAt = room.startedAt || room.createdAt || null;
  const finishedAt = room.endedAt || (room.status === 'archived' ? startedAt : new Date().toISOString());
  const durationSeconds = startedAt && finishedAt
    ? Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : 0;
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    djName: room.djName,
    roomType: room.roomType || 'custom',
    broadcastMode: ['live', 'recorded', 'image'].includes(room.broadcastMode) ? room.broadcastMode : 'live',
    starPrice: Math.max(0, Number(room.starPrice) || 0),
    visibility: room.visibility,
    status: room.status,
    createdAt: room.createdAt,
    scheduledAt: room.scheduledAt,
    startedAt: room.startedAt,
    endedAt: room.endedAt,
    durationSeconds,
    metrics: {
      peakListeners: Math.max(0, Number(room.peakListeners) || 0),
      totalJoins: Math.max(0, Number(room.totalJoins) || 0),
      disconnects: Math.max(0, Number(room.disconnects) || 0),
    },
  };
}

const PUBLIC_ROOM_EXPERIENCE_DEFAULTS = Object.freeze({
  music: {designTheme: 'midnight', designMotion: 'immersive', allowAiCameraEffects: true, allowVjVisuals: true, allowVideoSubmissions: true, allowGreetingVideos: false, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true},
  'yoga-meditation': {designTheme: 'serenity', designMotion: 'calm', allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true, allowGreetingVideos: false, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true},
  conference: {designTheme: 'institutional', designMotion: 'balanced', allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: false, allowGreetingVideos: false, allowVideoToHost: false, allowVideoToRoom: false, allowPrivateVideoSubmissions: false},
  wedding: {designTheme: 'celebration', designMotion: 'balanced', allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true, allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true},
  birthday: {designTheme: 'celebration', designMotion: 'balanced', allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true, allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true},
  'baby-shower': {designTheme: 'celebration', designMotion: 'calm', allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true, allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true},
  custom: {designTheme: 'minimal', designMotion: 'balanced', allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: false, allowGreetingVideos: false, allowVideoToHost: false, allowVideoToRoom: false, allowPrivateVideoSubmissions: false},
});

function publicRoomExperience(room) {
  const canonicalType = room.roomType === 'party' ? 'music'
    : room.roomType === 'class' ? 'yoga-meditation'
      : room.roomType === 'professional' ? 'conference' : room.roomType;
  const defaults = PUBLIC_ROOM_EXPERIENCE_DEFAULTS[canonicalType] || PUBLIC_ROOM_EXPERIENCE_DEFAULTS.custom;
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key,
    typeof fallback === 'boolean' ? (typeof room[key] === 'boolean' ? room[key] : fallback) : (room[key] || fallback),
  ]));
}

function publicRoom(room, activity = null) {
  if (!room) return null;
  return {
    code: room.code,
    name: room.name,
    djName: room.djName,
    roomType: room.roomType || 'custom',
    artistProfileId: room.ownerProfileId || null,
    broadcastMode: ['live', 'recorded', 'image'].includes(room.broadcastMode) ? room.broadcastMode : 'live',
    recordedAssetId: room.recordedAssetId || null,
    sessionImageUrl: room.sessionImageUrl || null,
    starPrice: Math.max(0, Number(room.starPrice) || 0),
    description: room.description,
    visibility: room.visibility,
    capacity: room.capacity || 0,
    capacityMode: room.capacityMode === 'limited' ? 'limited' : 'expected',
    billingPlan: room.billingPlanId ? {
      id: room.billingPlanId,
      name: room.billingPlanName || room.billingPlanId,
      maxParticipants: Math.max(0, Number(room.billingCapacityLimit) || 0),
      durationMinutes: Math.max(15, Number(room.sessionDurationMinutes) || 120),
    } : null,
    accessMethods: Array.isArray(room.accessMethods) && room.accessMethods.length ? room.accessMethods : ['link', 'code', 'qr'],
    translation: room.translation || {sourceLanguage: 'es', mode: 'subtitles', targetLanguages: ['en', 'de']},
    sponsors: Array.isArray(room.sponsors) ? room.sponsors : [],
    promotions: Array.isArray(room.promotions) ? room.promotions.map(promotion => ({
      id: promotion.id,
      sponsor: promotion.sponsor,
      headline: promotion.headline || null,
      linkUrl: promotion.linkUrl || null,
      media: promotion.mediaId ? {
        id: promotion.mediaId,
        url: `/api/promotion-media/${promotion.mediaId}`,
        contentType: promotion.contentType,
      } : null,
    })) : [],
    passwordProtected: Boolean(room.passwordProtected),
    allowPublicChat: room.allowPublicChat !== false,
    allowGuestCameras: room.allowGuestCameras !== false,
    allowSocialProfiles: room.allowSocialProfiles !== false,
    allowMatchmaking: room.allowSocialProfiles !== false && room.allowMatchmaking !== false,
    allowProfileGifts: room.allowSocialProfiles !== false && room.allowProfileGifts !== false,
    allowSharedFiles: room.allowSharedFiles !== false,
    allowSpeakingQueue: room.allowSpeakingQueue !== false,
    allowQuestions: room.allowQuestions !== false,
    allowPolls: room.allowPolls !== false,
    allowReactions: room.allowReactions !== false,
    allowRecording: room.allowRecording === true,
    ...publicRoomExperience(room),
    status: room.status,
    transport: 'sfu',
    mediaTopology: 'adaptive',
    scheduledAt: room.scheduledAt,
    startedAt: room.startedAt,
    timeZone: room.timeZone || 'UTC',
    ...(activity ? {
      participantCount: Math.max(1, Number(activity.participantCount) || 1),
      listenerCount: Math.max(0, Number(activity.listenerCount) || 0),
      audioLive: activity.audioLive === true,
      cameraLive: activity.cameraLive === true,
    } : {}),
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function roomStartLabel(room) {
  const date = new Date(room.scheduledAt || room.startedAt || room.createdAt);
  const timeZone = room.timeZone || 'UTC';
  if (Number.isNaN(date.getTime())) return 'Ahora';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(date);
  }
}

function roomInvitationHtml(template, room, publicUrl) {
  const origin = publicUrl || 'https://qsession.org';
  const roomName = String(room.name || 'Sala Q Session').slice(0, 100);
  const djName = String(room.djName || 'DJ invitado').slice(0, 100);
  const title = `${roomName} · ${djName}`.slice(0, 145);
  const description = `Inicio: ${roomStartLabel(room)} · Sala ${room.code}. Entra a escuchar a ${djName} en Q Session.`.slice(0, 220);
  const canonicalUrl = `${origin}/join/${encodeURIComponent(room.code)}`;
  const imageUrl = `${origin}/brand/qsession-icon-master.png?v=20260911-brand-logo-v1`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const socialMeta = [
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="Q Session" />`,
    `    <meta property="og:locale" content="es_CO" />`,
    `    <meta property="og:title" content="${safeTitle}" />`,
    `    <meta property="og:description" content="${safeDescription}" />`,
    `    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `    <meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />`,
    `    <meta property="og:image:type" content="image/png" />`,
    `    <meta property="og:image:width" content="2048" />`,
    `    <meta property="og:image:height" content="2048" />`,
    `    <meta name="twitter:card" content="summary" />`,
    `    <meta name="twitter:title" content="${safeTitle}" />`,
    `    <meta name="twitter:description" content="${safeDescription}" />`,
    `    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    `    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
  ].join('\n');

  return template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle} · Q Session</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/i, `<meta name="description" content="${safeDescription}" />`)
    .replace('</head>', `${socialMeta}\n  </head>`);
}

function createQsessionServer(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const port = Number(options.port ?? env.QSESSION_PORT ?? 8090);
  const dataFile = options.dataFile || env.QSESSION_DATA_FILE || path.join(__dirname, 'data', 'qsession-state.json');
  const mediaDirectory = options.mediaDirectory || env.QSESSION_PROFILE_MEDIA_DIR || path.join(__dirname, 'data', 'profile-media');
  const privateMediaDirectory = options.privateMediaDirectory || env.QSESSION_PRIVATE_MEDIA_DIR || path.join(__dirname, 'data', 'private-media');
  const promotionMediaDirectory = options.promotionMediaDirectory || env.QSESSION_PROMOTION_MEDIA_DIR || path.join(__dirname, 'data', 'promotion-media');
  const originalMusicDirectory = options.originalMusicDirectory || env.QSESSION_ORIGINAL_MUSIC_DIR || path.join(path.dirname(dataFile), 'original-music');
  const analyticsDataFile = options.analyticsDataFile || env.QSESSION_ANALYTICS_DATA_FILE || path.join(__dirname, 'data', 'qsession-analytics.ndjson');
  const billingDataFile = options.billingDataFile || env.QSESSION_BILLING_DATA_FILE || path.join(path.dirname(dataFile), 'qsession-billing.json');
  const starDataFile = options.starDataFile || env.QSESSION_STAR_DATA_FILE || path.join(path.dirname(dataFile), 'qsession-stars.json');
  const adminCredentialFile = options.adminCredentialFile || env.QSESSION_ADMIN_CREDENTIAL_FILE || path.join(path.dirname(dataFile), 'qsession-admin-credential.json');
  const publicUrl = normalizePublicUrl(options.publicUrl ?? env.QSESSION_PUBLIC_URL ?? '');
  const livekitUrl = normalizeLiveKitUrl(options.livekitUrl ?? env.LIVEKIT_PUBLIC_URL ?? '');
  const livekitApiUrl = normalizeLiveKitApiUrl(options.livekitApiUrl ?? env.LIVEKIT_URL ?? livekitUrl);
  const livekitApiKey = String(options.livekitApiKey ?? env.LIVEKIT_API_KEY ?? '');
  const livekitApiSecret = String(options.livekitApiSecret ?? env.LIVEKIT_API_SECRET ?? '');
  const openaiApiKey = String(options.openaiApiKey ?? env.OPENAI_API_KEY ?? '');
  const qdjSemanticAiEnabled = String(options.qdjSemanticAiEnabled ?? env.QSESSION_QDJ_SEMANTIC_AI_ENABLED ?? '').toLowerCase() === 'true';
  const roomSecret = String(options.roomSecret ?? env.QSESSION_ROOM_SECRET ?? env.QSESSION_AUTH_PEPPER ?? crypto.randomBytes(32).toString('base64url'));
  const analyticsSecret = String(options.analyticsSecret ?? env.QSESSION_ANALYTICS_SECRET ?? roomSecret);
  const adminUsername = String(options.adminUsername ?? env.QSESSION_ADMIN_USERNAME ?? '').trim().toLowerCase().slice(0, 80);
  const configuredAdminPasswordHash = String(options.adminPasswordHash ?? env.QSESSION_ADMIN_PASSWORD_HASH ?? '');
  const initialAdminPasswordHash = configuredAdminPasswordHash || (options.adminPassword ? hashPassword(options.adminPassword) : '');
  let adminPasswordHash = storedAdminPasswordHash(adminCredentialFile) || initialAdminPasswordHash;
  const configuredAdminRecoveryCodeHash = String(options.adminRecoveryCodeHash ?? env.QSESSION_ADMIN_RECOVERY_CODE_HASH ?? '');
  const adminRecoveryCodeHash = configuredAdminRecoveryCodeHash || (options.adminRecoveryCode ? hashPassword(options.adminRecoveryCode) : '');
  const adminSessionSecret = String(options.adminSessionSecret ?? env.QSESSION_ADMIN_SESSION_SECRET ?? '');
  const adminConfigured = Boolean(adminUsername && adminPasswordHash && adminSessionSecret);
  const adminRecoveryConfigured = Boolean(adminConfigured && adminRecoveryCodeHash && adminCredentialFile);
  const dummyAdminPasswordHash = hashPassword('QSession-invalid-administrator-password');
  const storageDriver = String(options.storageDriver ?? env.QSESSION_STORAGE_DRIVER ?? 'file').toLowerCase();
  const productStore = options.productStore || createProductStore({filePath: dataFile, authPepper: env.QSESSION_AUTH_PEPPER || options.authPepper || ''});
  const databaseUrl = String(options.databaseUrl ?? env.QSESSION_DATABASE_URL ?? '');
  const ownedMusicLibrary = options.ownedMusicLibrary || createOwnedMusicLibrary({
    directory: originalMusicDirectory,
    metadataFile: path.join(originalMusicDirectory, 'catalog.json'),
  });
  const musicLibrary = options.musicLibrary || createMusicLibrary({
    fetchImpl,
    apiKey: env.QSESSION_AUDIUS_API_KEY || '',
    enabled: env.QSESSION_MUSIC_ENABLED !== 'false',
    externalEnabled: env.QSESSION_EXTERNAL_MUSIC_ENABLED === 'true' && env.QSESSION_AUDIUS_ENABLED !== 'false',
    ownedStore: ownedMusicLibrary,
  });
  const musicPlaylists = options.musicPlaylists || createMusicPlaylists({
    databaseUrl, pool: options.databasePool || null,
    filePath: path.join(path.dirname(dataFile), 'qsession-music-playlists.json'),
    hasTrack: musicLibrary.has,
  });
  const musicFeedback = options.musicFeedback || createMusicFeedback({databaseUrl,pool:options.databasePool||null,filePath:path.join(path.dirname(dataFile),'qsession-music-feedback.json'),hasTrack:musicLibrary.has});
  function musicVoter(req) {
    const auth=authenticated(req);
    if(auth)return {actor:'account:'+auth.account.id,headers:{'Cache-Control':'no-store'}};
    const previous=verifyPayload(parseCookies(req).qsession_music_voter,roomSecret);
    const valid=previous?.scope==='music-voter'&&/^[a-f0-9-]{36}$/.test(previous.sub);
    const id=valid?previous.sub:crypto.randomUUID();
    const token=signPayload({scope:'music-voter',sub:id,exp:Math.floor(Date.now()/1000)+365*86400},roomSecret);
    const secure=String(req.headers['x-forwarded-proto']||'')==='https'||Boolean(req.socket.encrypted);
    return {actor:'guest:'+id,headers:{'Cache-Control':'no-store',...(!valid?{'Set-Cookie':'qsession_music_voter='+encodeURIComponent(token)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000'+(secure?'; Secure':'')}: {})}};
  }
  const musicBuckets = new Map();
  const billingEnforced = options.billingEnforced ?? String(env.QSESSION_BILLING_ENFORCED || '').toLowerCase() === 'true';
  const publicRoomsSetting = String(env.QSESSION_PUBLIC_ROOMS_ENABLED || '').trim().toLowerCase();
  const publicRoomsEnabled = options.publicRoomsEnabled ?? !['false', '0', 'off', 'disabled'].includes(publicRoomsSetting);
  const billingStore = options.billingStore || createBillingStore({
    databaseUrl,
    filePath: billingDataFile,
    pool: options.databasePool || null,
  });
  const starEconomy = options.starEconomy || createStarEconomyStore({filePath: starDataFile});
  const wompiGateway = options.wompiGateway || createWompiGateway({
    publicKey: options.wompiPublicKey ?? env.QSESSION_WOMPI_PUBLIC_KEY ?? '',
    integritySecret: options.wompiIntegritySecret ?? env.QSESSION_WOMPI_INTEGRITY_SECRET ?? '',
    eventsSecret: options.wompiEventsSecret ?? env.QSESSION_WOMPI_EVENTS_SECRET ?? '',
    checkoutBaseUrl: options.wompiCheckoutUrl ?? env.QSESSION_WOMPI_CHECKOUT_URL ?? 'https://checkout.wompi.co/p/',
  });
  const accountMailer = options.accountMailer || createAccountMailer({
    apiKey: env.QSESSION_RESEND_API_KEY || '',
    from: env.QSESSION_RECOVERY_FROM_EMAIL || '',
    publicUrl,
    fetchImpl: options.fetchImpl || fetch,
  });
  const pushNotifications = options.pushNotifications || createFirebasePushProvider({
    serviceAccountJson: env.QSESSION_FIREBASE_SERVICE_ACCOUNT_JSON || '',
    serviceAccountFile: env.QSESSION_FIREBASE_SERVICE_ACCOUNT_FILE || '',
    fetchImpl: options.fetchImpl || fetch,
  });
  const redisUrl = String(options.redisUrl ?? env.QSESSION_REDIS_URL ?? '');
  const broadcastPlaybackUrlTemplate = String(
    options.broadcastPlaybackUrlTemplate ?? env.QSESSION_BROADCAST_PLAYBACK_URL_TEMPLATE ?? '',
  ).trim();
  const edgeMediaDirectory = String(options.edgeMediaDirectory ?? env.QSESSION_EDGE_MEDIA_DIR ?? '').trim();
  const audienceMode = String(options.audienceMode ?? env.QSESSION_AUDIENCE_MODE ?? 'interactive');
  if (!['interactive','cdn-only'].includes(audienceMode)) throw new Error('QSESSION_AUDIENCE_MODE debe ser interactive o cdn-only');
  const broadcastAudienceTarget = Math.max(1,Math.min(500000,Number(options.broadcastAudienceTarget ?? env.QSESSION_BROADCAST_AUDIENCE_TARGET) || 500000));
  const cdnOnlyRoom = String(options.cdnOnlyRoom ?? env.QSESSION_CDN_ONLY_ROOM ?? '').trim().toUpperCase();
  const cdnOnlyPaused = options.cdnOnlyPaused === true || String(env.QSESSION_CDN_ONLY_PAUSED || '').toLowerCase() === 'true';
  let massReadiness = null;
  if (audienceMode === 'cdn-only') {
    if (!/^[A-Z0-9]{6}$/.test(cdnOnlyRoom)) throw new Error('Selecciona QSESSION_CDN_ONLY_ROOM antes de activar la recepción masiva.');
    let evidence = options.massBroadcastReadiness;
    if (!evidence) {
      try { evidence = JSON.parse(fs.readFileSync(env.QSESSION_MASS_BROADCAST_READINESS_FILE, 'utf8').replace(/^\uFEFF/, '')); }
      catch { throw new Error('Falta un expediente válido de preparación para la recepción masiva.'); }
    }
    const report = assessReadiness({...env,QSESSION_CDN_ONLY_ROOM:cdnOnlyRoom,QSESSION_BROADCAST_AUDIENCE_TARGET:String(broadcastAudienceTarget)},evidence);
    if (!report.evidenceComplete) throw new Error('Recepción masiva bloqueada: ' + report.blockers.join(' '));
    massReadiness = {expiresAt:Date.parse(evidence.expiresAt)};
  }
  function readPrivateBroadcastConfig(file) {
    let descriptor;
    try {
      if (!path.isAbsolute(file) || typeof process.getuid !== 'function' || fs.realpathSync(file) !== path.resolve(file)) throw new Error('invalid private path');
      const metadata = fs.lstatSync(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8192 || metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) throw new Error('invalid private permissions');
      descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(descriptor);
      if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || !opened.isFile() || opened.size > 8192 || opened.uid !== process.getuid() || (opened.mode & 0o077) !== 0) throw new Error('private file changed');
      const source = fs.readFileSync(descriptor, 'utf8');
      if (Buffer.byteLength(source) > 8192) throw new Error('oversized');
      return JSON.parse(source.replace(/^\uFEFF/, ''));
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  }
  let broadcastAdmissionProbe = options.broadcastAdmissionProbe || null;
  if (!broadcastAdmissionProbe && env.QSESSION_BROADCAST_ADMISSION_PROBE_FILE) {
    try {
      broadcastAdmissionProbe = readPrivateBroadcastConfig(env.QSESSION_BROADCAST_ADMISSION_PROBE_FILE);
    } catch { throw new Error('No se pudo leer la configuración de la comprobación técnica de admisiones.'); }
  }
  if (broadcastAdmissionProbe) {
    const probe = broadcastAdmissionProbe;
    const fields = ['schemaVersion', 'code', 'prefix', 'generation', 'issuedAt', 'expiresAt', 'capacity'];
    const issued = Date.parse(probe.issuedAt), expires = Date.parse(probe.expiresAt);
    const isoInstant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    if (Object.keys(probe).some(key => !fields.includes(key)) || probe.schemaVersion !== 1 || probe.code !== 'PRB10A'
      || !isoInstant(probe.issuedAt) || !isoInstant(probe.expiresAt)
      || probe.prefix !== 'live/PRB10A-hWrdBkirH_2yHmZ9lp' || !/^synthetic-[a-f0-9]{16}$/.test(probe.generation) || probe.capacity !== 10000
      || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > Date.now() || expires <= issued || expires - issued > 3600000) {
      throw new Error('La comprobación técnica sólo permite la señal sintética PRB10A durante un máximo de una hora.');
    }
    if (expires <= Date.now()) {
      if (audienceMode !== 'interactive') throw new Error('La comprobación técnica de admisiones ya terminó.');
      console.warn('QSESSION_BROADCAST_ADMISSION_PROBE_EXPIRED_INACTIVE');
      broadcastAdmissionProbe = null;
    } else {
      broadcastAdmissionProbe = {...probe, expiresAtMs: expires};
    }
  }
  let broadcastEventPlan = options.broadcastEventPlan || null;
  if (!broadcastEventPlan && env.QSESSION_BROADCAST_EVENT_PLAN_FILE) {
    try {
      broadcastEventPlan = readPrivateBroadcastConfig(env.QSESSION_BROADCAST_EVENT_PLAN_FILE);
    } catch { throw new Error('No se pudo leer el plan operativo de transmisión.'); }
  }
  if (broadcastEventPlan) {
    const room = productStore.getRoomRecord(broadcastEventPlan.roomCode);
    const issuedAt = Date.parse(broadcastEventPlan.issuedAt), expiresAt = Date.parse(broadcastEventPlan.expiresAt);
    const planOptions = {roomCode: room?.code, roomId: room?.id, target: broadcastAudienceTarget};
    if (Number.isFinite(issuedAt) && issuedAt <= Date.now() && expiresAt <= Date.now()) {
      // Validate every structural and scope requirement at the issuance instant
      // before treating only expiry as an inactive, harmless configuration.
      parseBroadcastEventPlan(broadcastEventPlan, {...planOptions, now: issuedAt});
      if (audienceMode !== 'interactive') throw new Error('La autorización de aforo de este evento ya caducó.');
      console.warn('QSESSION_BROADCAST_EVENT_PLAN_EXPIRED_INACTIVE');
      broadcastEventPlan = null;
    } else {
      broadcastEventPlan = parseBroadcastEventPlan(broadcastEventPlan, planOptions);
    }
  }
  const admissionsNeeded = audienceMode === 'cdn-only' || Boolean(broadcastAdmissionProbe);
  const broadcastAdmissions = options.broadcastAdmissions || createBroadcastAdmissions({
    redisUrl: admissionsNeeded ? redisUrl : '',
    secret: admissionsNeeded ? String(env.QSESSION_BROADCAST_ADMISSION_SECRET || '') : '',
  });
  if (admissionsNeeded && !broadcastAdmissions.configured) {
    throw new Error('La recepción masiva requiere admisiones Redis y QSESSION_BROADCAST_ADMISSION_SECRET.');
  }
  const targetRoomCapacity = Math.max(1, Math.min(50000, Number(options.targetRoomCapacity ?? env.QSESSION_ROOM_TARGET_CAPACITY ?? 5000)));
  const djCameraLimit = Math.max(1, Math.min(3, Number(options.djCameraLimit ?? env.QSESSION_DJ_CAMERA_LIMIT ?? 3)));
  const realtimeMaximumConnections = Math.max(
    // Each signed-in listener can hold a profile socket and a conversation
    // socket simultaneously. Media distribution does not provide these slots.
    2 * Math.max(targetRoomCapacity, audienceMode === 'cdn-only' ? broadcastAudienceTarget : 0) + 64,
    Number(options.realtimeMaximumConnections ?? env.QSESSION_REALTIME_MAX_CONNECTIONS) || 6000,
  );
  const chatStore = options.chatStore || createScalableChatStore({
    databaseUrl,
    productStore,
    pool: options.databasePool || null,
    maximumPoolSize: Number(env.QSESSION_DATABASE_POOL_SIZE || 20),
  });
  const directVideoUploads = options.directVideoUploads || createDirectVideoUploadProvider({
    accountId: env.QSESSION_STREAM_ACCOUNT_ID || '',
    apiToken: env.QSESSION_STREAM_API_TOKEN || '',
    publicUrl,
    fetchImpl: options.fetchImpl || fetch,
  });
  const billingPlanForClient = plan => ({
    ...plan,
    features: {
      ...(plan?.features || {}),
      videoUploads: Boolean(plan?.features?.videoUploads && directVideoUploads.configured),
    },
  });
  const billingPlansForClient = async () => (await billingStore.listPlans()).map(billingPlanForClient);
  const accountBillingForClient = async accountId => {
    const billing = await billingStore.accountBilling(accountId);
    return {
      ...billing,
      plans: (billing.plans || []).map(billingPlanForClient),
      credits: (billing.credits || []).map(credit => ({
        ...credit,
        plan: credit.plan ? billingPlanForClient(credit.plan) : credit.plan,
      })),
    };
  };
  const edgeBroadcast = options.edgeBroadcast || createEdgeBroadcastProvider({
    apiUrl: livekitApiUrl,
    apiKey: livekitApiKey,
    apiSecret: livekitApiSecret,
    endpoint: env.QSESSION_BROADCAST_STORAGE_ENDPOINT || env.QSESSION_R2_ENDPOINT || '',
    bucket: env.QSESSION_BROADCAST_STORAGE_BUCKET || env.QSESSION_R2_BUCKET || '',
    accessKey: env.QSESSION_BROADCAST_STORAGE_ACCESS_KEY || env.QSESSION_R2_ACCESS_KEY || '',
    secretKey: env.QSESSION_BROADCAST_STORAGE_SECRET_KEY || env.QSESSION_R2_SECRET_KEY || '',
    pathSecret: roomSecret,
    region: env.QSESSION_BROADCAST_STORAGE_REGION || env.QSESSION_R2_REGION || 'auto',
    provider: env.QSESSION_BROADCAST_PROVIDER || 's3-cdn-hls',
    forcePathStyle: String(env.QSESSION_BROADCAST_FORCE_PATH_STYLE || '').toLowerCase() === 'true'
      || (!env.QSESSION_BROADCAST_STORAGE_ENDPOINT && Boolean(env.QSESSION_R2_ENDPOINT)),
    playbackBaseUrl: env.QSESSION_EDGE_PLAYBACK_BASE_URL || '',
    playbackPathPrefix: env.QSESSION_EDGE_PLAYBACK_PATH_PREFIX || '',
    playbackManifestSuffix: env.QSESSION_EDGE_PLAYBACK_MANIFEST_SUFFIX || '',
    storagePlaybackBaseUrl: env.QSESSION_BROADCAST_STORAGE_PLAYBACK_BASE_URL || '',
    storagePlaybackPathPrefix: env.QSESSION_BROADCAST_STORAGE_PLAYBACK_PATH_PREFIX || '',
    storagePlaybackManifestSuffix: env.QSESSION_BROADCAST_STORAGE_PLAYBACK_MANIFEST_SUFFIX || '',
    localPlaybackBaseUrl: env.QSESSION_BROADCAST_LOCAL_PLAYBACK_BASE_URL || '',
    localPlaybackPathPrefix: env.QSESSION_BROADCAST_LOCAL_PLAYBACK_PATH_PREFIX || '',
    localPlaybackManifestSuffix: env.QSESSION_BROADCAST_LOCAL_PLAYBACK_MANIFEST_SUFFIX || '',
    outputDirectory: env.QSESSION_EGRESS_OUTPUT_DIRECTORY || '',
    cleanupDirectory: edgeMediaDirectory,
    segmentDuration: env.QSESSION_HLS_SEGMENT_SECONDS || 4,
    videoBitrate: env.QSESSION_HLS_VIDEO_BITRATE || 1_800_000,
    audioBitrate: env.QSESSION_HLS_AUDIO_BITRATE || 128_000,
  });
  const profileMediaStore = createProfileMediaStore({directory: mediaDirectory});
  const privateMediaStore = createPrivateMediaStore({directory: privateMediaDirectory});
  const promotionMediaStore = createPromotionMediaStore({directory: promotionMediaDirectory});
  const analyticsStore = options.analyticsStore || createAnalyticsStore({filePath: analyticsDataFile, secret: analyticsSecret});
  const globalRavePresence = options.globalRavePresence || createGlobalRavePresenceStore({secret: roomSecret});
  const authBuckets = new Map();
  const passwordRecoveryBuckets = new Map();
  const adminBuckets = new Map();
  const adminRecoveryBuckets = new Map();
  const analyticsBuckets = new Map();
  const messageBuckets = new Map();
  const privateInviteBuckets = new Map();
  const effectCreatorBuckets = new Map();
  const globalPresenceBuckets = new Map();
  const uploadIntentBuckets = new Map();
  const contentReportBuckets = new Map();
  const mediaConfigured = Boolean(livekitUrl && livekitApiKey && livekitApiSecret);
  const broadcastAudioBitrate = Math.max(64000, Math.min(510000, Number(env.QSESSION_BROADCAST_AUDIO_BITRATE) || 320000));
  const publicDirectoryCacheMs = Math.max(0, Number(options.publicDirectoryCacheMs ?? env.QSESSION_PUBLIC_DIRECTORY_CACHE_MS ?? 5000));
  const liveRoomActivityProvider = typeof options.liveRoomActivityProvider === 'function'
    ? options.liveRoomActivityProvider
    : rooms => listLiveKitRoomActivity({rooms, apiUrl: livekitApiUrl, apiKey: livekitApiKey, apiSecret: livekitApiSecret});
  const roomChatPresenceProvider = typeof options.roomChatPresenceProvider === 'function'
    ? options.roomChatPresenceProvider
    : (room, auth) => liveKitRoomChatPresence({
      room,
      accountId: auth.account.id,
      profileId: auth.profile.id,
      apiUrl: livekitApiUrl,
      apiKey: livekitApiKey,
      apiSecret: livekitApiSecret,
    });
  const closeLiveRoomProvider = typeof options.closeLiveRoomProvider === 'function'
    ? options.closeLiveRoomProvider
    : room => closeLiveKitRoom({room, apiUrl: livekitApiUrl, apiKey: livekitApiKey, apiSecret: livekitApiSecret});
  const replaceDesktopAudioProvider = typeof options.replaceDesktopAudioProvider === 'function'
    ? options.replaceDesktopAudioProvider
    : code => removeExistingDesktopAudioParticipants({
      code,
      apiUrl: livekitApiUrl,
      apiKey: livekitApiKey,
      apiSecret: livekitApiSecret,
    });
  let publicDirectoryCache = {expiresAt: 0, rooms: []};
  let realtimeHub = null;

  function authenticated(req) {
    return productStore.authenticateSession(requestToken(req));
  }

  function realtimeAccess(auth, channel) {
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    return signPayload({scope: 'qsession-realtime', channel, sub: auth.account.id, exp: expiresAt}, roomSecret);
  }

  function authorizeRealtime({request, channel, token}) {
    const access = verifyPayload(token, roomSecret);
    if (!access || access.scope !== 'qsession-realtime' || !safeEqual(access.channel, channel)) return null;
    const auth = authenticated(request);
    if (auth && !safeEqual(access.sub, auth.account.id)) return null;
    return {accountId: access.sub, expiresAt: access.exp * 1000};
  }

  function publishPrivateRealtime(conversation, event) {
    if (!conversation?.id) return;
    void realtimeHub?.publish(`private:${conversation.id}`, event);
    conversation.members?.forEach(member => {
      if (member?.id) void realtimeHub?.publish(`profile:${member.id}`, {...event, conversationId: conversation.id});
    });
  }

  function sendPrivatePush(conversation, senderProfile, type, actionId, body) {
    if (!pushNotifications.configured || !conversation?.members) return;
    const targets = conversation.members
      .map(member => member?.id)
      .filter(profileId => profileId && profileId !== senderProfile?.id);
    const tokens = productStore.listPushTokens(targets);
    if (!tokens.length) return;
    void pushNotifications.sendToTokens(tokens, {
      type,
      actionId,
      conversationId: conversation.id,
      senderName: senderProfile?.displayName || 'Usuario Q Session',
      body,
    }).catch(error => console.warn(`No se pudo enviar una notificación privada: ${error.message}`));
  }

  function broadcastPlaybackUrl(code) {
    const edgeUrl = edgeBroadcast.playbackUrl?.(code);
    if (edgeUrl) return edgeUrl;
    if (!broadcastPlaybackUrlTemplate) return '';
    const candidate = broadcastPlaybackUrlTemplate.replaceAll('{roomCode}', encodeURIComponent(code));
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'https:' ? parsed.toString() : '';
    } catch {
      return '';
    }
  }

  function cdnAdmissionPrefix(code) {
    try {
      const url = new URL(broadcastPlaybackUrl(code));
      if (url.protocol !== 'https:' || !url.pathname.endsWith('/index.m3u8')) return '';
      return url.pathname.slice(1, url.pathname.lastIndexOf('/'));
    } catch { return ''; }
  }

  function broadcastEventOptions(room) {
    return {roomCode: room?.code, roomId: room?.id, target: broadcastAudienceTarget, audienceMode, selectedRoomCode: cdnOnlyRoom, readinessApproved: Boolean(massReadiness && Date.now() < massReadiness.expiresAt)};
  }

  function broadcastEventSummary(room) {
    return broadcastEventPlan?.roomCode === room?.code
      ? {broadcastEventPlan: publicBroadcastEventPlan(broadcastEventPlan, broadcastEventOptions(room))} : {};
  }

  function admissionError(res, error) {
    const status = [403, 410, 429, 503].includes(error?.statusCode) ? error.statusCode : 503;
    return json(res, status, {error: status === 503
      ? 'No pudimos comprobar el aforo de esta transmisión. Intenta nuevamente.'
      : error.message || 'La autorización de reproducción ya no es válida.'}, {'Cache-Control': 'no-store'});
  }

  function authenticatedAdmin(req) {
    if (!adminConfigured) return null;
    const payload = verifyPayload(parseCookies(req)[ADMIN_COOKIE], adminSessionSecret);
    return payload?.scope === 'qsession-admin' && safeEqual(payload.sub, adminUsername) ? payload : null;
  }

  function promoteRoomLive(room) {
    if (!room || room.status !== 'waiting') return room;
    publicDirectoryCache = {expiresAt: 0, rooms: []};
    return productStore.updateRoomRecord(room.code, {status: 'live', startedAt: new Date().toISOString()});
  }

  function currentRoom(roomOrCode) {
    let room = typeof roomOrCode === 'string' ? productStore.getRoomRecord(roomOrCode) : roomOrCode;
    if (room?.status === 'waiting' && room.scheduledAt && new Date(room.scheduledAt).getTime() <= Date.now()) {
      room = promoteRoomLive(room);
    }
    return room;
  }

  async function roomHasActiveBroadcast(room) {
    if (!mediaConfigured || !room) return false;
    try {
      const activityByRoom = await liveRoomActivityProvider([room]);
      const activity = activityByRoom instanceof Map ? activityByRoom.get(room.code) : activityByRoom?.[room.code];
      return activity?.audioLive === true;
    } catch {
      return false;
    }
  }

  let broadcastSessionCountCache = {key: '', expiresAt: 0, value: null, pending: null};
  async function broadcastSessionMetrics(room) {
    if (audienceMode !== 'cdn-only' || room?.code !== cdnOnlyRoom) return {};
    const prefix = cdnAdmissionPrefix(room.code);
    const key = `${room.id}:${prefix}`;
    if (broadcastSessionCountCache.key === key && broadcastSessionCountCache.expiresAt > Date.now()) return broadcastSessionCountCache.value;
    if (broadcastSessionCountCache.key === key && broadcastSessionCountCache.pending) return broadcastSessionCountCache.pending;
    const entry = {key, expiresAt: 0, value: null, pending: null};
    broadcastSessionCountCache = entry;
    entry.pending = (async () => {
      try {
        if (!prefix) throw new Error('Missing playback prefix');
        const count = await broadcastAdmissions.count({code: room.code, prefix, generation: room.id});
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid admission count');
        entry.value = {audienceMode: 'cdn-only', activeBroadcastSessions: count, broadcastSessionsStatus: 'ready', broadcastSessionsMeasuredAt: new Date().toISOString()};
      } catch {
        entry.value = {audienceMode: 'cdn-only', activeBroadcastSessions: null, broadcastSessionsStatus: 'unavailable', broadcastSessionsMeasuredAt: null};
      }
      entry.expiresAt = Date.now() + 5000;
      return entry.value;
    })();
    const result = await entry.pending;
    entry.pending = null;
    return result;
  }

  async function activePublicRooms() {
    if (!publicRoomsEnabled) return [];
    const now = Date.now();
    if (publicDirectoryCache.expiresAt > now) return publicDirectoryCache.rooms;
    const candidates = productStore.listPublicRooms()
      .map(currentRoom)
      .filter(room => room?.status === 'live');
    let activityByRoom = new Map();
    if (mediaConfigured && candidates.length) {
      try {
        activityByRoom = await liveRoomActivityProvider(candidates);
      } catch (error) {
        console.warn(`No se pudo comprobar el directorio en vivo: ${error.message}`);
      }
    }
    const rooms = [];
    for (const room of candidates) {
      const activity = activityByRoom instanceof Map ? activityByRoom.get(room.code) : activityByRoom?.[room.code];
      if (!activity || activity.audioLive !== true || Number(activity.participantCount) < 1) continue;
      for (const accountId of Array.isArray(activity.listenerAccountIds) ? activity.listenerAccountIds : []) {
        const savedPresence = productStore.globalRavePresenceForAccount(accountId);
        if (!savedPresence) continue;
        globalRavePresence.update({
          accountId,
          roomCode: room.code,
          countryCode: savedPresence.countryCode,
          profileVisible: room.allowSocialProfiles !== false && savedPresence.profileVisible,
          publicName: savedPresence.publicName,
        });
      }
      const cdnMetrics = await broadcastSessionMetrics(room);
      const measuredRoom = cdnMetrics.audienceMode === 'cdn-only' ? room
        : productStore.recordRoomActivity(room.code, activity.listenerCount) || room;
      rooms.push({...publicRoom(measuredRoom, activity), ...cdnMetrics, ...broadcastEventSummary(room)});
    }
    publicDirectoryCache = {expiresAt: Math.min(now + publicDirectoryCacheMs, rooms.some(room => room.audienceMode === 'cdn-only') ? broadcastSessionCountCache.expiresAt : Infinity), rooms};
    return rooms;
  }

  function createRoomAccessToken(code, requestedExpiresAt = null) {
    const expiresAt = Number(requestedExpiresAt) || Math.floor(Date.now() / 1000) + 12 * 60 * 60;
    return {
      accessToken: signPayload({code, scope: 'room-access', exp: expiresAt}, roomSecret),
      accessExpiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  function roomAccessGranted(req, room, input = {}) {
    if (!room?.passwordProtected) return true;
    const token = input.accessToken || req.headers['x-qsession-room-access'];
    const access = verifyPayload(token, roomSecret);
    return Boolean(access && access.code === room.code && access.scope === 'room-access');
  }

  function sessionPayload(session) {
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      account: session.account,
      profile: session.profile,
    };
  }

  async function serveStatic(requestUrl, res, method = 'GET', requestHeaders = {}) {
    const relative = requestUrl.pathname === '/'
      ? 'index.html'
      : requestUrl.pathname === '/admin' || requestUrl.pathname === '/admin/'
        ? 'admin.html'
        : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
    const dependencyAsset = requestUrl.pathname === '/vendor/hls.min.js' ? HLS_CLIENT_FILE : '';
    const candidate = dependencyAsset || path.resolve(PUBLIC_DIR, relative);
    if (!dependencyAsset && candidate !== PUBLIC_DIR && !candidate.startsWith(`${PUBLIC_DIR}${path.sep}`)) return false;
    let info;
    try {
      info = await fs.promises.stat(candidate);
    } catch {
      return false;
    }
    if (!info.isFile()) return false;
    const extension = path.extname(candidate).toLowerCase();
    const type = contentTypes[extension] || 'application/octet-stream';
    const invitedRoom = requestUrl.pathname === '/'
      ? productStore.getRoomRecord(requestUrl.searchParams.get('room'))
      : null;
    const isWindowsDesktop = requestUrl.pathname === '/'
      && requestUrl.searchParams.get('desktop') === 'windows';
    if ((invitedRoom && invitedRoom.status !== 'archived') || isWindowsDesktop) {
      const template = await fs.promises.readFile(candidate, 'utf8');
      let body = invitedRoom && invitedRoom.status !== 'archived'
        ? roomInvitationHtml(template, invitedRoom, publicUrl)
        : template;
      if (isWindowsDesktop) {
        body = body.replace(
          '<link rel="icon" href="/icons/qsession-icon-192.png?v=20260911-brand-logo-v1" type="image/png" />',
          '<link rel="icon" href="/icons/qsession-windows-icon-192.png?v=20260912-windows-taskbar-v6" type="image/png" />',
        );
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
      return true;
    }
    const headers = {
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': /\.(?:png|webp|ico)$/i.test(candidate) ? 'public, max-age=3600' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (requestUrl.pathname === '/admin' || requestUrl.pathname === '/admin/' || /^\/admin\.(?:html|css|js)$/.test(requestUrl.pathname)) {
      headers['Cache-Control'] = 'no-store';
      headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
      headers['X-Frame-Options'] = 'DENY';
      headers['Referrer-Policy'] = 'no-referrer';
      headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()';
    }
    if (/^\/(?:privacidad|eliminar-cuenta|terminos-anfitriones|propiedad-intelectual|reportar-contenido)(?:\.html|\.js)?$/.test(requestUrl.pathname)) {
      headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
      headers['X-Frame-Options'] = 'DENY';
      headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()';
    }
    if (extension === '.apk' || extension === '.exe') {
      const range = requestedByteRange(requestHeaders.range, info.size);
      headers['Accept-Ranges'] = 'bytes';
      headers['Content-Disposition'] = `attachment; filename="${path.basename(candidate)}"`;
      if (range?.invalid) {
        res.writeHead(416, {...headers, 'Content-Range': `bytes */${info.size}`});
        res.end();
        return true;
      }
      if (range) {
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
        headers['Content-Length'] = range.end - range.start + 1;
        res.writeHead(206, headers);
        if (method === 'HEAD') res.end();
        else fs.createReadStream(candidate, {start: range.start, end: range.end}).pipe(res);
        return true;
      }
    }
    res.writeHead(200, headers);
    if (method === 'HEAD') res.end();
    else fs.createReadStream(candidate).pipe(res);
    return true;
  }

  async function serveEdgeMedia(requestUrl, res, method = 'GET') {
    const routePrefix = '/edge-live/';
    if (!edgeMediaDirectory || !requestUrl.pathname.startsWith(routePrefix)) return false;
    let relative;
    try {
      relative = decodeURIComponent(requestUrl.pathname.slice(routePrefix.length));
    } catch {
      return false;
    }
    const playlistAlias = /\.m3u8\.txt$/.test(relative);
    const segmentAlias = /\.ts\.bin$/.test(relative);
    const sourceRelative = playlistAlias || segmentAlias ? relative.slice(0, -4) : relative;
    if (!/^live\/[A-Z0-9]{6}-[A-Za-z0-9_-]{18}\/(?:index|archive)\.m3u8$/.test(sourceRelative)
      && !/^live\/[A-Z0-9]{6}-[A-Za-z0-9_-]{18}\/segment[-_A-Za-z0-9.]*\.ts$/.test(sourceRelative)) return false;
    const root = path.resolve(edgeMediaDirectory);
    const candidate = path.resolve(root, sourceRelative);
    if (!candidate.startsWith(`${root}${path.sep}`)) return false;
    let info;
    try {
      info = await fs.promises.stat(candidate);
    } catch {
      return false;
    }
    if (!info.isFile()) return false;
    const playlist = candidate.endsWith('.m3u8');
    let playlistBody = null;
    if (playlistAlias) {
      const rawPlaylist = await fs.promises.readFile(candidate, 'utf8');
      playlistBody = Buffer.from(rawPlaylist.replace(/^(?!#)([^\r\n]+\.ts)(\?[^\r\n]*)?$/gm, '$1.bin$2'));
    }
    res.writeHead(200, {
      'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Content-Length': playlistBody ? playlistBody.length : info.size,
      'Cache-Control': playlist ? 'public, max-age=1, must-revalidate' : 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    if (method === 'HEAD') res.end();
    else if (playlistBody) res.end(playlistBody);
    else fs.createReadStream(candidate).pipe(res);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      const invitationMatch = requestUrl.pathname.match(/^\/join\/([A-Z0-9]{6})\/?$/i);
      if (invitationMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        const code = invitationMatch[1].toUpperCase();
        res.writeHead(302, {
          Location: `/?room=${encodeURIComponent(code)}&open=app`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      if (requestUrl.pathname === '/payments/return' && (req.method === 'GET' || req.method === 'HEAD')) {
        const transactionId = String(requestUrl.searchParams.get('id') || '').slice(0, 120);
        res.writeHead(302, {
          Location: `/?payment=returned${transactionId ? `&transaction=${encodeURIComponent(transactionId)}` : ''}#create`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      if (requestUrl.pathname === '/api/app-releases' && (req.method === 'GET' || req.method === 'HEAD')) {
        try {
          const catalog = await loadAppReleaseCatalog();
          if (req.method === 'HEAD') {
            res.writeHead(200, {'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8'});
            res.end();
            return;
          }
          return json(res, 200, catalog, {'Cache-Control': 'no-store'});
        } catch {
          return json(res, 503, {error: 'Las descargas están temporalmente en verificación.'}, {'Cache-Control': 'no-store'});
        }
      }

      const latestAppPlatform = Object.entries(APP_RELEASE_ALIASES)
        .find(([, pathname]) => pathname === requestUrl.pathname)?.[0];
      if (latestAppPlatform && (req.method === 'GET' || req.method === 'HEAD')) {
        try {
          const release = (await loadAppReleaseCatalog())[latestAppPlatform];
          res.writeHead(307, {
            Location: `/downloads/${encodeURIComponent(release.artifact)}?version=${encodeURIComponent(release.version)}`,
            'Cache-Control': 'no-store',
          });
          res.end();
          return;
        } catch {
          return json(res, 503, {error: 'La última versión está temporalmente en verificación.'}, {'Cache-Control': 'no-store'});
        }
      }

      if (
        requestUrl.pathname === '/downloads/QSession-Desktop-Windows-x64.zip'
        && (req.method === 'GET' || req.method === 'HEAD')
      ) {
        res.writeHead(308, {
          Location: APP_RELEASE_ALIASES.windows,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      const originalMusicMatch = requestUrl.pathname.match(/^\/api\/music\/originals\/([a-zA-Z0-9_-]+)\/audio$/);
      if (originalMusicMatch && ['GET','HEAD'].includes(req.method)) {
        const asset = ownedMusicLibrary.file(originalMusicMatch[1]);
        if (!asset) return json(res, 404, {error:'La pista no está disponible'});
        const info = await fs.promises.stat(asset.path);
        const range = requestedByteRange(req.headers.range, info.size);
        const headers = {
          'Content-Type': asset.contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
          'Content-Disposition': `inline; filename="${asset.track.id}${path.extname(asset.path)}"`,
          'X-Content-Type-Options': 'nosniff',
        };
        if (range?.invalid) {
          res.writeHead(416, {...headers, 'Content-Range':`bytes */${info.size}`}); res.end(); return;
        }
        if (range) {
          res.writeHead(206, {...headers, 'Content-Range':`bytes ${range.start}-${range.end}/${info.size}`, 'Content-Length':range.end-range.start+1});
          return req.method === 'HEAD' ? res.end() : fs.createReadStream(asset.path,{start:range.start,end:range.end}).pipe(res);
        }
        res.writeHead(200, {...headers, 'Content-Length':info.size});
        return req.method === 'HEAD' ? res.end() : fs.createReadStream(asset.path).pipe(res);
      }

      if (requestUrl.pathname === '/api/admin/music/import' && req.method === 'POST') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error:'Inicia sesión como administrador para importar música'});
        try {
          const input = Object.fromEntries(['filename','relativePath','title','artist','family','genre','subgenre','energy','bpm','mood','rhythm','duration']
            .map(key=>[key, requestUrl.searchParams.get(key) || '']));
          const result = await ownedMusicLibrary.importTrack(req, input);
          return json(res, result.duplicate ? 200 : 201, {ok:true, ...result});
        } catch(error) { return json(res, 400, {error:error.message}); }
      }

      if (requestUrl.pathname === '/api/admin/music/tracks' && req.method === 'GET') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error:'Inicia sesión como administrador'});
        return json(res, 200, {ok:true, tracks:ownedMusicLibrary.list()}, {'Cache-Control':'no-store'});
      }

      const originalMusicEditMatch = requestUrl.pathname.match(/^\/api\/admin\/music\/tracks\/([a-zA-Z0-9_-]+)$/);
      if (originalMusicEditMatch && req.method === 'PATCH') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error:'Inicia sesión como administrador'});
        try { return json(res, 200, {ok:true, track:ownedMusicLibrary.update(originalMusicEditMatch[1], await readJson(req, 16*1024))}); }
        catch(error) { return json(res, 400, {error:error.message}); }
      }
      if (originalMusicEditMatch && req.method === 'DELETE') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error:'Inicia sesión como administrador'});
        try { return json(res, 200, {ok:true, removed:ownedMusicLibrary.remove(originalMusicEditMatch[1])}); }
        catch(error) { return json(res, 400, {error:error.message}); }
      }

      if (requestUrl.pathname === '/api/music/catalog' && req.method === 'GET') {
        return json(res, 200, {ok:true, ...musicLibrary.catalog()});
      }
      if (requestUrl.pathname === '/api/music/feedback' && req.method==='GET') {
        const voter=musicVoter(req),trackId=requestUrl.searchParams.get('trackId');
        if(trackId&&!musicLibrary.has(trackId))return json(res,404,{error:'Canción no disponible'});
        return json(res,200,{ok:true,tracks:await musicFeedback.get(voter.actor,trackId)},voter.headers);
      }
      const feedbackMatch=requestUrl.pathname.match(/^\/api\/music\/tracks\/([a-zA-Z0-9_-]+)\/feedback$/);
      if(feedbackMatch&&req.method==='PUT'){
        const voter=musicVoter(req);
        if(!consumeRateLimit(musicBuckets,'vote:'+voter.actor,30,60000)||!consumeRateLimit(musicBuckets,'vote-ip:'+req.socket.remoteAddress,6000,60000))return json(res,429,{error:'Espera un momento antes de volver a votar'},voter.headers);
        try{const input=await readJson(req,1024);return json(res,200,{ok:true,trackId:feedbackMatch[1],feedback:await musicFeedback.put(voter.actor,feedbackMatch[1],input.vote)},voter.headers);}
        catch(error){return json(res,400,{error:error.message},voter.headers);}
      }
      if(requestUrl.pathname==='/api/admin/music/feedback'&&req.method==='GET'){
        if(!authenticatedAdmin(req))return json(res,401,{error:'Inicia sesión como administrador'});
        return json(res,200,{ok:true,tracks:await musicFeedback.get()},{'Cache-Control':'no-store'});
      }
      if (requestUrl.pathname === '/api/music/session' && req.method === 'POST') {
        try { const voter=musicVoter(req),input=await readJson(req,16384); return json(res,200,{ok:true,...musicLibrary.session({...input,feedback:await musicFeedback.get(voter.actor)})},voter.headers); }
        catch(error) { return json(res,400,{error:error.message}); }
      }
      if (requestUrl.pathname === '/api/music/interpret' && req.method === 'POST') {
        if (!consumeRateLimit(musicBuckets,'intent:'+String(req.socket.remoteAddress||'local'),20,60000)) return json(res,429,{error:'Espera un momento antes de crear otra playlist'});
        try {
          const input=await readJson(req,4096),catalog=musicLibrary.catalog();
          const result=await interpretIntent(input.command,catalog,{apiKey:qdjSemanticAiEnabled?openaiApiKey:'',fetchImpl,model:String(env.QSESSION_QDJ_INTERPRET_MODEL||'gpt-5-mini')});
          return json(res,200,{ok:true,...result},{'Cache-Control':'no-store'});
        } catch(error) { return json(res,400,{error:error.message}); }
      }
      const musicTrackMatch = requestUrl.pathname.match(/^\/api\/music\/tracks\/([a-zA-Z0-9_-]+)\/play$/);
      if (musicTrackMatch && req.method === 'GET') {
        if (!consumeRateLimit(musicBuckets, req.socket.remoteAddress || 'local', 90, 60000)) return json(res,429,{error:'Espera un momento antes de volver a reproducir'});
        try {return json(res,200,{ok:true,...await musicLibrary.resolve(musicTrackMatch[1])});}
        catch(error) {return json(res,503,{error:error.message});}
      }
      if (requestUrl.pathname === '/api/music/playlists' && ['GET','PUT'].includes(req.method)) {
        const auth=authenticated(req);
        if (!auth) return json(res,401,{error:'Inicia sesión para guardar y recuperar tus playlists'});
        try {
          const playlists=req.method==='GET' ? await musicPlaylists.get(auth.account.id)
            : await musicPlaylists.put(auth.account.id,(await readJson(req, 64*1024)).playlists);
          return json(res,200,{ok:true,playlists});
        } catch(error) {return json(res,400,{error:error.message});}
      }
      if (requestUrl.pathname === '/api/status' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          product: 'Q Session',
          version: QSESSION_VERSION,
          publicUrl: publicUrl || null,
          globalNetwork: true,
          storage: {driver: storageDriver, developmentOnly: storageDriver === 'file'},
          media: {transport: 'sfu', configured: mediaConfigured, url: livekitUrl || null, turnRequired: true},
          scale: {
            targetParticipantsPerRoom: targetRoomCapacity,
            djCameraLimit,
            realtime: realtimeHub?.status() || {transport: 'websocket', distribution: redisUrl ? 'redis-connecting' : 'local'},
            roomChat: chatStore.status(),
            broadcast: {
              audienceMode,
              audienceTarget: audienceMode === 'cdn-only' ? broadcastAudienceTarget : null,
              scopedToSingleRoom: true,
              admissionPaused: audienceMode === 'cdn-only' && cdnOnlyPaused,
              admissions: broadcastAdmissions.status(),
              readinessEvidenceAccepted: Boolean(massReadiness),
              capacityValidated: false,
              video: {width:1280,height:720,framerate:30},
              mode: edgeBroadcast.configured ? 'edge-hls' : 'hybrid-ready',
              provider: edgeBroadcast.configured ? edgeBroadcast.provider : null,
              deliveryMode: edgeBroadcast.configured ? edgeBroadcast.deliveryMode : null,
              configured: Boolean(edgeBroadcast.configured || broadcastPlaybackUrlTemplate),
              segmentDuration: edgeBroadcast.configured ? edgeBroadcast.segmentDuration : null,
              approximateLatencySeconds: edgeBroadcast.configured ? edgeBroadcast.approximateLatencySeconds : null,
              estimatedViewerGigabytesPerHour: edgeBroadcast.configured
                ? edgeBroadcast.estimatedViewerGigabytesPerHour
                : null,
            },
            directVideoUploads: {
              configured: Boolean(directVideoUploads.configured),
              protocol: 'tus',
              maximumMessageMegabytes: 200,
              maximumSessionGigabytes: 8,
              maximumSessionHours: 4,
            },
          },
          features: {
            accounts: true,
            profiles: true,
            stories: true,
            roomParticipants: true,
            roomChat: true,
            privateChat: true,
            privateChats: true,
            privateMedia: true,
            voiceNotes: true,
            privateGroupVoice: true,
            privateContactInvites: true,
            liveChat: true,
            realtimeChat: true,
            directVideoUploads: Boolean(directVideoUploads.configured),
            socialCamera: true,
            profileGallery: true,
            profileActions: true,
            pushNotifications: pushNotifications.configured,
            analytics: true,
            adminAnalytics: adminConfigured,
            adminRecovery: adminRecoveryConfigured,
            accountRecovery: true,
            recoveryEmailConfigured: Boolean(accountMailer.configured),
            accountDataExport: true,
            accountDeletion: true,
            globalRaveMap: true,
            publicRooms: publicRoomsEnabled,
            privateRoomLaunch: !publicRoomsEnabled,
            contentReporting: true,
            copyrightAppeals: true,
            repeatInfringerEnforcement: true,
            paidRooms: true,
            billingEnforced,
            wompiCheckout: wompiGateway.checkoutConfigured,
            musicDatabase: musicLibrary.catalog().enabled,
            autopilot: musicLibrary.catalog().enabled,
            unattendedAutopilot: false,
          },
        });
      }

      if (requestUrl.pathname === '/api/global-rave' && req.method === 'GET') {
        let connectedTotal = 0;
        try {
          const liveRooms = await activePublicRooms();
          connectedTotal = liveRooms.reduce((total, room) => total + Math.max(0, Number(room.participantCount) || 0), 0);
        } catch {
          // El mapa sigue mostrando la última presencia consentida aunque LiveKit
          // esté temporalmente fuera de alcance.
        }
        const presence = globalRavePresence.snapshot();
        connectedTotal = Math.max(connectedTotal, presence.total);
        return json(res, 200, {
          ok: true,
          ...presence,
          visiblePresenceCount: presence.total,
          total: connectedTotal,
        }, {'Cache-Control': 'no-store'});
      }

      if (requestUrl.pathname === '/api/billing/plans' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          provider: 'wompi',
          checkoutConfigured: wompiGateway.checkoutConfigured,
          billingEnforced,
          directVideoUploadsConfigured: Boolean(directVideoUploads.configured),
          plans: await billingPlansForClient(),
        });
      }

      if (requestUrl.pathname === '/api/account/billing' && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para consultar tus bonos'});
        return json(res, 200, {
          ok: true,
          provider: 'wompi',
          checkoutConfigured: wompiGateway.checkoutConfigured,
          billingEnforced,
          directVideoUploadsConfigured: Boolean(directVideoUploads.configured),
          ...(await accountBillingForClient(auth.account.id)),
        });
      }

      if (requestUrl.pathname === '/api/stars/catalog' && req.method === 'GET') {
        return json(res, 200, {ok: true, provider: 'wompi', checkoutConfigured: wompiGateway.checkoutConfigured, ...starEconomy.publicCatalog()});
      }

      if (requestUrl.pathname === '/api/account/stars' && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para consultar tus estrellas'});
        return json(res, 200, {ok: true, provider: 'wompi', checkoutConfigured: wompiGateway.checkoutConfigured, ...(await starEconomy.accountWallet(auth.account.id))});
      }

      const flowerPulseMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/flowers\/pulse$/i);
      if (flowerPulseMatch && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para guardar flores'});
        const room = currentRoom(flowerPulseMatch[1]);
        if (!room || room.status !== 'live') return json(res, 404, {error: 'La sesión en vivo ya no está disponible'});
        if (room.ownerAccountId === auth.account.id) return json(res, 200, {ok: true, listener: false});
        try {
          const presence = await roomChatPresenceProvider(room, auth);
          if (!presence?.active) return json(res, 409, {error: 'Las flores sólo crecen mientras escuchas la sesión'});
          const reward = await starEconomy.recordListeningPulse({
            accountId: auth.account.id,
            roomId: room.id,
            roomCode: room.code,
            artistAccountId: room.ownerAccountId,
          });
          return json(res, 200, {ok: true, listener: true, reward});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/flowers/send' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para enviar una flor'});
        try {
          const input = await readJson(req, 8 * 1024);
          const targetProfile = productStore.snapshot().profiles.find(profile => profile.id === String(input.profileId || ''));
          if (!targetProfile?.accountId) throw new Error('El artista no tiene una cuenta activa para recibir flores');
          if (!['dj', 'organizer'].includes(String(targetProfile.role || '').toLowerCase())) {
            throw new Error('Las flores de reconocimiento se envían a artistas u organizadores');
          }
          const wallet = await starEconomy.accountWallet(auth.account.id);
          const available = wallet.flowers.inventory.find(item => item.id === String(input.flowerId || '') && item.quantity > 0);
          if (!available) throw new Error('Ya no tienes esa flor disponible');
          const action = productStore.createProfileAction({
            senderProfileId: auth.profile.id,
            targetProfileId: targetProfile.id,
            type: 'gift',
            gift: available.id,
            roomCode: input.roomCode,
          });
          const transfer = await starEconomy.sendFlower({
            fromAccountId: auth.account.id,
            toAccountId: targetProfile.accountId,
            flowerId: available.id,
            roomId: String(input.roomId || '') || null,
            profileId: targetProfile.id,
          });
          return json(res, 201, {ok: true, action, transfer});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/stars/orders' && req.method === 'POST') {
        if (/\bQSessionAndroid\//i.test(String(req.headers['user-agent'] || ''))) {
          return json(res, 403, {error: 'Las estrellas dentro de Android se habilitarán con Google Play Billing'});
        }
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para comprar estrellas'});
        if (!wompiGateway.checkoutConfigured) return json(res, 503, {error: 'Los pagos todavía están en preparación'});
        try {
          const input = await readJson(req, 8 * 1024);
          const order = await starEconomy.createOrder({accountId: auth.account.id, customerEmail: auth.account.email, packageId: String(input.packageId || '')});
          const checkout = wompiGateway.checkout(order, {
            redirectUrl: `${publicUrl || `http://${req.headers.host}`}/payments/return`,
            customerEmail: auth.account.email,
            customerName: auth.profile?.displayName || '',
          });
          return json(res, 201, {ok: true, order, checkout});
        } catch (error) { return json(res, 400, {error: error.message}); }
      }

      if (requestUrl.pathname === '/api/stars/send' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para enviar estrellas'});
        try {
          const input = await readJson(req, 8 * 1024);
          const targetProfile = productStore.snapshot().profiles.find(profile => profile.id === String(input.profileId || ''));
          if (!targetProfile?.accountId) throw new Error('El artista no tiene una cuenta activa para recibir estrellas');
          const transfer = await starEconomy.sendStars({fromAccountId: auth.account.id, toAccountId: targetProfile.accountId, stars: input.stars, roomId: String(input.roomId || '') || null, note: 'Apoyo al artista'});
          return json(res, 201, {ok: true, transfer});
        } catch (error) { return json(res, 400, {error: error.message}); }
      }

      const starUnlockMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/unlock$/i);
      if (starUnlockMatch && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para acceder a esta sesión'});
        const room = currentRoom(starUnlockMatch[1]);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sesión no está disponible'});
        if (!room.starPrice) return json(res, 200, {ok: true, free: true});
        try {
          const unlock = await starEconomy.unlockSession({accountId: auth.account.id, artistAccountId: room.ownerAccountId, roomId: room.id, roomCode: room.code, stars: room.starPrice});
          return json(res, 201, {ok: true, unlock});
        } catch (error) { return json(res, 400, {error: error.message}); }
      }

      if (requestUrl.pathname === '/api/sponsors' && req.method === 'GET') {
        const rooms = productStore.snapshot().rooms.filter(room => room.visibility === 'public' && (room.status === 'live' || room.status === 'waiting'));
        const sponsors = rooms.flatMap(room => (room.promotions || []).map(promotion => ({
          id: promotion.id, roomCode: room.code, roomName: room.name, artist: room.djName,
          sponsor: promotion.sponsor, headline: promotion.headline, linkUrl: promotion.linkUrl,
          media: promotion.mediaId ? {url: `/api/promotion-media/${promotion.mediaId}`, contentType: promotion.contentType} : null,
        })));
        return json(res, 200, {ok: true, rewardStars: starEconomy.publicCatalog().sponsorRewardStars, sponsors});
      }

      const sponsorViewMatch = requestUrl.pathname.match(/^\/api\/sponsors\/([a-z0-9_-]{6,120})\/views$/i);
      if (sponsorViewMatch && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para recibir estrellas'});
        const input = await readJson(req, 8 * 1024);
        const room = currentRoom(String(input.roomCode || ''));
        const promotion = room?.promotions?.find(item => item.id === sponsorViewMatch[1]);
        if (!promotion || room.visibility !== 'public' || !['live', 'waiting'].includes(room.status)) return json(res, 404, {error: 'El contenido patrocinado no está disponible'});
        try { return json(res, 201, {ok: true, view: await starEconomy.beginSponsorView({accountId: auth.account.id, promotionId: promotion.id, roomCode: room.code})}); }
        catch (error) { return json(res, 400, {error: error.message}); }
      }

      const sponsorRewardMatch = requestUrl.pathname.match(/^\/api\/sponsors\/views\/([a-z0-9_-]{10,120})\/reward$/i);
      if (sponsorRewardMatch && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para recibir estrellas'});
        try { return json(res, 200, {ok: true, reward: await starEconomy.rewardSponsorView({accountId: auth.account.id, viewId: sponsorRewardMatch[1]})}); }
        catch (error) { return json(res, 400, {error: error.message}); }
      }

      if (requestUrl.pathname === '/api/billing/custom-quotes' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para crear una cotización personalizada'});
        try {
          const input = await readJson(req, 16 * 1024);
          const quote = calculateCustomRoomQuote(input);
          const quoteId = crypto.randomUUID();
          const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
          const plan = customPlanFromQuote(quoteId, quote);
          const quoteToken = signPayload({
            scope: 'billing-custom-quote',
            sub: auth.account.id,
            quoteId,
            quote,
            plan,
            exp: expiresAt,
          }, roomSecret);
          return json(res, 201, {
            ok: true,
            quoteId,
            quote,
            plan,
            quoteToken,
            checkoutConfigured: !quote.requiresReview && wompiGateway.checkoutConfigured,
            expiresAt: new Date(expiresAt * 1000).toISOString(),
          });
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/billing/orders' && req.method === 'POST') {
        if (/\bQSessionAndroid\//i.test(String(req.headers['user-agent'] || ''))) {
          return json(res, 403, {error: 'Las compras dentro de Android se habilitarán con Google Play'});
        }
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para comprar un bono'});
        if (!wompiGateway.checkoutConfigured) return json(res, 503, {error: 'Los pagos todavía están en preparación'});
        try {
          const input = await readJson(req, 8 * 1024);
          let planId = String(input.planId || '');
          let planOverride = null;
          if (input.quoteToken) {
            const quoted = verifyPayload(input.quoteToken, roomSecret);
            if (!quoted || quoted.scope !== 'billing-custom-quote' || !safeEqual(quoted.sub, auth.account.id)) {
              return json(res, 400, {error: 'La cotización venció o no pertenece a esta cuenta'});
            }
            if (quoted.quote?.requiresReview || quoted.plan?.requiresReview || Number(quoted.plan?.maxParticipants) > 5000) {
              return json(res, 409, {error: 'Esta cotización es una estimación y necesita revisión de capacidad y precio antes de comprar.', requiresReview: true});
            }
            planOverride = quoted.plan;
            planId = String(planOverride?.id || '');
          } else {
            const plan = (await billingStore.listPlans()).find(candidate => candidate.id === planId);
            if (!plan) return json(res, 400, {error: 'El plan seleccionado no está disponible'});
          }
          const order = await billingStore.createOrder({
            accountId: auth.account.id,
            customerEmail: auth.account.email,
            planId,
            planOverride,
          });
          const checkout = wompiGateway.checkout(order, {
            redirectUrl: `${publicUrl || `http://${req.headers.host}`}/payments/return`,
            customerEmail: auth.account.email,
            customerName: auth.profile?.displayName || '',
          });
          return json(res, 201, {ok: true, order, checkout});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      const billingOrderMatch = requestUrl.pathname.match(/^\/api\/billing\/orders\/([A-Z0-9-]{12,80})$/i);
      if (billingOrderMatch && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para consultar este pago'});
        const order = await billingStore.getOrderByReference(billingOrderMatch[1]);
        return order && order.accountId === auth.account.id
          ? json(res, 200, {ok: true, order})
          : json(res, 404, {error: 'No encontramos ese pago'});
      }

      if (requestUrl.pathname === '/api/webhooks/wompi' && req.method === 'POST') {
        if (!wompiGateway.eventsConfigured) return json(res, 503, {error: 'El webhook de Wompi todavía no está configurado'});
        const input = await readJson(req, 256 * 1024);
        if (!wompiGateway.verifyEvent(input, req.headers['x-event-checksum'])) {
          return json(res, 401, {error: 'La firma del evento no es válida'});
        }
        try {
          const event = wompiGateway.normalizeTransactionEvent(input);
          if (event.environment && event.environment !== wompiGateway.environment) {
            return json(res, 409, {error: 'El ambiente del pago no coincide'});
          }
          const applied = event.reference.startsWith('QSSTAR-')
            ? await starEconomy.applyPaymentEvent(event)
            : await billingStore.applyPaymentEvent(event);
          return json(res, 200, {ok: true, duplicate: applied.duplicate});
        } catch (error) {
          console.warn(`Evento de Wompi ignorado: ${error.message}`);
          return json(res, 200, {ok: true, ignored: true});
        }
      }

      if (requestUrl.pathname === '/api/global-rave/verification' && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res,401,{error:'Inicia sesión para consultar tu verificación GPS'});
        const verification = productStore.globalRavePresenceForAccount(auth.account.id);
        if (!verification) return json(res,409,{error:'Abre Q Session en tu teléfono con esta misma cuenta, haz público tu perfil y toca Compartir mi país para verificar el GPS. Después vuelve aquí.'});
        return json(res,200,{ok:true,countryCode:verification.countryCode,verifiedAt:verification.verifiedAt,verifiedBy:'gps'}, {'Cache-Control':'no-store'});
      }
      if (requestUrl.pathname === '/api/global-rave/presence' && (req.method === 'POST' || req.method === 'DELETE')) {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para compartir presencia en Rave global'});
        if (req.method === 'DELETE') {
          globalRavePresence.remove(auth.account.id);
          productStore.clearGlobalRaveCountry(auth.account.id);
          return json(res, 200, {ok: true});
        }
        if (!auth.profile?.visible || !auth.profile?.social?.shareApproximateLocation) {
          return json(res, 403, {error: 'Haz público tu perfil y activa Rave global antes de compartir ubicación'});
        }
        if (!consumeRateLimit(globalPresenceBuckets, auth.account.id, 12, MESSAGE_WINDOW_MS)) {
          return json(res, 429, {error: 'Espera un momento antes de actualizar tu presencia'});
        }
        try {
          const input = await readJson(req, 8 * 1024);
          // Country headers and IP geolocation are intentionally ignored. A
          // country can enter the map only after the client verified a GPS fix.
          // A room or LiveKit media credential is deliberately NOT required:
          // Global Rave is platform-wide and an authenticated person may opt in
          // from the map before joining any session.
          const countryCode = productStore.setGlobalRaveCountry(auth.account.id, input.countryCode, input.verifiedAt, input.verifiedBy);
          const presence = globalRavePresence.update({
            accountId: auth.account.id,
            roomCode: '',
            countryCode,
            profileVisible: Boolean(auth.profile.visible),
            publicName: auth.profile.displayName,
          });

          return json(res, 200, {
            ok: true,
            presence: {countryCode: presence.countryCode, expiresAt: new Date(presence.expiresAt).toISOString()},
          }, {'Cache-Control': 'no-store'});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/effects/transcribe' && req.method === 'POST') {
        if (!openaiApiKey) return json(res, 503, {error: 'El creador por voz todavía no está configurado'});
        if (!consumeRateLimit(effectCreatorBuckets, `voice:${clientAddress(req)}`, 30, EFFECT_CREATOR_WINDOW_MS)) return json(res, 429, {error: 'Alcanzaste el límite temporal de instrucciones por voz'});
        const input = await readJson(req, MAX_PRIVATE_MEDIA_JSON_BYTES);
        const audio = decodeEffectDataUrl(input.audioDataUrl, 'audio');
        const extension = audio.contentType.includes('ogg') ? 'ogg' : audio.contentType.includes('mpeg') ? 'mp3' : audio.contentType.includes('mp4') || audio.contentType.includes('m4a') ? 'm4a' : audio.contentType.includes('wav') ? 'wav' : 'webm';
        const form = new FormData();
        form.append('model', 'gpt-transcribe');
        form.append('file', new Blob([audio.buffer], {type: audio.contentType}), `qsession-instruction.${extension}`);
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {method:'POST', headers:{Authorization:`Bearer ${openaiApiKey}`}, body:form, signal:AbortSignal.timeout(120000)});
        const result = await openAiJson(response);
        return json(res, 200, {ok:true, text:String(result.text || '').trim().slice(0, 1200)});
      }

      if (requestUrl.pathname === '/api/effects/generate' && req.method === 'POST') {
        if (!openaiApiKey) return json(res, 503, {error: 'El creador de efectos todavía no está configurado'});
        if (!consumeRateLimit(effectCreatorBuckets, `image:${clientAddress(req)}`, MAX_EFFECT_CREATIONS_PER_HOUR, EFFECT_CREATOR_WINDOW_MS)) return json(res, 429, {error: 'Alcanzaste el límite de creaciones de esta hora'});
        const input = await readJson(req, MAX_PRIVATE_MEDIA_JSON_BYTES);
        const kind = ['mask','filter','vj'].includes(input.kind) ? input.kind : 'mask';
        const instructions = String(input.prompt || '').trim().slice(0, 1200);
        if (instructions.length < 5) return json(res, 400, {error: 'Describe el efecto con un poco más de detalle'});
        const reference = input.imageDataUrl ? decodeEffectDataUrl(input.imageDataUrl, 'image') : null;
        const prompt = effectPrompt(kind, instructions, Boolean(reference));
        let response;
        if (reference) {
          const form = new FormData();
          form.append('model', 'gpt-image-2'); form.append('prompt', prompt); form.append('size', '1024x1024'); form.append('quality', 'medium'); form.append('background', 'transparent'); form.append('output_format', 'png');
          const extension = reference.contentType.endsWith('jpeg') ? 'jpg' : reference.contentType.split('/')[1];
          form.append('image', new Blob([reference.buffer], {type:reference.contentType}), `reference.${extension}`);
          response = await fetch('https://api.openai.com/v1/images/edits', {method:'POST', headers:{Authorization:`Bearer ${openaiApiKey}`}, body:form, signal:AbortSignal.timeout(180000)});
        } else {
          response = await fetch('https://api.openai.com/v1/images/generations', {method:'POST', headers:{Authorization:`Bearer ${openaiApiKey}`,'Content-Type':'application/json'}, body:JSON.stringify({model:'gpt-image-2',prompt,size:'1024x1024',quality:'medium',background:'transparent',output_format:'png'}), signal:AbortSignal.timeout(180000)});
        }
        const result = await openAiJson(response);
        let base64 = result.data?.[0]?.b64_json;
        if (!base64 && result.data?.[0]?.url) {
          const imageResponse = await fetch(result.data[0].url, {signal:AbortSignal.timeout(60000)});
          if (!imageResponse.ok) throw new Error('No se pudo recuperar la imagen creada');
          base64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
        }
        if (!base64) throw new Error('El creador no devolvió una imagen utilizable');
        return json(res, 200, {ok:true, imageDataUrl:`data:image/png;base64,${base64}`, kind});
      }

      if (requestUrl.pathname === '/api/analytics/collect' && req.method === 'POST') {
        if (!consumeRateLimit(analyticsBuckets, clientAddress(req), 120, MESSAGE_WINDOW_MS)) {
          return json(res, 429, {error: 'Demasiados eventos de medición'});
        }
        try {
          const input = await readJson(req, 96 * 1024);
          const result = analyticsStore.recordBatch(Array.isArray(input.events) ? input.events : input);
          return json(res, 202, {ok: true, ...result});
        } catch {
          return json(res, 400, {error: 'La medición no tiene un formato válido'});
        }
      }

      if (requestUrl.pathname === '/api/content-reports' && req.method === 'POST') {
        if (!consumeRateLimit(contentReportBuckets, clientAddress(req), 6, 60 * 60 * 1000)) {
          return json(res, 429, {error: 'Recibimos varios reportes desde esta conexión. Intenta nuevamente más tarde.'});
        }
        try {
          const auth = authenticated(req);
          const input = await readJson(req, 24 * 1024);
          const report = productStore.addContentReport({...input, reporterProfileId: auth?.profile?.id});
          return json(res, 201, {ok: true, report: {id: report.id, status: report.status, createdAt: report.createdAt}});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      const contentAppealMatch = requestUrl.pathname.match(/^\/api\/content-reports\/([a-z0-9_-]{8,160})\/appeals$/i);
      if (contentAppealMatch && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión con la cuenta anfitriona para apelar'});
        try {
          const appeal = productStore.appealContentReport(contentAppealMatch[1], auth.account.id, await readJson(req, 16 * 1024));
          return json(res, 201, {ok: true, appeal: {id: appeal.id, reportId: appeal.reportId, status: appeal.status, createdAt: appeal.createdAt}});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/admin/login' && req.method === 'POST') {
        if (!adminConfigured) return json(res, 503, {error: 'El acceso administrativo todavía no está configurado'});
        if (!consumeRateLimit(adminBuckets, clientAddress(req), 8, AUTH_WINDOW_MS)) {
          return json(res, 429, {error: 'Demasiados intentos. Espera unos minutos.'});
        }
        const input = await readJson(req, 8 * 1024);
        const requestedUsername = String(input.username || '').trim().toLowerCase().slice(0, 80);
        const usernameMatches = safeEqual(requestedUsername, adminUsername);
        const passwordMatchesAdmin = passwordMatches(input.password, usernameMatches ? adminPasswordHash : dummyAdminPasswordHash);
        if (!usernameMatches || !passwordMatchesAdmin) {
          return json(res, 401, {error: 'El usuario o la contraseña no coinciden'});
        }
        const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
        const token = signPayload({scope: 'qsession-admin', sub: adminUsername, exp: expiresAt}, adminSessionSecret);
        return json(res, 200, {
          ok: true,
          administrator: {username: adminUsername},
          expiresAt: new Date(expiresAt * 1000).toISOString(),
        }, {'Set-Cookie': adminSessionCookie(req, token)});
      }

      if (requestUrl.pathname === '/api/admin/recover' && req.method === 'POST') {
        if (!adminRecoveryConfigured) return json(res, 503, {error: 'La recuperación administrativa todavía no está configurada'});
        if (!consumeRateLimit(adminRecoveryBuckets, clientAddress(req), MAX_ADMIN_RECOVERY_ATTEMPTS, ADMIN_RECOVERY_WINDOW_MS)) {
          return json(res, 429, {error: 'Demasiados intentos de recuperación. Espera una hora.'});
        }
        const input = await readJson(req, 12 * 1024);
        const requestedUsername = String(input.username || '').trim().toLowerCase().slice(0, 80);
        const usernameMatches = safeEqual(requestedUsername, adminUsername);
        const recoveryCodeMatches = passwordMatches(
          input.recoveryCode,
          usernameMatches ? adminRecoveryCodeHash : dummyAdminPasswordHash,
        );
        if (!usernameMatches || !recoveryCodeMatches) {
          return json(res, 401, {error: 'El usuario o el código de recuperación no coinciden'});
        }
        let nextPasswordHash;
        try {
          nextPasswordHash = hashPassword(input.newPassword);
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
        persistAdminPasswordHash(adminCredentialFile, nextPasswordHash);
        adminPasswordHash = nextPasswordHash;
        return json(res, 200, {ok: true, message: 'La contraseña administrativa fue actualizada'});
      }

      if (requestUrl.pathname === '/api/admin/session' && req.method === 'GET') {
        const admin = authenticatedAdmin(req);
        return admin
          ? json(res, 200, {ok: true, administrator: {username: admin.sub}})
          : json(res, 401, {error: 'Inicia sesión como administrador'});
      }

      if (requestUrl.pathname === '/api/admin/content-reports' && req.method === 'GET') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error: 'Inicia sesión como administrador'});
        return json(res, 200, {ok: true, reports: productStore.listContentReports()});
      }

      const adminContentReportMatch = requestUrl.pathname.match(/^\/api\/admin\/content-reports\/([a-z0-9_-]{8,160})$/i);
      if (adminContentReportMatch && req.method === 'PATCH') {
        const admin = authenticatedAdmin(req);
        if (!admin) return json(res, 401, {error: 'Inicia sesión como administrador'});
        try {
          const result = productStore.moderateContentReport(adminContentReportMatch[1], {...await readJson(req, 16 * 1024), administrator: admin.sub});
          await Promise.all(result.affectedRoomCodes.map(code => edgeBroadcast.configured
            ? edgeBroadcast.stop(code).catch(() => undefined) : Promise.resolve()));
          return json(res, 200, {ok: true, ...result});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/admin/analytics' && req.method === 'GET') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error: 'Inicia sesión como administrador'});
        return json(res, 200, {
          ok: true,
          analytics: analyticsStore.summary({days: requestUrl.searchParams.get('days'), product: productStore.snapshot()}),
        });
      }

      if (requestUrl.pathname === '/api/admin/billing' && req.method === 'GET') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error: 'Inicia sesión como administrador'});
        return json(res, 200, {
          ok: true,
          billing: await billingStore.adminSummary(),
          configuration: {
            provider: 'wompi',
            store: billingStore.driver,
            checkoutConfigured: wompiGateway.checkoutConfigured,
            eventsConfigured: wompiGateway.eventsConfigured,
            environment: wompiGateway.environment,
            billingEnforced,
          },
          stars: await starEconomy.adminSummary(),
        });
      }

      if (requestUrl.pathname === '/api/admin/stars/settings' && req.method === 'PATCH') {
        if (!authenticatedAdmin(req)) return json(res, 401, {error: 'Inicia sesión como administrador'});
        try { return json(res, 200, {ok: true, settings: await starEconomy.updateSettings(await readJson(req, 8 * 1024))}); }
        catch (error) { return json(res, 400, {error: error.message}); }
      }

      const adminPlanMatch = requestUrl.pathname.match(/^\/api\/admin\/billing\/plans\/([a-z0-9-]{2,60})$/i);
      if (adminPlanMatch && req.method === 'PATCH') {
        const admin = authenticatedAdmin(req);
        if (!admin) return json(res, 401, {error: 'Inicia sesión como administrador'});
        try {
          const plan = await billingStore.updatePlan(adminPlanMatch[1], await readJson(req, 16 * 1024));
          return json(res, 200, {ok: true, plan});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/admin/billing/credits' && req.method === 'POST') {
        const admin = authenticatedAdmin(req);
        if (!admin) return json(res, 401, {error: 'Inicia sesión como administrador'});
        try {
          const input = await readJson(req, 12 * 1024);
          const requestedAccount = String(input.accountId || '').trim().toLowerCase();
          if (!requestedAccount) throw new Error('Indica la cuenta que recibirá el bono');
          if (!String(input.reason || '').trim()) throw new Error('Escribe el motivo del ajuste');
          const account = productStore.snapshot().accounts.find(item => (
            String(item.id).toLowerCase() === requestedAccount || String(item.email).toLowerCase() === requestedAccount
          ));
          if (!account || account.status !== 'active') throw new Error('No encontramos una cuenta activa con ese correo o ID');
          const credit = await billingStore.grantCredit({
            accountId: account.id,
            planId: String(input.planId || '').trim(),
            units: input.units,
            reason: input.reason,
            administrator: admin.sub,
          });
          return json(res, 201, {ok: true, credit});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/admin/logout' && req.method === 'POST') {
        return json(res, 200, {ok: true}, {'Set-Cookie': adminSessionCookie(req, '', 0)});
      }

      if (requestUrl.pathname === '/api/auth/register' && req.method === 'POST') {
        if (!consumeRateLimit(authBuckets, clientAddress(req), MAX_AUTH_ATTEMPTS, AUTH_WINDOW_MS)) {
          return json(res, 429, {error: 'Demasiados intentos. Espera unos minutos.'});
        }
        try {
          const input = await readJson(req, 32 * 1024);
          const created = productStore.createAccount(input);
          const remembered = input.remember !== false;
          const lifetimeMs = remembered ? REMEMBERED_SESSION_LIFETIME_MS : DEVICE_SESSION_LIFETIME_MS;
          const session = productStore.createSession(created.account.id, {lifetimeMs});
          return json(res, 201, sessionPayload(session), {
            'Set-Cookie': sessionCookie(req, session.token, remembered ? lifetimeMs / 1000 : null),
          });
        } catch (error) {
          return json(res, /Ya existe/.test(error.message) ? 409 : 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/auth/login' && req.method === 'POST') {
        if (!consumeRateLimit(authBuckets, clientAddress(req), MAX_AUTH_ATTEMPTS, AUTH_WINDOW_MS)) {
          return json(res, 429, {error: 'Demasiados intentos. Espera unos minutos.'});
        }
        const input = await readJson(req, 16 * 1024);
        const account = productStore.authenticateAccount(input.email, input.password);
        if (!account) return json(res, 401, {error: 'El correo o la contraseña no coinciden'});
        const remembered = input.remember !== false;
        const lifetimeMs = remembered ? REMEMBERED_SESSION_LIFETIME_MS : DEVICE_SESSION_LIFETIME_MS;
        const session = productStore.createSession(account.id, {lifetimeMs});
        return json(res, 200, sessionPayload(session), {
          'Set-Cookie': sessionCookie(req, session.token, remembered ? lifetimeMs / 1000 : null),
        });
      }

      if (requestUrl.pathname === '/api/auth/recovery/request' && req.method === 'POST') {
        const input = await readJson(req, 8 * 1024);
        const emailKey = String(input.email || '').trim().toLowerCase().slice(0, 254);
        const address = clientAddress(req);
        if (!consumeRateLimit(passwordRecoveryBuckets, `ip:${address}`, MAX_PASSWORD_RECOVERY_ATTEMPTS, AUTH_WINDOW_MS)
          || !consumeRateLimit(passwordRecoveryBuckets, `email:${emailKey}`, MAX_PASSWORD_RECOVERY_ATTEMPTS, AUTH_WINDOW_MS)) {
          return json(res, 429, {error: 'Demasiadas solicitudes. Espera unos minutos.'});
        }
        if (!accountMailer.configured) {
          return json(res, 503, {error: 'El correo de recuperación todavía no está disponible'});
        }
        const recovery = productStore.createPasswordRecovery(input.email);
        if (recovery) {
          try {
            await accountMailer.sendPasswordRecovery(recovery);
          } catch (error) {
            productStore.cancelPasswordRecovery(recovery.id);
            console.warn(`No se pudo enviar un correo de recuperación: ${error.message}`);
            return json(res, 503, {error: 'No pudimos enviar el correo. Inténtalo nuevamente en unos minutos.'});
          }
        }
        return json(res, 202, {
          ok: true,
          message: 'Si existe una cuenta con ese correo, recibirás un código válido durante 15 minutos.',
        });
      }

      if (requestUrl.pathname === '/api/auth/recovery/reset' && req.method === 'POST') {
        const address = clientAddress(req);
        if (!consumeRateLimit(passwordRecoveryBuckets, `reset:${address}`, MAX_PASSWORD_RECOVERY_ATTEMPTS, AUTH_WINDOW_MS)) {
          return json(res, 429, {error: 'Demasiados intentos. Solicita un código nuevo más tarde.'});
        }
        try {
          const input = await readJson(req, 12 * 1024);
          const account = productStore.resetAccountPassword(input);
          const remembered = input.remember !== false;
          const lifetimeMs = remembered ? REMEMBERED_SESSION_LIFETIME_MS : DEVICE_SESSION_LIFETIME_MS;
          const session = productStore.createSession(account.id, {lifetimeMs});
          if (accountMailer.configured) {
            void accountMailer.sendPasswordChanged({recipient: account.email})
              .catch(error => console.warn(`No se pudo enviar la confirmación de contraseña: ${error.message}`));
          }
          return json(res, 200, sessionPayload(session), {
            'Set-Cookie': sessionCookie(req, session.token, remembered ? lifetimeMs / 1000 : null),
          });
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
        productStore.revokeSession(requestToken(req));
        return json(res, 200, {ok: true}, {'Set-Cookie': sessionCookie(req, '', 0)});
      }

      if (requestUrl.pathname === '/api/account' && req.method === 'GET') {
        const auth = authenticated(req);
        return auth ? json(res, 200, {ok: true, ...auth}) : json(res, 401, {error: 'Inicia sesión para continuar'});
      }

      if (requestUrl.pathname === '/api/account/export' && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para descargar tus datos'});
        const billing = await accountBillingForClient(auth.account.id);
        const rewards = await starEconomy.accountWallet(auth.account.id);
        const {plans: _catalog, ...accountBilling} = billing;
        const data = {
          product: 'Q Session',
          formatVersion: 1,
          ...productStore.exportAccountData(auth.account.id),
          billing: accountBilling,
          rewards: {stars: rewards.balance, flowers: rewards.flowers},
          musicPlaylists: await musicPlaylists.get(auth.account.id),
          musicVotes: await musicFeedback.export('account:'+auth.account.id),
        };
        const date = new Date().toISOString().slice(0, 10);
        return json(res, 200, data, {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="qsession-mis-datos-${date}.json"`,
        });
      }

      if (requestUrl.pathname === '/api/account' && req.method === 'DELETE') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para eliminar tu cuenta'});
        try {
          const input = await readJson(req, 8 * 1024);
          if (String(input.confirmation || '').trim().toUpperCase() !== 'ELIMINAR') {
            return json(res, 400, {error: 'Escribe ELIMINAR para confirmar'});
          }
          if (!productStore.authenticateAccount(auth.account.email, input.password)) {
            return json(res, 400, {error: 'La contraseña no coincide'});
          }
          const hostedRooms = productStore.listHostedRooms(auth.account.id);
          for (const room of hostedRooms.filter(item => item.status !== 'archived')) {
            if (mediaConfigured) {
              await closeLiveRoomProvider(room).catch(error => console.warn(`No se pudo cerrar LiveKit para ${room.code}: ${error.message}`));
            }
            if (edgeBroadcast.configured) {
              await edgeBroadcast.stop(room.code).catch(error => console.warn(`No se pudo cerrar HLS para ${room.code}: ${error.message}`));
            }
            if (billingEnforced) {
              await billingStore.releaseReservation(room.id).catch(error => console.warn(`No se pudo liberar el bono de ${room.code}: ${error.message}`));
            }
          }
          const deleted = productStore.deleteAccount(auth.account.id, input.password);
          globalRavePresence.remove(auth.account.id);
          await billingStore.deactivateAccount?.(auth.account.id);
          await starEconomy.deactivateAccount?.(auth.account.id);
          await musicPlaylists.remove?.(auth.account.id);
          await musicFeedback.remove('account:'+auth.account.id);
          deleted.profileMedia.forEach(media => profileMediaStore.remove(media));
          deleted.privateMedia.forEach(media => privateMediaStore.remove(media));
          deleted.promotionMedia.forEach(media => promotionMediaStore.remove(media));
          publicDirectoryCache = {expiresAt: 0, rooms: []};
          return json(res, 200, {ok: true, deletedAt: deleted.deletedAt}, {
            'Set-Cookie': sessionCookie(req, '', 0),
            'Cache-Control': 'no-store',
          });
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/account/sessions' && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para ver tu historial de sesiones'});
        const sessions = productStore.listHostedRooms(auth.account.id).map(hostedRoomHistory);
        return json(res, 200, {ok: true, sessions});
      }

      const hostedSessionDeleteMatch = requestUrl.pathname.match(/^\/api\/account\/sessions\/(room_[a-f0-9-]+)$/i);
      if (hostedSessionDeleteMatch && req.method === 'DELETE') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para eliminar una sesión'});
        const room = productStore.getRoomRecordById(hostedSessionDeleteMatch[1]);
        if (!room) return json(res, 404, {error: 'Esta sesión ya no existe'});
        if (room.ownerAccountId !== auth.account.id) {
          return json(res, 403, {error: 'No tienes permiso para eliminar esta sesión'});
        }
        if (room.status !== 'archived' && mediaConfigured) {
          try {
            await closeLiveRoomProvider(room);
          } catch (error) {
            console.warn(`La sesión ${room.code} se eliminará aunque LiveKit no pudo cerrarla: ${error.message}`);
          }
        }
        if (room.status !== 'archived' && edgeBroadcast.configured) {
          try {
            await edgeBroadcast.stop(room.code);
          } catch (error) {
            console.warn(`La sesión ${room.code} se eliminará aunque su salida HLS no pudo cerrarse: ${error.message}`);
          }
        }
        if (billingEnforced) await billingStore.releaseReservation(room.id).catch(error => console.warn(`No se pudo liberar el bono de ${room.code}: ${error.message}`));
        const deleted = productStore.deleteHostedRoom(room.id, auth.account.id);
        publicDirectoryCache = {expiresAt: 0, rooms: []};
        return json(res, 200, {ok: true, deleted: Boolean(deleted), session: hostedRoomHistory(room)});
      }

      if (requestUrl.pathname === '/api/account/profile' && req.method === 'PUT') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para guardar tu perfil'});
        try {
          const profile = productStore.updateAccountProfile(auth.account.id, await readJson(req, 64 * 1024));
          if (!profile.visible || !profile.social?.shareApproximateLocation) globalRavePresence.remove(auth.account.id);
          return json(res, 200, {ok: true, profile});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/profiles/public' && req.method === 'GET') {
        return json(res, 410, {error: 'El directorio global de perfiles ya no está disponible'});
      }

      if (requestUrl.pathname === '/api/profile-actions' && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para ver tu actividad'});
        const actions = productStore.listProfileActions(auth.profile.id, requestUrl.searchParams.get('limit'));
        return json(res, 200, {
          ok: true,
          actions,
          unreadCount: actions.filter(action => !action.readAt).length,
          savedProfileIds: auth.profile.savedProfileIds || [],
          contacts: productStore.listRelatedProfiles(auth.profile.id),
          realtime: {
            transport: 'websocket',
            channel: `profile:${auth.profile.id}`,
            token: realtimeAccess(auth, `profile:${auth.profile.id}`),
          },
        });
      }

      if (requestUrl.pathname === '/api/push/devices' && (req.method === 'PUT' || req.method === 'DELETE')) {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para configurar notificaciones'});
        try {
          const input = await readJson(req, 12 * 1024);
          const result = req.method === 'PUT'
            ? productStore.registerPushDevice(auth.account.id, auth.profile.id, input)
            : productStore.unregisterPushDevice(auth.account.id, input.token);
          return json(res, 200, {ok: true, ...result, configured: pushNotifications.configured});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/profile-actions/read' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para ver tu actividad'});
        try {
          const input = await readJson(req, 16 * 1024);
          const result = productStore.markProfileActionsRead(auth.profile.id, Array.isArray(input.actionIds) ? input.actionIds : null);
          return json(res, 200, {ok: true, ...result});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      const publicProfileMatch = requestUrl.pathname.match(/^\/api\/profiles\/([a-z0-9_-]{8,100})$/i);
      if (publicProfileMatch && req.method === 'GET') {
        const profile = productStore.getPublicProfile(publicProfileMatch[1]);
        const storedProfile = productStore.snapshot().profiles.find(item => item.id === publicProfileMatch[1]);
        const sessions = storedProfile?.accountId && ['dj', 'organizer'].includes(String(profile?.role || '').toLowerCase())
          ? productStore.listHostedRooms(storedProfile.accountId).filter(item => item.visibility === 'public').map(hostedRoomHistory)
          : [];
        return profile
          ? json(res, 200, {ok: true, profile: {...profile, sessions}})
          : json(res, 404, {error: 'Este perfil ya no está disponible'});
      }

      const savedProfileMatch = requestUrl.pathname.match(/^\/api\/profiles\/([a-z0-9_-]{8,100})\/saved$/i);
      if (savedProfileMatch && req.method === 'PUT') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para guardar perfiles'});
        try {
          const input = await readJson(req, 8 * 1024);
          return json(res, 200, {ok: true, ...productStore.setSavedProfile(auth.profile.id, savedProfileMatch[1], input.saved !== false)});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      const profileActionMatch = requestUrl.pathname.match(/^\/api\/profiles\/([a-z0-9_-]{8,100})\/actions$/i);
      if (profileActionMatch && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para conectar con esta persona'});
        if (!consumeRateLimit(messageBuckets, `profile-action:${auth.account.id}`, 20, MESSAGE_WINDOW_MS)) {
          return json(res, 429, {error: 'Enviaste muchas interacciones. Espera un momento.'});
        }
        try {
          const input = await readJson(req, 8 * 1024);
          const targetProfile = productStore.snapshot().profiles.find(profile => profile.id === profileActionMatch[1]);
          if (input.roomCode) {
            const actionRoom = currentRoom(input.roomCode);
            if (!actionRoom || actionRoom.status === 'archived') return json(res, 404, {error: 'La sala ya no está disponible'});
            if (actionRoom.allowSocialProfiles === false) return json(res, 403, {error: 'Esta sesión no utiliza funciones sociales'});
            if (input.type === 'touch' && actionRoom.allowMatchmaking === false) return json(res, 403, {error: 'El matchmaking está desactivado en esta sesión'});
            if (input.type === 'gift' && actionRoom.allowProfileGifts === false) return json(res, 403, {error: 'Los detalles están desactivados en esta sesión'});
            if (input.type === 'room-invite' && actionRoom.allowPublicChat === false) return json(res, 403, {error: 'El chat público está desactivado en esta sesión'});
          }
          if (input.type === 'touch') {
            if (!targetProfile?.accountId) throw new Error('Esta persona no puede recibir una solicitud de matchmaking');
            if (!starEconomy.canUseFlower(auth.account.id)) {
              throw new Error('Necesitas una flor para enviar una solicitud de matchmaking');
            }
          }
          const action = productStore.createProfileAction({
            senderProfileId: auth.profile.id,
            targetProfileId: profileActionMatch[1],
            type: input.type,
            gift: input.gift,
            roomCode: input.roomCode,
          });
          const flowerTransfer = input.type === 'touch'
            ? starEconomy.useFlowerForMatchmaking({
                accountId: auth.account.id,
                targetAccountId: targetProfile.accountId,
                profileId: targetProfile.id,
                roomId: String(input.roomId || '') || null,
              })
            : null;
          return json(res, 201, {ok: true, action, flowerTransfer});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/profile-media' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para guardar fotos'});
        let savedFile;
        try {
          const input = await readJson(req, MAX_JSON_BYTES);
          savedFile = profileMediaStore.saveDataUrl(input.dataUrl);
          const media = productStore.addProfileMedia(auth.account.id, savedFile);
          return json(res, 201, {ok: true, media: {...media, url: `/api/profile-media/${media.id}`}});
        } catch (error) {
          if (savedFile) profileMediaStore.remove(savedFile);
          return json(res, 400, {error: error.message});
        }
      }

      const mediaMatch = requestUrl.pathname.match(/^\/api\/profile-media\/(media_[a-f0-9-]+)$/i);
      if (mediaMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        const media = productStore.getProfileMedia(mediaMatch[1]);
        const auth = authenticated(req);
        if (!media || (auth?.account?.id !== media.accountId && !productStore.profileMediaIsPublic(media.id))) {
          return json(res, 404, {error: 'Foto no encontrada'});
        }
        try {
          const filePath = profileMediaStore.filePath(media);
          const info = await fs.promises.stat(filePath);
          res.writeHead(200, {'Content-Type': media.contentType, 'Content-Length': info.size, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'});
          return req.method === 'HEAD' ? res.end() : fs.createReadStream(filePath).pipe(res);
        } catch {
          return json(res, 404, {error: 'Foto no encontrada'});
        }
      }

      if (requestUrl.pathname === '/api/promotion-media' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para agregar promociones'});
        if (auth.account?.status !== 'active' || !auth.profile?.id || !String(auth.profile.displayName || '').trim()) {
          return json(res, 403, {error: 'Completa tu perfil antes de agregar promociones'});
        }
        let savedFile;
        try {
          const input = await readJson(req, MAX_PROMOTION_MEDIA_JSON_BYTES);
          savedFile = promotionMediaStore.saveDataUrl(input.dataUrl);
          const media = productStore.addPromotionMedia(auth.account.id, savedFile);
          return json(res, 201, {
            ok: true,
            media: {
              id: media.id,
              url: `/api/promotion-media/${media.id}`,
              contentType: media.contentType,
              byteLength: media.byteLength,
            },
          });
        } catch (error) {
          if (savedFile) promotionMediaStore.remove(savedFile);
          return json(res, 400, {error: error.message});
        }
      }

      const promotionMediaMatch = requestUrl.pathname.match(/^\/api\/promotion-media\/(promotion_media_[a-f0-9-]+)$/i);
      if (promotionMediaMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        const media = productStore.getPromotionMedia(promotionMediaMatch[1]);
        const auth = authenticated(req);
        if (!media || (auth?.account?.id !== media.accountId && !productStore.promotionMediaIsPublic(media.id))) {
          return json(res, 404, {error: 'Promoción no encontrada'});
        }
        try {
          const filePath = promotionMediaStore.filePath(media);
          const info = await fs.promises.stat(filePath);
          const range = requestedByteRange(req.headers.range, info.size);
          if (range?.invalid) {
            res.writeHead(416, {
              'Content-Range': `bytes */${info.size}`,
              'Cache-Control': 'public, max-age=86400, immutable',
              'X-Content-Type-Options': 'nosniff',
            });
            return res.end();
          }
          const headers = {
            'Content-Type': media.contentType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=86400, immutable',
            'Content-Disposition': 'inline',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Content-Type-Options': 'nosniff',
          };
          if (range) {
            headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
            headers['Content-Length'] = range.end - range.start + 1;
            res.writeHead(206, headers);
            return req.method === 'HEAD' ? res.end() : fs.createReadStream(filePath, {start: range.start, end: range.end}).pipe(res);
          }
          headers['Content-Length'] = info.size;
          res.writeHead(200, headers);
          return req.method === 'HEAD' ? res.end() : fs.createReadStream(filePath).pipe(res);
        } catch {
          return json(res, 404, {error: 'Promoción no encontrada'});
        }
      }

      if (requestUrl.pathname === '/api/rooms' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para crear una sala'});
        if (auth.account?.status !== 'active' || !auth.profile?.id || !String(auth.profile.displayName || '').trim()) {
          return json(res, 403, {error: 'Completa tu perfil antes de crear una sala'});
        }
        let room = null;
        let billingReservation = null;
        try {
          const input = await readJson(req, 32 * 1024);
          if (!String(input.name || '').trim()) throw new Error('Escribe un nombre para la sesión');
          const requestedVisibility = publicRoomsEnabled && input.visibility === 'public' ? 'public' : 'private';
          const requestedPlanId = String(input.billingPlanId || '').trim();
          let billingPlan = requestedPlanId
            ? (await billingStore.listPlans()).find(plan => plan.id === requestedPlanId)
            : null;
          if (requestedPlanId && !billingPlan) {
            const accountBilling = await billingStore.accountBilling(auth.account.id);
            const purchasedCredit = accountBilling.credits.find(credit => credit.planId === requestedPlanId
              && credit.status === 'available' && Number(credit.unitsRemaining) > 0
              && (!credit.expiresAt || new Date(credit.expiresAt).getTime() > Date.now()));
            billingPlan = purchasedCredit?.plan || null;
          }
          if (billingEnforced && !billingPlan) throw new Error('Selecciona un plan activo para crear la sala');
          const blankCapacity = input.capacity == null || (typeof input.capacity === 'string' && !input.capacity.trim());
          const requestedCapacity = blankCapacity ? 0
            : typeof input.capacity === 'number' || (typeof input.capacity === 'string' && /^\d+$/.test(input.capacity.trim()))
              ? Number(input.capacity) : NaN;
          if (!Number.isSafeInteger(requestedCapacity) || requestedCapacity < 0 || requestedCapacity > 1_000_000
            || (input.capacityMode === 'limited' && requestedCapacity < 1)) {
            throw new Error(input.capacityMode === 'limited'
              ? 'Escribe un límite entero entre 1 y 1.000.000 personas'
              : 'Escribe una capacidad entera entre 0 y 1.000.000 personas');
          }
          if (billingPlan && requestedCapacity > billingPlan.maxParticipants) {
            throw new Error(`Este plan admite hasta ${billingPlan.maxParticipants} personas`);
          }
          const customPlan = String(billingPlan?.id || '').startsWith('custom-quote-');
          const quotedFeature = (name, requested) => {
            if (!customPlan) return requested;
            return billingPlan.features?.[name] === true ? requested : false;
          };
          const translation = customPlan ? {
            ...input.translation,
            targetLanguages: (Array.isArray(input.translation?.targetLanguages) ? input.translation.targetLanguages : ['en'])
              .slice(0, Math.max(1, Number(billingPlan.features?.translationLanguages) || 1)),
          } : input.translation;
          const code = createRoomCode(productStore);
          const scheduledTime = input.scheduledAt ? new Date(input.scheduledAt).getTime() : NaN;
          if (input.scheduledAt && !Number.isFinite(scheduledTime)) throw new Error('La fecha de inicio no es válida');
          const waiting = Number.isFinite(scheduledTime) && scheduledTime > Date.now();
          room = productStore.createRoomRecord({
            code,
            ownerAccountId: auth.account.id,
            ownerProfileId: auth.profile.id,
            name: input.name,
            description: input.description,
            djName: auth.profile.displayName,
            roomType: input.roomType,
            visibility: requestedVisibility,
            scheduledAt: waiting ? input.scheduledAt : null,
            timeZone: input.timeZone,
            capacity: billingPlan ? (requestedCapacity || billingPlan.maxParticipants) : requestedCapacity,
            capacityMode: input.capacityMode,
            billingPlanId: billingPlan?.id,
            billingPlanName: billingPlan?.name,
            billingCapacityLimit: billingPlan?.maxParticipants,
            sessionDurationMinutes: billingPlan?.durationMinutes,
            broadcastMode: input.broadcastMode,
            recordedAssetId: input.recordedAssetId,
            sessionImageUrl: input.sessionImageUrl,
            starPrice: input.starPrice,
            accessMethods: input.accessMethods,
            translation,
            sponsors: input.sponsors,
            promotions: input.promotions,
            password: input.password,
            allowPublicChat: quotedFeature('publicChat', input.allowPublicChat),
            allowGuestCameras: quotedFeature('guestCameras', input.allowGuestCameras),
            allowSocialProfiles: input.allowSocialProfiles,
            allowMatchmaking: input.allowMatchmaking,
            allowProfileGifts: input.allowProfileGifts,
            allowSharedFiles: input.allowSharedFiles,
            allowSpeakingQueue: input.allowSpeakingQueue,
            allowQuestions: input.allowQuestions,
            allowPolls: input.allowPolls,
            allowReactions: input.allowReactions,
            allowRecording: quotedFeature('recording', input.allowRecording),
            designTheme: input.designTheme,
            designMotion: input.designMotion,
            allowAiCameraEffects: quotedFeature('aiCameraEffects', input.allowAiCameraEffects),
            allowVjVisuals: quotedFeature('vjVisuals', input.allowVjVisuals),
            allowVideoSubmissions: quotedFeature('videoUploads', input.allowVideoSubmissions),
            allowGreetingVideos: input.allowGreetingVideos,
            allowVideoToHost: input.allowVideoToHost,
            allowVideoToRoom: input.allowVideoToRoom,
            allowPrivateVideoSubmissions: input.allowPrivateVideoSubmissions,
            contentAudit: {
              accountId: auth.account.id,
              profileId: auth.profile.id,
              source: input.broadcastMode === 'recorded' ? 'uploaded-recording' : input.broadcastMode === 'image' ? 'image-and-live-audio' : 'live-source',
              recordedAssetId: input.recordedAssetId || null,
              sessionImageUrl: input.sessionImageUrl || null,
              recordedAt: new Date().toISOString(),
            },
            transport: 'sfu',
            status: waiting ? 'waiting' : 'live',
          });
          if (billingEnforced) {
            billingReservation = await billingStore.reserveCredit({
              accountId: auth.account.id,
              roomId: room.id,
              roomCode: room.code,
              planId: billingPlan.id,
            });
          }
          const expiresAt = Math.floor(Math.max(Date.now(), waiting ? scheduledTime : 0) / 1000) + 12 * 60 * 60;
          const hostToken = signPayload({code, role: 'dj', exp: expiresAt}, roomSecret);
          return json(res, 201, {
            ok: true,
            room: publicRoom(room),
            hostToken,
            ...(room.passwordProtected ? createRoomAccessToken(code, expiresAt) : {}),
            joinUrl: `${publicUrl || ''}/join/${code}`,
            mediaConfigured,
            billing: billingEnforced
              ? {required: true, reservationStatus: billingReservation.status, plan: billingPlan}
              : {required: false, plan: billingPlan},
          });
        } catch (error) {
          if (billingReservation?.status === 'reserved') await billingStore.releaseReservation(room?.id).catch(() => undefined);
          if (room?.id) productStore.deleteHostedRoom(room.id, auth.account.id);
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/rooms' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          realtime: true,
          rooms: await activePublicRooms(),
        });
      }

      const roomMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})$/i);
      if (roomMatch && req.method === 'GET') {
        let room = currentRoom(roomMatch[1]);
        if (room?.status === 'waiting' && !(audienceMode === 'cdn-only' && room.code === cdnOnlyRoom) && await roomHasActiveBroadcast(room)) room = promoteRoomLive(room);
        return room && room.status !== 'archived'
          ? json(res, 200, {ok: true, room: {...publicRoom(room), ...await broadcastSessionMetrics(room), ...broadcastEventSummary(room)}, mediaConfigured}, {'Cache-Control': 'no-store'})
          : json(res, 404, {error: 'La sala no existe o ya finalizó'});
      }

      const roomAccessMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/access$/i);
      if (roomAccessMatch && req.method === 'POST') {
        const code = roomAccessMatch[1].toUpperCase();
        const room = currentRoom(code);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no existe o ya finalizó'});
        const input = await readJson(req, 8 * 1024);
        if (!productStore.roomPasswordIsValid(code, input.password)) {
          return json(res, 403, {error: 'La contraseña de la sala no coincide'});
        }
        return json(res, 200, {ok: true, ...createRoomAccessToken(code)});
      }

      const roomConfigurationMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/configuration$/i);
      if (roomConfigurationMatch && req.method === 'PATCH') {
        const code = roomConfigurationMatch[1].toUpperCase();
        const room = currentRoom(code);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no existe o ya finalizó'});
        try {
          const input = await readJson(req, 32 * 1024);
          const control = verifyPayload(input.hostToken, roomSecret);
          if (!control || control.code !== code || control.role !== 'dj') {
            return json(res, 403, {error: 'No tienes permiso para configurar esta sala'});
          }
          const eventCapacityLimit = effectiveBroadcastEventLimit(broadcastEventPlan, broadcastEventOptions(room)) || 0;
          const updated = productStore.updateRoomConfiguration(code, {...input, visibility: publicRoomsEnabled && input.visibility === 'public' ? 'public' : 'private'}, {eventCapacityLimit});
          publicDirectoryCache = {expiresAt: 0, rooms: []};
          return json(res, 200, {ok: true, room: {...publicRoom(updated), ...await broadcastSessionMetrics(updated), ...broadcastEventSummary(updated)}});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      const endRoomMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/end$/i);
      if (endRoomMatch && req.method === 'POST') {
        const code = endRoomMatch[1].toUpperCase();
        const room = productStore.getRoomRecord(code);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no existe o ya finalizó'});
        const input = await readJson(req, 16 * 1024);
        const control = verifyPayload(input.hostToken, roomSecret);
        if (!control || control.code !== code || control.role !== 'dj') {
          return json(res, 403, {error: 'No tienes permiso para finalizar esta sala'});
        }
        if (mediaConfigured) {
          try {
            await closeLiveRoomProvider(room);
          } catch (error) {
            console.warn(`La sala ${code} se archivará aunque LiveKit no pudo cerrarla: ${error.message}`);
          }
        }
        if (edgeBroadcast.configured) {
          try {
            await edgeBroadcast.stop(code);
          } catch (error) {
            console.warn(`La sala ${code} se archivará aunque su salida HLS no pudo cerrarse: ${error.message}`);
          }
        }
        if (billingEnforced) await billingStore.releaseReservation(room.id).catch(error => console.warn(`No se pudo liberar el bono de ${code}: ${error.message}`));
        const archived = productStore.archiveRoom(code);
        publicDirectoryCache = {expiresAt: 0, rooms: []};
        return json(res, 200, {ok: true, room: publicRoom(archived), session: hostedRoomHistory(archived)});
      }

      const broadcastMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/broadcast$/i);
      if (broadcastMatch && req.method === 'GET') {
        const code = broadcastMatch[1].toUpperCase();
        const room = currentRoom(code);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no existe o ya finalizó'});
        if (!roomAccessGranted(req, room, {accessToken: requestUrl.searchParams.get('accessToken') || ''})) {
          return json(res, 403, {error: 'Esta sala necesita autorización para consultar su difusión'});
        }
        if (!edgeBroadcast.configured) {
          return json(res, 200, {
            ok: true,
            broadcast: {
              configured: false,
              provider: null,
              roomCode: code,
              state: 'fallback-webrtc',
              ready: false,
              playbackUrl: broadcastPlaybackUrl(code) || null,
            },
          });
        }
        try {
          return json(res, 200, {ok: true, broadcast: await edgeBroadcast.status(code)});
        } catch (error) {
          return json(res, 503, {error: `No fue posible consultar la difusión: ${error.message}`});
        }
      }

      const broadcastStartMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/broadcast\/start$/i);
      if (broadcastStartMatch && req.method === 'POST') {
        const code = broadcastStartMatch[1].toUpperCase();
        let room = currentRoom(code);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no existe o ya finalizó'});
        const input = await readJson(req, 16 * 1024);
        const control = verifyPayload(input.hostToken, roomSecret);
        if (!control || control.code !== code || control.role !== 'dj') {
          return json(res, 403, {error: 'No tienes permiso para iniciar la difusión de esta sala'});
        }
        if (!edgeBroadcast.configured) {
          return json(res, 200, {
            ok: true,
            broadcast: {
              configured: false,
              provider: null,
              roomCode: code,
              state: 'fallback-webrtc',
              ready: false,
              playbackUrl: broadcastPlaybackUrl(code) || null,
            },
          });
        }
        try {
          room = promoteRoomLive(room);
          const broadcast = await edgeBroadcast.start(code, {participantIdentity: `dj-primary-${code.toLowerCase()}`});
          publicDirectoryCache = {expiresAt: 0, rooms: []};
          return json(res, 202, {ok: true, room: publicRoom(room), broadcast});
        } catch (error) {
          return json(res, 503, {error: `No fue posible iniciar la difusión económica: ${error.message}`});
        }
      }

      if (requestUrl.pathname === '/api/chat/contacts' && req.method === 'GET') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para usar el chat privado'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para conversar'});
        }
        return json(res, 200, {ok: true, contacts: productStore.listPrivateContacts(auth.profile.id)});
      }

      if (requestUrl.pathname === '/api/private-chat-invitations' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para crear una invitación privada'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para crear una invitación'});
        }
        if (!consumeRateLimit(privateInviteBuckets, `create:${auth.account.id}`, 6, AUTH_WINDOW_MS)) {
          return json(res, 429, {error: 'Creaste varias invitaciones. Espera un momento antes de generar otra.'});
        }
        try {
          const invitation = productStore.createPrivateChatInvitation(auth.profile.id);
          return json(res, 201, {
            ok: true,
            invitation: {
              ...invitation,
              url: `${publicUrl || ''}/?chatInvite=${encodeURIComponent(invitation.code)}#chat`,
            },
          });
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/private-chat-invitations/redeem' && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para aceptar la invitación privada'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para aceptar la invitación'});
        }
        if (!consumeRateLimit(privateInviteBuckets, `redeem:${auth.account.id}`, 12, AUTH_WINDOW_MS)) {
          return json(res, 429, {error: 'Probaste varios códigos. Espera un momento antes de intentar nuevamente.'});
        }
        try {
          const input = await readJson(req, 8 * 1024);
          const conversation = productStore.redeemPrivateChatInvitation(auth.profile.id, input.code);
          publishPrivateRealtime(conversation, {type: 'private-conversation', conversationId: conversation.id});
          return json(res, 200, {ok: true, conversation});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/private-conversations' && (req.method === 'GET' || req.method === 'POST')) {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para usar el chat privado'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para conversar'});
        }
        if (req.method === 'GET') {
          return json(res, 200, {
            ok: true,
            conversations: productStore.listPrivateConversations(auth.profile.id),
            realtime: {
              transport: 'websocket',
              channel: `profile:${auth.profile.id}`,
              token: realtimeAccess(auth, `profile:${auth.profile.id}`),
            },
          });
        }
        try {
          const input = await readJson(req, 64 * 1024);
          const conversation = productStore.createPrivateConversation({
            creatorProfileId: auth.profile.id,
            type: input.type,
            name: input.name,
            memberProfileIds: input.memberProfileIds,
          });
          publishPrivateRealtime(conversation, {type: 'private-conversation', conversationId: conversation.id});
          return json(res, 201, {ok: true, conversation});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      const privateMessagesMatch = requestUrl.pathname.match(/^\/api\/private-conversations\/([a-z0-9_-]{10,100})\/messages$/i);
      if (privateMessagesMatch && (req.method === 'GET' || req.method === 'POST')) {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para usar el chat privado'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para conversar'});
        }
        const conversationId = privateMessagesMatch[1];
        const conversation = productStore.getPrivateConversation(conversationId, auth.profile.id);
        if (!conversation) return json(res, 404, {error: 'La conversación privada no está disponible'});
        if (req.method === 'GET') {
          const page = productStore.listPrivateMessagePage(
            conversationId,
            auth.profile.id,
            requestUrl.searchParams.get('limit'),
            requestUrl.searchParams.get('before'),
          );
          return json(res, 200, {
            ok: true,
            conversation,
            messages: page.messages,
            pagination: {hasMore: page.hasMore, nextBefore: page.nextBefore},
            realtime: {
              transport: 'websocket',
              channel: `private:${conversationId}`,
              token: realtimeAccess(auth, `private:${conversationId}`),
            },
          });
        }
        const rateLimitKey = `${auth.account.id}:${conversationId}`;
        if (!consumeRateLimit(messageBuckets, rateLimitKey, MAX_MESSAGES_PER_WINDOW, MESSAGE_WINDOW_MS)) {
          return json(res, 429, {error: 'Enviaste muchos mensajes. Espera un momento.'});
        }
        try {
          const input = await readJson(req, 8 * 1024);
          const message = productStore.addPrivateMessage({
            conversationId,
            profileId: auth.profile.id,
            kind: input.kind === 'reaction' ? 'reaction' : 'text',
            text: input.text,
          });
          publishPrivateRealtime(conversation, {
            type: 'private-message',
            message: {
              ...message,
              author: auth.profile.displayName || 'Oyente',
              avatarUrl: auth.profile.visible ? auth.profile.avatarUrl || auth.profile.photos?.[0]?.url || null : null,
            },
          });
          sendPrivatePush(conversation, auth.profile, 'message', message.id, 'Te envió un mensaje privado');
          return json(res, 201, {ok: true, message});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      const privateAttachmentMatch = requestUrl.pathname.match(/^\/api\/private-conversations\/([a-z0-9_-]{10,100})\/attachments$/i);

      if (requestUrl.pathname === '/api/uploads/video-intents' && req.method === 'POST') {
        if (!directVideoUploads.configured) return json(res, 503, {error: 'La subida directa de videos todavía no está configurada'});
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para enviar un video'});
        if (!consumeRateLimit(
          uploadIntentBuckets,
          auth.account.id,
          MAX_UPLOAD_INTENTS_PER_HOUR,
          UPLOAD_INTENT_WINDOW_MS,
        )) return json(res, 429, {error: 'Preparaste varios videos. Espera antes de iniciar otra subida.'});
        try {
          const input = await readJson(req, 12 * 1024);
          const purpose = input.purpose === 'session' ? 'session' : 'message';
          const roomCode = String(input.roomCode || '').trim().toUpperCase();
          const conversationId = String(input.conversationId || '').trim();
          if (purpose === 'session') {
            if (!['dj', 'organizer'].includes(String(auth.profile?.role || '').toLowerCase())) {
              return json(res, 403, {error: 'Sólo un DJ u organizador puede subir una sesión grabada'});
            }
          } else if (conversationId) {
            const conversation = productStore.getPrivateConversation(conversationId, auth.profile.id);
            if (!conversation) return json(res, 404, {error: 'La conversación privada no está disponible'});
          } else if (roomCode) {
            const room = currentRoom(roomCode);
            if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no está disponible'});
            if (!room.allowVideoSubmissions) return json(res, 403, {error: 'Esta sala no recibe videos'});
            if (!roomAccessGranted(req, room, input)) return json(res, 403, {error: 'Esta sala necesita una contraseña'});
            const presence = await roomChatPresenceProvider(room, auth);
            if (!presence?.active) return json(res, 409, {error: 'Entra a la transmisión antes de enviar un video'});
          } else {
            return json(res, 400, {error: 'El video necesita una sala o conversación de destino'});
          }
          const upload = await directVideoUploads.create({
            creatorId: auth.profile.id,
            roomCode: roomCode || null,
            conversationId: conversationId || null,
            originalName: input.name,
            contentType: input.contentType,
            byteLength: input.byteLength,
            durationSeconds: input.durationSeconds,
            purpose,
          });
          return json(res, 201, {ok: true, upload});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (privateAttachmentMatch && req.method === 'POST') {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para compartir fotos o videos'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para conversar'});
        }
        const conversationId = privateAttachmentMatch[1];
        const conversation = productStore.getPrivateConversation(conversationId, auth.profile.id);
        if (!conversation) return json(res, 404, {error: 'La conversación privada no está disponible'});
        const rateLimitKey = `private-media:${auth.account.id}:${conversationId}`;
        if (!consumeRateLimit(messageBuckets, rateLimitKey, 12, MESSAGE_WINDOW_MS)) {
          return json(res, 429, {error: 'Enviaste muchos archivos. Espera un momento.'});
        }
        let savedFile;
        try {
          const input = await readJson(req, MAX_PRIVATE_MEDIA_JSON_BYTES);
          savedFile = privateMediaStore.saveDataUrl(input.dataUrl);
          const message = productStore.addPrivateMediaMessage({
            conversationId,
            profileId: auth.profile.id,
            originalName: input.name,
            durationMs: input.durationMs,
            media: savedFile,
          });
          const page = productStore.listPrivateMessagePage(conversationId, auth.profile.id, 1, null);
          const publishedMessage = page.messages.find(item => item.id === message.id) || message;
          publishPrivateRealtime(conversation, {type: 'private-message', message: publishedMessage});
          sendPrivatePush(conversation, auth.profile, 'message', publishedMessage.id, 'Te envió un archivo privado');
          return json(res, 201, {ok: true, message});
        } catch (error) {
          if (savedFile) privateMediaStore.remove(savedFile);
          return json(res, 400, {error: error.message});
        }
      }

      const privateMediaMatch = requestUrl.pathname.match(/^\/api\/private-media\/(private_media_[a-f0-9-]+)$/i);
      if (privateMediaMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        const auth = authenticated(req);
        if (!auth) return json(res, 404, {error: 'Archivo privado no encontrado'});
        const media = productStore.getPrivateMedia(privateMediaMatch[1], auth.profile.id);
        if (!media) return json(res, 404, {error: 'Archivo privado no encontrado'});
        try {
          const filePath = privateMediaStore.filePath(media);
          const info = await fs.promises.stat(filePath);
          const range = requestedByteRange(req.headers.range, info.size);
          if (range?.invalid) {
            res.writeHead(416, {
              'Content-Range': `bytes */${info.size}`,
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            });
            return res.end();
          }
          const headers = {
            'Content-Type': media.contentType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, no-store',
            'Content-Disposition': 'inline',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Content-Type-Options': 'nosniff',
          };
          if (range) {
            headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
            headers['Content-Length'] = range.end - range.start + 1;
            res.writeHead(206, headers);
            return req.method === 'HEAD' ? res.end() : fs.createReadStream(filePath, {start: range.start, end: range.end}).pipe(res);
          }
          headers['Content-Length'] = info.size;
          res.writeHead(200, headers);
          return req.method === 'HEAD' ? res.end() : fs.createReadStream(filePath).pipe(res);
        } catch {
          return json(res, 404, {error: 'Archivo privado no encontrado'});
        }
      }

      const privateVoiceMatch = requestUrl.pathname.match(/^\/api\/private-conversations\/([a-z0-9_-]{10,100})\/voice-token$/i);
      if (privateVoiceMatch && req.method === 'POST') {
        if (!mediaConfigured) return json(res, 503, {error: 'El servidor de voz todavía no está configurado'});
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para usar la voz privada'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para conversar'});
        }
        const conversation = productStore.getPrivateConversation(privateVoiceMatch[1], auth.profile.id);
        if (!conversation) return json(res, 404, {error: 'La conversación privada no está disponible'});
        // Existing conversations are preserved, including older, larger groups.
        // They must not mint new media credentials above the current call limit.
        if (conversation.memberCount > 10) return json(res, 409, {error: 'La voz privada admite hasta 10 personas. Crea un grupo de hasta 10 para llamar.'});
        const input = await readJson(req, 8 * 1024);
        if (input.notifyMembers === true) {
          const callActions = productStore.notifyPrivateCall(conversation.id, auth.profile.id);
          publishPrivateRealtime(conversation, {
            type: 'private-call',
            conversationId: conversation.id,
            caller: {
              id: auth.profile.id,
              displayName: auth.profile.displayName || 'Usuario Q Session',
              avatarUrl: auth.profile.visible ? auth.profile.avatarUrl || auth.profile.photos?.[0]?.url || null : null,
            },
            actionIds: callActions.map(action => action.id),
          });
          sendPrivatePush(
            conversation,
            auth.profile,
            'call',
            callActions[0]?.id || `call-${conversation.id}`,
            'Llamada privada entrante',
          );
        }
        const displayName = auth.profile.displayName || 'Oyente';
        const mediaToken = createLiveKitToken({
          apiKey: livekitApiKey,
          apiSecret: livekitApiSecret,
          code: conversation.id,
          roomName: `qsession-private-${conversation.id}`,
          identity: `voice-${auth.account.id}`.slice(0, 90),
          name: displayName,
          role: 'private-call',
          canPublishCamera: true,
          canPublishAudio: true,
          metadata: {profileId: auth.profile.id, displayName},
        });
        return json(res, 200, {
          ok: true,
          url: livekitUrl,
          token: mediaToken,
          audioPolicy: {maxBitrate: broadcastAudioBitrate},
          conversation,
          permissions: ['listen', 'microphone', 'camera'],
        });
      }

      const roomMessagesMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/messages$/i);
      if (roomMessagesMatch && (req.method === 'GET' || req.method === 'POST')) {
        const auth = authenticated(req);
        if (!auth) return json(res, 401, {error: 'Inicia sesión para usar el chat'});
        if (!auth.profile?.social?.allowMessages) {
          return json(res, 403, {error: 'Activa Mensajes en tu Perfil para conversar'});
        }
        const code = roomMessagesMatch[1].toUpperCase();
        const room = currentRoom(code);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no existe o ya finalizó'});
        if (!room.allowPublicChat) return json(res, 403, {error: 'El anfitrión desactivó el chat público de esta sala'});
        if (!roomAccessGranted(req, room)) return json(res, 403, {error: 'Esta sala necesita una contraseña'});
        let presence;
        try {
          presence = await roomChatPresenceProvider(room, auth);
        } catch (error) {
          console.warn(`No se pudo comprobar la presencia del chat ${code}: ${error.message}`);
          return json(res, 503, {error: 'No pudimos confirmar tu presencia en la sala. Intenta nuevamente.'});
        }
        if (!presence?.active) {
          return json(res, 409, {error: 'El chat se activa sólo mientras estás conectado a esta sala'});
        }
        const publicPresence = {participantCount: Math.max(1, Number(presence.participantCount) || 1)};
        if (req.method === 'GET') {
          return json(res, 200, {
            ok: true,
            room: publicRoom(room),
            presence: publicPresence,
            messages: await chatStore.listMessages(code, requestUrl.searchParams.get('limit')),
            realtime: {
              transport: 'websocket',
              channel: `room:${code}`,
              token: realtimeAccess(auth, `room:${code}`),
            },
          });
        }
        const rateLimitKey = `${auth.account.id}:${code}`;
        if (!consumeRateLimit(messageBuckets, rateLimitKey, MAX_MESSAGES_PER_WINDOW, MESSAGE_WINDOW_MS)) {
          return json(res, 429, {error: 'Enviaste muchos mensajes. Espera un momento.'});
        }
        try {
          const input = await readJson(req, 8 * 1024);
          const message = await chatStore.addMessage({
            roomCode: code,
            profileId: auth.profile.id,
            author: auth.profile.visible && auth.profile.displayName ? auth.profile.displayName : 'Oyente',
            avatarUrl: auth.profile.visible ? auth.profile.avatarUrl || auth.profile.photos?.[0]?.url || null : null,
            kind: input.kind === 'reaction' ? 'reaction' : 'text',
            text: input.text,
          });
          void realtimeHub?.publish(`room:${code}`, {type: 'room-message', message});
          return json(res, 201, {ok: true, presence: publicPresence, message});
        } catch (error) {
          return json(res, 400, {error: error.message});
        }
      }

      if (requestUrl.pathname === '/api/broadcast/admissions/probe-check' && req.method === 'POST') {
        if (!broadcastAdmissionProbe) return json(res, 503, {error: 'La comprobación técnica de admisiones está desactivada.'}, {'Cache-Control': 'no-store'});
        if (Date.now() >= broadcastAdmissionProbe.expiresAtMs) return json(res, 410, {error: 'La comprobación técnica de admisiones ya terminó.'}, {'Cache-Control': 'no-store'});
        const input = await readJson(req, 4096);
        try {
          const claims = broadcastAdmissions.decode(input.token);
          if (claims.code !== broadcastAdmissionProbe.code || claims.prefix !== broadcastAdmissionProbe.prefix || claims.generation !== broadcastAdmissionProbe.generation || claims.exp * 1000 > broadcastAdmissionProbe.expiresAtMs) {
            return json(res, 403, {error: 'La autorización no pertenece a la señal sintética de comprobación.'}, {'Cache-Control': 'no-store'});
          }
          return json(res, 200, await broadcastAdmissions.check({token: input.token, objectKey: input.objectKey}), {'Cache-Control': 'no-store'});
        } catch (error) { return admissionError(res, error); }
      }

      if (requestUrl.pathname === '/api/broadcast/admissions/check' && req.method === 'POST') {
        const input = await readJson(req, 4096);
        try {
          const claims = broadcastAdmissions.decode(input.token);
          if (audienceMode !== 'cdn-only' || claims.code !== cdnOnlyRoom) return json(res, 403, {error: 'Esta autorización no pertenece a la transmisión activa.'}, {'Cache-Control': 'no-store'});
          if (Date.now() >= massReadiness.expiresAt) return json(res, 503, {error: 'Caducó la revisión de preparación de este evento.'}, {'Cache-Control': 'no-store'});
          const room = currentRoom(claims.code);
          if (!room || room.status === 'archived') return json(res, 410, {error: 'La transmisión ya finalizó.'}, {'Cache-Control': 'no-store'});
          if (claims.generation !== room.id || claims.prefix !== cdnAdmissionPrefix(room.code)) return json(res, 403, {error: 'La autorización no corresponde a esta transmisión.'}, {'Cache-Control': 'no-store'});
          const end = room.billingStartedAt ? Date.parse(room.billingStartedAt) + Math.max(15, Number(room.sessionDurationMinutes) || 120) * 60_000 : Infinity;
          if (Date.now() >= end) return json(res, 410, {error: 'El tiempo incluido en este plan ya terminó.'}, {'Cache-Control': 'no-store'});
          if (room.status !== 'live') return json(res, 503, {error: 'La transmisión no está activa.'}, {'Cache-Control': 'no-store'});
          return json(res, 200, await broadcastAdmissions.check({token: input.token, objectKey: input.objectKey}), {'Cache-Control': 'no-store'});
        } catch (error) { return admissionError(res, error); }
      }

      if (requestUrl.pathname === '/api/broadcast/admissions/release' && req.method === 'POST') {
        const input = await readJson(req, 4096);
        try {
          const claims = broadcastAdmissions.decode(input.token);
          if (audienceMode !== 'cdn-only' || claims.code !== cdnOnlyRoom) return json(res, 403, {error: 'Esta autorización no pertenece a la transmisión activa.'}, {'Cache-Control': 'no-store'});
          return json(res, 200, {ok: true, released: await broadcastAdmissions.release(input.token)}, {'Cache-Control': 'no-store'});
        } catch (error) { return admissionError(res, error); }
      }

      const credentialMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/media-token$/i);
      if (credentialMatch && req.method === 'POST') {
        if (!mediaConfigured) return json(res, 503, {error: 'El servidor multimedia público todavía no está configurado'});
        const code = credentialMatch[1].toUpperCase();
        let room = currentRoom(code);
        if (!room || room.status === 'archived') return json(res, 404, {error: 'La sala no existe o ya finalizó'});
        const input = await readJson(req, 16 * 1024);
        const requestedRole = input.role === 'dj' ? 'dj' : 'listener';
        const isCdnListener = requestedRole === 'listener' && audienceMode === 'cdn-only' && code === cdnOnlyRoom;
        const auth = authenticated(req);
        const nativeAudio = requestedRole === 'listener' && input.nativeAudio === true;
        const nativeBroadcastAudio = requestedRole === 'dj' && input.nativeBroadcastAudio === true;
        const durationMinutes = Math.max(15, Number(room.sessionDurationMinutes) || 120);
        if (room.billingStartedAt && Date.now() >= new Date(room.billingStartedAt).getTime() + durationMinutes * 60_000) {
          return json(res, 410, {error: 'El tiempo incluido en este plan ya terminó'});
        }
        if (requestedRole === 'dj') {
          const control = verifyPayload(input.hostToken, roomSecret);
          if (!control || control.code !== code || control.role !== 'dj') return json(res, 403, {error: 'No tienes permiso para transmitir en esta sala'});
          if (billingEnforced) {
            try {
              await billingStore.consumeReservation(room.id);
            } catch (error) {
              return json(res, 402, {error: error.message});
            }
          }
          room = promoteRoomLive(room);
          if (!room.billingStartedAt) {
            room = productStore.updateRoomRecord(code, {billingStartedAt: new Date().toISOString()}) || room;
          }
          if (nativeBroadcastAudio) {
            try {
              await replaceDesktopAudioProvider(code);
            } catch {
              return json(res, 503, {error: 'No fue posible cerrar la captura anterior. Intenta nuevamente para evitar audio duplicado.'});
            }
          }
        } else {
          if (!roomAccessGranted(req, room, input)) return json(res, 403, {error: 'Esta sala necesita una contraseña'});
          if (room.starPrice > 0) {
            if (!auth) return json(res, 401, {error: `Esta sesión cuesta ${room.starPrice} estrellas. Inicia sesión para acceder.`});
            if (auth.account.id !== room.ownerAccountId && !(await starEconomy.hasUnlocked(auth.account.id, room.id))) {
              return json(res, 402, {error: `Esta sesión cuesta ${room.starPrice} estrellas`, starPrice: room.starPrice, roomCode: room.code});
            }
          }
          if (room.status === 'waiting') {
            if (!isCdnListener && await roomHasActiveBroadcast(room)) room = promoteRoomLive(room);
            else return json(res, 409, {error: 'La sesión todavía no ha comenzado'});
          }
          const paidLimit = Math.max(0, Number(room.billingCapacityLimit) || 0);
          const configuredLimit = room.capacityMode === 'limited' ? Math.max(0, Number(room.capacity) || 0) : 0;
          const capacityLimit = configuredLimit && paidLimit ? Math.min(configuredLimit, paidLimit) : (configuredLimit || paidLimit);
          if (capacityLimit && mediaConfigured && !isCdnListener) {
            try {
              const activityByRoom = await liveRoomActivityProvider([room]);
              const activity = activityByRoom instanceof Map ? activityByRoom.get(room.code) : activityByRoom?.[room.code];
              if (Number(activity?.listenerCount || 0) >= capacityLimit) {
                return json(res, 429, {error: `La sala alcanzó su capacidad de ${capacityLimit} personas`});
              }
            } catch (error) {
              console.warn(`No se pudo comprobar la capacidad de ${code}: ${error.message}`);
            }
          }
        }
        if (isCdnListener) {
          if (cdnOnlyPaused) return json(res,503,{error:'El ingreso a este evento está temporalmente pausado. La recepción no cambiará a WebRTC.'},{'Retry-After':'30'});
          if (Date.now() >= massReadiness.expiresAt) return json(res,503,{error:'Caducó la revisión de preparación para este evento. No se habilitará una conexión SFU alternativa.'});
          const url = broadcastPlaybackUrl(code);
          if (!url || !edgeBroadcast.configured || edgeBroadcast.deliveryMode !== 'object-storage') return json(res,503,{error:'La recepción masiva requiere la salida HLS mediante almacenamiento y CDN configurados.'});
          if (nativeAudio) return json(res,409,{error:'Esta sala utiliza exclusivamente el reproductor HLS; actualiza Q Session.'});
          const prefix = cdnAdmissionPrefix(code);
          if (!prefix) return json(res, 503, {error: 'La ruta de reproducción HLS no es válida.'});
          if (broadcastEventPlan?.roomCode === code && Date.now() >= Date.parse(broadcastEventPlan.expiresAt)) return json(res, 503, {error: 'Caducó la autorización de aforo de este evento. No se ampliará el plan contratado.'}, {'Cache-Control': 'no-store'});
          const eventLimit = effectiveBroadcastEventLimit(broadcastEventPlan, broadcastEventOptions(room));
          const paidLimit = eventLimit || Math.max(0, Number(room.billingCapacityLimit) || 0);
          const manualLimit = room.capacityMode === 'limited' ? Math.max(0, Number(room.capacity) || 0) : 0;
          const capacity = Math.min(broadcastAudienceTarget, ...(paidLimit ? [paidLimit] : []), ...(manualLimit ? [manualLimit] : []));
          const billingEnd = room.billingStartedAt ? Date.parse(room.billingStartedAt) + durationMinutes * 60_000 : Infinity;
          try {
            const admission = await broadcastAdmissions.reserve({code, prefix, capacity, generation: room.id, expiresAt: Math.min(Date.now() + 6 * 60 * 60_000, billingEnd, eventLimit ? Date.parse(broadcastEventPlan.expiresAt) : Infinity), previousToken: input.previousAdmissionToken});
            const authorizedUrl = new URL(url);
            authorizedUrl.searchParams.set('qsat', admission.token);
            // CDN leases replace SFU participation and per-viewer product-store writes.
            return json(res, 200, {ok: true, transport: 'hls', delivery: {kind: 'broadcast', topology: 'cdn-one-to-many', audienceMode: 'cdn-only', url: authorizedUrl.toString(), admissionToken: admission.token, leaseMs: 90000, provider: edgeBroadcast.provider, deliveryMode: edgeBroadcast.deliveryMode, fallback: null}, permissions: ['listen'], limits: {audienceTarget: broadcastAudienceTarget, maxParticipants: capacity, activeAdmissions: admission.active, capacityValidated: false, djCameras: 1}}, {'Cache-Control': 'no-store'});
          } catch (error) { return admissionError(res, error); }
        }
        if (requestedRole === 'listener' && !nativeAudio) {
          room = productStore.recordJoin(code, Math.max(1, Number(room.peakListeners) || 0)) || room;
        }
        const socialProfilesAllowed = room.allowSocialProfiles !== false;
        const publicProfile = socialProfilesAllowed && auth?.profile?.visible ? {
          profileId: auth.profile.id,
          visible: true,
          displayName: auth.profile.displayName || (requestedRole === 'dj' ? room.djName : 'Oyente'),
          role: auth.profile.role === 'dj' ? 'dj' : 'listener',
          avatarUrl: auth.profile.avatarUrl || auth.profile.photos?.[0]?.url || null,
          city: auth.profile.social?.showResidence ? auth.profile.city || null : null,
          country: auth.profile.social?.showResidence ? auth.profile.country || null : null,
          social: {
            allowMatchmaking: Boolean(auth.profile.social?.allowMatchmaking),
            allowMessages: Boolean(auth.profile.social?.allowMessages),
            allowTips: Boolean(auth.profile.social?.allowTips),
          },
        } : null;
        const canPublishCamera = !nativeAudio && !nativeBroadcastAudio && (
          requestedRole === 'dj' || (requestedRole === 'listener' && room.allowGuestCameras !== false)
        );
        // Listener microphones belong only to their private/group call room.
        // Never grant them publishing rights on the DJ's main transmission.
        const canPublishChatAudio = false;
        const name = nativeBroadcastAudio
          ? 'Audio de Chrome QSession'
          : nativeAudio
            ? 'Audio nativo QSession'
          : publicProfile?.displayName || (requestedRole === 'dj' ? room.djName || 'DJ invitado' : 'Oyente');
        const hiddenMedia = nativeAudio || nativeBroadcastAudio;
        const identityPrefix = nativeBroadcastAudio ? 'desktop-tab-audio' : nativeAudio ? 'native-audio' : requestedRole;
        // A room can have only one Windows tab-audio publisher. Reusing this
        // identity makes LiveKit replace a stale capture instead of mixing two
        // copies of the same music after a restart or source change.
        const hiddenIdentity = nativeBroadcastAudio ? code.toLowerCase() : crypto.randomUUID();
        const identity = requestedRole === 'dj' && !hiddenMedia
          ? `dj-primary-${code.toLowerCase()}`
          : `${identityPrefix}-${hiddenMedia ? hiddenIdentity : auth?.account?.id || crypto.randomUUID()}`.slice(0, 90);
        const mediaToken = createLiveKitToken({
          apiKey: livekitApiKey,
          apiSecret: livekitApiSecret,
          code,
          identity,
          name,
          role: nativeBroadcastAudio ? 'desktop-audio' : requestedRole,
          canPublishCamera,
          canPublishAudio: canPublishChatAudio,
          canPublishScreenAudio: nativeBroadcastAudio,
          metadata: hiddenMedia
            ? null
            : requestedRole === 'dj'
              ? {...(publicProfile || {}), cameraLimit: djCameraLimit}
              : publicProfile,
          hidden: hiddenMedia,
          expiresInSeconds: room.billingStartedAt
            ? Math.max(60, Math.floor((new Date(room.billingStartedAt).getTime() + durationMinutes * 60_000 - Date.now()) / 1000))
            : durationMinutes * 60,
        });
        const presenceTicket = requestedRole === 'listener' && !nativeAudio && auth?.account?.id
          ? signPayload({
              scope: 'global-rave-presence',
              sub: auth.account.id,
              code,
              exp: Math.floor(Date.now() / 1000) + 6 * 60 * 60,
            }, roomSecret)
          : null;
        return json(res, 200, {
          ok: true,
          transport: 'sfu',
          url: livekitUrl,
          token: mediaToken,
          ...(presenceTicket ? {presenceTicket} : {}),
          delivery: requestedRole === 'listener' && broadcastPlaybackUrl(code)
            ? {
                kind: 'broadcast',
                topology: 'cdn-one-to-many',
                url: broadcastPlaybackUrl(code),
                provider: edgeBroadcast.configured ? edgeBroadcast.provider : 'external',
                deliveryMode: edgeBroadcast.configured ? edgeBroadcast.deliveryMode : 'external',
                segmentDuration: edgeBroadcast.configured ? edgeBroadcast.segmentDuration : null,
                approximateLatencySeconds: edgeBroadcast.configured ? edgeBroadcast.approximateLatencySeconds : null,
                fallback: {kind: 'webrtc', topology: 'interactive-sfu', url: livekitUrl, token: mediaToken},
              }
            : {
                kind: 'webrtc',
                topology: 'interactive-sfu',
                url: livekitUrl,
                token: mediaToken,
              },
          permissions: nativeBroadcastAudio
            ? ['audio']
            : requestedRole === 'dj'
            ? ['audio', 'camera', 'screen']
            : (canPublishCamera
              ? ['listen', ...(publicProfile ? ['social-camera'] : ['participant-camera']), ...(canPublishChatAudio ? ['chat-microphone'] : [])]
              : ['listen', ...(canPublishChatAudio ? ['chat-microphone'] : [])]),
          profile: publicProfile,
          limits: {
            djCameras: djCameraLimit,
            targetParticipants: targetRoomCapacity,
            audienceMode: audienceMode === 'cdn-only' && code === cdnOnlyRoom ? 'cdn-only' : 'interactive',
            ...broadcastEventSummary(room),
          },
        });
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (await serveEdgeMedia(requestUrl, res, req.method)) return;
        if (await serveStatic(requestUrl, res, req.method, req.headers)) return;
      }
      return json(res, 404, {error: 'Ruta no encontrada'});
    } catch (error) {
      return json(res, 500, {error: error.message || 'Error interno'});
    }
  });

  realtimeHub = options.realtimeHub || createRealtimeHub({
    server,
    authorize: authorizeRealtime,
    redisUrl,
    maximumConnections: realtimeMaximumConnections,
  });
  server.on('close', () => {
    void realtimeHub?.close?.();
    void chatStore.close?.();
    void billingStore.close?.();
    void starEconomy.close?.();
    void musicPlaylists.close?.();
    void musicFeedback.close?.();
    void broadcastAdmissions.close?.();
  });

  return {server, port, productStore, chatStore, billingStore, starEconomy, ownedMusicLibrary, realtimeHub, edgeBroadcast, broadcastAdmissions, mediaConfigured};
}

if (require.main === module) {
  const app = createQsessionServer();
  app.server.listen(app.port, '0.0.0.0', () => {
    console.log(`Q Session disponible en http://localhost:${app.server.address().port}`);
    console.log(app.mediaConfigured ? 'Red multimedia global preparada.' : 'Configura LIVEKIT_PUBLIC_URL y sus credenciales para transmitir globalmente.');
  });
}

module.exports = {
  createQsessionServer,
  createLiveKitToken,
  createLiveKitServiceToken,
  liveRoomActivityFromParticipants,
  roomChatPresenceFromParticipants,
  normalizeLiveKitApiUrl,
  normalizeLiveKitUrl,
  normalizePublicUrl,
  verifyPayload,
};
