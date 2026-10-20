'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PROFILE_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_PRIVATE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_PROMOTION_MEDIA_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES = {
  'image/jpeg': {extension: '.jpg', signature: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff},
  'image/png': {extension: '.png', signature: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))},
  'image/webp': {extension: '.webp', signature: buffer => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'},
};
const PRIVATE_MEDIA_TYPES = {
  ...MEDIA_TYPES,
  'video/mp4': {extension: '.mp4', signature: buffer => buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'},
  'video/quicktime': {extension: '.mov', signature: buffer => buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'},
  'video/webm': {extension: '.webm', signature: buffer => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))},
  'audio/mp4': {extension: '.m4a', signature: buffer => buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'},
  'audio/aac': {extension: '.aac', signature: buffer => buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0},
  'audio/mpeg': {extension: '.mp3', signature: buffer => buffer.length >= 3 && (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))},
  'audio/ogg': {extension: '.ogg', signature: buffer => buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS'},
  'audio/webm': {extension: '.webm', signature: buffer => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))},
};

function decodeImageData(value) {
  const match = String(value || '').trim().match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error('La foto debe ser JPG, PNG o WebP');
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PROFILE_MEDIA_BYTES) {
    throw new Error('La foto debe pesar como máximo 2 MB');
  }
  const format = MEDIA_TYPES[contentType];
  if (!format?.signature(buffer)) throw new Error('El contenido del archivo no coincide con su formato');
  return {buffer, contentType, extension: format.extension};
}

function decodePrivateAttachmentData(value) {
  const match = String(value || '').trim().match(/^data:((?:image\/(?:jpeg|png|webp))|(?:video\/(?:mp4|webm|quicktime))|(?:audio\/(?:mp4|aac|mpeg|ogg|webm)));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error('El archivo debe ser una foto, un video o una nota de voz compatible');
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PRIVATE_ATTACHMENT_BYTES) {
    throw new Error('El archivo debe pesar como máximo 12 MB');
  }
  const format = PRIVATE_MEDIA_TYPES[contentType];
  if (!format?.signature(buffer)) throw new Error('El contenido del archivo no coincide con su formato');
  return {buffer, contentType, extension: format.extension};
}

function decodePromotionMediaData(value) {
  const match = String(value || '').trim().match(/^data:((?:image\/(?:jpeg|png|webp))|(?:video\/(?:mp4|webm|quicktime)));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error('La promoción debe usar una imagen JPG, PNG o WebP, o un video MP4, WebM o MOV');
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PROMOTION_MEDIA_BYTES) {
    throw new Error('El archivo promocional debe pesar como máximo 20 MB');
  }
  const format = PRIVATE_MEDIA_TYPES[contentType];
  if (!format?.signature(buffer)) throw new Error('El contenido del archivo no coincide con su formato');
  return {buffer, contentType, extension: format.extension};
}

function createMediaStore({directory, decodeData, idPrefix}) {
  const root = path.resolve(directory);

  function safeFilePath(fileName) {
    const safeName = path.basename(String(fileName || ''));
    const resolved = path.resolve(root, safeName);
    if (!safeName || path.dirname(resolved) !== root) throw new Error('Ruta de archivo no válida');
    return resolved;
  }

  function saveDataUrl(dataUrl) {
    const decoded = decodeData(dataUrl);
    const mediaId = `${idPrefix}_${crypto.randomUUID()}`;
    const fileName = `${mediaId}${decoded.extension}`;
    const target = safeFilePath(fileName);
    const temporary = `${target}.tmp`;
    fs.mkdirSync(root, {recursive: true});
    fs.writeFileSync(temporary, decoded.buffer, {flag: 'wx'});
    fs.renameSync(temporary, target);
    return {
      id: mediaId,
      contentType: decoded.contentType,
      fileName,
      byteLength: decoded.buffer.length,
      sha256: crypto.createHash('sha256').update(decoded.buffer).digest('hex'),
    };
  }

  function filePath(media) {
    return safeFilePath(media?.fileName);
  }

  function remove(media) {
    if (!media?.fileName) return;
    try {
      fs.unlinkSync(safeFilePath(media.fileName));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return {saveDataUrl, filePath, remove, root};
}

function createProfileMediaStore({directory}) {
  return createMediaStore({directory, decodeData: decodeImageData, idPrefix: 'media'});
}

function createPrivateMediaStore({directory}) {
  return createMediaStore({directory, decodeData: decodePrivateAttachmentData, idPrefix: 'private_media'});
}

function createPromotionMediaStore({directory}) {
  return createMediaStore({directory, decodeData: decodePromotionMediaData, idPrefix: 'promotion_media'});
}

module.exports = {
  createProfileMediaStore,
  createPrivateMediaStore,
  createPromotionMediaStore,
  decodeImageData,
  decodePrivateAttachmentData,
  decodePromotionMediaData,
  MAX_PROFILE_MEDIA_BYTES,
  MAX_PRIVATE_ATTACHMENT_BYTES,
  MAX_PROMOTION_MEDIA_BYTES,
};
