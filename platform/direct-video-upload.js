'use strict';

const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const MAX_DIRECT_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_DIRECT_VIDEO_SECONDS = 10 * 60;
const MAX_SESSION_VIDEO_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_SESSION_VIDEO_SECONDS = 4 * 60 * 60;

function tusMetadata(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key} ${Buffer.from(String(value), 'utf8').toString('base64')}`)
    .join(',');
}

function createDirectVideoUploadProvider({accountId = '', apiToken = '', publicUrl = '', fetchImpl = fetch} = {}) {
  const configured = Boolean(accountId && apiToken);
  const allowedOrigin = publicUrl ? new URL(publicUrl).hostname : '';

  async function create(input = {}) {
    if (!configured) throw new Error('La subida directa de videos todavía no está configurada');
    const contentType = String(input.contentType || '').toLowerCase();
    const byteLength = Number(input.byteLength);
    const sessionUpload = input.purpose === 'session';
    const maximumSeconds = sessionUpload ? MAX_SESSION_VIDEO_SECONDS : MAX_DIRECT_VIDEO_SECONDS;
    const maximumBytes = sessionUpload ? MAX_SESSION_VIDEO_BYTES : MAX_DIRECT_VIDEO_BYTES;
    const durationSeconds = Math.max(1, Math.min(maximumSeconds, Math.ceil(Number(input.durationSeconds) || maximumSeconds)));
    if (!VIDEO_TYPES.has(contentType)) throw new Error('El video debe ser MP4, WebM o MOV');
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > maximumBytes) {
      throw new Error(sessionUpload ? 'La sesión grabada debe pesar como máximo 8 GB' : 'El video debe pesar como máximo 200 MB');
    }
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const target = sessionUpload ? {purpose: 'session'} : input.conversationId ? {conversationId: String(input.conversationId)} : {roomCode: String(input.roomCode || '')};
    if (sessionUpload) {
      const metadata = tusMetadata({
        name: String(input.originalName || 'sesion-qsession').slice(0, 160),
        filetype: contentType,
        maxdurationseconds: durationSeconds,
        requiresignedurls: 'true',
        expiry,
        allowedorigins: allowedOrigin ? JSON.stringify([allowedOrigin]) : undefined,
        qsession: 'true',
        purpose: target.purpose,
      });
      const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream?direct_user=true`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(byteLength),
          'Upload-Creator': String(input.creatorId || '').slice(0, 64),
          'Upload-Metadata': metadata,
        },
      });
      const uploadUrl = response.headers?.get?.('location') || '';
      const assetId = response.headers?.get?.('stream-media-id') || '';
      if (!response.ok || !uploadUrl || !assetId) {
        let detail = `El proveedor respondió ${response.status}`;
        try {
          const payload = await response.json();
          detail = payload?.errors?.[0]?.message || detail;
        } catch { /* La respuesta TUS correcta no incluye JSON. */ }
        throw new Error(`No fue posible preparar la subida reanudable: ${detail}`);
      }
      return {
        provider: 'cloudflare-stream',
        protocol: 'tus',
        assetId,
        uploadUrl,
        method: 'PATCH',
        expiresAt: expiry,
        maximumByteLength: maximumBytes,
        contentType,
        byteLength,
        chunkSize: 50 * 1024 * 1024,
      };
    }
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream/direct_upload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        maxDurationSeconds: durationSeconds,
        expiry,
        creator: String(input.creatorId || '').slice(0, 64),
        allowedOrigins: allowedOrigin ? [allowedOrigin] : [],
        requireSignedURLs: true,
        meta: {
          qsession: true,
          ...target,
          originalName: String(input.originalName || 'video-qsession').slice(0, 160),
          contentType,
          byteLength,
        },
      }),
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* Se informa el estado HTTP debajo. */ }
    if (!response.ok || !payload?.success || !payload?.result?.uploadURL || !payload?.result?.uid) {
      const detail = payload?.errors?.[0]?.message || `El proveedor respondió ${response.status}`;
      throw new Error(`No fue posible preparar la subida directa: ${detail}`);
    }
    return {
      provider: 'cloudflare-stream',
      protocol: 'form',
      assetId: payload.result.uid,
      uploadUrl: payload.result.uploadURL,
      method: 'POST',
      fieldName: 'file',
      expiresAt: expiry,
      maximumByteLength: maximumBytes,
      contentType,
      byteLength,
    };
  }

  return {configured, create};
}

module.exports = {
  createDirectVideoUploadProvider,
  MAX_DIRECT_VIDEO_BYTES,
  MAX_DIRECT_VIDEO_SECONDS,
  MAX_SESSION_VIDEO_BYTES,
  MAX_SESSION_VIDEO_SECONDS,
  VIDEO_TYPES,
};
