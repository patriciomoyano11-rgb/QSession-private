'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOM_CODE = /^[A-Z0-9]{6}$/;
const MESSAGE_KINDS = new Set(['text', 'reaction', 'notice']);
const PRIVATE_MESSAGE_KINDS = new Set(['text', 'reaction', 'image', 'video', 'voice']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_ROLES = new Set(['listener', 'dj']);
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_PROFILE_MEDIA = 24;
const MAX_STORED_PROMOTION_MEDIA = 40;
const PROFILE_ACTION_TYPES = new Set(['gift', 'touch', 'room-invite']);
const PASSWORD_RECOVERY_LIFETIME_MS = 15 * 60 * 1000;
const PRIVATE_CHAT_INVITE_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const PRIVATE_CHAT_INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PRIVATE_CHAT_INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const ROOM_TYPES = new Set([
  'music', 'yoga-meditation', 'conference', 'wedding', 'birthday', 'baby-shower', 'custom',
  // Tipos históricos: se conservan para poder abrir salas y registros creados antes de esta versión.
  'party', 'class', 'professional', 'networking', 'private-experience',
]);
const ROOM_ACCESS_METHODS = new Set(['link', 'code', 'qr']);
const CONFERENCE_LANGUAGES = new Set(['es', 'en', 'de']);
const ROOM_DESIGN_THEMES = new Set(['midnight', 'serenity', 'institutional', 'celebration', 'minimal']);
const ROOM_DESIGN_MOTIONS = new Set(['calm', 'balanced', 'immersive']);
const ROOM_EXPERIENCE_FIELDS = Object.freeze([
  'allowAiCameraEffects',
  'allowVjVisuals',
  'allowVideoSubmissions',
  'allowGreetingVideos',
  'allowVideoToHost',
  'allowVideoToRoom',
  'allowPrivateVideoSubmissions',
]);
const ROOM_EXPERIENCE_PRESETS = Object.freeze({
  music: {
    designTheme: 'midnight', designMotion: 'immersive',
    allowed: ['allowAiCameraEffects', 'allowVjVisuals', 'allowVideoSubmissions', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    defaults: ['allowAiCameraEffects', 'allowVjVisuals', 'allowVideoSubmissions', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
  },
  'yoga-meditation': {
    designTheme: 'serenity', designMotion: 'calm',
    allowed: ['allowVideoSubmissions', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    defaults: ['allowVideoSubmissions', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
  },
  conference: {designTheme: 'institutional', designMotion: 'balanced', allowed: [], defaults: []},
  wedding: {
    designTheme: 'celebration', designMotion: 'balanced',
    allowed: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    defaults: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
  },
  birthday: {
    designTheme: 'celebration', designMotion: 'balanced',
    allowed: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    defaults: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
  },
  'baby-shower': {
    designTheme: 'celebration', designMotion: 'calm',
    allowed: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    defaults: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
  },
  custom: {
    designTheme: 'minimal', designMotion: 'balanced',
    allowed: ROOM_EXPERIENCE_FIELDS,
    defaults: [],
  },
});
const PROFILE_GIFTS = Object.freeze({
  flower: {emoji: '🌸', label: 'Una flor'},
  margarita: {emoji: '✿', label: 'Una margarita'},
  tulipan: {emoji: '♧', label: 'Un tulipán'},
  rosa: {emoji: '❀', label: 'Una rosa'},
  orquidea: {emoji: '❁', label: 'Una orquídea'},
  loto: {emoji: '⌘', label: 'Una flor de loto'},
  star: {emoji: '⭐', label: 'Una estrella'},
  coffee: {emoji: '☕', label: 'Un café'},
  music: {emoji: '🎵', label: 'Una canción'},
  spark: {emoji: '✨', label: 'Buena energía'},
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, maxLength = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function optionalText(value, maxLength = 240) {
  const result = text(value, maxLength);
  return result || null;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedTimeZone(value) {
  const zone = optionalText(value, 80);
  if (!zone) return 'UTC';
  try {
    new Intl.DateTimeFormat('es', {timeZone: zone}).format(new Date());
    return zone;
  } catch {
    return 'UTC';
  }
}

function canonicalExperienceType(roomType) {
  if (roomType === 'party') return 'music';
  if (roomType === 'class') return 'yoga-meditation';
  if (roomType === 'professional') return 'conference';
  return ROOM_EXPERIENCE_PRESETS[roomType] ? roomType : 'custom';
}

function normalizedRoomExperience(input = {}, roomType = 'custom') {
  const preset = ROOM_EXPERIENCE_PRESETS[canonicalExperienceType(roomType)];
  const allowed = new Set(preset.allowed);
  const defaults = new Set(preset.defaults);
  const result = {
    designTheme: ROOM_DESIGN_THEMES.has(input.designTheme) ? input.designTheme : preset.designTheme,
    designMotion: ROOM_DESIGN_MOTIONS.has(input.designMotion) ? input.designMotion : preset.designMotion,
  };
  ROOM_EXPERIENCE_FIELDS.forEach(key => {
    result[key] = allowed.has(key) && (typeof input[key] === 'boolean' ? input[key] : defaults.has(key));
  });
  if (!result.allowVideoSubmissions) {
    result.allowGreetingVideos = false;
    result.allowVideoToHost = false;
    result.allowVideoToRoom = false;
    result.allowPrivateVideoSubmissions = false;
  }
  if (result.allowVideoSubmissions && !result.allowVideoToHost && !result.allowVideoToRoom) {
    result.allowVideoToHost = true;
  }
  return result;
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function profileTokenHash(value) {
  const token = String(value || '').trim().slice(0, 200);
  return token ? crypto.createHash('sha256').update(token).digest('hex') : null;
}

function securityTokenHash(value, pepper = '') {
  return crypto.createHmac('sha256', pepper || 'qsession-local-security')
    .update(String(value || ''))
    .digest('hex');
}

function normalizedPrivateChatInviteCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function normalizedEmail(value) {
  const result = String(value || '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL.test(result)) throw new Error('Escribe un correo electrónico válido');
  return result;
}

function normalizedPassword(value) {
  const password = String(value || '');
  if (password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');
  if (password.length > 128) throw new Error('La contraseña es demasiado larga');
  return password;
}

function normalizedRole(value) {
  return PROFILE_ROLES.has(value) ? value : 'listener';
}

function hashPassword(value, pepper = '') {
  const password = normalizedPassword(value);
  const salt = crypto.randomBytes(16);
  const cost = 16384;
  const blockSize = 8;
  const parallelization = 1;
  const hash = crypto.scryptSync(`${password}${pepper}`, salt, 64, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function passwordMatches(value, encoded, pepper = '') {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, costValue, blockSizeValue, parallelizationValue, saltValue, hashValue] = parts;
  const expected = Buffer.from(hashValue, 'base64url');
  if (!expected.length) return false;
  let password;
  try {
    password = normalizedPassword(value);
  } catch {
    return false;
  }
  const actual = crypto.scryptSync(`${password}${pepper}`, Buffer.from(saltValue, 'base64url'), expected.length, {
    N: Number(costValue),
    r: Number(blockSizeValue),
    p: Number(parallelizationValue),
    maxmem: 64 * 1024 * 1024,
  });
  return sameHash(actual, expected);
}

function normalizedRoomPassword(value) {
  const password = String(value || '');
  if (password.length < 6) throw new Error('La contraseña de la sala debe tener al menos 6 caracteres');
  if (password.length > 64) throw new Error('La contraseña de la sala es demasiado larga');
  return password;
}

function hashRoomPassword(value, pepper = '') {
  return hashPassword(`${normalizedRoomPassword(value)}\u0000qsession-room`, pepper);
}

function roomPasswordMatches(value, encoded, pepper = '') {
  try {
    return passwordMatches(`${normalizedRoomPassword(value)}\u0000qsession-room`, encoded, pepper);
  } catch {
    return false;
  }
}

function normalizedSponsors(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);
  return [...new Set(entries.map(entry => text(entry, 60)).filter(Boolean))].slice(0, 8);
}

function normalizedPromotionLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    const candidate = raw.startsWith('//') ? `https:${raw}` : /^[^\s/:?#]+\.[^\s/:?#]+(?::\d+)?(?:[/?#]|$)/.test(raw) ? `https://${raw}` : raw;
    parsed = new URL(candidate);
  } catch {
    throw new Error('El enlace de la promoción no es válido');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('El enlace de la promoción debe comenzar con http:// o https://');
  return parsed.toString().slice(0, 800);
}

function sameHash(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function avatarValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:')) {
    if (raw.length > 700000) throw new Error('La foto de perfil es demasiado grande');
    if (!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(raw)) {
      throw new Error('La foto de perfil no tiene un formato válido');
    }
    return raw;
  }
  return /^https:\/\//i.test(raw) ? raw.slice(0, 500) : null;
}

function initialState() {
  return {
    schemaVersion: 12,
    events: [],
    rooms: [],
    profiles: [],
    accounts: [],
    sessions: [],
    passwordRecoveries: [],
    media: [],
    stories: [],
    messages: [],
    privateConversations: [],
    privateMessages: [],
    privateMedia: [],
    privateChatInvitations: [],
    promotionMedia: [],
    profileActions: [],
    pushDevices: [],
    reports: [],
    contentAppeals: [],
    enforcementActions: [],
  };
}

function safePublicProfile(profile, stories = []) {
  if (!profile) return null;
  const visible = Boolean(profile.visible);
  const photos = Array.isArray(profile.photos) ? profile.photos.slice(0, 6) : [];
  return {
    id: profile.id,
    displayName: visible ? profile.displayName : null,
    role: visible ? normalizedRole(profile.role) : null,
    avatarUrl: visible ? profile.avatarUrl : null,
    photos: visible ? photos : [],
    city: visible && profile.social?.showResidence ? profile.city : null,
    country: visible && profile.social?.showResidence ? profile.country : null,
    bio: visible ? profile.bio : null,
    musicGenres: visible ? profile.musicGenres || [] : [],
    social: visible ? profile.social || null : null,
    stories: visible ? stories : [],
    visible,
  };
}

function createProductStore({filePath = null, now = () => new Date(), authPepper = process.env.QSESSION_AUTH_PEPPER || ''} = {}) {
  let state = initialState();

  if (filePath && fs.existsSync(filePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      state = {...initialState(), ...saved, schemaVersion: 12};
    } catch (error) {
      throw new Error(`No se pudo leer el almacenamiento de Q Session: ${error.message}`);
    }
  }

  function timestamp() {
    return now().toISOString();
  }

  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
    fs.renameSync(temporary, filePath);
  }

  function safeAccount(account) {
    if (!account) return null;
    return {
      id: account.id,
      email: account.email,
      emailVerified: Boolean(account.emailVerified),
      status: account.status,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  function ownProfile(profile) {
    const result = clone(profile || null);
    if (result) {
      delete result.editTokenHash;
      result.savedProfileIds = Array.isArray(result.savedProfileIds) ? result.savedProfileIds : [];
    }
    return result;
  }

  function activeStories(profileId) {
    const currentTime = now().getTime();
    return state.stories
      .filter(story => story.profileId === profileId && new Date(story.expiresAt).getTime() > currentTime)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
      .slice(-10)
      .map(story => ({
        id: story.id,
        text: story.text,
        mediaId: story.mediaId || null,
        mediaUrl: story.mediaId ? `/api/profile-media/${story.mediaId}` : null,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
      }));
  }

  function publicProfile(profile) {
    return safePublicProfile(profile, profile?.visible ? activeStories(profile.id) : []);
  }

  function getPublicProfile(profileId) {
    const profile = state.profiles.find(item => item.id === text(profileId, 100) && item.visible);
    return profile ? publicProfile(profile) : null;
  }

  function profileForAccount(accountId) {
    return state.profiles.find(profile => profile.accountId === accountId) || null;
  }

  function createAccount(input = {}) {
    const email = normalizedEmail(input.email);
    if (state.accounts.some(account => account.email === email && account.status !== 'deleted')) {
      throw new Error('Ya existe una cuenta con este correo electrónico');
    }
    const createdAt = timestamp();
    const account = {
      id: id('account'),
      email,
      passwordHash: hashPassword(input.password, authPepper),
      emailVerified: false,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
    const profile = {
      id: id('profile'),
      accountId: account.id,
      displayName: optionalText(input.displayName, 60),
      role: normalizedRole(input.role),
      avatarUrl: null,
      photos: [],
      city: null,
      country: null,
      bio: null,
      musicGenres: [],
      savedProfileIds: [],
      social: {
        allowMatchmaking: false,
        allowMessages: false,
        showResidence: false,
        shareApproximateLocation: false,
        allowDjContact: true,
        allowTips: true,
      },
      visible: false,
      createdAt,
      updatedAt: createdAt,
    };
    state.accounts.push(account);
    state.profiles.push(profile);
    persist();
    return {account: safeAccount(account), profile: ownProfile(profile)};
  }

  function authenticateAccount(emailValue, password) {
    let email;
    try {
      email = normalizedEmail(emailValue);
    } catch {
      return null;
    }
    const account = state.accounts.find(item => item.email === email && item.status === 'active');
    if (!account || !passwordMatches(password, account.passwordHash, authPepper)) return null;
    return safeAccount(account);
  }

  function purgePasswordRecoveries() {
    const oldestAllowed = now().getTime() - 24 * 60 * 60 * 1000;
    state.passwordRecoveries = state.passwordRecoveries.filter(recovery => {
      const expiresAt = new Date(recovery.expiresAt).getTime();
      const usedAt = recovery.usedAt ? new Date(recovery.usedAt).getTime() : NaN;
      return expiresAt > now().getTime() || (Number.isFinite(usedAt) && usedAt > oldestAllowed);
    });
  }

  function createPasswordRecovery(emailValue, {lifetimeMs = PASSWORD_RECOVERY_LIFETIME_MS} = {}) {
    let email;
    try {
      email = normalizedEmail(emailValue);
    } catch {
      return null;
    }
    const account = state.accounts.find(item => item.email === email && item.status === 'active');
    if (!account) return null;
    purgePasswordRecoveries();
    state.passwordRecoveries = state.passwordRecoveries.filter(item => item.accountId !== account.id || item.usedAt);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const createdAt = timestamp();
    const recovery = {
      id: id('password_recovery'),
      accountId: account.id,
      codeHash: securityTokenHash(`${account.id}:${code}`, authPepper),
      createdAt,
      expiresAt: new Date(now().getTime() + Math.max(5 * 60 * 1000, Number(lifetimeMs) || PASSWORD_RECOVERY_LIFETIME_MS)).toISOString(),
      usedAt: null,
    };
    state.passwordRecoveries.push(recovery);
    persist();
    return {id: recovery.id, recipient: account.email, code, createdAt, expiresAt: recovery.expiresAt};
  }

  function cancelPasswordRecovery(recoveryId) {
    const originalLength = state.passwordRecoveries.length;
    state.passwordRecoveries = state.passwordRecoveries.filter(item => item.id !== recoveryId);
    if (state.passwordRecoveries.length !== originalLength) persist();
    return state.passwordRecoveries.length !== originalLength;
  }

  function resetAccountPassword({email: emailValue, code: codeValue, newPassword} = {}) {
    let email;
    try {
      email = normalizedEmail(emailValue);
    } catch {
      throw new Error('El código no es válido o ya venció');
    }
    const account = state.accounts.find(item => item.email === email && item.status === 'active');
    const code = String(codeValue || '').replace(/\D/g, '').slice(0, 6);
    purgePasswordRecoveries();
    const recovery = account && code.length === 6
      ? [...state.passwordRecoveries].reverse().find(item => item.accountId === account.id && !item.usedAt
        && new Date(item.expiresAt).getTime() > now().getTime())
      : null;
    const candidateHash = securityTokenHash(`${account?.id || 'missing'}:${code}`, authPepper);
    if (!recovery || !sameHash(recovery.codeHash, candidateHash)) {
      throw new Error('El código no es válido o ya venció');
    }
    account.passwordHash = hashPassword(newPassword, authPepper);
    account.emailVerified = true;
    account.updatedAt = timestamp();
    recovery.usedAt = account.updatedAt;
    state.sessions = state.sessions.filter(session => session.accountId !== account.id);
    persist();
    return safeAccount(account);
  }

  function createSession(accountId, {lifetimeMs = SESSION_LIFETIME_MS} = {}) {
    const account = state.accounts.find(item => item.id === accountId && item.status === 'active');
    if (!account) throw new Error('La cuenta no está disponible');
    const token = crypto.randomBytes(32).toString('base64url');
    const createdAt = timestamp();
    const session = {
      id: id('session'),
      accountId,
      tokenHash: profileTokenHash(token),
      createdAt,
      expiresAt: new Date(now().getTime() + Math.max(60_000, lifetimeMs)).toISOString(),
    };
    state.sessions = state.sessions.filter(item => new Date(item.expiresAt).getTime() > now().getTime());
    state.sessions.push(session);
    persist();
    return {
      token,
      expiresAt: session.expiresAt,
      account: safeAccount(account),
      profile: ownProfile(profileForAccount(accountId)),
    };
  }

  function authenticateSession(token) {
    const tokenHash = profileTokenHash(token);
    if (!tokenHash) return null;
    const session = state.sessions.find(item => sameHash(item.tokenHash, tokenHash));
    if (!session || new Date(session.expiresAt).getTime() <= now().getTime()) return null;
    const account = state.accounts.find(item => item.id === session.accountId && item.status === 'active');
    if (!account) return null;
    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      account: safeAccount(account),
      profile: ownProfile(profileForAccount(account.id)),
    };
  }

  function revokeSession(token) {
    const tokenHash = profileTokenHash(token);
    const originalLength = state.sessions.length;
    state.sessions = state.sessions.filter(item => !sameHash(item.tokenHash, tokenHash));
    if (state.sessions.length !== originalLength) persist();
    return state.sessions.length !== originalLength;
  }

  function updateAccountProfile(accountId, input = {}) {
    const account = state.accounts.find(item => item.id === accountId && item.status === 'active');
    if (!account) throw new Error('La cuenta no está disponible');
    let profile = profileForAccount(accountId);
    if (!profile) {
      profile = {id: id('profile'), accountId, createdAt: timestamp()};
      state.profiles.push(profile);
    }
    profile.displayName = optionalText(input.displayName, 60);
    profile.role = normalizedRole(input.role === undefined ? profile.role : input.role);
    profile.city = optionalText(input.city, 100);
    profile.country = optionalText(input.country, 100);
    profile.bio = optionalText(input.bio, 300);
    profile.musicGenres = Array.isArray(input.musicGenres)
      ? input.musicGenres.map(item => text(item, 40)).filter(Boolean).slice(0, 12)
      : profile.musicGenres || [];
    if (Array.isArray(input.photos)) {
      const seen = new Set();
      profile.photos = input.photos.map(item => {
        const mediaId = text(typeof item === 'string' ? item : item?.id, 100);
        if (!mediaId || seen.has(mediaId)) return null;
        const media = state.media.find(asset => asset.id === mediaId && asset.accountId === accountId);
        if (!media) throw new Error('Una de las fotos no pertenece a esta cuenta');
        seen.add(mediaId);
        return {
          id: media.id,
          url: `/api/profile-media/${media.id}`,
          caption: optionalText(typeof item === 'object' ? item.caption : null, 120),
        };
      }).filter(Boolean).slice(0, 6);
      profile.avatarUrl = profile.photos[0]?.url || null;
    }
    const social = input.social && typeof input.social === 'object' ? input.social : profile.social || {};
    profile.social = {
      allowMatchmaking: Boolean(social.allowMatchmaking),
      allowMessages: Boolean(social.allowMessages),
      showResidence: Boolean(social.showResidence),
      shareApproximateLocation: Boolean(social.shareApproximateLocation),
      allowDjContact: social.allowDjContact === undefined ? true : Boolean(social.allowDjContact),
      allowTips: social.allowTips === undefined ? true : Boolean(social.allowTips),
    };
    if (!profile.social.shareApproximateLocation || !input.visible) {
      profile.globalRaveCountryCode = null;
      profile.globalRaveCountryVerifiedAt = null;
      profile.globalRaveVerifiedBy = null;
    }
    profile.visible = Boolean(input.visible);
    profile.updatedAt = timestamp();
    account.updatedAt = profile.updatedAt;
    persist();
    return ownProfile(profile);
  }

  function setGlobalRaveCountry(accountId, countryCode, verifiedAt, verifiedBy) {
    const account = state.accounts.find(item => item.id === accountId && item.status === 'active');
    if (!account) throw new Error('La cuenta no está disponible');
    const profile = profileForAccount(accountId);
    if (!profile?.social?.shareApproximateLocation) {
      throw new Error('Activa Rave global en tu perfil antes de compartir ubicación');
    }
    if (!profile.visible) throw new Error('Haz público tu perfil antes de activar el localizador');
    if (verifiedBy !== 'gps') throw new Error('El localizador requiere GPS confirmado');
    const normalized = String(countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized) || normalized === 'XX') {
      throw new Error('No fue posible identificar el país');
    }
    const age = now().getTime() - verifiedAt;
    if (!Number.isFinite(verifiedAt) || age < -60_000 || age >= 30 * 60_000) {
      throw new Error('Actualiza la ubicación de tu dispositivo para compartir tu país');
    }
    profile.globalRaveCountryCode = normalized;
    profile.globalRaveCountryVerifiedAt = verifiedAt;
    profile.globalRaveVerifiedBy = 'gps';
    profile.updatedAt = timestamp();
    account.updatedAt = profile.updatedAt;
    persist();
    return normalized;
  }

  function clearGlobalRaveCountry(accountId) {
    const profile = profileForAccount(accountId);
    if (!profile) return;
    profile.globalRaveCountryCode = null;
    profile.globalRaveCountryVerifiedAt = null;
    persist();
  }

  function globalRavePresenceForAccount(accountId) {
    const profile = profileForAccount(accountId);
    if (!profile?.visible || profile.globalRaveVerifiedBy !== 'gps' || !profile?.social?.shareApproximateLocation || !/^[A-Z]{2}$/.test(profile.globalRaveCountryCode || '')) {
      return null;
    }
    const age = now().getTime() - profile.globalRaveCountryVerifiedAt;
    if (!Number.isFinite(age) || age < -60_000 || age >= 30 * 60_000) return null;
    return {
      countryCode: profile.globalRaveCountryCode,
      verifiedAt: profile.globalRaveCountryVerifiedAt,
      verifiedBy: 'gps',
      profileVisible: Boolean(profile.visible),
      publicName: profile.visible ? profile.displayName || '' : '',
    };
  }

  function addProfileMedia(accountId, input = {}) {
    if (!state.accounts.some(item => item.id === accountId && item.status === 'active')) {
      throw new Error('La cuenta no está disponible');
    }
    if (state.media.filter(item => item.accountId === accountId).length >= MAX_STORED_PROFILE_MEDIA) {
      throw new Error('Alcanzaste el límite temporal de fotos. Quita algunas antes de agregar otras.');
    }
    const media = {
      id: text(input.id, 100) || id('media'),
      accountId,
      contentType: text(input.contentType, 40),
      fileName: text(input.fileName, 180),
      byteLength: Math.max(0, Number(input.byteLength) || 0),
      sha256: text(input.sha256, 128),
      createdAt: timestamp(),
    };
    if (!media.fileName || !media.contentType || !media.byteLength) throw new Error('El archivo no es válido');
    state.media.push(media);
    persist();
    return clone(media);
  }

  function getProfileMedia(mediaId) {
    return clone(state.media.find(item => item.id === text(mediaId, 100)) || null);
  }

  function profileMediaIsPublic(mediaId) {
    const normalized = text(mediaId, 100);
    const referencedByProfile = state.profiles.some(profile => profile.visible && (profile.photos || []).some(photo => photo.id === normalized));
    const referencedByStory = state.stories.some(story => {
      const profile = state.profiles.find(item => item.id === story.profileId);
      return story.mediaId === normalized && profile?.visible && new Date(story.expiresAt).getTime() > now().getTime();
    });
    return referencedByProfile || referencedByStory;
  }

  function addPromotionMedia(accountId, input = {}) {
    if (!state.accounts.some(item => item.id === accountId && item.status === 'active')) {
      throw new Error('La cuenta no está disponible');
    }
    if (state.promotionMedia.filter(item => item.accountId === accountId).length >= MAX_STORED_PROMOTION_MEDIA) {
      throw new Error('Alcanzaste el límite de archivos promocionales guardados');
    }
    const media = {
      id: text(input.id, 100) || id('promotion_media'),
      accountId,
      contentType: text(input.contentType, 40).toLowerCase(),
      fileName: text(input.fileName, 180),
      byteLength: Math.max(0, Number(input.byteLength) || 0),
      sha256: text(input.sha256, 128),
      createdAt: timestamp(),
    };
    const supported = media.contentType.startsWith('image/') || media.contentType.startsWith('video/');
    if (!media.fileName || !media.byteLength || !supported) throw new Error('El archivo promocional no es válido');
    state.promotionMedia.push(media);
    persist();
    return clone(media);
  }

  function getPromotionMedia(mediaId) {
    return clone(state.promotionMedia.find(item => item.id === text(mediaId, 100)) || null);
  }

  function promotionMediaIsPublic(mediaId) {
    const normalized = text(mediaId, 100);
    return state.rooms.some(room => room.status !== 'archived'
      && (room.promotions || []).some(promotion => promotion.mediaId === normalized));
  }

  function normalizedRoomPromotions(value, ownerAccountId) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).map(item => {
      const sponsor = text(item?.sponsor, 80);
      if (!sponsor) throw new Error('Escribe el nombre del patrocinador');
      const mediaId = optionalText(item?.mediaId, 100);
      const media = mediaId ? state.promotionMedia.find(entry => entry.id === mediaId) : null;
      if (mediaId && (!media || media.accountId !== ownerAccountId)) {
        throw new Error('El archivo promocional no pertenece a esta cuenta');
      }
      return {
        id: id('promotion'),
        sponsor,
        headline: optionalText(item?.headline, 140),
        linkUrl: normalizedPromotionLink(item?.linkUrl),
        mediaId: media?.id || null,
        contentType: media?.contentType || null,
      };
    });
  }

  function createStory(accountId, input = {}) {
    const profile = profileForAccount(accountId);
    if (!profile) throw new Error('Completa tu perfil antes de publicar un estado');
    if (!profile.visible) throw new Error('Guarda tu perfil como público antes de publicar un Story');
    const storyText = optionalText(input.text, 180);
    const mediaId = optionalText(input.mediaId, 100);
    if (!storyText && !mediaId) throw new Error('Escribe un estado o elige una foto');
    if (mediaId && !state.media.some(item => item.id === mediaId && item.accountId === accountId)) {
      throw new Error('La foto del estado no pertenece a esta cuenta');
    }
    const createdAt = timestamp();
    const story = {
      id: id('story'),
      accountId,
      profileId: profile.id,
      text: storyText,
      mediaId,
      createdAt,
      expiresAt: new Date(now().getTime() + STORY_LIFETIME_MS).toISOString(),
    };
    state.stories = state.stories.filter(item => new Date(item.expiresAt).getTime() > now().getTime());
    state.stories.push(story);
    const ownStories = state.stories.filter(item => item.accountId === accountId);
    if (ownStories.length > 10) {
      const removeIds = new Set(ownStories.slice(0, ownStories.length - 10).map(item => item.id));
      state.stories = state.stories.filter(item => !removeIds.has(item.id));
    }
    persist();
    return clone({...story, mediaUrl: mediaId ? `/api/profile-media/${mediaId}` : null});
  }

  function deleteStory(accountId, storyId) {
    const originalLength = state.stories.length;
    state.stories = state.stories.filter(item => !(item.id === storyId && item.accountId === accountId));
    if (state.stories.length !== originalLength) persist();
    return state.stories.length !== originalLength;
  }

  function createEvent(input = {}) {
    const scheduledAt = isoDate(input.scheduledAt);
    const event = {
      id: id('evt'),
      name: optionalText(input.name, 100),
      coverUrl: optionalText(input.coverUrl, 500),
      description: optionalText(input.description, 800),
      scheduledAt,
      durationMinutes: Math.min(1440, Math.max(1, Number(input.durationMinutes) || 120)),
      location: optionalText(input.location, 180),
      capacity: Math.max(0, Number(input.capacity) || 0),
      visibility: input.visibility === 'public' ? 'public' : 'private',
      organizerName: optionalText(input.organizerName, 100),
      djName: optionalText(input.djName, 100),
      status: scheduledAt ? 'scheduled' : 'draft',
      createdAt: timestamp(),
      updatedAt: timestamp(),
    };
    state.events.push(event);
    persist();
    return clone(event);
  }

  function listEvents({includeArchived = false} = {}) {
    return clone(state.events
      .filter(event => includeArchived || event.status !== 'archived')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  }

  function getEvent(eventId) {
    return clone(state.events.find(event => event.id === eventId) || null);
  }

  function createRoomRecord(input = {}) {
    const code = text(input.code, 6).toUpperCase();
    if (!ROOM_CODE.test(code)) throw new Error('El código de sala no es válido');
    const existing = state.rooms.find(room => room.code === code && room.status !== 'archived');
    if (existing) throw new Error(`La sala ${code} ya existe`);
    const event = input.eventId ? state.events.find(item => item.id === input.eventId) : null;
    if (input.eventId && !event) throw new Error('El evento seleccionado no existe');
    const passwordHash = input.password ? hashRoomPassword(input.password, authPepper) : null;
    const allowSocialProfiles = input.allowSocialProfiles !== false;
    const accessMethods = [...new Set((Array.isArray(input.accessMethods) ? input.accessMethods : ['link', 'code', 'qr'])
      .filter(method => ROOM_ACCESS_METHODS.has(method)))];
    if (!accessMethods.length) throw new Error('Activa al menos una forma de ingreso');
    const sourceLanguage = CONFERENCE_LANGUAGES.has(input.translation?.sourceLanguage) ? input.translation.sourceLanguage : 'es';
    const targetLanguages = [...new Set((Array.isArray(input.translation?.targetLanguages) ? input.translation.targetLanguages : ['en', 'de'])
      .filter(language => CONFERENCE_LANGUAGES.has(language) && language !== sourceLanguage))];
    if (!targetLanguages.length) throw new Error('Elige al menos un idioma de traducción diferente al idioma original');
    const requestedOwnerAccountId = optionalText(input.ownerAccountId, 100);
    const promotions = normalizedRoomPromotions(input.promotions, requestedOwnerAccountId);
    const roomType = ROOM_TYPES.has(input.roomType) ? input.roomType : 'custom';
    const experience = normalizedRoomExperience(input, roomType);
    const room = {
      id: id('room'),
      code,
      ownerAccountId: requestedOwnerAccountId && state.accounts.some(account => account.id === requestedOwnerAccountId && account.status === 'active')
        ? requestedOwnerAccountId
        : null,
      ownerProfileId: optionalText(input.ownerProfileId, 100),
      eventId: event?.id || null,
      name: optionalText(input.name, 100) || event?.name || null,
      description: optionalText(input.description, 800) || event?.description || null,
      coverUrl: optionalText(input.coverUrl, 500) || event?.coverUrl || null,
      djName: optionalText(input.djName, 100) || event?.djName || 'DJ Q Session',
      hostRole: input.hostRole === 'organizer' ? 'organizer' : 'dj',
      roomType,
      capacity: Math.max(0, Math.min(1_000_000, Number(input.capacity) || event?.capacity || 0)),
      capacityMode: input.capacityMode === 'limited' ? 'limited' : 'expected',
      billingPlanId: optionalText(input.billingPlanId, 60),
      billingPlanName: optionalText(input.billingPlanName, 100),
      billingCapacityLimit: Math.max(0, Math.min(1_000_000, Number(input.billingCapacityLimit) || 0)),
      sessionDurationMinutes: Math.min(1440, Math.max(15, Number(input.sessionDurationMinutes) || 120)),
      broadcastMode: ['live', 'recorded', 'image'].includes(input.broadcastMode) ? input.broadcastMode : 'live',
      recordedAssetId: optionalText(input.recordedAssetId, 160),
      sessionImageUrl: optionalText(input.sessionImageUrl, 800),
      starPrice: Math.max(0, Math.min(1_000_000, Math.floor(Number(input.starPrice) || 0))),
      rightsDeclaration: input.rightsDeclaration?.accepted === true ? {
        accepted: true,
        version: optionalText(input.rightsDeclaration.version, 80),
        acceptedAt: isoDate(input.rightsDeclaration.acceptedAt),
        accountId: optionalText(input.rightsDeclaration.accountId, 100),
        scope: optionalText(input.rightsDeclaration.scope, 80),
      } : null,
      contentAudit: input.contentAudit ? {
        accountId: optionalText(input.contentAudit.accountId, 100),
        profileId: optionalText(input.contentAudit.profileId, 100),
        source: optionalText(input.contentAudit.source, 80),
        recordedAssetId: optionalText(input.contentAudit.recordedAssetId, 160),
        sessionImageUrl: optionalText(input.contentAudit.sessionImageUrl, 800),
        recordedAt: isoDate(input.contentAudit.recordedAt) || timestamp(),
      } : null,
      billingStartedAt: null,
      visibility: input.visibility === 'public' ? 'public' : 'private',
      accessMethods,
      translation: {
        sourceLanguage,
        mode: input.translation?.mode === 'audio' ? 'audio' : 'subtitles',
        targetLanguages,
      },
      sponsors: normalizedSponsors([...normalizedSponsors(input.sponsors), ...promotions.map(promotion => promotion.sponsor)]),
      promotions,
      passwordProtected: Boolean(passwordHash),
      passwordHash,
      allowPublicChat: input.allowPublicChat !== false,
      allowGuestCameras: input.allowGuestCameras !== false,
      allowSocialProfiles,
      allowMatchmaking: allowSocialProfiles && input.allowMatchmaking !== false,
      allowProfileGifts: allowSocialProfiles && input.allowProfileGifts !== false,
      allowSharedFiles: input.allowSharedFiles !== false,
      allowSpeakingQueue: input.allowSpeakingQueue !== false,
      allowQuestions: input.allowQuestions !== false,
      allowPolls: input.allowPolls !== false,
      allowReactions: input.allowReactions !== false,
      allowRecording: input.allowRecording === true,
      ...experience,
      scheduledAt: isoDate(input.scheduledAt) || event?.scheduledAt || null,
      timeZone: normalizedTimeZone(input.timeZone),
      transport: 'sfu',
      status: input.status === 'waiting' ? 'waiting' : 'live',
      createdAt: timestamp(),
      startedAt: input.status === 'waiting' ? null : timestamp(),
      endedAt: null,
      peakListeners: 0,
      totalJoins: 0,
      disconnects: 0,
    };
    state.rooms.push(room);
    if (event) {
      event.status = room.status === 'live' ? 'live' : 'waiting';
      event.updatedAt = timestamp();
    }
    persist();
    return clone(room);
  }

  function getRoomRecord(code) {
    const normalized = text(code, 6).toUpperCase();
    const rooms = state.rooms.filter(room => room.code === normalized);
    return clone(rooms.at(-1) || null);
  }

  function getRoomRecordById(roomId) {
    const normalized = text(roomId, 100);
    return clone(state.rooms.find(room => room.id === normalized) || null);
  }

  function listPublicRooms() {
    return clone(state.rooms
      .filter(room => room.visibility === 'public')
      .filter(room => room.status === 'live' || room.status === 'waiting')
      .sort((left, right) => String(right.startedAt || right.scheduledAt || right.createdAt)
        .localeCompare(String(left.startedAt || left.scheduledAt || left.createdAt))));
  }

  function listHostedRooms(accountId) {
    const normalizedAccountId = text(accountId, 100);
    return clone(state.rooms
      .filter(room => room.ownerAccountId === normalizedAccountId)
      .sort((left, right) => String(right.startedAt || right.scheduledAt || right.createdAt)
        .localeCompare(String(left.startedAt || left.scheduledAt || left.createdAt)))
      .map(room => ({
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
        peakListeners: Math.max(0, Number(room.peakListeners) || 0),
        totalJoins: Math.max(0, Number(room.totalJoins) || 0),
        disconnects: Math.max(0, Number(room.disconnects) || 0),
      })));
  }

  function roomPasswordIsValid(code, password) {
    const room = getRoomRecord(code);
    if (!room || room.status === 'archived') return false;
    if (!room.passwordProtected) return true;
    return roomPasswordMatches(password, room.passwordHash, authPepper);
  }

  function updateRoomRecord(code, patch = {}) {
    const normalized = text(code, 6).toUpperCase();
    const room = [...state.rooms].reverse().find(item => item.code === normalized);
    if (!room) return null;
    const allowed = ['status', 'transport', 'peakListeners', 'totalJoins', 'disconnects', 'startedAt', 'endedAt', 'billingStartedAt'];
    for (const key of allowed) {
      if (patch[key] !== undefined) room[key] = patch[key];
    }
    persist();
    return clone(room);
  }

  function updateRoomConfiguration(code, input = {}, {eventCapacityLimit = 0} = {}) {
    const normalized = text(code, 6).toUpperCase();
    const room = [...state.rooms].reverse().find(item => item.code === normalized);
    if (!room || room.status === 'archived') return null;
    const accessMethods = [...new Set((Array.isArray(input.accessMethods) ? input.accessMethods : room.accessMethods)
      .filter(method => ROOM_ACCESS_METHODS.has(method)))];
    if (!accessMethods.length) throw new Error('Activa al menos una forma de ingreso');
    const sourceLanguage = CONFERENCE_LANGUAGES.has(input.translation?.sourceLanguage)
      ? input.translation.sourceLanguage : room.translation?.sourceLanguage || 'es';
    const targetLanguages = [...new Set((Array.isArray(input.translation?.targetLanguages)
      ? input.translation.targetLanguages : room.translation?.targetLanguages || ['en', 'de'])
      .filter(language => CONFERENCE_LANGUAGES.has(language) && language !== sourceLanguage))];
    if (!targetLanguages.length) throw new Error('Elige al menos un idioma de traducción diferente al idioma original');
    if (eventCapacityLimit !== 0 && (!Number.isSafeInteger(eventCapacityLimit) || eventCapacityLimit < 1 || eventCapacityLimit > 10000)) {
      throw new Error('La autorización de aforo del evento no es válida');
    }
    const billingLimit = eventCapacityLimit || Math.max(0, Number(room.billingCapacityLimit) || 0);
    const rawCapacity = input.capacity === undefined ? room.capacity : input.capacity;
    const capacity = typeof rawCapacity === 'number' || typeof rawCapacity === 'string' ? Number(rawCapacity) : NaN;
    const capacityMode = (input.capacityMode ?? room.capacityMode) === 'limited' ? 'limited' : 'expected';
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 1_000_000) {
      throw new Error('Escribe un aforo entero entre 1 y 1.000.000 personas');
    }
    if (capacityMode === 'limited' && capacity < 1) throw new Error('Escribe un límite máximo de al menos una persona');
    if (billingLimit && capacity > billingLimit) throw new Error(`Este plan admite hasta ${billingLimit.toLocaleString('es-CO')} personas`);
    room.visibility = input.visibility === 'public' ? 'public' : 'private';
    room.capacity = capacity;
    room.capacityMode = capacityMode;
    room.accessMethods = accessMethods;
    room.translation = {
      sourceLanguage,
      mode: input.translation?.mode === 'audio' ? 'audio' : 'subtitles',
      targetLanguages,
    };
    ['allowPublicChat', 'allowGuestCameras', 'allowSharedFiles', 'allowSpeakingQueue', 'allowQuestions', 'allowPolls', 'allowReactions']
      .forEach(key => { if (typeof input[key] === 'boolean') room[key] = input[key]; });
    if (typeof input.allowRecording === 'boolean') room.allowRecording = input.allowRecording;
    Object.assign(room, normalizedRoomExperience({...room, ...input}, room.roomType));
    persist();
    return clone(room);
  }

  function recordJoin(code, listenerCount) {
    const room = getRoomRecord(code);
    if (!room || room.status === 'archived') return null;
    return updateRoomRecord(code, {
      peakListeners: Math.max(room.peakListeners, Number(listenerCount) || 0),
      totalJoins: room.totalJoins + 1,
    });
  }

  function recordRoomActivity(code, listenerCount) {
    const room = getRoomRecord(code);
    if (!room || room.status === 'archived') return null;
    return updateRoomRecord(code, {
      peakListeners: Math.max(room.peakListeners, Number(listenerCount) || 0),
    });
  }

  function archiveRoom(code) {
    const endedAt = timestamp();
    const room = updateRoomRecord(code, {status: 'archived', endedAt});
    if (room?.eventId) {
      const event = state.events.find(item => item.id === room.eventId);
      if (event) {
        event.status = 'archived';
        event.updatedAt = endedAt;
        persist();
      }
    }
    return room;
  }

  function deleteHostedRoom(roomId, accountId) {
    const normalizedRoomId = text(roomId, 100);
    const normalizedAccountId = text(accountId, 100);
    const roomIndex = state.rooms.findIndex(room => room.id === normalizedRoomId);
    if (roomIndex < 0) return null;
    const room = state.rooms[roomIndex];
    if (!normalizedAccountId || room.ownerAccountId !== normalizedAccountId) {
      throw new Error('No tienes permiso para eliminar esta sesión');
    }
    state.rooms.splice(roomIndex, 1);
    state.messages = state.messages.filter(message => message.roomCode !== room.code);
    // Ordinary in-room moderation reports can disappear with the room, but
    // copyright notices are compliance records and must survive its deletion.
    state.reports = state.reports.filter(report => report.roomCode !== room.code || report.kind === 'copyright');
    persist();
    return clone(room);
  }

  function upsertProfile(input = {}) {
    const requestedId = text(input.id, 100);
    let profile = requestedId ? state.profiles.find(item => item.id === requestedId) : null;
    const requestedTokenHash = profileTokenHash(input.editToken);
    if (profile?.editTokenHash && !sameHash(profile.editTokenHash, requestedTokenHash)) {
      throw new Error('No tienes permiso para modificar este perfil');
    }
    if (!profile) {
      profile = {
        id: requestedId || id('profile'),
        photos: [],
        createdAt: timestamp(),
      };
      state.profiles.push(profile);
    }
    if (!profile.editTokenHash && requestedTokenHash) profile.editTokenHash = requestedTokenHash;
    profile.displayName = optionalText(input.displayName, 60);
    profile.avatarUrl = avatarValue(input.avatarUrl);
    profile.city = optionalText(input.city, 100);
    profile.country = optionalText(input.country, 100);
    profile.bio = optionalText(input.bio, 300);
    profile.musicGenres = Array.isArray(input.musicGenres)
      ? input.musicGenres.map(item => text(item, 40)).filter(Boolean).slice(0, 12)
      : profile.musicGenres || [];
    const social = input.social && typeof input.social === 'object' ? input.social : {};
    profile.social = {
      allowMatchmaking: Boolean(social.allowMatchmaking),
      allowMessages: Boolean(social.allowMessages),
      showResidence: Boolean(social.showResidence),
      shareApproximateLocation: Boolean(social.shareApproximateLocation),
      allowDjContact: Boolean(social.allowDjContact),
      allowTips: Boolean(social.allowTips),
    };
    profile.visible = Boolean(input.visible);
    profile.updatedAt = timestamp();
    persist();
    const result = clone(profile);
    delete result.editTokenHash;
    return result;
  }

  function getProfile(profileId) {
    return ownProfile(state.profiles.find(item => item.id === profileId) || null);
  }

  function profileIsOwned(profileId, {accountId = null, editToken = null} = {}) {
    const profile = state.profiles.find(item => item.id === text(profileId, 100));
    if (!profile) return false;
    if (profile.accountId) return Boolean(accountId && profile.accountId === accountId);
    const editTokenHash = profileTokenHash(editToken);
    return Boolean(profile.editTokenHash && editTokenHash && sameHash(profile.editTokenHash, editTokenHash));
  }

  function addMessage(input = {}) {
    const roomCode = text(input.roomCode, 6).toUpperCase();
    if (!ROOM_CODE.test(roomCode) || !getRoomRecord(roomCode)) throw new Error('La sala no existe');
    const kind = MESSAGE_KINDS.has(input.kind) ? input.kind : 'text';
    const messageText = text(input.text, kind === 'reaction' ? 12 : 600);
    if (!messageText) throw new Error('El mensaje está vacío');
    const profile = input.profileId ? state.profiles.find(item => item.id === input.profileId) : null;
    const message = {
      id: id('msg'),
      roomCode,
      profileId: profile?.id || null,
      author: profile
        ? (profile.visible && profile.displayName ? profile.displayName : 'Oyente')
        : optionalText(input.author, 60) || 'Oyente',
      kind,
      text: messageText,
      createdAt: timestamp(),
    };
    state.messages.push(message);
    if (state.messages.length > 5000) state.messages.splice(0, state.messages.length - 5000);
    persist();
    return clone(message);
  }

  function listMessages(roomCode, limit = 50) {
    const normalized = text(roomCode, 6).toUpperCase();
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    return clone(state.messages.filter(message => message.roomCode === normalized).slice(-safeLimit).map(message => {
      const profile = message.profileId ? state.profiles.find(item => item.id === message.profileId) : null;
      if (!profile) return {...message, avatarUrl: null};
      return {
        ...message,
        author: profile.visible && profile.displayName ? profile.displayName : 'Oyente',
        avatarUrl: profile.visible ? profile.avatarUrl || profile.photos?.[0]?.url || null : null,
      };
    }));
  }

  function privateMemberSummary(profile) {
    return {
      id: profile.id,
      displayName: profile.displayName || 'Oyente',
      role: normalizedRole(profile.role),
      avatarUrl: profile.visible ? profile.avatarUrl || profile.photos?.[0]?.url || null : null,
      visible: Boolean(profile.visible),
    };
  }

  function privateContactSummary(profile) {
    if (profile.visible) return safePublicProfile(profile, activeStories(profile.id));
    return {
      ...privateMemberSummary(profile),
      photos: [],
      city: null,
      country: null,
      bio: null,
      musicGenres: [],
      social: {allowMessages: Boolean(profile.social?.allowMessages)},
      stories: [],
      private: true,
    };
  }

  function privateConversationRecord(conversationId) {
    return state.privateConversations.find(item => item.id === text(conversationId, 100)) || null;
  }

  function requireSmallPrivateGroup(conversation) {
    if (conversation.memberProfileIds.length > 10) {
      throw new Error('Este grupo supera el máximo de 10 personas. Su historial se conserva; crea un grupo de hasta 10 para continuar.');
    }
  }

  function privateInteractionText(action) {
    if (action.type === 'touch') return 'Envió un toque para conectar';
    if (action.type === 'gift') return 'Envió un detalle';
    return 'Interacción de perfil';
  }

  function privateTimelineEntries(conversation) {
    const entries = state.privateMessages.filter(message => message.conversationId === conversation.id);
    if (conversation.type !== 'direct' || conversation.memberProfileIds.length !== 2) return entries;
    const members = new Set(conversation.memberProfileIds);
    const interactions = state.profileActions
      .filter(action => (action.type === 'touch' || action.type === 'gift')
        && members.has(action.senderProfileId)
        && members.has(action.targetProfileId))
      .map(action => ({
        id: `interaction_${action.id}`,
        conversationId: conversation.id,
        profileId: action.senderProfileId,
        kind: 'interaction',
        text: privateInteractionText(action),
        interaction: {type: action.type, gift: action.gift || null},
        createdAt: action.createdAt,
      }));
    return [...entries, ...interactions].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  function privateMessageOutput(message) {
    const profile = state.profiles.find(item => item.id === message.profileId);
    const media = message.mediaId ? state.privateMedia.find(item => item.id === message.mediaId) : null;
    return {
      ...message,
      author: profile?.displayName || 'Oyente',
      avatarUrl: profile?.visible ? profile.avatarUrl || profile.photos?.[0]?.url || null : null,
      media: media ? {
        id: media.id,
        url: `/api/private-media/${media.id}`,
        contentType: media.contentType,
        byteLength: media.byteLength,
        originalName: media.originalName,
      } : null,
      audio: media && message.kind === 'voice' ? {
        url: `/api/private-media/${media.id}`,
        mimeType: media.contentType,
        durationMs: media.durationMs || 0,
      } : null,
    };
  }

  function notifyPrivateMessage(conversation, profileId, createdAt) {
    conversation.memberProfileIds.filter(memberProfileId => memberProfileId !== profileId).forEach(targetProfileId => {
      state.profileActions.push({
        id: id('profile_action'),
        senderProfileId: profileId,
        targetProfileId,
        type: 'message',
        gift: null,
        conversationId: conversation.id,
        createdAt,
        readAt: null,
      });
    });
  }

  function notifyPrivateCall(conversationId, callerProfileId) {
    const normalizedCallerId = text(callerProfileId, 100);
    const conversation = privateConversationRecord(conversationId);
    if (!conversation || !conversation.memberProfileIds.includes(normalizedCallerId)) {
      throw new Error('La conversación privada no está disponible');
    }
    requireSmallPrivateGroup(conversation);
    const caller = state.profiles.find(profile => profile.id === normalizedCallerId);
    if (!caller?.social?.allowMessages) throw new Error('Activa Mensajes en tu Perfil para llamar');
    const createdAt = timestamp();
    const cooldownStart = now().getTime() - 2 * 60 * 1000;
    const actions = conversation.memberProfileIds
      .filter(targetProfileId => targetProfileId !== normalizedCallerId)
      .map(targetProfileId => {
        const recent = state.profileActions.find(action => action.type === 'call'
          && action.senderProfileId === normalizedCallerId
          && action.targetProfileId === targetProfileId
          && action.conversationId === conversation.id
          && new Date(action.createdAt).getTime() > cooldownStart);
        if (recent) return recent;
        const action = {
          id: id('profile_action'),
          senderProfileId: normalizedCallerId,
          targetProfileId,
          type: 'call',
          gift: null,
          conversationId: conversation.id,
          createdAt,
          readAt: null,
        };
        state.profileActions.push(action);
        return action;
      });
    conversation.updatedAt = createdAt;
    persist();
    return clone(actions);
  }

  function privateConversationSummary(conversation, viewerProfileId) {
    if (!conversation?.memberProfileIds?.includes(viewerProfileId)) return null;
    const members = conversation.memberProfileIds
      .map(profileId => state.profiles.find(profile => profile.id === profileId))
      .filter(Boolean)
      .map(privateMemberSummary);
    const otherMember = members.find(member => member.id !== viewerProfileId);
    const latest = privateTimelineEntries(conversation).at(-1) || null;
    return {
      id: conversation.id,
      type: conversation.type,
      name: conversation.name,
      title: conversation.type === 'direct' ? otherMember?.displayName || 'Chat privado' : conversation.name,
      ownerProfileId: conversation.ownerProfileId,
      members,
      memberCount: members.length,
      lastMessage: latest ? {
        text: latest.text,
        kind: latest.kind,
        authorProfileId: latest.profileId,
        createdAt: latest.createdAt,
      } : null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  function relatedProfileIds(viewerProfileId) {
    const normalizedViewer = text(viewerProfileId, 100);
    const viewer = state.profiles.find(profile => profile.id === normalizedViewer);
    if (!viewer) return new Set();
    const relatedProfileIds = new Set(Array.isArray(viewer.savedProfileIds) ? viewer.savedProfileIds : []);
    state.profileActions.forEach(action => {
      if (action.senderProfileId === normalizedViewer) relatedProfileIds.add(action.targetProfileId);
      if (action.targetProfileId === normalizedViewer) relatedProfileIds.add(action.senderProfileId);
    });
    state.privateConversations
      .filter(conversation => conversation.memberProfileIds.includes(normalizedViewer))
      .forEach(conversation => conversation.memberProfileIds.forEach(profileId => relatedProfileIds.add(profileId)));
    relatedProfileIds.delete(normalizedViewer);
    return relatedProfileIds;
  }

  function listRelatedProfiles(viewerProfileId) {
    const relatedIds = relatedProfileIds(viewerProfileId);
    return state.profiles
      .filter(profile => relatedIds.has(profile.id) && profile.visible)
      .map(profile => safePublicProfile(profile, activeStories(profile.id)))
      .filter(Boolean)
      .sort((left, right) => String(left.displayName || '').localeCompare(String(right.displayName || '')));
  }

  function listPrivateContacts(viewerProfileId) {
    const relatedIds = relatedProfileIds(viewerProfileId);
    return state.profiles
      .filter(profile => relatedIds.has(profile.id) && profile.social?.allowMessages)
      .map(privateContactSummary)
      .sort((left, right) => String(left.displayName || '').localeCompare(String(right.displayName || '')));
  }

  function createPrivateConversation(input = {}) {
    const creatorProfileId = text(input.creatorProfileId, 100);
    const creator = state.profiles.find(profile => profile.id === creatorProfileId);
    if (!creator?.social?.allowMessages) throw new Error('Activa Mensajes en tu Perfil para conversar');
    const type = input.type === 'group' ? 'group' : 'direct';
    const requestedIds = Array.isArray(input.memberProfileIds) ? input.memberProfileIds : [];
    const memberIds = [...new Set(requestedIds.map(profileId => text(profileId, 100)).filter(Boolean))]
      .filter(profileId => profileId !== creatorProfileId);
    if (type === 'direct' && memberIds.length !== 1) throw new Error('Elige una persona para el chat uno a uno');
    if (type === 'group' && memberIds.length < 2) throw new Error('Elige al menos dos personas para crear un grupo');
    // The creator occupies one of the ten places too. Check after deduplicating
    // so repeated profile IDs cannot consume places or bypass the boundary.
    if (memberIds.length > 9) throw new Error('Cada grupo admite hasta 10 personas, incluyéndote');
    const invited = memberIds.map(profileId => state.profiles.find(profile => profile.id === profileId));
    if (invited.some(profile => !profile || !profile.social?.allowMessages)) {
      throw new Error('Una de las personas ya no está disponible para conversar');
    }
    const establishedContacts = relatedProfileIds(creatorProfileId);
    const undiscoverableInvitee = invited.some(profile => (!creator.visible || !profile.visible) && !establishedContacts.has(profile.id));
    if (undiscoverableInvitee && input.allowUndiscoverable !== true) {
      throw new Error('Los perfiles privados se conectan mediante un enlace, código o QR de invitación');
    }
    const allMemberIds = [creatorProfileId, ...memberIds];
    if (type === 'direct') {
      const existing = state.privateConversations.find(conversation => conversation.type === 'direct'
        && conversation.memberProfileIds.length === 2
        && allMemberIds.every(profileId => conversation.memberProfileIds.includes(profileId)));
      if (existing) return privateConversationSummary(existing, creatorProfileId);
    }
    const createdAt = timestamp();
    const conversation = {
      id: id('conversation'),
      type,
      name: type === 'group' ? text(input.name, 80) || `Grupo de ${creator.displayName || 'Q Session'}` : null,
      ownerProfileId: creatorProfileId,
      memberProfileIds: allMemberIds,
      createdAt,
      updatedAt: createdAt,
    };
    state.privateConversations.push(conversation);
    persist();
    return privateConversationSummary(conversation, creatorProfileId);
  }

  function privateChatInviteCodeHash(code) {
    return crypto.createHash('sha256').update(`${authPepper}:private-chat:${code}`).digest('hex');
  }

  function purgePrivateChatInvitations() {
    const sevenDaysAgo = now().getTime() - 7 * 24 * 60 * 60 * 1000;
    state.privateChatInvitations = state.privateChatInvitations.filter(invitation => {
      const expiresAt = new Date(invitation.expiresAt).getTime();
      const acceptedAt = invitation.acceptedAt ? new Date(invitation.acceptedAt).getTime() : NaN;
      return expiresAt > now().getTime() || (Number.isFinite(acceptedAt) && acceptedAt > sevenDaysAgo);
    });
  }

  function createPrivateChatInvitation(profileId) {
    const creatorProfileId = text(profileId, 100);
    const creator = state.profiles.find(profile => profile.id === creatorProfileId);
    if (!creator?.social?.allowMessages) throw new Error('Activa Mensajes en tu Perfil para crear una invitación');
    purgePrivateChatInvitations();
    let code = '';
    let codeHash = '';
    do {
      code = Array.from({length: 8}, () => PRIVATE_CHAT_INVITE_ALPHABET[crypto.randomInt(PRIVATE_CHAT_INVITE_ALPHABET.length)]).join('');
      codeHash = privateChatInviteCodeHash(code);
    } while (state.privateChatInvitations.some(invitation => invitation.codeHash === codeHash));
    const createdAt = timestamp();
    const invitation = {
      id: id('private_chat_invite'),
      codeHash,
      creatorProfileId,
      createdAt,
      expiresAt: new Date(now().getTime() + PRIVATE_CHAT_INVITE_LIFETIME_MS).toISOString(),
      acceptedAt: null,
      acceptedByProfileId: null,
      conversationId: null,
    };
    state.privateChatInvitations.push(invitation);
    persist();
    return {code, createdAt, expiresAt: invitation.expiresAt};
  }

  function redeemPrivateChatInvitation(profileId, rawCode) {
    const accepterProfileId = text(profileId, 100);
    const accepter = state.profiles.find(profile => profile.id === accepterProfileId);
    if (!accepter?.social?.allowMessages) throw new Error('Activa Mensajes en tu Perfil para aceptar la invitación');
    const code = normalizedPrivateChatInviteCode(rawCode);
    if (!PRIVATE_CHAT_INVITE_CODE.test(code)) throw new Error('El código de invitación no es válido');
    purgePrivateChatInvitations();
    const invitation = state.privateChatInvitations.find(item => item.codeHash === privateChatInviteCodeHash(code));
    if (!invitation) throw new Error('La invitación no existe o ya venció');
    if (invitation.creatorProfileId === accepterProfileId) throw new Error('Comparte este código con otra persona');
    if (invitation.acceptedAt) {
      if (invitation.acceptedByProfileId === accepterProfileId && invitation.conversationId) {
        const existing = privateConversationSummary(privateConversationRecord(invitation.conversationId), accepterProfileId);
        if (existing) return existing;
      }
      throw new Error('Esta invitación ya fue utilizada');
    }
    if (new Date(invitation.expiresAt).getTime() <= now().getTime()) throw new Error('La invitación ya venció');
    const creator = state.profiles.find(profile => profile.id === invitation.creatorProfileId);
    if (!creator?.social?.allowMessages) throw new Error('La persona que invitó ya no está disponible para conversar');
    const conversation = createPrivateConversation({
      creatorProfileId: creator.id,
      memberProfileIds: [accepterProfileId],
      type: 'direct',
      allowUndiscoverable: true,
    });
    invitation.acceptedAt = timestamp();
    invitation.acceptedByProfileId = accepterProfileId;
    invitation.conversationId = conversation.id;
    persist();
    return privateConversationSummary(privateConversationRecord(conversation.id), accepterProfileId);
  }

  function listPrivateConversations(viewerProfileId) {
    return state.privateConversations
      .filter(conversation => conversation.memberProfileIds.includes(viewerProfileId))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map(conversation => privateConversationSummary(conversation, viewerProfileId))
      .filter(Boolean);
  }

  function getPrivateConversation(conversationId, viewerProfileId) {
    return privateConversationSummary(privateConversationRecord(conversationId), viewerProfileId);
  }

  function addPrivateMessage(input = {}) {
    const profileId = text(input.profileId, 100);
    const conversation = privateConversationRecord(input.conversationId);
    if (!conversation || !conversation.memberProfileIds.includes(profileId)) throw new Error('La conversación privada no está disponible');
    requireSmallPrivateGroup(conversation);
    const kind = input.kind === 'reaction' ? 'reaction' : 'text';
    const messageText = text(input.text, kind === 'reaction' ? 12 : 600);
    if (!messageText) throw new Error('El mensaje está vacío');
    const createdAt = timestamp();
    const message = {
      id: id('private_msg'),
      conversationId: conversation.id,
      profileId,
      kind,
      text: messageText,
      createdAt,
    };
    state.privateMessages.push(message);
    notifyPrivateMessage(conversation, profileId, createdAt);
    conversation.updatedAt = createdAt;
    persist();
    return clone(message);
  }

  function addPrivateMediaMessage(input = {}) {
    const profileId = text(input.profileId, 100);
    const conversation = privateConversationRecord(input.conversationId);
    if (!conversation || !conversation.memberProfileIds.includes(profileId)) throw new Error('La conversación privada no está disponible');
    requireSmallPrivateGroup(conversation);
    const source = input.media && typeof input.media === 'object' ? input.media : {};
    const mediaId = text(source.id, 100);
    const contentType = text(source.contentType, 40).toLowerCase();
    const kind = contentType.startsWith('image/') ? 'image'
      : contentType.startsWith('video/') ? 'video'
        : contentType.startsWith('audio/') ? 'voice' : null;
    const media = {
      id: mediaId,
      conversationId: conversation.id,
      profileId,
      contentType,
      fileName: text(source.fileName, 180),
      originalName: optionalText(input.originalName, 120),
      byteLength: Math.max(0, Number(source.byteLength) || 0),
      sha256: text(source.sha256, 128),
      durationMs: kind === 'voice' ? Math.min(30000, Math.max(300, Number(input.durationMs) || 0)) : 0,
      createdAt: timestamp(),
    };
    if (!media.id || !media.fileName || !media.byteLength || !kind || !PRIVATE_MESSAGE_KINDS.has(kind)) {
      throw new Error('El archivo privado no es válido');
    }
    if (state.privateMedia.some(item => item.id === media.id)) throw new Error('El archivo privado ya existe');
    const message = {
      id: id('private_msg'),
      conversationId: conversation.id,
      profileId,
      kind,
      text: kind === 'image' ? 'Foto' : kind === 'video' ? 'Video' : 'Nota de voz',
      mediaId: media.id,
      createdAt: media.createdAt,
    };
    state.privateMedia.push(media);
    state.privateMessages.push(message);
    notifyPrivateMessage(conversation, profileId, media.createdAt);
    conversation.updatedAt = media.createdAt;
    persist();
    return clone(privateMessageOutput(message));
  }

  function getPrivateMedia(mediaId, viewerProfileId) {
    const media = state.privateMedia.find(item => item.id === text(mediaId, 100));
    if (!media) return null;
    const conversation = privateConversationRecord(media.conversationId);
    if (!conversation?.memberProfileIds?.includes(text(viewerProfileId, 100))) return null;
    return clone(media);
  }

  function listPrivateMessages(conversationId, viewerProfileId, limit = 50) {
    return listPrivateMessagePage(conversationId, viewerProfileId, limit).messages;
  }

  function listPrivateMessagePage(conversationId, viewerProfileId, limit = 50, beforeId = null) {
    const conversation = privateConversationRecord(conversationId);
    if (!conversation || !conversation.memberProfileIds.includes(viewerProfileId)) throw new Error('La conversación privada no está disponible');
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const timeline = privateTimelineEntries(conversation);
    const normalizedBeforeId = optionalText(beforeId, 140);
    const foundIndex = normalizedBeforeId ? timeline.findIndex(entry => entry.id === normalizedBeforeId) : -1;
    const endIndex = foundIndex >= 0 ? foundIndex : timeline.length;
    const startIndex = Math.max(0, endIndex - safeLimit);
    const messages = timeline.slice(startIndex, endIndex).map(privateMessageOutput);
    return clone({
      messages,
      hasMore: startIndex > 0,
      nextBefore: startIndex > 0 ? messages[0]?.id || null : null,
    });
  }

  function setSavedProfile(viewerProfileId, targetProfileId, saved = true) {
    const viewer = state.profiles.find(profile => profile.id === text(viewerProfileId, 100));
    const target = state.profiles.find(profile => profile.id === text(targetProfileId, 100));
    if (!viewer) throw new Error('Tu perfil no está disponible');
    if (!target?.visible) throw new Error('Este perfil ya no está disponible');
    if (viewer.id === target.id) throw new Error('No necesitas guardar tu propio perfil');
    const savedIds = new Set(Array.isArray(viewer.savedProfileIds) ? viewer.savedProfileIds : []);
    if (saved) savedIds.add(target.id);
    else savedIds.delete(target.id);
    viewer.savedProfileIds = [...savedIds].filter(profileId => state.profiles.some(profile => profile.id === profileId && profile.visible)).slice(-500);
    viewer.updatedAt = timestamp();
    persist();
    return {saved: savedIds.has(target.id), savedProfileIds: clone(viewer.savedProfileIds)};
  }

  function createProfileAction(input = {}) {
    const senderProfileId = text(input.senderProfileId, 100);
    const targetProfileId = text(input.targetProfileId, 100);
    const sender = state.profiles.find(profile => profile.id === senderProfileId);
    const target = state.profiles.find(profile => profile.id === targetProfileId);
    const type = PROFILE_ACTION_TYPES.has(input.type) ? input.type : null;
    if (!sender) throw new Error('Tu perfil no está disponible');
    if (!sender.visible) throw new Error('Haz público tu perfil antes de conectar con otras personas');
    if (!target?.visible) throw new Error('Este perfil ya no está disponible');
    if (sender.id === target.id) throw new Error('Esta acción es para conectar con otra persona');
    if (!type) throw new Error('La interacción no es válida');
    if (type === 'touch' && !target.social?.allowMatchmaking) {
      throw new Error('Esta persona no está disponible para matchmaking');
    }
    if (type === 'room-invite' && (!sender.social?.allowMessages || !target.social?.allowMessages)) {
      throw new Error('Ambas personas deben tener Mensajes activados para enviar invitaciones');
    }
    const roomCode = type === 'room-invite' ? text(input.roomCode, 6).toUpperCase() : null;
    if (type === 'room-invite' && !ROOM_CODE.test(roomCode)) {
      throw new Error('La sala de la invitación no es válida');
    }
    if (type === 'touch') {
      const fifteenMinutesAgo = now().getTime() - 15 * 60 * 1000;
      const recentTouch = state.profileActions.some(action => action.type === 'touch'
        && action.senderProfileId === sender.id
        && action.targetProfileId === target.id
        && new Date(action.createdAt).getTime() > fifteenMinutesAgo);
      if (recentTouch) throw new Error('Ya enviaste un toque. Dale un poco de tiempo para responder.');
    }
    if (type === 'room-invite') {
      const fifteenMinutesAgo = now().getTime() - 15 * 60 * 1000;
      const recentInvite = state.profileActions.some(action => action.type === 'room-invite'
        && action.senderProfileId === sender.id
        && action.targetProfileId === target.id
        && action.roomCode === roomCode
        && new Date(action.createdAt).getTime() > fifteenMinutesAgo);
      if (recentInvite) throw new Error('Ya enviaste esta invitación hace poco.');
    }
    const giftKey = type === 'gift' && Object.prototype.hasOwnProperty.call(PROFILE_GIFTS, input.gift)
      ? input.gift
      : null;
    if (type === 'gift' && !giftKey) throw new Error('Elige un detalle disponible');
    const action = {
      id: id('profile_action'),
      senderProfileId: sender.id,
      targetProfileId: target.id,
      type,
      gift: giftKey ? {...PROFILE_GIFTS[giftKey], key: giftKey} : null,
      roomCode,
      createdAt: timestamp(),
      readAt: null,
    };
    state.profileActions.push(action);
    const directConversation = state.privateConversations.find(conversation => conversation.type === 'direct'
      && conversation.memberProfileIds.length === 2
      && conversation.memberProfileIds.includes(sender.id)
      && conversation.memberProfileIds.includes(target.id));
    if (directConversation) directConversation.updatedAt = action.createdAt;
    persist();
    return clone(action);
  }

  function listProfileActions(targetProfileId, limit = 50) {
    const normalizedTarget = text(targetProfileId, 100);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    return state.profileActions
      .filter(action => action.targetProfileId === normalizedTarget)
      .slice(-safeLimit)
      .reverse()
      .map(action => {
        const sender = state.profiles.find(profile => profile.id === action.senderProfileId);
        return {
          ...clone(action),
          sender: sender ? privateMemberSummary(sender) : {id: action.senderProfileId, displayName: 'Usuario Q Session', avatarUrl: null},
        };
      });
  }

  function markProfileActionsRead(targetProfileId, actionIds = null) {
    const normalizedTarget = text(targetProfileId, 100);
    const requestedIds = Array.isArray(actionIds)
      ? new Set(actionIds.map(actionId => text(actionId, 100)).filter(Boolean).slice(0, 100))
      : null;
    const readAt = timestamp();
    let count = 0;
    state.profileActions.forEach(action => {
      if (action.targetProfileId !== normalizedTarget || action.readAt || (requestedIds && !requestedIds.has(action.id))) return;
      action.readAt = readAt;
      count += 1;
    });
    if (count) persist();
    return {count, readAt};
  }

  function registerPushDevice(accountId, profileId, input = {}) {
    const token = text(input.token, 4096);
    const platform = input.platform === 'android' ? 'android' : null;
    if (!token || token.length < 32 || !platform) throw new Error('El dispositivo de notificaciones no es válido');
    const profile = state.profiles.find(item => item.id === profileId && item.accountId === accountId);
    if (!profile) throw new Error('Tu perfil no está disponible');
    const registeredAt = timestamp();
    state.pushDevices = state.pushDevices.filter(device => device.token !== token || device.accountId === accountId);
    let device = state.pushDevices.find(item => item.accountId === accountId && item.token === token);
    if (device) {
      device.profileId = profileId;
      device.platform = platform;
      device.updatedAt = registeredAt;
    } else {
      device = {
        id: id('push_device'),
        accountId,
        profileId,
        token,
        platform,
        createdAt: registeredAt,
        updatedAt: registeredAt,
      };
      state.pushDevices.push(device);
    }
    const accountDevices = state.pushDevices
      .filter(item => item.accountId === accountId)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    const keepIds = new Set(accountDevices.slice(0, 5).map(item => item.id));
    state.pushDevices = state.pushDevices.filter(item => item.accountId !== accountId || keepIds.has(item.id));
    persist();
    return {id: device.id, platform: device.platform, updatedAt: device.updatedAt};
  }

  function unregisterPushDevice(accountId, token) {
    const normalizedToken = text(token, 4096);
    const before = state.pushDevices.length;
    state.pushDevices = state.pushDevices.filter(device => device.accountId !== accountId || device.token !== normalizedToken);
    if (state.pushDevices.length !== before) persist();
    return {removed: before - state.pushDevices.length};
  }

  function listPushTokens(profileIds = []) {
    const requested = new Set((profileIds || []).map(value => text(value, 100)).filter(Boolean));
    return state.pushDevices
      .filter(device => requested.has(device.profileId) && device.platform === 'android')
      .map(device => device.token);
  }

  function addReport(input = {}) {
    const roomCode = text(input.roomCode, 6).toUpperCase();
    if (!ROOM_CODE.test(roomCode) || !getRoomRecord(roomCode)) throw new Error('La sala no existe');
    const report = {
      id: id('report'),
      roomCode,
      messageId: optionalText(input.messageId, 100),
      reporterProfileId: optionalText(input.reporterProfileId, 100),
      targetProfileId: optionalText(input.targetProfileId, 100),
      reason: optionalText(input.reason, 300) || 'Contenido inapropiado',
      status: 'open',
      createdAt: timestamp(),
    };
    state.reports.push(report);
    persist();
    return clone(report);
  }

  function addContentReport(input = {}) {
    const roomCode = text(input.roomCode, 6).toUpperCase();
    const room = ROOM_CODE.test(roomCode) ? getRoomRecord(roomCode) : null;
    const reporterEmail = text(input.reporterEmail, 180).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporterEmail)) throw new Error('Escribe un correo válido para responder el reporte');
    if (!optionalText(input.reporterName, 120)) throw new Error('Escribe el nombre de quien presenta el reporte');
    if (!room && !optionalText(input.contentUrl, 800)) throw new Error('Indica el código de sala o el enlace del contenido');
    if (!optionalText(input.protectedWork, 1200)) throw new Error('Identifica la obra o el contenido protegido');
    if (!optionalText(input.explanation, 3000)) throw new Error('Explica por qué consideras que existe una infracción');
    if (input.goodFaith !== true || input.accuracy !== true || !optionalText(input.signature, 160)) {
      throw new Error('Confirma las declaraciones y firma electrónicamente el reporte');
    }
    const createdAt = timestamp();
    const report = {
      id: id('copyright_report'),
      kind: 'copyright',
      roomCode: room?.code || roomCode || null,
      roomId: room?.id || null,
      targetAccountId: room?.ownerAccountId || null,
      reporterProfileId: optionalText(input.reporterProfileId, 100),
      reporterName: optionalText(input.reporterName, 120),
      reporterEmail,
      claimantRole: ['owner', 'agent'].includes(input.claimantRole) ? input.claimantRole : 'owner',
      protectedWork: optionalText(input.protectedWork, 1200),
      contentUrl: optionalText(input.contentUrl, 800),
      explanation: optionalText(input.explanation, 3000),
      goodFaith: true,
      accuracy: true,
      signature: optionalText(input.signature, 160),
      status: 'open',
      createdAt,
      updatedAt: createdAt,
      history: [{status: 'open', at: createdAt, actor: 'claimant'}],
    };
    state.reports.push(report);
    persist();
    return clone({...report, reporterEmail: reporterEmail.replace(/(^.).*(@.*$)/, '$1***$2')});
  }

  function appealContentReport(reportId, accountId, input = {}) {
    const report = state.reports.find(item => item.id === text(reportId, 120) && item.kind === 'copyright');
    if (!report) throw new Error('No encontramos ese reporte');
    if (!report.targetAccountId || report.targetAccountId !== text(accountId, 100)) throw new Error('Este reporte no corresponde a tu cuenta');
    if (!optionalText(input.explanation, 3000) || !optionalText(input.signature, 160) || input.goodFaith !== true) {
      throw new Error('Explica la apelación, confirma tu buena fe y firma electrónicamente');
    }
    const createdAt = timestamp();
    const appeal = {
      id: id('copyright_appeal'), reportId: report.id, accountId: report.targetAccountId,
      explanation: optionalText(input.explanation, 3000), evidenceUrl: optionalText(input.evidenceUrl, 800),
      signature: optionalText(input.signature, 160), goodFaith: true, status: 'open', createdAt,
    };
    state.contentAppeals.push(appeal);
    report.status = 'appealed';
    report.updatedAt = createdAt;
    report.history.push({status: 'appealed', at: createdAt, actor: 'host'});
    persist();
    return clone(appeal);
  }

  function listContentReports() {
    return clone(state.reports.filter(report => report.kind === 'copyright')
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(report => ({...report, appeals: state.contentAppeals.filter(appeal => appeal.reportId === report.id)})));
  }

  function moderateContentReport(reportId, input = {}) {
    const report = state.reports.find(item => item.id === text(reportId, 120) && item.kind === 'copyright');
    if (!report) throw new Error('No encontramos ese reporte');
    const decision = ['reviewing', 'dismissed', 'upheld', 'restored'].includes(input.decision) ? input.decision : null;
    if (!decision) throw new Error('Elige una decisión válida');
    const at = timestamp();
    report.status = decision;
    report.updatedAt = at;
    report.resolutionNote = optionalText(input.note, 1200);
    report.history.push({status: decision, at, actor: optionalText(input.administrator, 100) || 'administrator'});
    const affectedRoomCodes = [];
    if (decision === 'upheld' && !state.enforcementActions.some(action => action.reportId === report.id && action.status === 'active')) {
      const room = report.roomCode ? state.rooms.find(item => item.code === report.roomCode) : null;
      if (room && room.status !== 'archived') {
        room.status = 'archived'; room.endedAt = at; affectedRoomCodes.push(room.code);
      }
      state.enforcementActions.push({id: id('enforcement'), reportId: report.id, accountId: report.targetAccountId, roomCode: report.roomCode, type: 'copyright-strike', status: 'active', createdAt: at});
      const strikes = state.enforcementActions.filter(action => action.accountId && action.accountId === report.targetAccountId && action.type === 'copyright-strike' && action.status === 'active').length;
      if (strikes >= 3) {
        const account = state.accounts.find(item => item.id === report.targetAccountId && item.status === 'active');
        if (account) { account.status = 'suspended'; account.updatedAt = at; account.suspendedAt = at; }
        state.sessions = state.sessions.filter(session => session.accountId !== report.targetAccountId);
        state.rooms.filter(item => item.ownerAccountId === report.targetAccountId && item.status !== 'archived').forEach(item => {
          item.status = 'archived'; item.endedAt = at; affectedRoomCodes.push(item.code);
        });
      }
    }
    if ((decision === 'dismissed' || decision === 'restored')) {
      state.enforcementActions.filter(action => action.reportId === report.id && action.status === 'active').forEach(action => { action.status = 'reversed'; action.reversedAt = at; });
      const remainingStrikes = state.enforcementActions.filter(action => action.accountId && action.accountId === report.targetAccountId && action.type === 'copyright-strike' && action.status === 'active').length;
      const account = state.accounts.find(item => item.id === report.targetAccountId && item.status === 'suspended');
      if (account && remainingStrikes < 3) {
        account.status = 'active';
        account.updatedAt = at;
        delete account.suspendedAt;
      }
    }
    persist();
    const activeStrikes = state.enforcementActions.filter(action => action.accountId && action.accountId === report.targetAccountId && action.type === 'copyright-strike' && action.status === 'active').length;
    return clone({report, affectedRoomCodes: [...new Set(affectedRoomCodes)], activeStrikes});
  }

  function exportAccountData(accountId) {
    const account = state.accounts.find(item => item.id === accountId && item.status === 'active');
    if (!account) throw new Error('La cuenta no está disponible');
    const profile = profileForAccount(accountId);
    const profileId = profile?.id || null;
    const rooms = state.rooms.filter(room => room.ownerAccountId === accountId).map(room => {
      const safeRoom = clone(room);
      delete safeRoom.passwordHash;
      return safeRoom;
    });
    const conversationIds = new Set(state.privateConversations
      .filter(conversation => profileId && conversation.memberProfileIds.includes(profileId))
      .map(conversation => conversation.id));
    return {
      generatedAt: timestamp(),
      account: safeAccount(account),
      profile: ownProfile(profile),
      activeSessions: clone(state.sessions.filter(session => session.accountId === accountId).map(session => ({
        id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt,
      }))),
      rooms,
      stories: clone(state.stories.filter(story => story.accountId === accountId)),
      profileMedia: clone(state.media.filter(media => media.accountId === accountId).map(media => ({
        ...media, url: `/api/profile-media/${media.id}`,
      }))),
      promotionMedia: clone(state.promotionMedia.filter(media => media.accountId === accountId)),
      roomMessages: clone(state.messages.filter(message => profileId && message.profileId === profileId)),
      privateConversations: clone(state.privateConversations.filter(conversation => conversationIds.has(conversation.id))),
      privateMessages: clone(state.privateMessages.filter(message => profileId && message.profileId === profileId)),
      privateMedia: clone(state.privateMedia.filter(media => profileId && media.profileId === profileId)),
      profileActions: clone(state.profileActions.filter(action => profileId
        && (action.senderProfileId === profileId || action.targetProfileId === profileId))),
      pushDevices: clone(state.pushDevices.filter(device => device.accountId === accountId).map(device => ({
        id: device.id, platform: device.platform, createdAt: device.createdAt, updatedAt: device.updatedAt,
      }))),
      reports: clone(state.reports.filter(report => (profileId
        && (report.reporterProfileId === profileId || report.targetProfileId === profileId))
        || report.targetAccountId === accountId).map(report => ({
          ...report,
          reporterEmail: report.reporterEmail
            ? report.reporterEmail.replace(/(^.).*(@.*$)/, '$1***$2')
            : undefined,
        }))),
      contentAppeals: clone(state.contentAppeals.filter(appeal => appeal.accountId === accountId)),
      enforcementActions: clone(state.enforcementActions.filter(action => action.accountId === accountId)),
    };
  }

  function deleteAccount(accountId, password) {
    const account = state.accounts.find(item => item.id === accountId && item.status === 'active');
    if (!account || !passwordMatches(password, account.passwordHash, authPepper)) {
      throw new Error('La contraseña no coincide');
    }
    const profile = profileForAccount(accountId);
    const profileId = profile?.id || null;
    const profileMedia = state.media.filter(media => media.accountId === accountId);
    const promotionMedia = state.promotionMedia.filter(media => media.accountId === accountId);
    const privateMedia = state.privateMedia.filter(media => profileId && media.profileId === profileId);
    const privateMediaIds = new Set(privateMedia.map(media => media.id));
    const deletedRoomIds = state.rooms.filter(room => room.ownerAccountId === accountId).map(room => room.id);
    const deletedRoomCodes = new Set(state.rooms.filter(room => room.ownerAccountId === accountId).map(room => room.code));
    const deletedAt = timestamp();

    state.sessions = state.sessions.filter(session => session.accountId !== accountId);
    state.passwordRecoveries = state.passwordRecoveries.filter(recovery => recovery.accountId !== accountId);
    state.pushDevices = state.pushDevices.filter(device => device.accountId !== accountId);
    state.rooms = state.rooms.filter(room => room.ownerAccountId !== accountId);
    state.stories = state.stories.filter(story => story.accountId !== accountId);
    state.media = state.media.filter(media => media.accountId !== accountId);
    state.promotionMedia = state.promotionMedia.filter(media => media.accountId !== accountId);
    state.messages = state.messages.filter(message => (!profileId || message.profileId !== profileId)
      && !deletedRoomCodes.has(message.roomCode));
    state.privateMedia = state.privateMedia.filter(media => !privateMediaIds.has(media.id));
    state.privateMessages = state.privateMessages.map(message => {
      if (!profileId || message.profileId !== profileId) return message;
      const redacted = {...message, kind: 'notice', text: 'Mensaje eliminado'};
      delete redacted.mediaId;
      return redacted;
    });
    state.profileActions = state.profileActions.filter(action => !profileId
      || (action.senderProfileId !== profileId && action.targetProfileId !== profileId));
    state.privateChatInvitations = state.privateChatInvitations.filter(invitation => !profileId
      || (invitation.creatorProfileId !== profileId && invitation.acceptedByProfileId !== profileId));
    state.profiles.forEach(item => {
      item.savedProfileIds = (item.savedProfileIds || []).filter(savedId => savedId !== profileId);
    });
    state.reports.forEach(report => {
      if (report.reporterProfileId === profileId) report.reporterProfileId = null;
      if (report.targetProfileId === profileId) report.targetProfileId = null;
    });

    if (profile) {
      Object.assign(profile, {
        accountId: null,
        displayName: 'Cuenta eliminada',
        role: 'listener',
        avatarUrl: null,
        photos: [],
        city: null,
        country: null,
        bio: null,
        musicGenres: [],
        savedProfileIds: [],
        social: {
          allowMatchmaking: false, allowMessages: false, showResidence: false,
          shareApproximateLocation: false, allowDjContact: false, allowTips: false,
        },
        visible: false,
        globalRaveCountryCode: null,
        deletedAt,
        updatedAt: deletedAt,
      });
      delete profile.editTokenHash;
    }
    account.email = `deleted+${securityTokenHash(account.id, authPepper).slice(0, 16)}@deleted.qsession.invalid`;
    account.passwordHash = hashPassword(crypto.randomBytes(32).toString('base64url'), authPepper);
    account.emailVerified = false;
    account.status = 'deleted';
    account.deletedAt = deletedAt;
    account.updatedAt = deletedAt;
    persist();
    return {
      accountId,
      profileId,
      deletedAt,
      deletedRoomIds,
      profileMedia: clone(profileMedia),
      privateMedia: clone(privateMedia),
      promotionMedia: clone(promotionMedia),
    };
  }

  function snapshot() {
    return clone(state);
  }

  return {
    createEvent,
    listEvents,
    getEvent,
    createRoomRecord,
    getRoomRecord,
    getRoomRecordById,
    listPublicRooms,
    listHostedRooms,
    roomPasswordIsValid,
    updateRoomRecord,
    updateRoomConfiguration,
    recordJoin,
    recordRoomActivity,
    archiveRoom,
    deleteHostedRoom,
    createAccount,
    authenticateAccount,
    createPasswordRecovery,
    cancelPasswordRecovery,
    resetAccountPassword,
    createSession,
    authenticateSession,
    revokeSession,
    updateAccountProfile,
    setGlobalRaveCountry,
    clearGlobalRaveCountry,
    globalRavePresenceForAccount,
    addProfileMedia,
    getProfileMedia,
    profileMediaIsPublic,
    addPromotionMedia,
    getPromotionMedia,
    promotionMediaIsPublic,
    createStory,
    deleteStory,
    activeStories,
    getPublicProfile,
    upsertProfile,
    getProfile,
    profileIsOwned,
    addMessage,
    listMessages,
    listPrivateContacts,
    listRelatedProfiles,
    createPrivateChatInvitation,
    redeemPrivateChatInvitation,
    createPrivateConversation,
    listPrivateConversations,
    getPrivateConversation,
    addPrivateMessage,
    addPrivateMediaMessage,
    notifyPrivateCall,
    getPrivateMedia,
    listPrivateMessages,
    listPrivateMessagePage,
    setSavedProfile,
    createProfileAction,
    listProfileActions,
    markProfileActionsRead,
    registerPushDevice,
    unregisterPushDevice,
    listPushTokens,
    addReport,
    addContentReport,
    appealContentReport,
    listContentReports,
    moderateContentReport,
    exportAccountData,
    deleteAccount,
    snapshot,
    safePublicProfile: publicProfile,
  };
}

module.exports = {createProductStore, safePublicProfile, hashPassword, passwordMatches};
