'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  AudioCodec,
  EgressClient,
  EgressStatus,
  EncodingOptions,
  RoomServiceClient,
  S3Upload,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  VideoCodec,
  TrackSource,
  TrackType,
} = require('livekit-server-sdk');

const ACTIVE_EGRESS_STATES = new Set([
  EgressStatus.EGRESS_STARTING,
  EgressStatus.EGRESS_ACTIVE,
  EgressStatus.EGRESS_ENDING,
]);

function normalizeRoomCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('El código de sala no es válido');
  return code;
}

function normalizeHttpsBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString().replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

function normalizePathPrefix(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function normalizeManifestSuffix(value) {
  const suffix = String(value || '').trim();
  if (suffix && !/^\.[a-z0-9]{1,8}$/i.test(suffix)) {
    throw new Error('El sufijo público del manifiesto HLS no es válido.');
  }
  return suffix;
}

function normalizeSegmentSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(2, Math.min(10, Math.round(seconds))) : 4;
}

function normalizeBitrate(value, fallback, minimum, maximum) {
  const bitrate = Number(value);
  return Number.isFinite(bitrate) ? Math.max(minimum, Math.min(maximum, Math.round(bitrate))) : fallback;
}

function normalizeParticipantIdentity(value) {
  const identity = String(value || '').trim();
  if (!identity || identity.length > 90) throw new Error('La identidad del DJ principal no es válida');
  return identity;
}

function egressStateName(status) {
  switch (status) {
    case EgressStatus.EGRESS_STARTING: return 'starting';
    case EgressStatus.EGRESS_ACTIVE: return 'active';
    case EgressStatus.EGRESS_ENDING: return 'ending';
    case EgressStatus.EGRESS_COMPLETE: return 'complete';
    case EgressStatus.EGRESS_FAILED: return 'failed';
    case EgressStatus.EGRESS_ABORTED: return 'aborted';
    case EgressStatus.EGRESS_LIMIT_REACHED: return 'limit-reached';
    default: return 'unknown';
  }
}

function createEdgeBroadcastProvider(options = {}) {
  const apiUrl = String(options.apiUrl || '').trim();
  const apiKey = String(options.apiKey || '').trim();
  const apiSecret = String(options.apiSecret || '').trim();
  const endpoint = String(options.endpoint || '').trim().replace(/\/+$/, '');
  const bucket = String(options.bucket || '').trim();
  const accessKey = String(options.accessKey || '').trim();
  const secretKey = String(options.secretKey || '').trim();
  const pathSecret = String(options.pathSecret || '').trim();
  const region = String(options.region || 'auto').trim() || 'auto';
  const requestedProvider = String(options.provider || 'cloudflare-r2-hls').trim() || 'cloudflare-r2-hls';
  const forcePathStyle = options.forcePathStyle === true;
  const legacyPlaybackBaseUrl = normalizeHttpsBaseUrl(options.playbackBaseUrl);
  const storagePlaybackBaseUrl = normalizeHttpsBaseUrl(options.storagePlaybackBaseUrl || legacyPlaybackBaseUrl);
  const storagePlaybackPathPrefix = normalizePathPrefix(options.storagePlaybackPathPrefix);
  const storagePlaybackManifestSuffix = normalizeManifestSuffix(options.storagePlaybackManifestSuffix);
  const localPlaybackBaseUrl = normalizeHttpsBaseUrl(options.localPlaybackBaseUrl || legacyPlaybackBaseUrl);
  const localPlaybackPathPrefix = normalizePathPrefix(options.localPlaybackPathPrefix ?? options.playbackPathPrefix);
  const localPlaybackManifestSuffix = normalizeManifestSuffix(
    options.localPlaybackManifestSuffix ?? options.playbackManifestSuffix,
  );
  const outputDirectory = String(options.outputDirectory || '').trim().replace(/\/+$/, '');
  const cleanupDirectory = String(options.cleanupDirectory || '').trim();
  const segmentDuration = normalizeSegmentSeconds(options.segmentDuration);
  const videoBitrate = normalizeBitrate(options.videoBitrate, 1_800_000, 500_000, 6_000_000);
  const audioBitrate = normalizeBitrate(options.audioBitrate, 128_000, 64_000, 320_000);
  const estimatedViewerGigabytesPerHour = Number((((videoBitrate + audioBitrate) * 3600) / 8 / 1_000_000_000).toFixed(4));
  const storageConfigured = Boolean(endpoint && bucket && accessKey && secretKey);
  const storageReady = Boolean(storageConfigured && storagePlaybackBaseUrl);
  const localOriginConfigured = Boolean(outputDirectory && cleanupDirectory);
  const localOriginReady = Boolean(localOriginConfigured && localPlaybackBaseUrl);
  const deliveryMode = storageReady ? 'object-storage' : localOriginReady ? 'local-origin' : 'disabled';
  const provider = deliveryMode === 'object-storage'
    ? requestedProvider
    : deliveryMode === 'local-origin'
      ? (requestedProvider === 'cloudflare-r2-hls' ? 'local-origin-hls-fallback' : requestedProvider)
      : requestedProvider;
  const playbackBaseUrl = deliveryMode === 'object-storage' ? storagePlaybackBaseUrl : localPlaybackBaseUrl;
  const playbackPathPrefix = deliveryMode === 'object-storage'
    ? storagePlaybackPathPrefix
    : localPlaybackPathPrefix;
  const playbackManifestSuffix = deliveryMode === 'object-storage'
    ? storagePlaybackManifestSuffix
    : localPlaybackManifestSuffix;
  const configured = Boolean(apiUrl && apiKey && apiSecret && pathSecret && deliveryMode !== 'disabled');
  const client = configured
    ? options.client || new EgressClient(apiUrl, apiKey, apiSecret, {requestTimeout: 15_000})
    : null;
  const operations = new Map();
  const statusReads = new Map();
  const roomClient = configured ? options.roomClient || new RoomServiceClient(apiUrl, apiKey, apiSecret) : null;

  function streamPath(roomCode) {
    const code = normalizeRoomCode(roomCode);
    const signature = crypto.createHmac('sha256', pathSecret).update(`qsession-live:${code}`).digest('base64url').slice(0, 18);
    return `live/${code}-${signature}`;
  }

  function playbackUrl(roomCode) {
    if (!configured) return '';
    const code = normalizeRoomCode(roomCode);
    return `${playbackBaseUrl}/${playbackPathPrefix ? `${playbackPathPrefix}/` : ''}${streamPath(code)}/index.m3u8${playbackManifestSuffix}`;
  }

  function publicState(roomCode, info = null) {
    const code = normalizeRoomCode(roomCode);
    const status = info?.status;
    return {
      configured,
      provider,
      deliveryMode,
      roomCode: code,
      egressId: info?.egressId || null,
      state: info ? egressStateName(status) : 'inactive',
      ready: status === EgressStatus.EGRESS_ACTIVE,
      playbackUrl: playbackUrl(code),
      segmentDuration,
      approximateLatencySeconds: segmentDuration * 3,
      estimatedViewerGigabytesPerHour,
    };
  }

  async function listActive(roomCode) {
    if (!configured) return [];
    const code = normalizeRoomCode(roomCode);
    const results = await client.listEgress({roomName: `qsession-${code}`, active: true});
    return (results || []).filter(info => ACTIVE_EGRESS_STATES.has(info.status));
  }

  async function status(roomCode) {
    const code = normalizeRoomCode(roomCode);
    if (!configured) return publicState(code);
    const existing = statusReads.get(code);
    if (existing && existing.expiresAt > Date.now()) return existing.pending;
    if (!existing && statusReads.size >= 256) statusReads.delete(statusReads.keys().next().value);
    const entry = {expiresAt: Infinity, pending: null};
    entry.pending = listActive(code).then(([active]) => {
      entry.expiresAt = Date.now() + 2000;
      return publicState(code, active || null);
    }, error => {
      if (statusReads.get(code) === entry) statusReads.delete(code);
      throw error;
    });
    statusReads.set(code, entry);
    return entry.pending;
  }

  async function start(roomCode, {participantIdentity} = {}) {
    const code = normalizeRoomCode(roomCode);
    if (!configured) throw new Error('La difusión HLS por CDN todavía no está configurada');
    const identity = normalizeParticipantIdentity(participantIdentity);
    if (operations.has(code)) return operations.get(code);
    statusReads.delete(code);
    const operation = (async () => {
      const [existing] = await listActive(code);
      if (existing && existing.request?.case !== 'trackComposite') return publicState(code, existing);
      const participants = await roomClient.listParticipants(`qsession-${code}`);
      const primary = participants.find(participant => participant.identity === identity);
      const desktopAudio = participants.find(participant => participant.identity.startsWith(`desktop-tab-audio-${code.toLowerCase()}-`)
        && participant.tracks?.some(track => track.type === TrackType.AUDIO));
      const audioTracks = (desktopAudio || primary)?.tracks?.filter(track => track.type === TrackType.AUDIO) || [];
      const audioTrack = audioTracks.find(track => track.source === TrackSource.SCREEN_SHARE_AUDIO) || audioTracks[0];
      // Only the primary DJ's camera is eligible. Never export an audience
      // camera or shared desktop video when selecting the music's audio track.
      let camera = primary?.tracks?.find(track => track.type === TrackType.VIDEO && track.source === TrackSource.CAMERA && !track.muted);
      if (existing) {
        // A camera/device restart creates a new SID. Reusing the old job
        // indefinitely produces valid HLS containing only black frames.
        // Preserve the current signal while an audio source is being replaced.
        if (!primary || !audioTrack) return publicState(code, existing);
        const input = existing.request.value;
        const retainedCamera = primary.tracks?.find(track => track.sid === input.videoTrackId
          && track.type === TrackType.VIDEO && track.source === TrackSource.CAMERA);
        const videoTrackId = camera?.sid || retainedCamera?.sid || '';
        if (input.audioTrackId === audioTrack.sid && (input.videoTrackId || '') === videoTrackId) {
          return publicState(code, existing);
        }
        camera ||= retainedCamera;
        await client.stopEgress(existing.egressId);
        // Prevent the previous writer from overwriting the new manifest.
        for (let attempt = 0; ; attempt += 1) {
          const remaining = await listActive(code);
          if (!remaining.some(info => info.egressId === existing.egressId)) break;
          if (attempt >= 20) throw new Error('El codificador anterior todavía está cerrando. Vuelve a sincronizar la cámara.');
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      const storage = deliveryMode === 'object-storage' ? new S3Upload({
        accessKey,
        secret: secretKey,
        region,
        endpoint,
        bucket,
        forcePathStyle,
      }) : null;
      // When both the emergency local origin and R2 are configured, object
      // storage must win. Absolute local paths are invalid R2 object keys and
      // previously made a nominal R2 cutover continue billing the old CDN.
      const outputPrefix = deliveryMode === 'object-storage'
        ? streamPath(code)
        : path.posix.join(outputDirectory, streamPath(code));
      const output = new SegmentedFileOutput({
        protocol: SegmentedFileProtocol.HLS_PROTOCOL,
        // CDN segments are immutable: a restarted encoder must never reuse keys.
        filenamePrefix: `${outputPrefix}/segment_${crypto.randomBytes(8).toString('hex')}`,
        playlistName: `${outputPrefix}/archive.m3u8`,
        livePlaylistName: `${outputPrefix}/index.m3u8`,
        segmentDuration,
        ...(storage ? {output: {case: 's3', value: storage}} : {}),
      });
      const encodingOptions = new EncodingOptions({
        width: 1280,
        height: 720,
        framerate: 30,
        audioCodec: AudioCodec.AAC,
        // Environment values are bits/s; LiveKit EncodingOptions uses kbit/s.
        audioBitrate: Math.round(audioBitrate / 1000),
        audioFrequency: 48_000,
        videoCodec: VideoCodec.H264_MAIN,
        videoBitrate: Math.round(videoBitrate / 1000),
        keyFrameInterval: segmentDuration,
      });
      // Participant egress's default microphone/camera selection silently
      // excludes SCREEN_SHARE_AUDIO (used by the library and tab capture).
      const info = audioTrack && (desktopAudio || audioTrack.source !== TrackSource.MICROPHONE)
        ? await client.startTrackCompositeEgress(`qsession-${code}`, output, {
          audioTrackId: audioTrack.sid,
          ...(camera ? {videoTrackId: camera.sid} : {}),
          encodingOptions,
        })
        : await client.startParticipantEgress(`qsession-${code}`, identity, output, {encodingOptions});
      return publicState(code, info);
    })().finally(() => { operations.delete(code); statusReads.delete(code); });
    operations.set(code, operation);
    return operation;
  }

  async function stop(roomCode) {
    const code = normalizeRoomCode(roomCode);
    statusReads.delete(code);
    if (!configured) return {...publicState(code), stopped: 0};
    if (operations.has(code)) await operations.get(code).catch(() => undefined);
    const active = await listActive(code);
    const stopped = [];
    for (const info of active) {
      if (!info.egressId) continue;
      stopped.push(await client.stopEgress(info.egressId));
    }
    if (localOriginConfigured) {
      const target = path.resolve(cleanupDirectory, streamPath(code));
      const root = path.resolve(cleanupDirectory);
      if (target.startsWith(`${root}${path.sep}`)) await fs.promises.rm(target, {recursive: true, force: true});
    }
    statusReads.delete(code);
    return {...publicState(code, stopped.at(-1) || null), stopped: stopped.length};
  }

  return {
    configured,
    provider,
    deliveryMode,
    segmentDuration,
    approximateLatencySeconds: segmentDuration * 3,
    videoBitrate,
    audioBitrate,
    estimatedViewerGigabytesPerHour,
    playbackUrl,
    start,
    status,
    stop,
  };
}

module.exports = {
  createEdgeBroadcastProvider,
  egressStateName,
  normalizeHttpsBaseUrl,
  normalizeParticipantIdentity,
  normalizeRoomCode,
};
