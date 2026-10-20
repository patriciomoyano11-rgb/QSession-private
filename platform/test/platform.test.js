'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createQsessionServer, liveRoomActivityFromParticipants, roomChatPresenceFromParticipants} = require('../server');
const {createGlobalRavePresenceStore} = require('../global-rave-presence');
const qsessionI18n = require('../public/i18n');
const {syntheticAdmissions} = require('./fixtures/broadcast-admissions.cjs');

test('Q Session detecta y traduce el idioma del dispositivo con preferencia manual', () => {
  assert.equal(qsessionI18n.normalizeLocale('es-CO'), 'es');
  assert.equal(qsessionI18n.normalizeLocale('en-US'), 'en');
  assert.equal(qsessionI18n.normalizeLocale('de-DE'), 'de');
  assert.equal(qsessionI18n.normalizeLocale('de-CH'), 'de');
  assert.equal(qsessionI18n.resolveLocale('auto', ['de-AT', 'en']), 'de');
  assert.equal(qsessionI18n.resolveLocale('en', ['de-DE']), 'en');
  assert.equal(qsessionI18n.resolveLocale('auto', ['fr-FR']), 'en');
  assert.equal(qsessionI18n.translateCore('Crear sala', 'en'), 'Create room');
  assert.equal(qsessionI18n.translateCore('Crear sala', 'de'), 'Raum erstellen');
  assert.equal(qsessionI18n.translateCore('Tu sesión,', 'de'), 'Deine Session,');
  assert.equal(qsessionI18n.translateCore('Tu música en vivo,', 'en'), 'Your live music,');
  assert.equal(qsessionI18n.translateCore('en cada teléfono.', 'de'), 'auf jedem Smartphone.');
  assert.equal(qsessionI18n.translateCore('4 personas', 'de'), '4 Personen');
  assert.equal(qsessionI18n.translateCore('Cámara frontal principal', 'en'), 'Main front camera');
  assert.equal(qsessionI18n.translateCore('Cámara trasera 2', 'de'), 'Rückkamera 2');
  assert.equal(qsessionI18n.translateCore('Evento profesional', 'en'), 'Professional event');
  assert.equal(qsessionI18n.translateCore('Experiencia privada', 'de'), 'Privates Erlebnis');
  assert.equal(qsessionI18n.translateCore('TIPO DE SESIÓN', 'en'), 'SESSION TYPE');
  assert.equal(qsessionI18n.translateCore('Solo con acceso compartido.', 'de'), 'Nur über einen geteilten Zugang.');
  assert.equal(qsessionI18n.translateCore('Elige el comienzo', 'en'), 'Choose the start time');
  assert.equal(qsessionI18n.translateCore('Mañana', 'de'), 'Morgen');
  assert.equal(qsessionI18n.translateCore('CHAT ACTIVO AHORA', 'en'), 'ACTIVE CHAT NOW');
  assert.equal(qsessionI18n.translateCore('3 personas activas ahora', 'de'), '3 Personen jetzt aktiv');
  assert.equal(qsessionI18n.translateCore('3 personas conectadas', 'en'), '3 people connected');
  assert.equal(qsessionI18n.translateCore('Personas y contactos', 'de'), 'Personen und Kontakte');
  assert.equal(qsessionI18n.translateCore('te invitó al chat de la sala ABC123.', 'en'), 'invited you to the chat in room ABC123.');
  assert.equal(qsessionI18n.translateCore('Eliminar sesión', 'en'), 'Delete session');
  assert.equal(qsessionI18n.translateCore('Finalizar y eliminar', 'de'), 'Beenden und löschen');
  assert.equal(qsessionI18n.translateCore('Compartir invitación', 'en'), 'Share invitation');
  assert.equal(qsessionI18n.translateCore('Copiar invitación', 'de'), 'Einladung kopieren');
  assert.equal(qsessionI18n.translateCore('Salir de la sala', 'en'), 'Leave the room');
  assert.equal(qsessionI18n.translateCore('Salir de la sala', 'de'), 'Raum verlassen');
  assert.equal(qsessionI18n.translateCore('Suave', 'en'), 'Soft');
  assert.equal(qsessionI18n.translateCore('Suave', 'de'), 'Sanft');
  assert.equal(qsessionI18n.translateCore('Chat grupal', 'en'), 'Group chat');
  assert.equal(qsessionI18n.translateCore('Chat de la sala', 'de'), 'Raum-Chat');
  assert.equal(qsessionI18n.translateCore('Todas las aplicaciones', 'de'), 'Alle Apps');
  assert.equal(qsessionI18n.translateCore('Habla sobre la transmisión', 'en'), 'Speak over the broadcast');
  assert.equal(qsessionI18n.translateCore('Ajustes de voz', 'de'), 'Stimmeinstellungen');
  assert.equal(qsessionI18n.translateCore('Seleccionar fuente de audio', 'en'), 'Select audio source');
  assert.equal(qsessionI18n.translateCore('Micrófono inalámbrico conectado.', 'de'), 'Verbundenes drahtloses Mikrofon.');
});

async function startPlatform(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-test-'));
  const liveRoomActivity = new Map();
  const roomChatParticipants = new Map();
  const closedLiveRooms = [];
  const replacedDesktopAudioRooms = [];
  const app = createQsessionServer({
    port: 0,
    dataFile: path.join(directory, 'state.json'),
    mediaDirectory: path.join(directory, 'media'),
    privateMediaDirectory: path.join(directory, 'private-media'),
    promotionMediaDirectory: path.join(directory, 'promotion-media'),
    publicUrl: 'https://qsession.org',
    livekitUrl: 'wss://media.qsession.org',
    livekitApiKey: 'test-key',
    livekitApiSecret: 'test-secret-with-enough-entropy',
    roomSecret: 'room-secret-with-enough-entropy',
    authPepper: 'auth-pepper-with-enough-entropy',
    publicRoomsEnabled: true,
    publicDirectoryCacheMs: 0,
    liveRoomActivityProvider: async rooms => new Map(rooms
      .filter(room => liveRoomActivity.has(room.code))
      .map(room => [room.code, liveRoomActivity.get(room.code)])),
    roomChatPresenceProvider: async (room, auth) => {
      const activeAccountIds = roomChatParticipants.get(room.code) || new Set();
      return {active: activeAccountIds.has(auth.account.id), participantCount: activeAccountIds.size};
    },
    closeLiveRoomProvider: async room => {
      closedLiveRooms.push(`qsession-${room.code}`);
      liveRoomActivity.delete(room.code);
    },
    replaceDesktopAudioProvider: async code => {
      replacedDesktopAudioRooms.push(`qsession-${code}`);
      return [];
    },
    ...overrides,
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  return {
    ...app,
    baseUrl,
    setLiveRoomActivity: (code, activity) => {
      if (activity) liveRoomActivity.set(code, activity);
      else liveRoomActivity.delete(code);
    },
    setRoomChatParticipants: (code, accountIds = []) => {
      roomChatParticipants.set(code, new Set(accountIds));
    },
    closedLiveRooms,
    replacedDesktopAudioRooms,
    close: async () => {
      await new Promise(resolve => app.server.close(resolve));
      fs.rmSync(directory, {recursive: true, force: true});
    },
  };
}

test('el directorio en vivo exige un anfitrión conectado con audio activo', () => {
  assert.equal(liveRoomActivityFromParticipants([
    {identity: 'listener-1', state: 'ACTIVE', tracks: []},
  ]), null);
  assert.equal(liveRoomActivityFromParticipants([
    {identity: 'dj-1', state: 'ACTIVE', tracks: [{type: 'AUDIO', source: 'MICROPHONE', muted: true}]},
  ]), null);
  assert.deepEqual(liveRoomActivityFromParticipants([
    {identity: 'dj-1', state: 'ACTIVE', tracks: [{type: 'AUDIO', source: 'SCREEN_SHARE_AUDIO', muted: false}, {type: 'VIDEO', source: 'CAMERA', muted: false}]},
    {identity: 'listener-1', state: 'ACTIVE', tracks: []},
  ]), {participantCount: 2, listenerCount: 1, listenerAccountIds: ['1'], audioLive: true, cameraLive: true});
});

test('la presencia del chat corresponde a la cuenta conectada en esa sala', () => {
  const participants = [
    {identity: 'dj-account_host', state: 'ACTIVE'},
    {identity: 'listener-account_patricio', state: 'ACTIVE'},
    {identity: 'listener-temporal', state: 'ACTIVE', metadata: JSON.stringify({profileId: 'profile_maria'})},
    {identity: 'listener-account_old', state: 'DISCONNECTED'},
  ];
  assert.deepEqual(roomChatPresenceFromParticipants(participants, 'account_patricio'), {active: true, participantCount: 3});
  assert.deepEqual(roomChatPresenceFromParticipants(participants, 'account_maria', 'profile_maria'), {active: true, participantCount: 3});
  assert.deepEqual(roomChatPresenceFromParticipants(participants, 'account_other'), {active: false, participantCount: 3});
});

test('Rave global conserva sólo el país, limita los indicadores y separa perfiles públicos de privados', () => {
  const presence = createGlobalRavePresenceStore({ttlMs: 30_000, secret: 'global-rave-test-secret'});
  for (let index = 0; index < 30; index += 1) {
    presence.update({
      accountId: `account-${index}`,
      countryCode: 'CO',
      roomCode: 'ABC123',
      profileVisible: index === 0,
      publicName: index === 0 ? 'Bailarina pública' : '',
    }, 1000);
  }
  const snapshot = presence.snapshot(2000);
  assert.equal(snapshot.total, 30);
  assert.equal(snapshot.activeCountries, 1);
  assert.equal(snapshot.maxPointsPerCountry, 25);
  assert.equal(snapshot.countries[0].code, 'CO');
  assert.equal(snapshot.countries[0].count, 30);
  assert.equal(snapshot.countries[0].points.length, 25);
  assert.deepEqual(snapshot.countries[0].points[0], {});
  assert.deepEqual(snapshot.countries[0].publicPeople, ['Bailarina pública']);
  assert.equal(snapshot.countries[0].privateCount, 29);
  assert.equal('latitude' in snapshot.countries[0].points[0], false);
  assert.equal('longitude' in snapshot.countries[0].points[0], false);
  assert.equal(presence.snapshot(31_001).total, 0);
});

async function jsonRequest(url, {method = 'GET', body, cookie} = {}) {
  const requestBody = body;
  const response = await fetch(url, {
    method,
    headers: {
      ...(requestBody ? {'Content-Type': 'application/json'} : {}),
      ...(cookie ? {Cookie: cookie} : {}),
    },
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
  return {response, payload: await response.json()};
}

async function registerTestCreator(app, {
  email = 'creator@example.com',
  displayName = 'DJ Prueba',
  role = 'dj',
} = {}) {
  const registration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
    method: 'POST',
    body: {email, password: 'password-segura-123', displayName, role},
  });
  assert.equal(registration.response.status, 201);
  return {
    ...registration.payload,
    cookie: registration.response.headers.get('set-cookie').split(';')[0],
  };
}

function jwtPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

test('Q Session ofrece biblioteca musical sin dependencia de una LAN', async () => {
  const app = await startPlatform();
  try {
    const status = await (await fetch(`${app.baseUrl}/api/status`)).json();
    assert.equal(status.product, 'Q Session');
    assert.equal(status.globalNetwork, true);
    assert.equal(status.publicUrl, 'https://qsession.org');
    assert.equal(status.media.url, 'wss://media.qsession.org');
    assert.equal(status.media.turnRequired, true);
    assert.equal(status.version, '0.1.4');
    assert.equal(status.features.roomParticipants, true);
    assert.equal(status.features.privateChats, true);
    assert.equal(status.features.privateChat, true);
    assert.equal(status.features.privateMedia, true);
    assert.equal(status.features.privateGroupVoice, true);
    assert.equal(status.features.privateContactInvites, true);
    assert.equal(status.features.musicDatabase, true);
    assert.equal(status.features.autopilot, true);
    assert.equal(status.features.unattendedAutopilot, false);
    assert.equal('lanUrls' in status, false);

    const home = await (await fetch(app.baseUrl)).text();
    assert.match(home, /Q Session/);
    assert.doesNotMatch(home, /PERSONAS · IMAGEN · SONIDO · UNA RED QUE NOS UNE/);
    assert.doesNotMatch(home, /UNA SEÑAL · CUALQUIER RED · CUALQUIER PAÍS/);
    assert.match(home, /Tu sesión,<br \/><span>todos conectados\.<\/span>/);
    assert.match(home, /class="home-use-cases-spacer" aria-hidden="true"><\/div>/);
    assert.match(home, /class="home-purpose-footer">Q Session convierte cada teléfono en un receptor audiovisual en vivo\.<\/p>/);
    assert.ok(home.indexOf('home-use-cases-spacer') < home.indexOf('home-purpose-footer'));
    assert.doesNotMatch(home, /class="home-purpose-flow"/);
    assert.doesNotMatch(home, /Entra, escucha y comparte el momento, estés donde estés\./);
    assert.doesNotMatch(home, /sin depender del mismo Wi‑Fi que el DJ/);
    assert.match(home, /id="homeJoinAction"[^>]*data-home-session-action="join"[^>]*aria-controls="homeJoinPanel"/);
    assert.match(home, /id="homeCreateAction"[^>]*data-home-session-action="create"[^>]*aria-controls="homeCreatePanel"/);
    assert.match(home, /id="homeJoinPanel"[^>]*class="home-session-panel"[^>]*hidden/);
    assert.match(home, /id="homeCreatePanel"[^>]*class="home-session-panel home-create-panel"[^>]*hidden/);
    assert.match(home, /id="quickLiveRoomsMenu"[^>]*class="quick-live-rooms-menu"/);
    assert.doesNotMatch(home, /id="quickLiveRoomsMenu"[^>]*(?:hidden|aria-hidden="true")/);
    assert.match(home, /id="publicRoomDirectory"[^>]*class="public-room-directory"[^>]*aria-labelledby="publicRoomsTitle">/);
    assert.match(home, /id="quickLiveRoomsList"[^>]*class="quick-live-rooms-list"/);
    assert.match(home, /class="home-session-action-icon"[^>]*>→<\/span>[\s\S]*?<strong>Entrar a una sala<\/strong><small>Código, enlace o QR<\/small>/);
    assert.match(home, /class="home-session-action-icon"[^>]*>＋<\/span>[\s\S]*?<strong>Crear una sala<\/strong><small>Requiere perfil e inicio de sesión<\/small>/);
    assert.match(home, /class="room-code-control"[\s\S]*?id="roomCode"[\s\S]*?type="submit">Entrar/);
    assert.doesNotMatch(home, /createRoomShortcut|inline-create-action/);
    assert.match(home, /PARA QUIENES CREAN Y CONECTAN/);
    assert.match(home, /Crear una sala pública o privada/);
    assert.match(home, /Privada: solo con acceso compartido/);
    assert.match(home, /Pública: todos pueden verla/);
    assert.match(home, /Crea la sesión,/);
    assert.match(home, /comparte y conecta\./);
    assert.doesNotMatch(home, /Después, sal en vivo\./);
    assert.match(home, /Reúne a tu comunidad con imagen, sonido y conversación en vivo/);
    assert.match(home, /Ideal para clases, bienestar, hoteles, música y eventos/);
    assert.doesNotMatch(home, /PARA DJs Y ORGANIZADORES/);
    assert.doesNotMatch(home, /La transmisión comenzará únicamente cuando pulses/);
    assert.match(home, /id="languageTrigger"[^>]*aria-label="Cambiar idioma"[^>]*aria-haspopup="listbox"/);
    assert.match(home, /id="languageMenu"[^>]*role="listbox"/);
    assert.match(home, /data-language-option="es"/);
    assert.match(home, /data-language-option="en"/);
    assert.match(home, /data-language-option="de"/);
    assert.doesNotMatch(home, /<option value="auto">/);
    assert.match(home, /id="languageSelector"[^>]*aria-label="Idioma de la aplicación"/);
    assert.doesNotMatch(home, /class="world-art"/);
    assert.match(home, /\/styles\.css\?v=20261018-event-capacity-v1/);
    assert.match(home, /¡Conoce y recompensa!/);
    assert.match(home, /Las estrellas de cada anuncio van para tu artista elegido\. Él ha seleccionado estos anuncios para ti\./);
    assert.match(home, /\/i18n\.js\?v=20261003-public-rooms-v1/);
    assert.match(home, /\/analytics\.js\?v=20260910-admin-v1/);
    assert.match(home, /\/camera-effects\.js\?v=20261018-camera-clock-v4/);
    assert.match(home, /\/data\/world-countries\.js\?v=20261016-vision-map-v2/);
    assert.match(home, /\/vendor\/hls\.min\.js/);
    assert.match(home, /\/music-library\.css\?v=20261008-live-dj-v1/);
    assert.match(home, /\/qsession-sky-palette\.css\?v=20261016-sky-palette-v1/);
    assert.match(home, /\/dj-mixer\.js\?v=20261016-autodj-calibration-v2/);
    assert.match(home, /\/music-library\.js\?v=20261016-autodj-calibration-v2/);
    assert.match(home, /\/app\.js\?v=20261020-runtime-reconciled-v1/);
    assert.doesNotMatch(home, /id="musicRightsDeclaration"/);
    assert.doesNotMatch(home, /id="musicRightsAccepted"/);
    assert.match(home, /id="customQuoteDialog"/);
    assert.match(home, /id="customQuoteOpen"/);
    assert.match(home, /class="creator-command-deck"/);
    assert.match(home, /<details id="creatorBillingPanel"[^>]*data-creator-command/);
    assert.match(home, /<details id="roomTypePanel"[^>]*data-creator-command/);
    assert.match(home, /id="roomTypeSummaryState"[^>]*>Privada · 5 funciones/);
    const hlsClient = await fetch(`${app.baseUrl}/vendor/hls.min.js`);
    assert.equal(hlsClient.status, 200);
    assert.match(hlsClient.headers.get('content-type') || '', /javascript/);
    assert.ok((await hlsClient.text()).length > 100_000);
    assert.match(home, /id="privateContactInvite"/);
    assert.match(home, /id="privateContactInviteDialog"/);
    assert.match(home, /id="flowerWalletPanel"/);
    assert.match(home, /id="personGiftChoices"[^>]*person-flower-choices/);
    assert.match(home, /id="openPublicChatMic"/);
    assert.match(home, /id="publicChatPushToTalk"/);
    assert.doesNotMatch(home, /id="togglePublicChatCamera"/);
    assert.match(home, /la cámara no está disponible en la sala general/);
    assert.match(home, /id="globalRaveMap"[^>]*viewBox="0 0 1000 500"/);
    assert.match(home, /id="globalRaveCountries"/);
    assert.match(home, /id="globalRaveMicrostates"/);
    assert.match(home, /id="globalRaveCapitals"/);
    assert.match(home, /id="globalRavePresencePoints"/);
    assert.match(home, /id="globalMapZoomIn"/);
    assert.match(home, /id="globalCountryPanel"/);
    assert.match(home, /Máximo 25 indicadores por país/);
    assert.match(home, /id="cameraEffectsControl"/);
    assert.match(home, /data-camera-effect="qfauna"/);
    assert.doesNotMatch(home, /Una cuenta para todos tus dispositivos|Elige DJ u oyente|Tú decides si el perfil es público/);
    assert.match(home, /id="appVersionLabel"[^>]*class="app-version-label"[^>]*data-i18n-ignore[^>]*>[\s\S]*Q Session Web · v0\.1\.4/);
    assert.match(home, /id="breakingRaveSignature"[^>]*class="breaking-rave-signature"[^>]*data-i18n-ignore[^>]*>BREAKING RAVE<\/p>/);
    assert.match(home, /id="view-vision"[^>]*data-view-panel="vision"/);
    assert.match(home, /Baila, libera y conecta/);
    assert.match(home, /Usa el baile como terapia/);
    assert.match(home, /id="visionWorldCountries"/);
    assert.match(home, /class="vision-world-fallback"/);
    assert.match(home, /AUDIO GLOBAL EN VIVO/);
    assert.match(home, /Una persona transmite\. Todos lo viven/);
    assert.match(home, /class="vision-system-stage"/);
    assert.match(home, /class="vision-system-hub"/);
    assert.match(home, /class="vision-system-receivers"/);
    assert.match(home, /MUCHO MÁS QUE UNA FIESTA/);
    assert.match(home, /Yoga y meditación/);
    assert.match(home, /Q Session es infraestructura para compartir presencia/);
    assert.doesNotMatch(home, /Mientras estés conectado, aquí se abrirá/);
    assert.match(home, /id="stopBroadcast"[^>]*class="close-session-button"[^>]*aria-haspopup="dialog"[^>]*aria-controls="confirmationDialog"[^>]*>[\s\S]*Cerrar sesión[\s\S]*requiere confirmación/);
    assert.doesNotMatch(home, /id="stopBroadcast"[^>]*control-danger/);
    assert.match(home, /id="hostSessionDangerZone"[^>]*class="host-session-danger-zone"[^>]*hidden/);
    assert.ok(home.indexOf('id="stopBroadcast"') > home.indexOf('id="connectionMonitor"'));
    assert.match(home, /id="copyRoomInvite"[^>]*>[^<]*[\s\S]*Copiar invitación/);
    assert.match(home, /id="shareRoomInvite"[^>]*aria-controls="roomShareMenu"/);
    assert.match(home, /id="roomShareMenu"[^>]*role="dialog"[^>]*hidden/);
    assert.match(home, /id="nativeShareRoom"[^>]*data-room-share="native"/);
    assert.match(home, /data-room-share="whatsapp"/);
    assert.match(home, /data-room-share="telegram"/);
    assert.match(home, /data-room-share="email"/);
    assert.match(home, /data-room-share="sms"/);
    assert.match(home, /id="copyRoomCode"[^>]*data-room-share="copy-code"/);
    assert.match(home, /id="copyRoomLink"[^>]*data-room-share="copy-link"/);
    assert.match(home, /id="listenerRoomInvite"[^>]*class="listener-room-invite"/);
    assert.match(home, /id="copyListenerRoomInvite"[^>]*aria-label="Copiar invitación"/);
    assert.match(home, /id="shareListenerRoomInvite"[^>]*aria-controls="listenerRoomShareMenu"/);
    assert.match(home, /id="listenerRoomShareMenu"[^>]*role="menu"[^>]*hidden/);
    assert.match(home, /data-listener-room-share="whatsapp"/);
    assert.match(home, /data-listener-room-share="telegram"/);
    assert.match(home, /data-listener-room-share="email"/);
    assert.doesNotMatch(home, /class="listener-room-check"/);
    assert.match(home, /id="sessionHistoryPanel"/);
    assert.match(home, /id="sessionHistoryList"/);
    assert.doesNotMatch(home, /network-state|Red mundial/);
    assert.match(home, /id="roomType"/);
    assert.match(home, /id="roomTypeTrigger"[^>]*aria-haspopup="listbox"/);
    assert.match(home, /id="roomTypeMenu"[^>]*role="listbox"/);
    assert.match(home, /data-room-type-value="music"/);
    assert.match(home, /<option value="yoga-meditation">Yoga y meditación<\/option>/);
    assert.match(home, /<option value="conference">Conferencia<\/option>/);
    assert.match(home, /<option value="wedding">Boda<\/option>/);
    assert.match(home, /<option value="birthday">Cumpleaños<\/option>/);
    assert.match(home, /<option value="baby-shower">Baby shower<\/option>/);
    assert.doesNotMatch(home, /data-room-type-value="(?:party|class|professional|networking|private-experience)"/);
    assert.match(home, /Funciones de la sala/);
    assert.match(home, /data-room-config-menu/);
    assert.match(home, /id="conferenceOptionsMenu"[^>]*hidden/);
    assert.match(home, /Cámaras de usuarios/);
    assert.match(home, /Perfiles visibles/);
    assert.match(home, /Matchmaking abierto/);
    assert.match(home, /name="roomVisibilityChoice" value="public"/);
    assert.match(home, /name="roomVisibilityChoice" value="private" checked/);
    assert.match(home, /¿Quién puede encontrarla\?/);
    assert.match(home, /Contenido preparado para una audiencia pública\./);
    assert.match(home, /biblioteca original de Qsession/);
    assert.match(home, /id="sessionScheduledAt"[^>]*type="datetime-local"/);
    assert.match(home, /id="sessionScheduledDate"[^>]*type="date"/);
    assert.match(home, /id="sessionScheduledTime"[^>]*type="time"/);
    assert.match(home, /data-schedule-day-offset="0"[^>]*>Hoy<\/button>/);
    assert.match(home, /data-schedule-day-offset="1"[^>]*>Mañana<\/button>/);
    assert.match(home, /id="sessionSchedulePreview"[^>]*aria-live="polite"/);
    assert.match(home, /id="roomCapacity"[^>]*type="number"/);
    assert.match(home, /id="roomPromotionTitle"[^>]*>Patrocinadores y promociones/);
    assert.match(home, /id="promotionSponsor"/);
    assert.match(home, /id="promotionHeadline"/);
    assert.match(home, /id="promotionLink"[^>]*type="url"/);
    assert.match(home, /id="promotionMediaInput"[^>]*type="file"/);
    assert.match(home, /id="roomPromotions"[^>]*hidden/);
    assert.match(home, /id="roomPasswordEnabled"[^>]*type="checkbox"/);
    assert.match(home, /id="allowRoomChat"[^>]*type="checkbox"[^>]*checked/);
    assert.match(home, /id="allowGuestCameras"[^>]*type="checkbox"[^>]*checked/);
    assert.match(home, /id="allowRoomSocialProfiles"[^>]*type="checkbox"[^>]*checked/);
    assert.match(home, /id="allowRoomMatchmaking"[^>]*type="checkbox"[^>]*checked/);
    assert.match(home, /id="allowRoomProfileGifts"[^>]*type="checkbox"[^>]*checked/);
    assert.match(home, /id="roomPasswordDialog"/);
    assert.match(home, /id="chatReady"/);
    assert.match(home, /id="privateChatPanel"/);
    assert.match(home, /id="publicChatPanel"/);
    assert.match(home, /data-chat-mode="private"/);
    assert.match(home, /data-chat-mode="group"/);
    assert.match(home, /data-chat-mode="public"/);
    assert.match(home, /id="privateChatTab"[\s\S]*Chat privado[\s\S]*id="groupChatShortcut"[\s\S]*Chat grupal[\s\S]*id="publicChatTab"[\s\S]*Chat de la sala/);
    assert.match(home, /id="chatModeMenu"[^>]*class="chat-mode-menu"/);
    assert.doesNotMatch(home, /<details id="chatModeMenu"/);
    assert.match(home, /id="privateVoiceControlsMenu"[^>]*class="chat-control-menu private-voice-controls-menu"/);
    assert.match(home, /class="public-chat-invite-menu"/);
    assert.match(home, /class="public-chat-call chat-control-menu"/);
    assert.match(home, /id="publicChatRoomName"/);
    assert.match(home, /id="publicChatPeopleSearch"[^>]*type="search"/);
    assert.match(home, /id="publicChatPeopleCount"[^>]*aria-live="polite"/);
    assert.match(home, /id="publicChatPeopleList"/);
    assert.match(home, /id="copyChatInviteLink"/);
    assert.match(home, /id="showChatInviteQr"/);
    assert.match(home, /id="focusChatInviteContact"/);
    assert.match(home, /id="chatInviteDialog"/);
    assert.match(home, /id="chatContextStrip"/);
    assert.match(home, /CHAT ACTIVO AHORA|TUS CONVERSACIONES/);
    assert.match(home, /id="publicChatPresence">Activo ahora/);
    assert.match(home, /El chat se activa únicamente mientras estás conectado a una sesión en vivo/);
    assert.doesNotMatch(home, /id="chatRoomForm"|id="chatRoomCode"/);
    assert.match(home, /id="newDirectChat"/);
    assert.match(home, /id="newGroupChat"/);
    assert.match(home, /class="private-chat-quick-actions"/);
    assert.doesNotMatch(home, /<details class="private-chat-create-menu"/);
    assert.match(home, /id="privateContactInvite"[\s\S]*Enlace, código o QR/);
    assert.match(home, /id="privatePushToTalk"/);
    assert.match(home, /id="privateChatProfileButton"/);
    assert.match(home, /id="privateChatMobileBack"[^>]*aria-label="Volver a las conversaciones"/);
    assert.match(home, /id="privateChatAttachmentInput"[^>]*accept="image\/jpeg,image\/png,image\/webp,video\/mp4,video\/webm,video\/quicktime"/);
    assert.match(home, /data-qmoji-favorites="private"/);
    assert.match(home, /data-qmoji-favorites="public"/);
    assert.match(home, /data-qmoji-grid="private"/);
    assert.match(home, /data-qmoji-grid="public"/);
    assert.match(home, /50 reacciones originales de Q Session/);
    assert.doesNotMatch(home, /data-(?:private-)?chat-reaction=/);
    assert.match(home, /Mensajes y archivos permanecen disponibles solamente para los integrantes/);
    assert.match(home, /id="enableMessagesButton"/);
    assert.match(home, /id="mediaConsole"/);
    assert.match(home, /id="broadcastSourcePicker"[^>]*class="broadcast-source-picker"/);
    assert.match(home, /id="broadcastSourceTrigger"[^>]*aria-haspopup="listbox"[^>]*aria-controls="broadcastSourceMenu"/);
    assert.match(home, /id="broadcastSourceMenu"[^>]*role="listbox"[^>]*hidden/);
    assert.match(home, /data-broadcast-source-value="tab"/);
    assert.match(home, /data-broadcast-source-value="microphone"/);
    assert.match(home, /data-broadcast-source-value="usb"/);
    assert.match(home, /data-broadcast-source-value="hdmi"/);
    assert.match(home, /data-broadcast-source-value="line"/);
    assert.match(home, /data-broadcast-source-value="bluetooth"/);
    assert.match(home, /id="broadcastSource" class="native-control-backup"[^>]*aria-hidden="true"[^>]*tabindex="-1"/);
    assert.match(home, /<option value="library" selected>Biblioteca Q Session<\/option>/);
    assert.match(home, /Audio estéreo directo, sin procesamiento de voz\./);
    assert.match(home, /<option value="microphone">Micrófono integrado<\/option>/);
    assert.match(home, /<option value="usb">USB o interfaz de audio<\/option>/);
    assert.match(home, /<option value="hdmi">Audio HDMI mediante capturadora<\/option>/);
    assert.match(home, /<option value="line">Conector de micrófono \(3,5 mm\)<\/option>/);
    assert.match(home, /<option value="bluetooth">Micrófono Bluetooth<\/option>/);
    assert.match(home, /id="microphoneModeControl"/);
    assert.match(home, /<option value="music" selected>Música y ambiente<\/option>/);
    assert.match(home, /<option value="voice">Voz<\/option>/);
    assert.match(home, /id="audioInputControl"/);
    assert.match(home, /id="audioInput"/);
    assert.match(home, /id="refreshAudioInputs"/);
    assert.match(home, /USB, HDMI, 3,5 mm o Bluetooth/);
    assert.match(home, /id="roomQr"/);
    assert.match(home, /Este QR abre directamente la transmisión/);
    assert.match(home, /Muéstralo completo, sin reflejos y con brillo medio/);
    assert.ok(home.indexOf('id="mediaStage"') < home.indexOf('id="roomResult"'));
    assert.doesNotMatch(home, /id="socialVideoArea"|id="socialVideoWall"|Personas con cámara/);
    assert.match(home, /id="scanRoomQr"/);
    assert.ok(home.indexOf('id="scanRoomQr"') < home.indexOf('id="roomCode"'));
    assert.match(home, /Código de seis caracteres o enlace de la sala/);
    assert.match(home, /placeholder="ABC123 o pega el enlace"/);
    assert.match(home, /id="roomQrScannerDialog"/);
    assert.match(home, /id="liveVideo"[^>]*poster="data:image\/gif;base64,/);
    assert.match(home, /id="mediaLiveBadge"[^>]*hidden/);
    assert.match(home, /id="roomQrVideo"[^>]*playsinline[^>]*poster="data:image\/gif;base64,/);
    assert.doesNotMatch(home, /<div class="qr-camera-frame">[\s\S]*?<i aria-hidden="true"><\/i>/);
    assert.match(home, /id="profileCountry"[^>]*required/);
    assert.match(home, /id="profileCity"[^>]*required/);
    assert.match(home, /Puedes escuchar sin perfil\. Para crear y transmitir una sala debes tener un perfil activo e iniciar sesión\./);
    assert.match(home, /Crear una sala<\/strong><small>Requiere perfil e inicio de sesión<\/small>/);
    assert.match(home, /id="accountName"[^>]*required/);
    assert.match(home, /id="profileName"[^>]*required/);
    assert.match(home, /id="showResidence"/);
    assert.match(home, /data-view-panel="create"/);
    assert.match(home, /data-view="create"/);
    const desktopNavigation = home.match(/<nav class="rail-nav">[\s\S]*?<\/nav>/)?.[0] || '';
    assert.ok(desktopNavigation.indexOf('data-view="create"') < desktopNavigation.indexOf('data-view="live"'));
    const mobileNavigation = home.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.match(mobileNavigation, /data-view="live"/);
    assert.match(mobileNavigation, /data-view="people"/);
    assert.match(mobileNavigation, /data-view="chat"/);
    assert.doesNotMatch(mobileNavigation, /data-view="global"|>Global</);
    assert.doesNotMatch(mobileNavigation, /data-view="create"|data-view="profile"/);
    assert.match(home, /Podrás revisar la sala antes de iniciar la transmisión/);
    assert.match(home, /id="liveMediaMount"/);
    assert.doesNotMatch(home, /id="hostMediaMount"/);
    assert.doesNotMatch(home, /Q Session te conecta automáticamente con el audio y el video de esta sala/);
    assert.match(home, /id="joinBroadcast"[^>]*hidden/);
    assert.match(home, /id="publicRoomsTitle">Salas activas</);
    assert.match(home, /Solo mostramos salas públicas con audio y personas conectadas/);
    assert.match(home, /id="publicRoomsToggle"[^>]*aria-expanded="false"[^>]*aria-controls="publicRoomsPanel"/);
    assert.match(home, /id="publicRoomsPanel"[^>]*hidden/);
    assert.match(home, /id="publicRoomsList"/);
    assert.match(home, /id="refreshPublicRooms"/);
    assert.match(home, /id="listenerRoomHistory"[\s\S]*id="listenerRoomsToggle"[^>]*aria-controls="listenerRoomsPanel"[\s\S]*<strong>Tus salas<\/strong>/);
    assert.match(home, /id="listenerRoomsPanel"[^>]*hidden[\s\S]*id="listenerRoomsList"/);
    assert.match(home, /id="publicRoomsPanel"[^>]*hidden[\s\S]*id="listenerRoomHistory"[\s\S]*class="public-room-directory-description"[\s\S]*id="publicRoomsList"/);
    assert.match(home, /class="public-rooms-live-mark"[\s\S]*class="public-rooms-heading"[\s\S]*class="public-room-meta"[\s\S]*id="publicRoomCount"[\s\S]*class="public-rooms-chevron disclosure-chevron"/);
    assert.match(home, /TU SALA AHORA/);
    assert.match(home, /Personas activas en esta sala/);
    assert.match(home, /Sólo aparecen perfiles visibles conectados a tu sesión actual/);
    assert.match(home, /Al salir, desaparecen de este espacio/);
    assert.match(home, /Aparecer en Personas sólo mientras estés en una sala/);
    assert.match(home, /id="peopleViewControls"/);
    assert.match(home, /data-people-layout="scroll"/);
    assert.match(home, /data-people-layout="mosaic"/);
    assert.match(home, /id="peopleNextGroup"/);
    assert.match(home, /Hasta 6 cámaras por grupo/);
    assert.match(home, /id="installAppButton"[^>]*aria-label="Instalar Q Session"/);
    assert.match(home, /id="installAppButton"[\s\S]*?<b id="installAppButtonLabel">APP<\/b><span[^>]*>↓<\/span>/);
    assert.match(home, /id="appUpdateIndicator"[^>]*hidden/);
    assert.match(home, /id="languageCurrentCode"[^>]*>ESP<\/b>/);
    assert.match(home, /id="accountShortcut"[^>]*aria-controls="accountMenuDialog"/);
    assert.match(home, /id="accountLabel">MENÚ</);
    assert.match(home, /id="accountMenuDialog"/);
    assert.match(home, /id="accountMenuAvatar"/);
    assert.match(home, /id="installAppHeroButton"/);
    assert.match(home, /id="downloadAndroidButton"/);
    assert.match(home, /id="voiceOverlayControl"/);
    assert.match(home, /<details id="voiceOverlayControl" class="voice-overlay-control">/);
    assert.doesNotMatch(home, /<details id="voiceOverlayControl"[^>]*\sopen(?:\s|>)/);
    assert.match(home, /<summary class="voice-overlay-heading">[\s\S]*?MICRÓFONO ADICIONAL[\s\S]*?id="voiceOverlayState">Preparado<\/span>[\s\S]*?<\/summary>/);
    assert.match(home, /class="voice-overlay-panel"/);
    assert.match(home, /id="voiceOverlayInput"/);
    assert.match(home, /id="voiceOverlayDeviceTrigger"[^>]*aria-haspopup="listbox"/);
    assert.match(home, /id="voiceOverlayDeviceMenu"[^>]*role="listbox"/);
    assert.match(home, /Puedes usar el micrófono integrado\. Para uno externo: conecta USB o 3,5 mm, o empareja Bluetooth/);
    assert.match(home, /id="toggleVoiceOverlay"[^>]*disabled>Open|id="toggleVoiceOverlay"[^>]*disabled>Abrir micrófono/);
    assert.match(home, /id="voiceOverlayVolume"[^>]*max="150"/);
    assert.match(home, /id="voiceOverlayBass"[^>]*min="-12"[^>]*max="12"/);
    assert.match(home, /id="voiceOverlayTreble"[^>]*min="-12"[^>]*max="12"/);
    assert.match(home, /<details id="listenerOutputControl"[^>]*open>/);
    assert.match(home, /class="listener-output-summary"/);
    assert.match(home, /id="listenerOutputSelection">Normal/);
    assert.match(home, /data-listener-output-gain="1"[^>]*aria-pressed="true"/);
    assert.match(home, /data-listener-output-gain="\.708"[^>]*aria-pressed="false"/);
    assert.match(home, /data-listener-output-gain="\.501"[^>]*aria-pressed="false"/);
    assert.match(home, /Auriculares sensibles/);
    assert.doesNotMatch(home, /data-listener-output-gain="1\.(?:412|995)"/);
    assert.match(home, /Q Session para Windows/);
    assert.match(home, /Descargar para Windows/);
    assert.match(home, /Un solo instalador: crea los accesos directos y abre Q Session al terminar/);
    assert.ok(home.indexOf('id="windowsInstallCard"') > home.indexOf('id="liveMediaMount"'));
    assert.match(home, /id="installDialog"/);
    assert.match(home, /id="confirmationDialog"/);
    assert.match(home, /id="confirmationCancel"[^>]*>Seguir transmitiendo/);
    assert.match(home, /id="confirmationAccept"[^>]*>Cerrar sesión/);
    assert.match(home, /id="androidInstallDialog"/);
    assert.match(home, /QSession-Android-0\.1\.42\.apk/);
    assert.match(home, /Android exige esta confirmación/);
    assert.match(home, /\/vendor\/livekit-client\.umd\.js/);
    assert.match(home, /data-open-music/);
    const railNavigation = home.match(/<nav class="rail-nav">([\s\S]*?)<\/nav>/)?.[1] || '';
    const accountNavigation = home.match(/<nav class="account-menu-links"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
    const bottomNavigation = home.match(/<nav class="bottom-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
    assert.doesNotMatch(railNavigation, /data-view="global"|Rave global/);
    assert.doesNotMatch(accountNavigation, /data-view="global"|Rave global/);
    assert.doesNotMatch(bottomNavigation, /data-view="global"|>Global</);
    assert.doesNotMatch(railNavigation, /data-open-music|Biblioteca musical/);
    assert.doesNotMatch(accountNavigation, /data-open-music|Biblioteca musical/);
    assert.match(home, /class="music-library-open" data-open-music/);
    assert.doesNotMatch(home, /href="\/musica"/i);
    const serviceWorker = await (await fetch(`${app.baseUrl}/sw.js`)).text();
    assert.match(serviceWorker, /qsession-20261020-runtime-reconciled-v1/);
    assert.match(serviceWorker, /styles\.css\?v=20261018-event-capacity-v1/);
    assert.match(serviceWorker, /i18n\.js\?v=20261003-public-rooms-v1/);
    assert.match(serviceWorker, /analytics\.js\?v=20260910-admin-v1/);
    assert.match(serviceWorker, /data\/world-countries\.js\?v=20261016-vision-map-v2/);
    assert.match(serviceWorker, /music-library\.css\?v=20261008-live-dj-v1/);
    assert.match(serviceWorker, /qsession-sky-palette\.css\?v=20261016-sky-palette-v1/);
    assert.match(serviceWorker, /dj-mixer\.js\?v=20261016-autodj-calibration-v2/);
    assert.match(serviceWorker, /music-library\.js\?v=20261016-autodj-calibration-v2/);
    assert.match(serviceWorker, /app\.js\?v=20261020-runtime-reconciled-v1/);
    assert.doesNotMatch(serviceWorker, /app-releases\.json/);
    assert.match(serviceWorker, /vendor\/hls\.min\.js/);
    assert.match(serviceWorker, /qsession-world-network/);

    const skyPalette = await (await fetch(`${app.baseUrl}/qsession-sky-palette.css`)).text();
    assert.match(skyPalette, /--qs-blue:\s*#0b68a5/);
    assert.match(skyPalette, /--qs-sky:\s*#1596c4/);
    assert.match(skyPalette, /#musicLibrary\.set-desk/);
    assert.match(skyPalette, /\.media-console\[data-media-role="dj"\]/);
    assert.match(skyPalette, /\.bottom-nav\s*\{\s*grid-template-columns:\s*repeat\(3,/);

    const musicStudio = await (await fetch(`${app.baseUrl}/music-library.js`)).text();
    assert.match(musicStudio, /id="musicBpmValue"/);
    assert.match(musicStudio, /id="musicTransition"/);
    assert.match(musicStudio, /data-music-sfx="riser"/);
    assert.match(musicStudio, /data-music-reaction="🌸"/);
    assert.match(musicStudio, /qsession-camera-reaction/);
    const cameraEffects = await (await fetch(`${app.baseUrl}/camera-effects.js`)).text();
    assert.match(cameraEffects, /drawReactions\(time\)/);
    assert.match(cameraEffects, /qsession-camera-reaction/);
    const appScript = await (await fetch(`${app.baseUrl}/app.js`)).text();
    assert.match(appScript, /const GLOBAL_RAVE_PUBLIC = false;/);
    assert.match(appScript, /requestedName === 'global' && !GLOBAL_RAVE_PUBLIC/);

    const politicalMap = await (await fetch(`${app.baseUrl}/data/world-countries.js`)).text();
    assert.match(politicalMap, /QSESSION_WORLD_COUNTRIES/);
    assert.match(politicalMap, /"code":"CO"/);
    assert.match(politicalMap, /"code":"DE"/);
    assert.ok(politicalMap.length < 150_000, 'el mapa político debe conservar un peso moderado');

    const browserApp = await (await fetch(`${app.baseUrl}/app.js`)).text();
    assert.match(browserApp, /button\.dataset\.billingPlanMode = purchaseMode/);
    assert.match(browserApp, /creator-plan-grid/);
    assert.match(browserApp, /creator-plan-selected-overview/);
    assert.match(browserApp, /creator-plan-catalog/);
    assert.match(browserApp, /detailsLabel\.textContent = 'Incluye'/);
    assert.match(browserApp, /overviewEyebrow\.textContent = 'TUS PLANES'/);
    assert.match(browserApp, /dataset\.selectBillingPlan = plan\.id/);
    assert.match(browserApp, /ownedPlans = plans\.filter\(plan => availableBillingUnits\(plan\.id\) > 0\)/);
    assert.match(browserApp, /creator-owned-plans-empty/);
    assert.doesNotMatch(browserApp, /creator-reward-report/);
    assert.match(home, /id="accountRewardsShortcut"/);
    assert.match(home, /id="starPurchasedTotal"/);
    assert.match(home, /id="flowerListeningTotal"/);
    assert.match(browserApp, /creatorBillingTitle'\)\.textContent = 'Plan y acceso'/);
    assert.match(browserApp, /Audio \+ video/);
    assert.doesNotMatch(browserApp, /Ver todo lo que incluye/);
    assert.match(browserApp, /Envío de videos/);
    assert.match(browserApp, /Sin envío de videos/);
    assert.match(browserApp, /retry\.dataset\.reloadBilling = 'true'/);
    assert.match(browserApp, /result = await api\('\/api\/billing\/plans'\)/);
    assert.match(browserApp, /No pudimos mostrar los planes/);
    assert.match(browserApp, /directVideoUploadsConfigured/);
    assert.match(browserApp, /'Cámaras'/);
    assert.match(browserApp, /byId\('accountName'\)\.required = registering/);
    assert.match(browserApp, /byId\('accountName'\)\.disabled = !registering/);
    assert.match(browserApp, /byId\('openPublicChatMic'\)\.addEventListener\('click'/);
    assert.match(browserApp, /publicChatPushButton\.addEventListener\('pointerdown'/);
    assert.match(browserApp, /downloads\/QSession-Windows-latest\.exe\?version=0\.4\.15/);
    assert.match(browserApp, /byId\('hostSessionDangerZone'\)\.hidden = role !== 'dj'/);
    assert.match(browserApp, /Descargando el instalador de Q Session para Windows/);
    assert.match(browserApp, /downloads\/QSession-Android-latest\.apk\?version=0\.1\.42/);
    assert.match(browserApp, /api\/app-releases\?time=/);
    assert.match(browserApp, /function compareAppVersions/);
    assert.match(browserApp, /classList\.toggle\('has-update', updateAvailable\)/);
    assert.match(browserApp, /appUpdateIndicator/);
    assert.match(browserApp, /intent:\/\/join#Intent;scheme=qsession;package=org\.qsession\.app/);
    assert.match(browserApp, /S\.browser_fallback_url=\$\{encodeURIComponent\(fallbackUrl\)\}/);
    assert.match(browserApp, /function openAndroidInvitationInInstalledApp\(\)/);
    assert.match(browserApp, /\$\{location\.origin\}\/join\/\$\{code\}/);
    assert.match(browserApp, /function downloadAndroidApp\(\)\s*\{\s*openAndroidInstallHelp\(\);\s*repeatAndroidDownload\(\);\s*\}/);
    assert.doesNotMatch(browserApp, /window\.setTimeout\(openAndroidInstallHelp/);
    assert.match(browserApp, /QSessionAndroid\\\/\(\[\^\\s;,\)\]\+\)/);
    assert.match(browserApp, /Q Session Android · v\$\{androidVersion\}/);
    assert.match(browserApp, /Q Session Windows · v\$\{windowsVersion\}/);
    assert.match(browserApp, /Q Session Windows · v\$\{launcherVersion\}/);
    assert.match(browserApp, /Q Session Web · v0\.1\.4/);
    assert.match(browserApp, /function roomCreatorProfileIsActive\(\)/);
    assert.match(browserApp, /requestedName === 'create' && !roomCreatorProfileIsActive\(\)/);
    assert.match(browserApp, /QSessionNativeBridge/);
    assert.match(browserApp, /if \(typeof bridge\?\.requestGpsCountry !== 'function'\) return null/);
    assert.doesNotMatch(browserApp, /isQSessionAndroidApp/);
    assert.match(browserApp, /captureHelp\.hidden = tabAudio/);
    assert.doesNotMatch(browserApp, /En Chrome, entra en “Pestaña de Chrome”/);

    const normalHome = await (await fetch(`${app.baseUrl}/`)).text();
    assert.match(normalHome, /icons\/qsession-icon-192\.png\?v=20260911-brand-logo-v1/);
    assert.doesNotMatch(normalHome, /qsession-windows-icon-192/);
    const windowsHome = await (await fetch(`${app.baseUrl}/?desktop=windows&app=0.4.10`)).text();
    assert.match(windowsHome, /icons\/qsession-windows-icon-192\.png\?v=20260912-windows-taskbar-v6/);
    assert.match(browserApp, /qsession-native-audio-status/);
    assert.match(browserApp, /nativeAudioReady/);
    assert.match(browserApp, /function requestConfirmation/);
    assert.match(browserApp, /QSessionNativeBridge\?\.shareRoom/);
    assert.match(browserApp, /QSessionNativeBridge\?\.copyText/);
    assert.match(browserApp, /runRoomShareAction\(action, \{listener: true\}\)/);
    assert.doesNotMatch(browserApp, /window\.confirm\(/);
    assert.match(browserApp, /function openAndroidInstallHelp/);
    assert.match(browserApp, /repeatAndroidDownload/);
    assert.match(browserApp, /name: 'qsession-voice-overlay'/);
    assert.match(browserApp, /function syncBroadcastSourceControl/);
    assert.match(browserApp, /function chooseBroadcastSource/);
    assert.match(browserApp, /function setBroadcastSourceMenuOpen/);
    assert.match(browserApp, /function createVoiceOverlayProcessor/);
    assert.match(browserApp, /createDynamicsCompressor/);
    assert.match(browserApp, /highPass\.frequency\.value = 80/);
    assert.match(browserApp, /state\.remoteAudioTracks\.size > 0/);
    assert.match(browserApp, /webAudioMix: false/);
    assert.match(browserApp, /type: 'listener-output-gain'/);
    assert.match(browserApp, /function listenerWebAudioVolume\(\)/);
    assert.match(browserApp, /state\.listenerMuted \|\| listenerShouldUseNativeAudio\(\) \? 0 : state\.listenerOutputGain/);
    assert.match(browserApp, /track\.setVolume\?\.\(listenerWebAudioVolume\(\)\)/);
    assert.doesNotMatch(home, /nativeStudioEntry|openNativeStudioButton|Transmisión nativa/);
    assert.doesNotMatch(browserApp, /initializeNativeStudioEntry|open-native-studio/);
    const legacyWindowsDownload = await fetch(`${app.baseUrl}/downloads/QSession-Desktop-Windows-x64.zip?v=20260909-desktop-tab-audio-v03`, {redirect: 'manual'});
    assert.equal(legacyWindowsDownload.status, 308);
    assert.equal(legacyWindowsDownload.headers.get('location'), '/downloads/QSession-Windows-latest.exe');
    const latestWindowsDownload = await fetch(`${app.baseUrl}/downloads/QSession-Windows-latest.exe`, {method: 'HEAD', redirect: 'manual'});
    assert.equal(latestWindowsDownload.status, 307);
    assert.equal(latestWindowsDownload.headers.get('cache-control'), 'no-store');
    assert.equal(latestWindowsDownload.headers.get('location'), '/downloads/Instalar-QSession-Windows.exe?version=0.4.15');
    const windowsInstaller = await fetch(`${app.baseUrl}/downloads/Instalar-QSession-Windows.exe?v=17`, {method: 'HEAD'});
    assert.equal(windowsInstaller.headers.get('content-type'), 'application/vnd.microsoft.portable-executable');
    assert.equal(windowsInstaller.headers.get('content-disposition'), 'attachment; filename="Instalar-QSession-Windows.exe"');
    assert.equal(windowsInstaller.headers.get('accept-ranges'), 'bytes');
    assert.match(browserApp, /Esta copia de Q Session para Windows usa una captación retirada/);
    const releaseResponse = await fetch(`${app.baseUrl}/api/app-releases`);
    const releaseCatalog = await releaseResponse.json();
    assert.equal(releaseResponse.headers.get('cache-control'), 'no-store');
    assert.equal(releaseCatalog.android.version, '0.1.42');
    assert.equal(releaseCatalog.windows.version, '0.4.15');
    assert.equal(releaseCatalog.android.url, '/downloads/QSession-Android-latest.apk?version=0.1.42');
    assert.equal(releaseCatalog.windows.url, '/downloads/QSession-Windows-latest.exe?version=0.4.15');
    const latestAndroidDownload = await fetch(`${app.baseUrl}/downloads/QSession-Android-latest.apk`, {method: 'HEAD', redirect: 'manual'});
    assert.equal(latestAndroidDownload.status, 307);
    assert.equal(latestAndroidDownload.headers.get('cache-control'), 'no-store');
    assert.equal(latestAndroidDownload.headers.get('location'), '/downloads/QSession-Android-0.1.42.apk?version=0.1.42');
    const androidDownload = await fetch(`${app.baseUrl}/downloads/QSession-Android-0.1.42.apk?v=44`, {method: 'HEAD'});
    assert.equal(androidDownload.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.equal(androidDownload.headers.get('content-disposition'), 'attachment; filename="QSession-Android-0.1.42.apk"');
    assert.equal(androidDownload.headers.get('accept-ranges'), 'bytes');
    const rangedAndroidDownload = await fetch(`${app.baseUrl}/downloads/QSession-Android-0.1.42.apk?v=44`, {headers: {Range: 'bytes=0-31'}});
    assert.equal(rangedAndroidDownload.status, 206);
    assert.equal((await rangedAndroidDownload.arrayBuffer()).byteLength, 32);
    const appInvitation = await fetch(`${app.baseUrl}/join/ABC123`, {redirect: 'manual'});
    assert.equal(appInvitation.status, 302);
    assert.equal(appInvitation.headers.get('location'), '/?room=ABC123&open=app');
    assert.match(browserApp, /function renderProfileAvatar/);
    assert.match(browserApp, /const detailsText = roomActive[\s\S]*profile\.roomOrganizer \? 'Organizador de la sala'/);
    assert.match(browserApp, /function syncVideoRotationCorrection/);
    assert.match(browserApp, /function participantCameraRotation/);
    assert.match(browserApp, /container\.dataset\.cameraRotation = rotation/);
    assert.doesNotMatch(browserApp, /preferredOrientation === 'portrait' && measuredOrientation === 'landscape'/);
    assert.match(browserApp, /--rotated-video-width/);
    assert.match(browserApp, /function setPublicRoomsPanelOpen\(open\)/);
    assert.match(browserApp, /setPublicRoomsPanelOpen\(shouldOpen\)/);
    assert.match(browserApp, /async function addRoomPromotion\(\)/);
    assert.match(browserApp, /function renderRoomPromotions\(room\)/);
    const browserStyles = await (await fetch(`${app.baseUrl}/styles.css`)).text();
    assert.match(browserStyles, /\.public-rooms-toggle\[aria-expanded="true"\]/);
    assert.match(browserStyles, /\.public-rooms-toggle \{[^}]*grid-template-columns: minmax\(3rem, 1fr\) auto minmax\(3rem, 1fr\)/);
    assert.match(browserStyles, /\.public-rooms-heading \{[^}]*justify-items: center;[^}]*text-align: center/);
    assert.match(browserStyles, /@keyframes public-live-wave/);
    assert.match(browserStyles, /\.room-promotion-editor \{[^}]*grid-column: 1 \/ -1/);
    assert.match(browserStyles, /\.room-promotions \{[^}]*grid-auto-flow: column/);
    assert.match(browserStyles, /\.bottom-nav button \{[^}]*font-size: \.7rem/);
    assert.match(browserStyles, /\.qr-scan-button \{[^}]*border: 2px solid #a3d6d8[^}]*cursor: pointer/);
    assert.match(browserStyles, /\.qr-scan-button:focus-visible \{[^}]*outline: 3px solid/);
    assert.match(browserStyles, /\.media-controls button \{[^}]*font-family: "Segoe UI Variable Text", "Aptos", Inter[^}]*font-weight: 600/);
    assert.match(browserStyles, /\.media-controls \.control-primary \{[^}]*font-weight: 680/);
    assert.match(browserStyles, /\.room-share-trigger \{[^}]*font-family: "Segoe UI Variable Text", "Aptos", Inter[^}]*font-weight: 520/);
    assert.match(browserStyles, /\.room-share-trigger strong \{[^}]*font-weight: 600/);
    assert.match(browserStyles, /\.room-share-trigger small \{[^}]*font-weight: 470/);
    assert.match(browserStyles, /\.broadcast-source-trigger \{[^}]*background: linear-gradient/);
    assert.match(browserStyles, /\.broadcast-source-menu \{[^}]*backdrop-filter: blur\(18px\)/);
    assert.match(browserStyles, /data-camera-rotation="clockwise"/);
    assert.match(browserStyles, /rotate\(90deg\)/);
    assert.match(browserStyles, /\/\* Chat: compact command-first layout \*\//);
    assert.match(browserStyles, /\.chat-mode-menu \.chat-mode-tabs \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(browserStyles, /\.chat-mode-tabs button\[aria-pressed="true"\] \{[^}]*color: #fff[^}]*background: #102746/);
    assert.match(browserStyles, /\.chat-mode-tabs button\[aria-pressed="true"\]::after \{[^}]*background: #8bdbe7/);
    assert.match(browserStyles, /\.private-chat-shell\.is-conversation-open \.chat-sidebar \{ display: none; \}/);
    assert.match(browserStyles, /\.private-chat-shell\.is-conversation-open \.chat-conversation \{ display: flex; \}/);
    assert.match(browserStyles, /\.qmoji-grid \{[^}]*grid-template-columns: repeat\(8/);
    assert.match(browserStyles, /\.qmoji-picker \{[^}]*backdrop-filter: blur\(18px\)/);
    assert.match(browserApp, /function roomSharePayload/);
    assert.match(browserApp, /function setRoomShareMenuOpen/);
    assert.match(browserApp, /byId\('copyRoomInvite'\)\.addEventListener/);
    assert.match(browserApp, /copyRoomShareValue\(payload\.text/);
    assert.match(browserApp, /navigator\.share/);
    assert.match(browserApp, /https:\/\/wa\.me\/\?text=/);
    assert.match(browserApp, /https:\/\/t\.me\/share\/url\?url=/);
    assert.match(browserApp, /mailto:\?subject=/);
    assert.match(browserApp, /sms:\?&body=/);
    assert.match(browserApp, /byId\('accountLabel'\)\.textContent = 'MENÚ'/);
    assert.match(browserApp, /renderProfileAvatar\('accountMenuAvatar'/);
    assert.match(browserApp, /function setChatMode/);
    assert.match(browserApp, /function activePublicChatCode/);
    assert.match(browserApp, /function publicChatDirectoryEntries/);
    assert.match(browserApp, /function renderPublicChatDirectory/);
    assert.match(browserApp, /function sendChatPlatformInvitation/);
    assert.match(browserApp, /type: 'room-invite'/);
    assert.equal((browserApp.match(/token: ':q\d{2}:'/g) || []).length, 50);
    assert.match(browserApp, /\['#dbe9f6', '#315f8c'\]/);
    assert.doesNotMatch(browserApp, /\['#7ed8d5', '#102d50'\]/);
    assert.match(browserApp, /function qmojiSvg/);
    assert.match(browserApp, /QMOJI_BY_TOKEN\.get\(message\.text\)/);
    assert.match(browserApp, /function sendQmoji/);
    assert.match(browserApp, /state\.mediaRoomCode !== state\.currentRoomCode/);
    assert.match(browserApp, /CHAT ACTIVO AHORA/);
    assert.match(browserApp, /este es el único chat público activo para ti/);
    assert.match(browserApp, /if \(!state\.chatModeChosen\) state\.chatMode = 'private'/);
    assert.match(browserApp, /\['private', 'group', 'public'\]\.includes\(mode\)/);
    assert.match(browserApp, /state\.privateConversationOpen = true/);
    assert.doesNotMatch(browserApp, /function connectChatRoom/);
    assert.match(browserApp, /function createPrivateChat/);
    assert.match(browserApp, /function createPrivateContactInvitation/);
    assert.match(browserApp, /function redeemPrivateContactInvitation/);
    assert.match(browserApp, /startRoomQrScanner\('private-contact'\)/);
    assert.match(browserApp, /function connectPrivateVoice/);
    assert.match(browserApp, /setMicrophoneEnabled/);
    assert.match(browserApp, /function startPrivatePushToTalk/);
    assert.match(browserApp, /function profileResidenceLabel/);
    assert.match(browserApp, /function connectMedia/);
    assert.match(browserApp, /function roomCodeFromQrText/);
    assert.match(browserApp, /function roomCodeFromSharedEntry/);
    assert.match(browserApp, /async function loadPublicRooms/);
    assert.match(browserApp, /dataset\.publicRoomCode/);
    assert.match(browserApp, /function renderQuickLiveRooms/);
    assert.match(browserApp, /ROOM_TYPE_PRESETS/);
    assert.match(browserApp, /function applyRoomTypePreset/);
    assert.match(browserApp, /function setRoomTypeMenuOpen/);
    assert.match(browserApp, /function syncRoomVisibilityControl/);
    assert.match(browserApp, /byId\('roomTypeTrigger'\)\.addEventListener/);
    assert.match(browserApp, /function syncScheduledDateTimeValue/);
    assert.match(browserApp, /function schedulePreviewText/);
    assert.match(browserApp, /data-schedule-day-offset/);
    assert.match(browserApp, /function startWaitingRoomMonitor/);
    assert.match(browserApp, /setInterval\(\(\) => void check\(\), 3000\)/);
    assert.match(browserApp, /function syncRoomSocialDependencies/);
    assert.match(browserApp, /function syncRoomExperienceDependencies/);
    assert.match(browserApp, /ROOM_EXPERIENCE_CONTROLS/);
    assert.match(browserApp, /allowAiCameraEffects/);
    assert.match(browserApp, /allowVjVisuals/);
    assert.match(browserApp, /allowVideoSubmissions/);
    assert.match(browserApp, /byId\('quickLiveRoomsList'\)\.addEventListener\('click', selectPublicRoom\)/);
    assert.match(browserApp, /byId\('quickLiveRoomsMenu'\)\.addEventListener\('toggle'/);
    assert.match(browserApp, /const LISTENER_ROOM_HISTORY_KEY = 'qsession-listener-room-history-v1'/);
    assert.match(browserApp, /function rememberListenerRoom\(room\)/);
    assert.match(browserApp, /rememberListenerRoom\(room\);/);
    assert.match(browserApp, /localStorage\.setItem\(LISTENER_ROOM_HISTORY_KEY/);
    assert.match(browserApp, /function renderListenerRoomHistory\(\)/);
    assert.match(browserApp, /byId\('listenerRoomsList'\)\.addEventListener\('click', selectListenerRoom\)/);
    assert.match(browserApp, /byId\('listenerRoomsToggle'\)\.addEventListener\('click'/);
    const listenerRoomsPanelFunction = browserApp.match(/function setListenerRoomsPanelOpen[\s\S]*?function rememberListenerRoom/)?.[0] || '';
    assert.doesNotMatch(listenerRoomsPanelFunction, /setPublicRoomsPanelOpen/);
    assert.match(browserApp, /setInterval\(\(\) => \{[\s\S]*loadPublicRooms\(\{quiet: true\}\)[\s\S]*\}, 10000\)/);
    assert.match(browserApp, /addEventListener\('paste'/);
    assert.match(browserApp, /clipboardData\?\.getData\('text'\)/);
    assert.match(browserApp, /Enlace reconocido\. Entrando a la sala/);
    assert.match(browserApp, /decodeFromConstraints/);
    assert.match(browserApp, /facingMode:\s*\{ideal:\s*'environment'\}/);
    assert.match(browserApp, /width:\s*\{ideal:\s*1920\}/);
    assert.match(browserApp, /focusMode:\s*'continuous'/);
    assert.match(browserApp, /window\.BarcodeDetector/);
    assert.match(browserApp, /delayBetweenScanAttempts:\s*180/);
    assert.match(browserApp, /Math\.max\(zoom\.min, 1\)/);
    assert.match(browserApp, /Math\.abs\(target - current\) > \.01/);
    assert.match(browserApp, /writeToDom\(container, joinUrl, 280, 280\)/);
    assert.match(browserApp, /Si se ve borroso, aléjate un poco/);
    assert.match(browserApp, /byId\('joinRoomForm'\)\.requestSubmit\(\)/);
    assert.match(browserApp, /async function joinBroadcast\(\{automatic = false\} = \{\}\)/);
    assert.match(browserApp, /function initializeHomeSessionActions/);
    assert.match(browserApp, /function setHomeSessionAction/);
    assert.match(browserApp, /all\('\[data-home-session-action\]'\)\.forEach/);
    assert.match(browserApp, /setHomeSessionAction\('join'\)/);
    assert.doesNotMatch(browserApp, /joinRoomMenu|createRoomShortcut/);
    assert.match(browserApp, /await joinBroadcast\(\{automatic: true\}\)/);
    assert.match(browserApp, /byId\('leaveBroadcast'\)\.addEventListener\('click', \(\) => void returnFromListenerSession\(\)\)/);
    assert.match(browserApp, /\['live', 'create', 'people', 'chat', 'global', 'sponsors', 'vision', 'profile', 'music'\]/);
    assert.match(browserApp, /const mount = byId\('liveMediaMount'\)/);
    assert.match(browserApp, /function prepareMediaConsole[\s\S]*showView\('live'\);[\s\S]*requestAnimationFrame/);
    assert.doesNotMatch(browserApp, /showView\('create'\).*prepareMediaConsole|prepareMediaConsole[\s\S]{0,200}showView\('create'\)/);
    assert.match(browserApp, /function registerPeopleCamera/);
    assert.match(browserApp, /function activeRoomProfiles/);
    assert.match(browserApp, /function detachedTrackElements/);
    assert.match(browserApp, /function removeDetachedTrackElements/);
    assert.doesNotMatch(browserApp, /\.detach\([^;\n]*\)\.forEach/);
    assert.match(browserApp, /async function deleteHostedSession/);
    assert.match(browserApp, /dataset\.deleteHostedSession = session\.id/);
    assert.match(browserApp, /\/api\/account\/sessions\/\$\{encodeURIComponent\(session\.id\)\}/);
    assert.match(browserApp, /function syncLocalRoomProfileMetadata/);
    assert.match(browserApp, /LiveKit\.RoomEvent\.ParticipantMetadataChanged/);
    assert.match(browserApp, /!state\.currentRoomCode \|\| !state\.mediaConnected \|\| !state\.mediaRoom/);
    assert.match(browserApp, /state\.publicProfiles = \[\.\.\.activeRoomProfiles\(\)\.values\(\)\]/);
    assert.doesNotMatch(browserApp, /api\('\/api\/profiles\/public'\)/);
    assert.match(browserApp, /peopleVideoTracks: new Map\(\)/);
    assert.match(browserApp, /PEOPLE_CAMERA_PAGE_SIZE = window\.QSessionPeopleCameras\.PAGE_SIZE/);
    assert.match(browserApp, /qsession-people-layout/);
    assert.match(browserApp, /function applyPeopleView/);
    assert.match(browserApp, /peopleCameraPager\.update/);
    assert.match(browserApp, /function roomParticipantIsOrganizer/);
    assert.match(browserApp, /startsWith\('dj-'\)/);
    assert.match(browserApp, /roomOrganizer/);
    assert.match(browserApp, /person-organizer-badge/);
    assert.match(browserApp, /personas · DJ · tú · sala/);
    assert.match(browserStyles, /\.person-card-organizer \{[^}]*border-color/);
    assert.match(browserStyles, /\.person-organizer-badge \{[^}]*position: absolute/);
    assert.match(browserStyles, /\.listener-room-invite \{[^}]*grid-template-columns:/);
    assert.match(browserStyles, /\.listener-room-share-menu \{[^}]*position: absolute/);
    assert.match(browserApp, /Personas en una lista vertical\. Desplázate hacia abajo para recorrerlas\./);
    assert.match(browserApp, /getDisplayMedia/);
    assert.match(browserApp, /function configureDefaultBroadcastSource/);
    assert.match(browserApp, /source\.value = 'library'/);
    assert.match(browserApp, /function microphoneCaptureOptions/);
    assert.match(browserApp, /function microphoneCaptureError/);
    assert.match(browserApp, /async function captureMicrophone/);
    assert.match(browserApp, /getUserMedia\(microphoneCaptureOptions\(\)\)/);
    assert.match(browserApp, /getUserMedia\(\{audio: true, video: false\}\)/);
    assert.match(browserApp, /preparedMicrophone = await captureMicrophone\(\)/);
    assert.ok(browserApp.indexOf('preparedMicrophone = await captureMicrophone()') < browserApp.indexOf("const room = await connectMedia('dj')"));
    assert.match(browserApp, /publishTrack\(capture\.track/);
    assert.match(browserApp, /source: LiveKit\.Track\.Source\.Microphone/);
    assert.match(browserApp, /contentHint = byId\('microphoneMode'\)\.value === 'voice' \? 'speech' : 'music'/);
    assert.match(browserApp, /Ajustes › Aplicaciones › Q Session o Chrome › Permisos › Micrófono/);
    assert.match(browserApp, /function audioInputDeviceLabel/);
    assert.match(browserApp, /function audioInputDeviceType/);
    assert.match(browserApp, /async function prepareRequestedAudioInput/);
    assert.match(browserApp, /PHYSICAL_AUDIO_SOURCES = new Set\(\['microphone', 'usb', 'hdmi', 'line', 'bluetooth'\]\)/);
    assert.match(browserApp, /async function refreshAudioInputDevices/);
    assert.match(browserApp, /filter\(device => device\.kind === 'audioinput'\)/);
    assert.match(browserApp, /deviceId: \{exact: state\.audioInputDeviceId\}/);
    assert.match(browserApp, /qsession-audio-input-device/);
    assert.match(browserApp, /Bluetooth ·/);
    assert.match(browserApp, /HDMI ·/);
    assert.match(browserApp, /USB ·/);
    assert.match(browserApp, /Conector 3,5 mm ·/);
    assert.match(browserApp, /function renderVoiceOverlayDevicePicker/);
    assert.match(browserApp, /data\.voiceOverlayDeviceId|dataset\.voiceOverlayDeviceId/);
    assert.match(browserApp, /byId\('refreshAudioInputs'\)\.addEventListener/);
    assert.match(browserApp, /width:\s*960,\s*height:\s*1280/);
    assert.match(browserApp, /orientation\?\.lock\?\.\(format\)/);
    assert.match(browserApp, /beforeinstallprompt/);

    const stylesheet = await (await fetch(`${app.baseUrl}/styles.css`)).text();
    assert.match(stylesheet, /\.live-stage\s*\{[^}]*background:\s*#fffefd;/);
    assert.doesNotMatch(stylesheet, /\.world-art\s*\{/);
    assert.match(stylesheet, /\.home-session-action-bar\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(stylesheet, /\.home-session-action-bar\s*>\s*button\s*\{[^}]*linear-gradient\(120deg,\s*#102746,\s*#1d4d67\)/);
    assert.match(stylesheet, /\.home-session-action-icon\s*\{[^}]*background:\s*linear-gradient\(145deg,\s*#8be0df,\s*var\(--aqua\)\)/);
    assert.match(stylesheet, /\.home-create-panel\s+\.create-session-stage\s*\{[^}]*min-height:\s*0;/);
    assert.match(stylesheet, /\.quick-live-rooms-panel\s*\{[^}]*position:\s*absolute;[^}]*max-height:/);
    assert.match(stylesheet, /\.quick-live-room\s*\{[^}]*background:\s*transparent;[^}]*text-align:\s*left;/);
    assert.match(stylesheet, /\.creator-command-deck\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(stylesheet, /\.creator-plan-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(stylesheet, /\.creator-plan-option\s*\{[^}]*grid-template-areas:\s*"select footer"\s*"details details"/);
    assert.match(stylesheet, /\.creator-plan-option-select\s*\{[^}]*grid-template-areas:\s*"topline essentials"\s*"title essentials"/);
    assert.match(stylesheet, /\.creator-plan-topline\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(stylesheet, /\.creator-plan-option h4\s*\{[^}]*font-size:\s*\.94rem;[^}]*white-space:\s*normal/);
    assert.match(stylesheet, /\.creator-plan-switcher\s*\{/);
    assert.match(stylesheet, /\.chat-heading\s*\{[^}]*min-height:\s*5\.15rem;[^}]*border-radius:\s*1\.25rem/);
    assert.match(stylesheet, /\.chat-heading::before\s*\{[^}]*qsession-mark-light\.png/);
    assert.match(stylesheet, /\.chat-account-strip::after\s*\{[^}]*background:\s*#4fbcae/);
    assert.match(stylesheet, /\.reward-source-report\s*\{/);
    assert.match(stylesheet, /\.room-form-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(stylesheet, /\.room-type-command-content\s*\{[^}]*grid-template-columns:/);
    assert.match(stylesheet, /\.room-setting-toggle\.is-disabled/);
    assert.match(stylesheet, /\.room-experience-intro/);
    assert.match(stylesheet, /data-room-design-theme="serenity"/);
    assert.match(stylesheet, /\.media-stage\.has-video/);
    assert.match(stylesheet, /\.install-app-button\s*\{[^}]*min-height:\s*2\.55rem;[^}]*border-radius:\s*999px;[^}]*box-shadow:\s*none;/);
    assert.match(stylesheet, /@media \(max-width: 420px\)[\s\S]*?\.install-app-button\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*3\.9rem;[^}]*gap:\s*\.28rem;/);
    assert.match(stylesheet, /@media \(max-width: 420px\)[\s\S]*?\.install-app-button b\s*\{[^}]*display:\s*block;/);
    assert.doesNotMatch(stylesheet, /\.install-app-button b\s*\{[^}]*display:\s*none;/);
    assert.match(stylesheet, /\.windows-install-card\s*\{[^}]*width:\s*max-content;[^}]*border-radius:\s*999px;[^}]*box-shadow:\s*none;/);
    assert.match(stylesheet, /\.app-download-actions\s*>\s*button\s*\{[^}]*Segoe UI Variable Text[^}]*font-size:\s*\.68rem;[^}]*font-weight:\s*620;/);
    assert.match(stylesheet, /\.primary-card\s*\{[^}]*color:\s*var\(--ink\);[^}]*Segoe UI Variable Text/);
    assert.match(stylesheet, /\.primary-card\s+\.room-code-control\s+button\s*\{[^}]*background:\s*#75d4d5;[^}]*font-weight:\s*650;/);
    assert.match(stylesheet, /\.room-code-control\s*\{[^}]*grid-template-columns:\s*minmax\(8rem,\s*1fr\)\s*auto;/);
    assert.match(stylesheet, /\.listener-rooms-toggle\s*\{[^}]*min-height:\s*3rem;[^}]*background:\s*transparent;/);
    assert.match(stylesheet, /\.listener-rooms-panel\s*\{[^}]*padding:\s*\.35rem/);
    assert.match(stylesheet, /\.public-room-directory-panel\s*>\s*\.listener-room-history\s*\{[^}]*border-top:\s*0;[^}]*border-bottom:/);
    assert.match(stylesheet, /\.host-session-danger-zone\s*\{[^}]*margin-top:\s*clamp\(2\.75rem,\s*8vh,\s*5rem\);[^}]*border-top:/);
    assert.match(stylesheet, /@media \(max-width: 620px\)[\s\S]*?\.listener-rooms-toggle small\s*\{[^}]*display:\s*none;/);
    assert.match(home, /id="voiceOverlayControl"[\s\S]*?class="disclosure-chevron"/);
    assert.match(home, /id="broadcastSourceTrigger"[\s\S]*?class="disclosure-chevron"/);
    assert.match(home, /id="cameraSettingsControl"[\s\S]*?class="camera-settings-chevron disclosure-chevron"/);
    assert.match(stylesheet, /\.disclosure-chevron\s*\{[^}]*width:\s*1\.8rem;[^}]*height:\s*1\.8rem;[^}]*border-radius:\s*50%/);
    assert.match(stylesheet, /\.disclosure-chevron::before\s*\{[^}]*border-right:\s*2px solid currentColor;[^}]*border-bottom:\s*2px solid currentColor/);
    assert.match(stylesheet, /\.voice-overlay-control\[open\][^,{]*\.disclosure-chevron\s*\{[^}]*rotate\(180deg\)/);
    assert.doesNotMatch(stylesheet, /\.join-room-menu|\.inline-create-action/);
    assert.match(stylesheet, /\.chat-mode-tabs/);
    assert.match(stylesheet, /\.private-voice-panel/);
    assert.match(stylesheet, /\.private-chat-dialog/);
    assert.match(stylesheet, /@media \(max-width: 620px\)[\s\S]*?\.profile-intro h1\s*\{[^}]*white-space:\s*nowrap;/);
    assert.doesNotMatch(stylesheet, /\.profile-intro ol/);
    assert.match(stylesheet, /aspect-ratio:\s*9\s*\/\s*16/);
    assert.match(stylesheet, /\.person-card-live/);
    assert.match(stylesheet, /\.person-live-media/);
    assert.match(stylesheet, /\.person-card-live\s*\{[^}]*aspect-ratio:\s*auto;[^}]*display:\s*block/);
    assert.doesNotMatch(stylesheet, /\.person-card-live\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    assert.match(stylesheet, /\.people-grid\[data-layout="mosaic"\]/);
    assert.match(stylesheet, /\.people-grid\[data-layout="scroll"\]/);
    assert.match(stylesheet, /\.people-grid\[data-layout="scroll"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 28rem\);[^}]*justify-content:\s*center;[^}]*overflow:\s*visible;/);
    assert.doesNotMatch(stylesheet, /\.people-grid\[data-layout="scroll"\]\s*\{[^}]*grid-auto-flow:\s*column/);
    assert.doesNotMatch(stylesheet, /\.people-grid\[data-layout="scroll"\]\s*\{[^}]*overflow-x:\s*auto/);
    assert.match(stylesheet, /\.people-grid\[data-layout="mosaic"\]\[data-size="240"\]/);
    assert.match(stylesheet, /\.person-live-media\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/);
    assert.match(stylesheet, /\.person-live-media\[data-camera-orientation="landscape"\]\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(stylesheet, /data-camera-format-mismatch="true"[\s\S]*?object-fit:\s*cover/);
    assert.match(stylesheet, /data-camera-framing="far"\]\[data-camera-format-mismatch="true"\]\[data-camera-orientation="landscape"\][\s\S]*?object-fit:\s*contain/);
    assert.match(stylesheet, /data-camera-framing="far"\]\[data-camera-format-mismatch="true"\]\[data-camera-orientation="portrait"\][\s\S]*?object-fit:\s*contain;\s*object-position:\s*center/);
    assert.match(stylesheet, /\.people-view-controls\s*\{[^}]*max-width:\s*42rem;[^}]*box-shadow:\s*none;/);
    assert.match(stylesheet, /\.room-qr\s*\{[^}]*width:\s*clamp\(11rem,\s*22vw,\s*14rem\)/);
    assert.match(stylesheet, /shape-rendering:\s*crispEdges/);
    assert.match(stylesheet, /repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(stylesheet, /\.create-session-stage/);
    assert.doesNotMatch(stylesheet, /\.create-session-direct/);
    assert.match(stylesheet, /\.bottom-nav[^\n]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);

    const manifest = await (await fetch(`${app.baseUrl}/manifest.webmanifest`)).json();
    assert.equal(manifest.name, 'Q Session');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
    assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
    assert.match(browserApp, /systemAudio: 'include'/);
    assert.match(browserApp, /windowAudio: 'system'/);
    assert.match(browserApp, /monitorTypeSurfaces: 'exclude'/);
    assert.match(browserApp, /audioSelection: 'preferred'/);
    assert.match(browserApp, /suppressLocalAudioPlayback: false/);
    assert.match(browserApp, /const CHROME_TAB_AUDIO_BITRATE = 510000/);
    assert.match(home, /id="broadcastAudioBitrate" disabled/);
    assert.match(home, /value="320000" selected/);
    assert.doesNotMatch(home, /value="(?:128000|192000|256000|510000)"/);
    assert.match(browserApp, /const BROADCAST_AUDIO_BITRATES = Object\.freeze\(\[128000, 192000, 256000, 320000, CHROME_TAB_AUDIO_BITRATE\]\)/);
    assert.match(browserApp, /name: 'qsession-tab-audio'[^}]*source: LiveKit\.Track\.Source\.ScreenShareAudio[^}]*forceStereo: true[^}]*dtx: false[^}]*red: false[^}]*maxBitrate: state\.broadcastAudioBitrate/s);
    assert.match(browserApp, /applyConstraints\(chromeTabAudioConstraints\(\)\)/);
    assert.match(browserApp, /track\.contentHint = 'music'/);
    assert.match(browserApp, /parameters\.encodings\[0\]\.maxBitrate = bitrate/);
    assert.match(browserApp, /type: 'set-chrome-tab-capture-bitrate'/);
    assert.match(browserApp, /createMediaStreamSource/);
    assert.match(browserApp, /function changeBroadcastSource/);
    assert.match(browserApp, /function setBroadcastActionButtonLabel/);
    assert.match(browserApp, /query\.get\('desktop'\) === 'windows'/);
    assert.match(browserApp, /broadcastActionIconSvg/);
    assert.match(browserApp, /function setListenerActionButtonLabel/);
    assert.match(browserApp, /QSessionAndroid\\\//);
    assert.match(browserApp, /localizedUiText\('Salir de la sala'\)/);
    assert.match(browserApp, /byId\('listenerOutputControl'\)\.open = false/);
    assert.match(browserApp, /byId\('listenerOutputSelection'\)/);
    assert.match(home, /class="broadcast-primary-actions"/);
    assert.match(home, /class="control-pair listener-primary-actions"/);
    assert.match(home, /id="toggleBroadcastAudio" class="media-icon-action" data-action-icon="volume-muted" data-control-state="inactive"/);
    assert.match(home, /id="toggleCamera" class="media-icon-action" data-action-icon="camera-off" data-control-state="inactive"/);
    assert.match(home, /id="changeBroadcastSource" class="media-icon-action" data-action-icon="ports" data-control-state="neutral"/);
    assert.match(home, /id="toggleListenerSound" class="media-icon-action" data-action-icon="volume-muted" data-control-state="inactive"/);
    assert.match(home, /id="toggleListenerCamera" class="media-icon-action" data-action-icon="camera-off" data-control-state="inactive"/);
    assert.match(stylesheet, /\.broadcast-primary-actions\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(stylesheet, /\.listener-primary-actions\s*\{[^}]*repeat\(2,\s*4\.35rem\)/);
    assert.match(stylesheet, /\.media-action-label\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    assert.match(browserApp, /button\.classList\.add\('media-icon-action'\)/);
    assert.match(browserApp, /function mediaActionPresentation/);
    assert.match(browserApp, /\{icon: 'pause', state: 'active'\}/);
    assert.match(browserApp, /\{icon: 'play', state: 'paused'\}/);
    assert.match(browserApp, /\{icon: 'volume-muted', state: 'muted'\}/);
    assert.match(browserApp, /button\.dataset\.controlState = presentation\.state/);
    assert.match(stylesheet, /media-icon-action\[data-control-state="active"\][\s\S]*?#8ce9e3/);
    assert.match(stylesheet, /media-icon-action\[data-control-state="paused"\][\s\S]*?#ffd28c/);
    assert.match(stylesheet, /media-icon-action\[data-control-state="muted"\][\s\S]*?#ffb0a7/);
    assert.match(stylesheet, /media-icon-action:disabled::after[\s\S]*?svg/);
    assert.match(stylesheet, /data-control-busy="true"\]:disabled::after/);
    assert.match(stylesheet, /data-qsession-desktop="windows"[^}]*\.room-result\s*\{[^}]*32rem[^}]*rgba\(118,190,197,\.14\)/);
    assert.match(stylesheet, /data-qsession-desktop="windows"[^}]*\.room-qr\s*\{[^}]*width:\s*9rem;[^}]*height:\s*9rem/);
    assert.match(stylesheet, /data-qsession-desktop="windows"[^}]*\.room-share-trigger\s*\{[^}]*min-height:\s*3\.15rem[^}]*box-shadow:\s*none/);
    assert.match(stylesheet, /data-qsession-android="true"[^}]*\.listener-output-summary\s*\{[^}]*min-height:\s*3rem[^}]*display:\s*flex/);
    assert.match(stylesheet, /data-qsession-android="true"[^}]*\.listener-output-panel\s*\{[^}]*border-top:/);
    assert.match(stylesheet, /data-qsession-android="true"[^}]*\.listener-output-presets\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(browserApp, /setCameraEnabled/);
    assert.match(browserApp, /function configureCameraFraming/);
    assert.match(browserApp, /getCapabilities\?\.\(\)\.zoom/);
    assert.match(browserApp, /applyConstraints\(\{advanced: \[\{zoom: target\}\]\}\)/);
    assert.match(browserApp, /function resetCameraFraming/);
    assert.match(home, /id="cameraZoom"/);
    assert.match(home, /Tu sesión,<br \/><span>todos conectados\.<\/span>/);
    assert.match(home, /<details id="cameraZoomGroup"/);
    assert.match(home, /id="cameraZoomSummary"/);
    assert.match(home, /data-camera-framing="far"/);
    assert.match(home, />Lejos<\/button>/);
    assert.match(home, />Medio<\/button>/);
    assert.match(home, />Cerca<\/button>/);
    assert.match(home, /<option value="0\.5">0\.5× · gran angular<\/option>/);
    assert.match(home, /<option value="3">3×<\/option>/);
    assert.match(browserApp, /\['0\.5', '1', '2', '3'\]/);
    assert.match(browserApp, /function localCameraCaptureOptions/);
    assert.match(browserApp, /function refreshCameraDevices/);
    assert.match(browserApp, /function describedCameraDevices/);
    assert.match(browserApp, /function renderCameraDevicePicker/);
    assert.match(browserApp, /enumerateDevices\(\)/);
    assert.match(browserApp, /switchActiveDevice\('videoinput', deviceId\)/);
    assert.match(browserApp, /addEventListener\?\.\('devicechange'/);
    assert.match(browserApp, /deviceId:\s*\{exact:\s*state\.cameraDeviceId\}/);
    assert.match(browserApp, /function initialCameraDeviceId/);
    assert.match(browserApp, /return isNativeAndroidApp\(\) \? '' : storedPeoplePreference\('qsession-camera-device', ''\)/);
    assert.match(browserApp, /cameraDeviceSelectionExplicit:\s*false/);
    assert.match(browserApp, /function frontCameraDevice/);
    assert.match(browserApp, /function widestFrontCameraDevice/);
    assert.match(browserApp, /function cameraDeviceIsWideAngle/);
    assert.match(browserApp, /frontCameraDevice\(cameras\)\?\.deviceId/);
    assert.match(browserApp, /function enableLocalCamera/);
    assert.match(browserApp, /\{facingMode:\s*'user'\}/);
    assert.match(browserApp, /Entrada HDMI/);
    assert.match(browserApp, /function startConnectionMonitor/);
    assert.match(browserApp, /getRTCStatsReport\(\)/);
    assert.match(browserApp, /availableOutgoingBitrate/);
    assert.match(browserApp, /availableIncomingBitrate/);
    assert.match(browserApp, /roundTripTime/);
    assert.match(browserApp, /packetsLost/);
    assert.match(browserApp, /ConnectionQualityChanged/);
    assert.match(browserApp, /simulcast:\s*true/);
    assert.match(browserApp, /degradationPreference:\s*'maintain-framerate'/);
    assert.match(browserApp, /maxBitrate:\s*1200000/);
    assert.match(browserApp, /red:\s*true/);
    assert.match(home, /id="connectionMonitor"/);
    assert.match(home, /id="connectionUpload"/);
    assert.match(home, /id="connectionDownload"/);
    assert.match(home, /id="connectionLatency"/);
    assert.match(home, /id="connectionLoss"/);
    assert.match(home, /id="sessionBackButton"[^>]*>← Atrás<\/button>/);
    assert.match(browserApp, /function returnFromListenerSession/);
    assert.match(browserApp, /function checkRoomAfterDjDeparture/);
    assert.match(browserApp, /mediaFallbackTitle'\)\.textContent = 'Sala finalizada'/);
    assert.match(browserApp, /nextUrl\.searchParams\.delete\('room'\)/);
    assert.match(browserApp, /setCurrentRoom\('', null\)/);
    assert.match(home, /id="cameraSourceControl"/);
    assert.match(home, /<details id="cameraSettingsControl"[^>]*hidden>[\s\S]*<strong>Cámara y encuadre<\/strong>/);
    assert.match(home, /id="cameraSettingsSelection">Cámara preparada · Horizontal · Lejos/);
    assert.match(home, /id="cameraDeviceTrigger"[^>]*aria-haspopup="listbox"/);
    assert.match(home, /id="cameraDeviceMenu"[^>]*role="listbox"/);
    assert.match(home, /id="cameraDevice"/);
    assert.match(home, /capturadora HDMI/);
    assert.match(home, /id="cameraOrientationControl"/);
    assert.match(home, /data-camera-orientation="portrait"/);
    assert.match(home, />▯ Vertical<\/button>/);
    assert.match(home, /data-camera-orientation="landscape"/);
    assert.match(home, />▭ Horizontal<\/button>/);
    assert.match(browserApp, /CAMERA_ORIENTATIONS = new Set\(\['portrait', 'landscape'\]\)/);
    assert.match(browserApp, /qsession-camera-orientation/);
    assert.match(browserApp, /devicePrefersPortraitCamera\(\) \? 'portrait' : 'landscape'/);
    assert.match(browserApp, /function refreshAutomaticCameraOrientation/);
    assert.match(browserApp, /function initialCameraOrientation\(\) \{\s*return devicePrefersPortraitCamera\(\) \? 'portrait' : 'landscape';\s*\}/);
    assert.match(browserApp, /function initialCameraOrientationMode\(\) \{\s*return 'automatic';\s*\}/);
    assert.match(browserApp, /refreshAutomaticCameraOrientation\(\{force: true\}\)/);
    assert.match(browserApp, /cameraOrientationMode: initialCameraOrientationMode\(\)/);
    assert.match(browserApp, /function setLocalCameraOrientation/);
    assert.match(browserApp, /function renderCameraSettingsSummary/);
    assert.match(browserApp, /cameraSettings\.hidden = !cameraControlsAllowed/);
    assert.match(browserApp, /qsession:languagechange', renderCameraSettingsSummary/);
    assert.match(browserStyles, /\.camera-settings-control > summary \{[^}]*min-height: 3\.45rem/);
    assert.match(browserStyles, /\.camera-settings-panel \{[^}]*display: grid/);
    assert.match(browserApp, /restartTrack\(localCameraCaptureOptions\(\)\)/);
    assert.match(browserApp, /'qsession\.cameraOrientation': state\.cameraOrientation/);
    assert.match(browserApp, /'qsession\.cameraDeviceClass': cameraDeviceClass\(\)/);
    assert.match(browserApp, /'qsession\.cameraFormatVersion': CAMERA_FORMAT_VERSION/);
    assert.match(browserApp, /function calibrateLocalCameraTrack/);
    assert.match(browserApp, /function resetCameraTrackToWidestAngle/);
    assert.match(browserApp, /function resetCameraStreamToWidestAngle/);
    assert.match(browserApp, /await resetCameraStreamToWidestAngle\(stream\)/);
    assert.match(browserApp, /applyConstraints\(\{advanced:\s*\[\{zoom:\s*range\.min\}\]\}\)/);
    assert.match(browserApp, /if \(next\) \{\s*refreshAutomaticCameraOrientation\(\{force: true\}\);[\s\S]*?state\.cameraFraming = 'far';\s*applyLocalCameraFraming\('far'\);/);
    assert.match(browserApp, /calibrateLocalCameraTrack\(publication\.track, \{resetToWidest: true\}\)/);
    assert.match(browserApp, /aspectRatio: \{ideal: format\.aspectRatio\}/);
    assert.match(browserApp, /function participantCameraOrientation/);
    assert.match(browserApp, /if \(deviceClass === 'mobile'\) return 'portrait';/);
    assert.match(browserApp, /if \(deviceClass === 'desktop'\) return 'landscape';/);
    assert.match(browserApp, /const CAMERA_FORMAT_VERSION = '4';/);
    assert.match(browserApp, /\? \{width: 960, height: 1280, aspectRatio: 3 \/ 4, frameRate: 24\}/);
    assert.match(browserApp, /: \{width: 1280, height: 720, aspectRatio: 16 \/ 9, frameRate: 24\}/);
    assert.match(browserApp, /ParticipantAttributesChanged/);
    assert.match(browserApp, /setAttributes\?\.\(cameraDeliveryAttributes\(track\)\)/);
    assert.match(browserApp, /function syncPrimaryVideoAspect/);
    assert.match(browserApp, /function syncVideoContainerAspect/);
    assert.match(browserApp, /const orientation = preference \|\| measuredOrientation \|\| 'landscape'/);
    assert.match(browserApp, /container\.dataset\.cameraAspectSource = streamMatchesPreference \? 'stream'/);
    assert.match(browserApp, /container\.dataset\.cameraFormatMismatch = String/);
    assert.match(browserApp, /container\.dataset\.cameraSourceOrientation = measuredOrientation/);
    assert.doesNotMatch(browserApp, /if \(next === previous\) \{[\s\S]{0,160}Formato/);
    assert.match(browserApp, /function bindVideoAspectSync/);
    assert.match(browserApp, /video\.addEventListener\('resize', synchronize\)/);
    assert.match(browserApp, /const measured = trackCameraOrientation\(track, video\)/);
    assert.match(stylesheet, /\.media-stage\.has-video\s*\{[^}]*width:\s*min\(100%,\s*38rem\)/);
    assert.match(stylesheet, /--camera-aspect/);
    assert.match(stylesheet, /data-camera-framing="far"/);
    assert.match(stylesheet, /object-fit:\s*contain/);
    assert.match(stylesheet, /\.camera-framing-control/);
    assert.match(stylesheet, /\.camera-source-control/);
    assert.match(stylesheet, /\.camera-device-menu\s*\{[^}]*max-height:\s*min\(16rem,\s*45vh\)/);
    assert.match(stylesheet, /\.camera-device-option\[aria-selected="true"\]/);
    assert.match(stylesheet, /\.camera-orientation-control/);
    assert.doesNotMatch(stylesheet, /\.social-video/);
    assert.doesNotMatch(browserApp, /attachSocialVideo|socialVideoWall|socialVideoArea/);
    assert.match(stylesheet, /\.person-live-media\[data-camera-orientation="landscape"\]/);
    assert.match(browserApp, /registerPeopleCamera\(track, participant\)/);
    assert.doesNotMatch(stylesheet, /data-camera-aspect-source="preference"\][^{]*\{\s*object-fit:\s*cover/);
    assert.match(stylesheet, /\.connection-monitor/);
    assert.match(stylesheet, /\.connection-bandwidth/);
    assert.match(stylesheet, /\.media-stage\.has-audio-signal \.signal-orbit::before/);
    assert.match(stylesheet, /@keyframes signal-wave/);
    assert.match(stylesheet, /signal-wave 4\.2s 2\.8s ease-out infinite/);
    assert.doesNotMatch(stylesheet, /\.signal-orbit > span:nth-child\(2\)/);
    assert.match(home, /class="signal-orbit"><span><\/span><b class="signal-frequency"/);
    assert.match(browserApp, /classList\.toggle\('has-audio-signal', signalIsActive\)/);
    assert.match(stylesheet, /\.session-back-button/);
    assert.match(stylesheet, /\.topbar\.has-active-session \.mobile-brand/);
    assert.match(stylesheet, /\.camera-zoom-control summary/);
    assert.match(stylesheet, /\.camera-zoom-fields/);
    const livekitClient = await fetch(`${app.baseUrl}/vendor/livekit-client.umd.js`);
    assert.equal(livekitClient.status, 200);
    assert.ok(Number(livekitClient.headers.get('content-length')) > 500000);
    await livekitClient.arrayBuffer();
  } finally {
    await app.close();
  }
});

test('DJ y oyente pueden crear una cuenta y Perfil conserva privacidad y fotos', async () => {
  const app = await startPlatform();
  try {
    const registration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'dj@example.com', password: 'password-segura-123', displayName: 'Luna', role: 'dj'},
    });
    assert.equal(registration.response.status, 201);
    assert.equal(registration.payload.profile.role, 'dj');
    assert.equal(registration.payload.profile.visible, false);
    const cookie = registration.response.headers.get('set-cookie').split(';')[0];

    const privateList = await jsonRequest(`${app.baseUrl}/api/profiles/public`);
    assert.equal(privateList.response.status, 410);
    assert.equal('profiles' in privateList.payload, false);

    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const upload = await jsonRequest(`${app.baseUrl}/api/profile-media`, {method: 'POST', body: {dataUrl: tinyPng}, cookie});
    assert.equal(upload.response.status, 201);

    const saved = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
      method: 'PUT',
      cookie,
      body: {
        displayName: 'Luna',
        role: 'dj',
        bio: 'Sesiones desde Bogotá para el mundo.',
        city: 'Bogotá',
        country: 'Colombia',
        visible: true,
        photos: [{id: upload.payload.media.id}],
        social: {allowMatchmaking: true, allowMessages: true, showResidence: false, shareApproximateLocation: false},
      },
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.payload.profile.photos.length, 1);
    assert.equal(saved.payload.profile.city, 'Bogotá');
    assert.equal(saved.payload.profile.country, 'Colombia');

    const publicProfile = await jsonRequest(`${app.baseUrl}/api/profiles/${saved.payload.profile.id}`);
    assert.equal(publicProfile.response.status, 200);
    assert.equal(publicProfile.payload.profile.displayName, 'Luna');
    assert.equal(publicProfile.payload.profile.role, 'dj');
    assert.equal(publicProfile.payload.profile.city, null);
    assert.equal(publicProfile.payload.profile.country, null);

    const sharedResidence = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
      method: 'PUT',
      cookie,
      body: {
        displayName: 'Luna',
        role: 'dj',
        bio: 'Sesiones desde Bogotá para el mundo.',
        city: 'Bogotá',
        country: 'Colombia',
        visible: true,
        photos: [{id: upload.payload.media.id}],
        social: {allowMatchmaking: true, allowMessages: true, showResidence: true, shareApproximateLocation: false},
      },
    });
    assert.equal(sharedResidence.response.status, 200);
    const residenceProfile = await jsonRequest(`${app.baseUrl}/api/profiles/${saved.payload.profile.id}`);
    assert.equal(residenceProfile.payload.profile.city, 'Bogotá');
    assert.equal(residenceProfile.payload.profile.country, 'Colombia');

    const publicPhoto = await fetch(`${app.baseUrl}${residenceProfile.payload.profile.photos[0].url}`);
    assert.equal(publicPhoto.status, 200);
    assert.equal(publicPhoto.headers.get('content-type'), 'image/png');
  } finally {
    await app.close();
  }
});

test('crear una sala exige una sesión iniciada y un perfil activo', async () => {
  const app = await startPlatform();
  try {
    const anonymous = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      body: {name: 'Sala anónima'},
    });
    assert.equal(anonymous.response.status, 401);
    assert.match(anonymous.payload.error, /Inicia sesión/);

    const incomplete = await registerTestCreator(app, {
      email: 'incomplete@example.com',
      displayName: '',
    });
    const incompleteCreation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: incomplete.cookie,
      body: {name: 'Sala sin perfil'},
    });
    assert.equal(incompleteCreation.response.status, 403);
    assert.match(incompleteCreation.payload.error, /Completa tu perfil/);

    const creator = await registerTestCreator(app, {
      email: 'active-creator@example.com',
      displayName: 'DJ Perfil Activo',
    });
    const creation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {name: 'Sala autorizada', djName: 'Nombre manipulado'},
    });
    assert.equal(creation.response.status, 201);
    assert.equal(creation.payload.room.djName, 'DJ Perfil Activo');
    assert.equal('rightsDeclaration' in creation.payload.room, false);
    const storedRoom = app.productStore.getRoomRecord(creation.payload.room.code);
    assert.equal(storedRoom.rightsDeclaration, null);
    assert.equal(storedRoom.contentAudit.accountId, creator.account.id);
  } finally {
    await app.close();
  }
});

test('el lanzamiento privado registra contenido, tramita reportes, apelaciones y reincidencia', async () => {
  const app = await startPlatform({
    publicRoomsEnabled: false,
    adminUsername: 'moderador',
    adminPassword: 'contraseña-administrativa-123',
    adminSessionSecret: 'secreto-administrativo-con-entropia-suficiente',
  });
  try {
    const creator = await registerTestCreator(app, {email: 'rights-host@example.com', displayName: 'Artista Propietario'});
    const reports = [];
    for (let index = 1; index <= 3; index += 1) {
      const creation = await jsonRequest(`${app.baseUrl}/api/rooms`, {method: 'POST', cookie: creator.cookie, body: {name: `Sala privada ${index}`, visibility: 'public', roomType: 'music'}});
      assert.equal(creation.response.status, 201);
      assert.equal(creation.payload.room.visibility, 'private');
      const stored = app.productStore.getRoomRecord(creation.payload.room.code);
      assert.equal(stored.contentAudit.accountId, creator.account.id);
      assert.equal(stored.contentAudit.source, 'live-source');
      const complaint = await jsonRequest(`${app.baseUrl}/api/content-reports`, {method: 'POST', body: {
        reporterName: 'Titular de prueba', reporterEmail: `titular${index}@example.com`, claimantRole: 'owner', roomCode: creation.payload.room.code,
        protectedWork: `Obra protegida ${index}`, explanation: 'La transmisión utiliza esta obra sin autorización.', goodFaith: true, accuracy: true, signature: 'Titular de prueba',
      }});
      assert.equal(complaint.response.status, 201);
      reports.push(complaint.payload.report.id);
    }
    assert.deepEqual((await jsonRequest(`${app.baseUrl}/api/rooms`)).payload.rooms, []);
    const appeal = await jsonRequest(`${app.baseUrl}/api/content-reports/${reports[0]}/appeals`, {method: 'POST', cookie: creator.cookie, body: {explanation: 'La obra es de mi autoría y adjunto la evidencia.', evidenceUrl: 'https://example.com/licencia', goodFaith: true, signature: 'Artista Propietario'}});
    assert.equal(appeal.response.status, 201);
    const login = await jsonRequest(`${app.baseUrl}/api/admin/login`, {method: 'POST', body: {username: 'moderador', password: 'contraseña-administrativa-123'}});
    const adminCookie = login.response.headers.get('set-cookie').split(';')[0];
    for (const reportId of reports) {
      const decision = await jsonRequest(`${app.baseUrl}/api/admin/content-reports/${reportId}`, {method: 'PATCH', cookie: adminCookie, body: {decision: 'upheld', note: 'Evidencia verificada en la prueba.'}});
      assert.equal(decision.response.status, 200);
    }
    const state = app.productStore.snapshot();
    assert.equal(state.accounts.find(account => account.id === creator.account.id).status, 'suspended');
    assert.equal(state.enforcementActions.filter(action => action.accountId === creator.account.id && action.status === 'active').length, 3);
    const expiredSession = await jsonRequest(`${app.baseUrl}/api/account`, {cookie: creator.cookie});
    assert.equal(expiredSession.response.status, 401);
    const adminReports = await jsonRequest(`${app.baseUrl}/api/admin/content-reports`, {cookie: adminCookie});
    assert.equal(adminReports.payload.reports.length, 3);
    assert.equal(adminReports.payload.reports.find(report => report.id === reports[0]).appeals.length, 1);
    const restoration = await jsonRequest(`${app.baseUrl}/api/admin/content-reports/${reports[0]}`, {method: 'PATCH', cookie: adminCookie, body: {decision: 'restored', note: 'La licencia aportada en la apelación es válida.'}});
    assert.equal(restoration.response.status, 200);
    assert.equal(restoration.payload.activeStrikes, 2);
    assert.equal(app.productStore.snapshot().accounts.find(account => account.id === creator.account.id).status, 'active');
    const renewedLogin = await jsonRequest(`${app.baseUrl}/api/auth/login`, {method: 'POST', body: {email: 'rights-host@example.com', password: 'password-segura-123'}});
    assert.equal(renewedLogin.response.status, 200);
  } finally {
    await app.close();
  }
});

test('una persona con perfil activo puede encender su país fuera de cualquier sala', async () => {
  const app = await startPlatform();
  try {
    const person = await registerTestCreator(app, {
      email: 'global-presence@example.com',
      displayName: 'Persona Global',
      role: 'listener',
    });
    const unauthenticated = await jsonRequest(`${app.baseUrl}/api/global-rave/presence`, {
      method: 'POST',
      body: {countryCode: 'CO',verifiedAt:Date.now(),verifiedBy:'gps'},
    });
    assert.equal(unauthenticated.response.status, 401);
    const withoutConsent = await jsonRequest(`${app.baseUrl}/api/global-rave/presence`, {
      method: 'POST',
      cookie: person.cookie,
      body: {countryCode: 'CO',verifiedAt:Date.now(),verifiedBy:'gps'},
    });
    assert.equal(withoutConsent.response.status, 403);
    await jsonRequest(`${app.baseUrl}/api/account/profile`, {
      method: 'PUT',
      cookie: person.cookie,
      body: {
        displayName: 'Persona Global',
        role: 'listener',
        visible: true,
        social: {allowMessages: true, shareApproximateLocation: true},
      },
    });
    const noGps=await jsonRequest(`${app.baseUrl}/api/global-rave/presence`,{method:'POST',cookie:person.cookie,body:{countryCode:'CO',verifiedAt:Date.now(),verifiedBy:'wifi'}});
    assert.equal(noGps.response.status,400);
    // Global Rave is platform-wide: the user can share a GPS-derived country
    // before joining any room and without obtaining a LiveKit media token.
    const shared = await jsonRequest(`${app.baseUrl}/api/global-rave/presence`, {
      method: 'POST',
      cookie: person.cookie,
      body: {countryCode: 'CO',verifiedAt:Date.now(),verifiedBy:'gps'},
    });
    assert.equal(shared.response.status, 200);
    assert.equal(shared.payload.presence.countryCode, 'CO');
    const persistedProfile = await jsonRequest(`${app.baseUrl}/api/account`, {cookie: person.cookie});
    assert.equal(persistedProfile.payload.profile.globalRaveCountryCode, 'CO');
    const map = await jsonRequest(`${app.baseUrl}/api/global-rave`);
    assert.equal(map.response.status, 200);
    assert.equal(map.payload.total, 1);
    assert.equal(map.payload.activeCountries, 1);
    assert.equal(map.payload.countries[0].points.length, 1);
    assert.equal('latitude' in map.payload.countries[0].points[0], false);
    assert.equal('longitude' in map.payload.countries[0].points[0], false);
    assert.deepEqual(map.payload.countries[0].publicPeople,['Persona Global']);
    assert.doesNotMatch(JSON.stringify(map.payload), /Bogotá|4\.711|-74\.072/);
    await jsonRequest(`${app.baseUrl}/api/account/profile`, {
      method: 'PUT',
      cookie: person.cookie,
      body: {
        displayName: 'Persona Global',
        role: 'listener',
        visible: true,
        social: {allowMessages: true, shareApproximateLocation: true},
      },
    });
    await jsonRequest(`${app.baseUrl}/api/global-rave/presence`, {
      method: 'POST',
      cookie: person.cookie,
      body: {countryCode: 'CO',verifiedAt:Date.now(),verifiedBy:'gps'},
    });
    const accountGps=await jsonRequest(`${app.baseUrl}/api/global-rave/verification`,{cookie:person.cookie});
    assert.equal(accountGps.response.status,200);assert.equal(accountGps.payload.countryCode,'CO');assert.equal(accountGps.payload.verifiedBy,'gps');assert.ok(Number.isFinite(accountGps.payload.verifiedAt));
    const publicMap = await jsonRequest(`${app.baseUrl}/api/global-rave`);
    assert.deepEqual(publicMap.payload.countries[0].publicPeople, ['Persona Global']);
    assert.equal(publicMap.payload.countries[0].privateCount, 0);
    assert.doesNotMatch(JSON.stringify(publicMap.payload), /4\.711|-74\.072/);
    await jsonRequest(`${app.baseUrl}/api/account/profile`,{method:'PUT',cookie:person.cookie,body:{displayName:'Persona Global',visible:false,social:{shareApproximateLocation:true}}});
    assert.equal((await jsonRequest(`${app.baseUrl}/api/global-rave`)).payload.visiblePresenceCount,0);
    assert.equal((await jsonRequest(`${app.baseUrl}/api/global-rave/verification`,{cookie:person.cookie})).response.status,409);
    const privateGps=await jsonRequest(`${app.baseUrl}/api/global-rave/presence`,{method:'POST',cookie:person.cookie,body:{countryCode:'CO',verifiedAt:Date.now(),verifiedBy:'gps'}});
    assert.equal(privateGps.response.status,403);
    const removed = await jsonRequest(`${app.baseUrl}/api/global-rave/presence`, {method: 'DELETE', cookie: person.cookie});
    assert.equal(removed.response.status, 200);
    assert.equal((await jsonRequest(`${app.baseUrl}/api/global-rave`)).payload.total, 0);
    const room = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: person.cookie,
      body: {name: 'Rave cartográfico', visibility: 'public'},
    });
    const code = room.payload.room.code;
    app.setLiveRoomActivity(code, {
      participantCount: 2,
      listenerCount: 1,
      listenerAccountIds: [person.account.id],
      audioLive: true,
      cameraLive: false,
    });
    const restoredFromLiveConnection = await jsonRequest(`${app.baseUrl}/api/global-rave`);
    assert.equal(restoredFromLiveConnection.payload.total, 2);
    assert.equal(restoredFromLiveConnection.payload.visiblePresenceCount, 0);
    assert.equal(restoredFromLiveConnection.payload.activeCountries, 0);
  } finally {
    await app.close();
  }
});

test('el organizador cierra la sesión, desaparece del muro y conserva su historial métrico', async () => {
  const app = await startPlatform();
  try {
    const anonymousHistory = await jsonRequest(`${app.baseUrl}/api/account/sessions`);
    assert.equal(anonymousHistory.response.status, 401);

    const registration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'organizer@example.com', password: 'password-segura-123', displayName: 'DJ Métrica', role: 'dj'},
    });
    const cookie = registration.response.headers.get('set-cookie').split(';')[0];
    const creation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie,
      body: {name: 'Sesión con historia', visibility: 'public'},
    });
    assert.equal(creation.response.status, 201);
    const code = creation.payload.room.code;

    const liveHistory = await jsonRequest(`${app.baseUrl}/api/account/sessions`, {cookie});
    assert.equal(liveHistory.response.status, 200);
    assert.deepEqual(liveHistory.payload.sessions.map(session => session.code), [code]);
    assert.equal(liveHistory.payload.sessions[0].status, 'live');

    const listener = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'listener'},
    });
    assert.equal(listener.response.status, 200);
    app.setLiveRoomActivity(code, {participantCount: 4, listenerCount: 3, audioLive: true, cameraLive: false});
    const wall = await jsonRequest(`${app.baseUrl}/api/rooms`);
    assert.deepEqual(wall.payload.rooms.map(room => room.code), [code]);

    const ended = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/end`, {
      method: 'POST',
      body: {hostToken: creation.payload.hostToken},
    });
    assert.equal(ended.response.status, 200);
    assert.equal(ended.payload.session.status, 'archived');
    assert.deepEqual(app.closedLiveRooms, [`qsession-${code}`]);
    assert.deepEqual((await jsonRequest(`${app.baseUrl}/api/rooms`)).payload.rooms, []);

    const history = await jsonRequest(`${app.baseUrl}/api/account/sessions`, {cookie});
    assert.equal(history.payload.sessions.length, 1);
    assert.equal(history.payload.sessions[0].status, 'archived');
    assert.ok(history.payload.sessions[0].endedAt);
    assert.equal(history.payload.sessions[0].metrics.totalJoins, 1);
    assert.equal(history.payload.sessions[0].metrics.peakListeners, 3);
    assert.ok(history.payload.sessions[0].durationSeconds >= 0);
  } finally {
    await app.close();
  }
});

test('el organizador puede eliminar de forma segura sesiones cerradas o activas', async () => {
  const app = await startPlatform();
  try {
    const ownerRegistration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'owner-delete@example.com', password: 'password-segura-123', displayName: 'DJ Propietaria', role: 'dj'},
    });
    const ownerCookie = ownerRegistration.response.headers.get('set-cookie').split(';')[0];
    const otherRegistration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'other-delete@example.com', password: 'password-segura-123', displayName: 'Otra DJ', role: 'dj'},
    });
    const otherCookie = otherRegistration.response.headers.get('set-cookie').split(';')[0];

    const closedCreation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {name: 'Sesión cerrada eliminable', visibility: 'public'},
    });
    const closedCode = closedCreation.payload.room.code;
    const closed = await jsonRequest(`${app.baseUrl}/api/rooms/${closedCode}/end`, {
      method: 'POST',
      body: {hostToken: closedCreation.payload.hostToken},
    });
    assert.equal(closed.response.status, 200);

    let history = await jsonRequest(`${app.baseUrl}/api/account/sessions`, {cookie: ownerCookie});
    const closedSession = history.payload.sessions.find(session => session.code === closedCode);
    assert.ok(closedSession.id);

    const anonymousDelete = await jsonRequest(`${app.baseUrl}/api/account/sessions/${closedSession.id}`, {method: 'DELETE'});
    assert.equal(anonymousDelete.response.status, 401);
    const foreignDelete = await jsonRequest(`${app.baseUrl}/api/account/sessions/${closedSession.id}`, {
      method: 'DELETE',
      cookie: otherCookie,
    });
    assert.equal(foreignDelete.response.status, 403);
    const ownerDelete = await jsonRequest(`${app.baseUrl}/api/account/sessions/${closedSession.id}`, {
      method: 'DELETE',
      cookie: ownerCookie,
    });
    assert.equal(ownerDelete.response.status, 200);
    assert.equal(ownerDelete.payload.deleted, true);
    assert.equal((await jsonRequest(`${app.baseUrl}/api/rooms/${closedCode}`)).response.status, 404);

    const activeCreation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {name: 'Sesión activa eliminable', visibility: 'public'},
    });
    const activeCode = activeCreation.payload.room.code;
    app.setLiveRoomActivity(activeCode, {participantCount: 2, listenerCount: 1, audioLive: true, cameraLive: false});
    assert.deepEqual((await jsonRequest(`${app.baseUrl}/api/rooms`)).payload.rooms.map(room => room.code), [activeCode]);
    history = await jsonRequest(`${app.baseUrl}/api/account/sessions`, {cookie: ownerCookie});
    const activeSession = history.payload.sessions.find(session => session.code === activeCode);
    assert.ok(activeSession.id);

    const activeDelete = await jsonRequest(`${app.baseUrl}/api/account/sessions/${activeSession.id}`, {
      method: 'DELETE',
      cookie: ownerCookie,
    });
    assert.equal(activeDelete.response.status, 200);
    assert.equal(activeDelete.payload.session.status, 'live');
    assert.deepEqual((await jsonRequest(`${app.baseUrl}/api/rooms`)).payload.rooms, []);
    assert.deepEqual((await jsonRequest(`${app.baseUrl}/api/account/sessions`, {cookie: ownerCookie})).payload.sessions, []);
    assert.deepEqual(app.closedLiveRooms, [`qsession-${closedCode}`, `qsession-${activeCode}`]);
  } finally {
    await app.close();
  }
});

test('una sala global entrega credenciales separadas para DJ y oyente', async () => {
  const app = await startPlatform();
  try {
    const creator = await registerTestCreator(app, {displayName: 'DJ Sol'});
    const creation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {name: 'Rave sin fronteras', djName: 'DJ Sol', visibility: 'public', timeZone: 'America/Bogota'},
    });
    assert.equal(creation.response.status, 201);
    assert.match(creation.payload.joinUrl, /^https:\/\/qsession\.org\/join\/[A-Z0-9]{6}$/);
    assert.equal(creation.payload.room.mediaTopology, 'adaptive');

    const code = creation.payload.room.code;
    assert.equal(app.productStore.getRoomRecord(code).rightsDeclaration, null);
    assert.equal(creation.payload.room.timeZone, 'America/Bogota');
    const privateCreation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {name: 'Sala secreta', djName: 'DJ Luna', visibility: 'private'},
    });
    assert.equal(privateCreation.response.status, 201);
    const inactiveDirectory = await jsonRequest(`${app.baseUrl}/api/rooms`);
    assert.deepEqual(inactiveDirectory.payload.rooms, []);
    app.setLiveRoomActivity(code, {participantCount: 2, listenerCount: 1, audioLive: true, cameraLive: false});
    const publicDirectory = await jsonRequest(`${app.baseUrl}/api/rooms`);
    assert.equal(publicDirectory.response.status, 200);
    assert.equal(publicDirectory.payload.realtime, true);
    assert.deepEqual(publicDirectory.payload.rooms.map(room => room.code), [code]);
    assert.equal(publicDirectory.payload.rooms[0].visibility, 'public');
    assert.equal(publicDirectory.payload.rooms[0].participantCount, 2);
    assert.equal(publicDirectory.payload.rooms[0].listenerCount, 1);
    assert.equal(publicDirectory.payload.rooms[0].audioLive, true);
    const invitation = await (await fetch(`${app.baseUrl}/?room=${code}`)).text();
    assert.match(invitation, /<meta property="og:title" content="Rave sin fronteras · DJ Sol"/);
    assert.match(invitation, /<meta property="og:description" content="Inicio: [^"]+ · Sala [A-Z0-9]{6}\. Entra a escuchar a DJ Sol en Q Session\."/);
    assert.match(invitation, new RegExp(`<meta property="og:url" content="https://qsession\\.org/join/${code}"`));
    assert.match(invitation, /<meta property="og:image" content="https:\/\/qsession\.org\/brand\/qsession-icon-master\.png\?v=20260911-brand-logo-v1"/);
    const listener = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'listener'},
    });
    assert.equal(listener.response.status, 200);
    assert.equal(listener.payload.delivery.kind, 'webrtc');
    assert.deepEqual(listener.payload.permissions, ['listen', 'participant-camera']);
    assert.equal(jwtPayload(listener.payload.token).video.canPublish, true);
    assert.deepEqual(jwtPayload(listener.payload.token).video.canPublishSources, ['camera']);

    const nativeAudioListener = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'listener', nativeAudio: true},
    });
    const nativeAudioToken = jwtPayload(nativeAudioListener.payload.token);
    assert.equal(nativeAudioListener.response.status, 200);
    assert.deepEqual(nativeAudioListener.payload.permissions, ['listen']);
    assert.equal(nativeAudioToken.video.hidden, true);
    assert.equal(nativeAudioToken.video.canPublish, false);
    assert.equal(nativeAudioToken.video.canPublishData, false);
    assert.equal(nativeAudioToken.video.canUpdateOwnMetadata, false);
    assert.match(nativeAudioToken.sub, /^native-audio-/);
    assert.equal('metadata' in nativeAudioToken, false);

    const listenerRegistration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'public-listener@example.com', password: 'password-segura-123', displayName: 'Mar', role: 'listener'},
    });
    const listenerCookie = listenerRegistration.response.headers.get('set-cookie').split(';')[0];
    const publicListenerProfile = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
      method: 'PUT',
      cookie: listenerCookie,
      body: {displayName: 'Mar', role: 'listener', visible: true, city: 'Cartagena', country: 'Colombia', social: {showResidence: false, shareApproximateLocation: false}},
    });
    const publicListener = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      cookie: listenerCookie,
      body: {role: 'listener'},
    });
    const publicListenerToken = jwtPayload(publicListener.payload.token);
    const publicListenerMetadata = JSON.parse(publicListenerToken.metadata);
    assert.deepEqual(publicListener.payload.permissions, ['listen', 'social-camera']);
    assert.equal(publicListenerToken.video.canPublish, true);
    assert.deepEqual(publicListenerToken.video.canPublishSources, ['camera']);
    assert.equal(publicListenerToken.video.canUpdateOwnMetadata, true);
    assert.equal(publicListenerMetadata.profileId, publicListenerProfile.payload.profile.id);
    assert.equal(publicListenerMetadata.displayName, 'Mar');
    assert.equal(publicListenerMetadata.city, null);
    assert.equal(publicListenerMetadata.country, null);
    assert.deepEqual(publicListenerMetadata.social, {allowMatchmaking: false, allowMessages: false, allowTips: true});

    const noGuestCameraRoom = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {name: 'Audio solamente', djName: 'Anfitrión', visibility: 'private', allowGuestCameras: false},
    });
    const noGuestCamera = await jsonRequest(`${app.baseUrl}/api/rooms/${noGuestCameraRoom.payload.room.code}/media-token`, {
      method: 'POST',
      cookie: listenerCookie,
      body: {role: 'listener'},
    });
    assert.equal(noGuestCamera.response.status, 200);
    assert.deepEqual(noGuestCamera.payload.permissions, ['listen']);
    assert.equal(jwtPayload(noGuestCamera.payload.token).video.canPublish, false);

    const professionalRoom = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {
        name: 'Reunión de trabajo', roomType: 'professional', visibility: 'private',
        allowGuestCameras: true, allowSocialProfiles: false, allowMatchmaking: false, allowProfileGifts: false,
      },
    });
    const professionalListener = await jsonRequest(`${app.baseUrl}/api/rooms/${professionalRoom.payload.room.code}/media-token`, {
      method: 'POST', cookie: listenerCookie, body: {role: 'listener'},
    });
    const professionalToken = jwtPayload(professionalListener.payload.token);
    assert.deepEqual(professionalListener.payload.permissions, ['listen', 'participant-camera']);
    assert.equal(professionalToken.video.canPublish, true);
    assert.equal('metadata' in professionalToken, false);

    const rejectedDj = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'dj', hostToken: 'incorrecto'},
    });
    assert.equal(rejectedDj.response.status, 403);

    const dj = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'dj', hostToken: creation.payload.hostToken},
    });
    assert.equal(dj.response.status, 200);
    assert.equal(jwtPayload(dj.payload.token).sub, `dj-primary-${code.toLowerCase()}`);
    assert.deepEqual(jwtPayload(dj.payload.token).video.canPublishSources, ['microphone', 'camera', 'screen_share', 'screen_share_audio']);
    assert.equal(jwtPayload(dj.payload.token).video.canUpdateOwnMetadata, true);

    const desktopTabAudio = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'dj', hostToken: creation.payload.hostToken, nativeBroadcastAudio: true},
    });
    const desktopTabAudioToken = jwtPayload(desktopTabAudio.payload.token);
    assert.equal(desktopTabAudio.response.status, 200);
    assert.deepEqual(app.replacedDesktopAudioRooms, [`qsession-${code}`]);
    assert.deepEqual(desktopTabAudio.payload.permissions, ['audio']);
    assert.equal(desktopTabAudioToken.video.hidden, true);
    assert.equal(desktopTabAudioToken.video.canPublish, true);
    assert.deepEqual(desktopTabAudioToken.video.canPublishSources, ['screen_share_audio']);
    assert.equal(desktopTabAudioToken.video.canPublishData, false);
    assert.equal(desktopTabAudioToken.video.canUpdateOwnMetadata, false);
    assert.equal(desktopTabAudioToken.sub, `desktop-tab-audio-${code.toLowerCase()}`);
    assert.equal('metadata' in desktopTabAudioToken, false);

    const rejectedEnd = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/end`, {
      method: 'POST',
      body: {hostToken: 'incorrecto'},
    });
    assert.equal(rejectedEnd.response.status, 403);
    const ended = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/end`, {
      method: 'POST',
      body: {hostToken: creation.payload.hostToken},
    });
    assert.equal(ended.response.status, 200);
    assert.equal(ended.payload.room.status, 'archived');
    assert.equal((await fetch(`${app.baseUrl}/api/rooms/${code}`)).status, 404);
    const directoryAfterEnd = await jsonRequest(`${app.baseUrl}/api/rooms`);
    assert.deepEqual(directoryAfterEnd.payload.rooms, []);
  } finally {
    await app.close();
  }
});

test('una sala inicia una sola salida HLS de borde y la detiene al finalizar', async () => {
  const started = [];
  const stopped = [];
  const edgeBroadcast = {
    configured: true,
    provider: 'r2-hls',
    segmentDuration: 4,
    approximateLatencySeconds: 12,
    playbackUrl: code => `https://live.qsession.org/live/${code}-SIGNED/index.m3u8`,
    async start(code, options) {
      started.push({code, options});
      return {
        configured: true,
        provider: 'r2-hls',
        roomCode: code,
        egressId: 'EG_TEST',
        state: 'starting',
        ready: false,
        playbackUrl: this.playbackUrl(code),
        segmentDuration: 4,
        approximateLatencySeconds: 12,
      };
    },
    async status(code) {
      return {
        configured: true,
        provider: 'r2-hls',
        roomCode: code,
        egressId: 'EG_TEST',
        state: 'active',
        ready: true,
        playbackUrl: this.playbackUrl(code),
        segmentDuration: 4,
        approximateLatencySeconds: 12,
      };
    },
    async stop(code) {
      stopped.push(code);
      return {configured: true, roomCode: code, state: 'ending', stopped: 1};
    },
  };
  const app = await startPlatform({edgeBroadcast});
  try {
    const creator = await registerTestCreator(app, {email: 'edge-host@example.com'});
    const creation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {name: 'Rave de borde', visibility: 'public'},
    });
    const code = creation.payload.room.code;
    const rejected = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/broadcast/start`, {
      method: 'POST',
      body: {hostToken: 'incorrecto'},
    });
    assert.equal(rejected.response.status, 403);

    const start = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/broadcast/start`, {
      method: 'POST',
      body: {hostToken: creation.payload.hostToken},
    });
    assert.equal(start.response.status, 202);
    assert.equal(start.payload.broadcast.provider, 'r2-hls');
    assert.equal(start.payload.broadcast.playbackUrl, `https://live.qsession.org/live/${code}-SIGNED/index.m3u8`);
    assert.deepEqual(started, [{code, options: {participantIdentity: `dj-primary-${code.toLowerCase()}`}}]);

    const listener = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'listener'},
    });
    assert.equal(listener.payload.delivery.kind, 'broadcast');
    assert.equal(listener.payload.delivery.provider, 'r2-hls');
    assert.equal(listener.payload.delivery.fallback.kind, 'webrtc');
    assert.doesNotMatch(JSON.stringify(listener.payload), /R2_SECRET|api-secret/);

    const status = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/broadcast`);
    assert.equal(status.payload.broadcast.ready, true);

    const ended = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/end`, {
      method: 'POST',
      body: {hostToken: creation.payload.hostToken},
    });
    assert.equal(ended.response.status, 200);
    assert.deepEqual(stopped, [code]);
  } finally {
    await app.close();
  }
});

test('el origen HLS local entrega sólo playlists y segmentos con CORS y caché segura', async () => {
  const edgeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-edge-'));
  const streamDirectory = path.join(edgeDirectory, 'live', 'ABC123-123456789012345678');
  fs.mkdirSync(streamDirectory, {recursive: true});
  fs.writeFileSync(path.join(streamDirectory, 'index.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.0,\nsegment_00001.ts\n');
  fs.writeFileSync(path.join(streamDirectory, 'segment_00001.ts'), Buffer.from([0x47, 0x40, 0x00, 0x10]));
  const app = await startPlatform({edgeMediaDirectory: edgeDirectory});
  try {
    const playlist = await fetch(`${app.baseUrl}/edge-live/live/ABC123-123456789012345678/index.m3u8`);
    assert.equal(playlist.status, 200);
    assert.equal(playlist.headers.get('content-type'), 'application/vnd.apple.mpegurl');
    assert.equal(playlist.headers.get('access-control-allow-origin'), '*');
    assert.match(playlist.headers.get('cache-control'), /max-age=1/);
    const segment = await fetch(`${app.baseUrl}/edge-live/live/ABC123-123456789012345678/segment_00001.ts`);
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get('content-type'), 'video/mp2t');
    assert.match(segment.headers.get('cache-control'), /immutable/);
    const cdnPlaylist = await fetch(`${app.baseUrl}/edge-live/live/ABC123-123456789012345678/index.m3u8.txt`);
    assert.equal(cdnPlaylist.status, 200);
    assert.equal(cdnPlaylist.headers.get('content-type'), 'application/vnd.apple.mpegurl');
    assert.match(await cdnPlaylist.text(), /segment_00001\.ts\.bin/);
    const cdnSegment = await fetch(`${app.baseUrl}/edge-live/live/ABC123-123456789012345678/segment_00001.ts.bin`);
    assert.equal(cdnSegment.status, 200);
    assert.equal(cdnSegment.headers.get('content-type'), 'video/mp2t');
    assert.equal((await fetch(`${app.baseUrl}/edge-live/..%2Fstate.json`)).status, 404);
  } finally {
    await app.close();
    fs.rmSync(edgeDirectory, {recursive: true, force: true});
  }
});

test('la configuración de sala aplica programación, promociones, capacidad y contraseña', async () => {
  const app = await startPlatform();
  try {
    const creator = await registerTestCreator(app, {displayName: 'Ana'});
    const anonymousPromotion = await jsonRequest(`${app.baseUrl}/api/promotion-media`, {
      method: 'POST',
      body: {dataUrl: 'data:image/png;base64,invalid'},
    });
    assert.equal(anonymousPromotion.response.status, 401);
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const promotionUpload = await jsonRequest(`${app.baseUrl}/api/promotion-media`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {dataUrl: tinyPng, name: 'hotel-rio.png'},
    });
    assert.equal(promotionUpload.response.status, 201);
    assert.equal(promotionUpload.payload.media.contentType, 'image/png');
    const tinyMp4 = Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]).toString('base64');
    const videoPromotionUpload = await jsonRequest(`${app.baseUrl}/api/promotion-media`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {dataUrl: `data:video/mp4;base64,${tinyMp4}`, name: 'fundacion-sol.mp4'},
    });
    assert.equal(videoPromotionUpload.response.status, 201);
    assert.equal(videoPromotionUpload.payload.media.contentType, 'video/mp4');
    const unsafePromotion = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {name: 'Promoción insegura', promotions: [{sponsor: 'Marca', linkUrl: 'javascript:alert(1)'}]},
    });
    assert.equal(unsafePromotion.response.status, 400);
    assert.match(unsafePromotion.payload.error, /http:\/\/ o https:\/\//);
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const creation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {
        name: 'Clase de movimiento',
        djName: 'Ana',
        roomType: 'yoga-meditation',
        visibility: 'public',
        scheduledAt,
        timeZone: 'America/Bogota',
        capacity: 500,
        capacityMode: 'limited',
        accessMethods: ['link', 'qr'],
        translation: {sourceLanguage: 'es', mode: 'audio', targetLanguages: ['en', 'de']},
        sponsors: 'Hotel Río, Fundación Sol',
        promotions: [
          {
            sponsor: 'Hotel Río',
            headline: 'Reserva con beneficio para asistentes',
            linkUrl: 'https://hotel.example/reserva?origen=qsession',
            mediaId: promotionUpload.payload.media.id,
          },
          {
            sponsor: 'Fundación Sol',
            headline: 'Conoce nuestro proyecto',
            linkUrl: 'www.fundacion.example/proyecto',
            mediaId: videoPromotionUpload.payload.media.id,
          },
        ],
        password: 'secreto-2026',
        allowPublicChat: false,
        allowGuestCameras: true,
        allowSocialProfiles: false,
        allowMatchmaking: false,
        allowProfileGifts: false,
        allowSharedFiles: true,
        allowSpeakingQueue: true,
        allowQuestions: true,
        allowPolls: false,
        allowReactions: true,
        allowRecording: true,
      },
    });
    assert.equal(creation.response.status, 201);
    assert.equal(creation.payload.room.status, 'waiting');
    assert.equal(creation.payload.room.capacity, 500);
    assert.equal(creation.payload.room.capacityMode, 'limited');
    assert.deepEqual(creation.payload.room.accessMethods, ['link', 'qr']);
    assert.deepEqual(creation.payload.room.translation, {
      sourceLanguage: 'es', mode: 'audio', targetLanguages: ['en', 'de'],
    });
    assert.deepEqual(creation.payload.room.sponsors, ['Hotel Río', 'Fundación Sol']);
    assert.equal(creation.payload.room.promotions.length, 2);
    assert.equal(creation.payload.room.promotions[0].sponsor, 'Hotel Río');
    assert.equal(creation.payload.room.promotions[0].headline, 'Reserva con beneficio para asistentes');
    assert.equal(creation.payload.room.promotions[0].linkUrl, 'https://hotel.example/reserva?origen=qsession');
    assert.equal(creation.payload.room.promotions[0].media.url, promotionUpload.payload.media.url);
    assert.equal(creation.payload.room.promotions[1].linkUrl, 'https://www.fundacion.example/proyecto');
    const publicPromotion = await fetch(`${app.baseUrl}${creation.payload.room.promotions[0].media.url}`);
    assert.equal(publicPromotion.status, 200);
    assert.equal(publicPromotion.headers.get('content-type'), 'image/png');
    const publicVideoPromotion = await fetch(`${app.baseUrl}${creation.payload.room.promotions[1].media.url}`, {
      headers: {Range: 'bytes=0-7'},
    });
    assert.equal(publicVideoPromotion.status, 206);
    assert.equal(publicVideoPromotion.headers.get('content-type'), 'video/mp4');
    assert.equal((await publicVideoPromotion.arrayBuffer()).byteLength, 8);
    assert.equal(creation.payload.room.passwordProtected, true);
    assert.equal(creation.payload.room.roomType, 'yoga-meditation');
    assert.equal(creation.payload.room.allowPublicChat, false);
    assert.equal(creation.payload.room.allowGuestCameras, true);
    assert.equal(creation.payload.room.allowSocialProfiles, false);
    assert.equal(creation.payload.room.allowMatchmaking, false);
    assert.equal(creation.payload.room.allowProfileGifts, false);
    assert.equal(creation.payload.room.allowSharedFiles, true);
    assert.equal(creation.payload.room.allowSpeakingQueue, true);
    assert.equal(creation.payload.room.allowQuestions, true);
    assert.equal(creation.payload.room.allowPolls, false);
    assert.equal(creation.payload.room.allowReactions, true);
    assert.equal(creation.payload.room.allowRecording, true);
    assert.equal(creation.payload.room.designTheme, 'serenity');
    assert.equal(creation.payload.room.designMotion, 'calm');
    assert.equal(creation.payload.room.allowAiCameraEffects, false);
    assert.equal(creation.payload.room.allowVjVisuals, false);
    assert.equal(creation.payload.room.allowVideoSubmissions, true);
    assert.equal(creation.payload.room.allowGreetingVideos, false);
    assert.equal(creation.payload.room.allowVideoToHost, true);
    assert.equal(creation.payload.room.allowVideoToRoom, true);
    assert.equal(creation.payload.room.allowPrivateVideoSubmissions, true);
    assert.equal('passwordHash' in creation.payload.room, false);
    assert.ok(creation.payload.accessToken);

    const code = creation.payload.room.code;
    const directory = await jsonRequest(`${app.baseUrl}/api/rooms`);
    assert.deepEqual(directory.payload.rooms, []);
    const directRoom = await jsonRequest(`${app.baseUrl}/api/rooms/${code}`);
    assert.equal(directRoom.payload.room.code, code);
    assert.equal(directRoom.payload.room.passwordProtected, true);

    const unauthorizedConfiguration = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/configuration`, {
      method: 'PATCH', body: {visibility: 'private'},
    });
    assert.equal(unauthorizedConfiguration.response.status, 403);
    const configuration = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/configuration`, {
      method: 'PATCH',
      body: {
        hostToken: creation.payload.hostToken,
        visibility: 'private', capacity: 240, capacityMode: 'expected', accessMethods: ['code'],
        translation: {sourceLanguage: 'de', mode: 'subtitles', targetLanguages: ['es', 'en']},
        allowPublicChat: true, allowGuestCameras: false, allowSharedFiles: false,
        allowSpeakingQueue: true, allowQuestions: true, allowPolls: true,
        allowReactions: false, allowRecording: false,
      },
    });
    assert.equal(configuration.response.status, 200);
    assert.equal(configuration.payload.room.visibility, 'private');
    assert.equal(configuration.payload.room.capacity, 240);
    assert.deepEqual(configuration.payload.room.accessMethods, ['code']);
    assert.deepEqual(configuration.payload.room.translation, {
      sourceLanguage: 'de', mode: 'subtitles', targetLanguages: ['es', 'en'],
    });
    assert.equal(configuration.payload.room.allowSharedFiles, false);
    assert.equal(configuration.payload.room.allowPolls, true);
    assert.equal(configuration.payload.room.allowReactions, false);

    const denied = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/access`, {
      method: 'POST',
      body: {password: 'incorrecta'},
    });
    assert.equal(denied.response.status, 403);
    const access = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/access`, {
      method: 'POST',
      body: {password: 'secreto-2026'},
    });
    assert.equal(access.response.status, 200);
    assert.ok(access.payload.accessToken);

    const tooEarly = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'listener', accessToken: access.payload.accessToken},
    });
    assert.equal(tooEarly.response.status, 409);

    app.setLiveRoomActivity(code, {participantCount: 1, listenerCount: 0, audioLive: true, cameraLive: true});
    const detectedLiveRoom = await jsonRequest(`${app.baseUrl}/api/rooms/${code}`);
    assert.equal(detectedLiveRoom.response.status, 200);
    assert.equal(detectedLiveRoom.payload.room.status, 'live');
    const recoveredListener = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'listener', accessToken: access.payload.accessToken},
    });
    assert.equal(recoveredListener.response.status, 200);
    const recoveredRoom = await jsonRequest(`${app.baseUrl}/api/rooms/${code}`);
    assert.equal(recoveredRoom.payload.room.status, 'live');
    assert.ok(recoveredRoom.payload.room.startedAt);

    const host = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`, {
      method: 'POST',
      body: {role: 'dj', hostToken: creation.payload.hostToken},
    });
    assert.equal(host.response.status, 200);

    const hostStart = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: creator.cookie,
      body: {name: 'Sesión que comienza antes', visibility: 'public', scheduledAt},
    });
    const earlyHost = await jsonRequest(`${app.baseUrl}/api/rooms/${hostStart.payload.room.code}/media-token`, {
      method: 'POST',
      body: {role: 'dj', hostToken: hostStart.payload.hostToken},
    });
    assert.equal(earlyHost.response.status, 200);
    const earlyStartedRoom = await jsonRequest(`${app.baseUrl}/api/rooms/${hostStart.payload.room.code}`);
    assert.equal(earlyStartedRoom.payload.room.status, 'live');
    assert.ok(earlyStartedRoom.payload.room.startedAt);
  } finally {
    await app.close();
  }
});

test('el chat de sala usa la cuenta activa y respeta el permiso de mensajes', async () => {
  const app = await startPlatform();
  try {
    const registration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'oyente@example.com', password: 'password-segura-123', displayName: 'Patricio', role: 'listener'},
    });
    const cookie = registration.response.headers.get('set-cookie').split(';')[0];
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const upload = await jsonRequest(`${app.baseUrl}/api/profile-media`, {
      method: 'POST',
      cookie,
      body: {dataUrl: tinyPng},
    });
    assert.equal(upload.response.status, 201);
    const creation = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie,
      body: {name: 'Rave de prueba', djName: 'DJ Sol', visibility: 'public'},
    });
    const code = creation.payload.room.code;

    const anonymousRead = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/messages`);
    assert.equal(anonymousRead.response.status, 401);

    const blocked = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/messages`, {
      method: 'POST',
      cookie,
      body: {text: 'Hola'},
    });
    assert.equal(blocked.response.status, 403);

    const saved = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
      method: 'PUT',
      cookie,
      body: {
        displayName: 'Patricio',
        role: 'listener',
        visible: true,
        photos: [{id: upload.payload.media.id}],
        social: {allowMessages: true},
      },
    });
    assert.equal(saved.response.status, 200);
    app.setRoomChatParticipants(code, [registration.payload.account.id]);

    const sent = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/messages`, {
      method: 'POST',
      cookie,
      body: {text: 'Hola desde mi cuenta', author: 'Nombre falso', profileId: 'profile_falso'},
    });
    assert.equal(sent.response.status, 201);
    assert.equal(sent.payload.message.author, 'Patricio');
    assert.equal(sent.payload.message.profileId, saved.payload.profile.id);
    assert.equal(sent.payload.presence.participantCount, 1);

    const otherRoom = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie,
      body: {name: 'Otra sala activa', djName: 'DJ Luna', visibility: 'public'},
    });
    const otherRoomChat = await jsonRequest(`${app.baseUrl}/api/rooms/${otherRoom.payload.room.code}/messages`, {cookie});
    assert.equal(otherRoomChat.response.status, 409);
    assert.match(otherRoomChat.payload.error, /sólo mientras estás conectado a esta sala/);

    const chatDisabledRoom = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie,
      body: {name: 'Sala sin chat', visibility: 'private', allowPublicChat: false},
    });
    const disabledChat = await jsonRequest(`${app.baseUrl}/api/rooms/${chatDisabledRoom.payload.room.code}/messages`, {cookie});
    assert.equal(disabledChat.response.status, 403);

    const history = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/messages`, {cookie});
    assert.equal(history.response.status, 200);
    assert.equal(history.payload.presence.participantCount, 1);
    assert.equal(history.payload.room.code, code);
    assert.equal(history.payload.messages.length, 1);
    assert.equal(history.payload.messages[0].text, 'Hola desde mi cuenta');
    assert.equal(history.payload.messages[0].avatarUrl, `/api/profile-media/${upload.payload.media.id}`);

    const qmoji = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/messages`, {
      method: 'POST',
      cookie,
      body: {kind: 'reaction', text: ':q50:'},
    });
    assert.equal(qmoji.response.status, 201);
    assert.equal(qmoji.payload.message.kind, 'reaction');
    assert.equal(qmoji.payload.message.text, ':q50:');

    const hidden = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
      method: 'PUT',
      cookie,
      body: {
        displayName: 'Patricio',
        role: 'listener',
        visible: false,
        photos: [{id: upload.payload.media.id}],
        social: {allowMessages: true},
      },
    });
    assert.equal(hidden.response.status, 200);
    const privateHistory = await jsonRequest(`${app.baseUrl}/api/rooms/${code}/messages`, {cookie});
    assert.equal(privateHistory.payload.messages[0].author, 'Oyente');
    assert.equal(privateHistory.payload.messages[0].avatarUrl, null);
  } finally {
    await app.close();
  }
});

test('el chat privado permite uno a uno, grupos y voz exclusiva para sus integrantes', async () => {
  const app = await startPlatform();
  try {
    async function createChatUser(email, displayName) {
      const registration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
        method: 'POST',
        body: {email, password: 'password-segura-123', displayName, role: 'listener'},
      });
      const cookie = registration.response.headers.get('set-cookie').split(';')[0];
      const saved = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
        method: 'PUT',
        cookie,
        body: {displayName, role: 'listener', visible: true, social: {allowMessages: true}},
      });
      return {cookie, profile: saved.payload.profile};
    }

    const luna = await createChatUser('luna-private@example.com', 'Luna');
    const mar = await createChatUser('mar-private@example.com', 'Mar');
    const sol = await createChatUser('sol-private@example.com', 'Sol');

    const unrelatedContacts = await jsonRequest(`${app.baseUrl}/api/chat/contacts`, {cookie: luna.cookie});
    assert.equal(unrelatedContacts.response.status, 200);
    assert.deepEqual(unrelatedContacts.payload.contacts, []);

    await jsonRequest(`${app.baseUrl}/api/profiles/${mar.profile.id}/saved`, {
      method: 'PUT', cookie: luna.cookie, body: {saved: true},
    });
    await jsonRequest(`${app.baseUrl}/api/profiles/${sol.profile.id}/saved`, {
      method: 'PUT', cookie: luna.cookie, body: {saved: true},
    });
    const contacts = await jsonRequest(`${app.baseUrl}/api/chat/contacts`, {cookie: luna.cookie});
    assert.equal(contacts.response.status, 200);
    assert.deepEqual(contacts.payload.contacts.map(contact => contact.displayName), ['Mar', 'Sol']);

    const direct = await jsonRequest(`${app.baseUrl}/api/private-conversations`, {
      method: 'POST',
      cookie: luna.cookie,
      body: {type: 'direct', memberProfileIds: [mar.profile.id]},
    });
    assert.equal(direct.response.status, 201);
    assert.equal(direct.payload.conversation.type, 'direct');
    assert.equal(direct.payload.conversation.title, 'Mar');
    assert.equal(direct.payload.conversation.memberCount, 2);

    const duplicate = await jsonRequest(`${app.baseUrl}/api/private-conversations`, {
      method: 'POST',
      cookie: luna.cookie,
      body: {type: 'direct', memberProfileIds: [mar.profile.id]},
    });
    assert.equal(duplicate.payload.conversation.id, direct.payload.conversation.id);

    const privateMessage = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/messages`, {
      method: 'POST',
      cookie: luna.cookie,
      body: {text: 'Este mensaje sólo es para Mar'},
    });
    assert.equal(privateMessage.response.status, 201);

    const marHistory = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/messages`, {cookie: mar.cookie});
    assert.equal(marHistory.response.status, 200);
    assert.equal(marHistory.payload.messages.length, 1);
    assert.equal(marHistory.payload.messages[0].author, 'Luna');
    assert.equal(marHistory.payload.messages[0].text, 'Este mensaje sólo es para Mar');

    const outsiderHistory = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/messages`, {cookie: sol.cookie});
    assert.equal(outsiderHistory.response.status, 404);

    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const attachment = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/attachments`, {
      method: 'POST',
      cookie: luna.cookie,
      body: {dataUrl: tinyPng, name: 'recuerdo.png'},
    });
    assert.equal(attachment.response.status, 201);
    assert.equal(attachment.payload.message.kind, 'image');
    assert.equal(attachment.payload.message.media.originalName, 'recuerdo.png');
    assert.match(attachment.payload.message.media.url, /^\/api\/private-media\/private_media_/);

    const mediaUrl = `${app.baseUrl}${attachment.payload.message.media.url}`;
    const memberMedia = await fetch(mediaUrl, {headers: {Cookie: mar.cookie}});
    assert.equal(memberMedia.status, 200);
    assert.equal(memberMedia.headers.get('content-type'), 'image/png');
    assert.ok((await memberMedia.arrayBuffer()).byteLength > 0);
    const mediaRange = await fetch(mediaUrl, {headers: {Cookie: mar.cookie, Range: 'bytes=0-7'}});
    assert.equal(mediaRange.status, 206);
    assert.match(mediaRange.headers.get('content-range'), /^bytes 0-7\//);
    assert.equal((await mediaRange.arrayBuffer()).byteLength, 8);
    const outsiderMedia = await fetch(mediaUrl, {headers: {Cookie: sol.cookie}});
    assert.equal(outsiderMedia.status, 404);
    const anonymousMedia = await fetch(mediaUrl);
    assert.equal(anonymousMedia.status, 404);

    const tinyM4a = Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]).toString('base64');
    const voiceNote = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/attachments`, {
      method: 'POST',
      cookie: luna.cookie,
      body: {dataUrl: `data:audio/mp4;base64,${tinyM4a}`, name: 'nota.m4a', durationMs: 4200},
    });
    assert.equal(voiceNote.response.status, 201);
    assert.equal(voiceNote.payload.message.kind, 'voice');
    assert.equal(voiceNote.payload.message.audio.durationMs, 4200);
    assert.match(voiceNote.payload.message.audio.url, /^\/api\/private-media\/private_media_/);
    const voiceMedia = await fetch(`${app.baseUrl}${voiceNote.payload.message.audio.url}`, {headers: {Cookie: mar.cookie}});
    assert.equal(voiceMedia.status, 200);
    assert.equal(voiceMedia.headers.get('content-type'), 'audio/mp4');
    assert.equal((await voiceMedia.arrayBuffer()).byteLength, 12);
    const outsiderVoice = await fetch(`${app.baseUrl}${voiceNote.payload.message.audio.url}`, {headers: {Cookie: sol.cookie}});
    assert.equal(outsiderVoice.status, 404);

    const historyWithMedia = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/messages`, {cookie: mar.cookie});
    assert.equal(historyWithMedia.payload.messages.length, 3);
    assert.equal(historyWithMedia.payload.messages[1].kind, 'image');
    assert.equal(historyWithMedia.payload.messages[1].media.url, attachment.payload.message.media.url);
    assert.equal(historyWithMedia.payload.messages[2].kind, 'voice');
    assert.equal(historyWithMedia.payload.messages[2].audio.url, voiceNote.payload.message.audio.url);
    const latestPage = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/messages?limit=1`, {cookie: mar.cookie});
    assert.equal(latestPage.payload.messages[0].kind, 'voice');
    assert.equal(latestPage.payload.pagination.hasMore, true);
    const earlierPage = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/messages?limit=1&before=${encodeURIComponent(latestPage.payload.pagination.nextBefore)}`, {cookie: mar.cookie});
    assert.equal(earlierPage.payload.messages[0].kind, 'image');
    assert.equal(earlierPage.payload.pagination.hasMore, true);

    const voice = await jsonRequest(`${app.baseUrl}/api/private-conversations/${direct.payload.conversation.id}/voice-token`, {
      method: 'POST',
      cookie: mar.cookie,
      body: {notifyMembers: true},
    });
    assert.equal(voice.response.status, 200);
    assert.deepEqual(voice.payload.permissions, ['listen', 'microphone', 'camera']);
    assert.equal(jwtPayload(voice.payload.token).video.room, `qsession-private-${direct.payload.conversation.id}`);
    assert.deepEqual(jwtPayload(voice.payload.token).video.canPublishSources, ['microphone', 'camera']);
    const lunaCallActivity = await jsonRequest(`${app.baseUrl}/api/profile-actions?limit=100`, {cookie: luna.cookie});
    assert.equal(lunaCallActivity.response.status, 200);
    assert.equal(lunaCallActivity.payload.realtime.channel, `profile:${luna.profile.id}`);
    assert.equal(lunaCallActivity.payload.actions[0].type, 'call');
    assert.equal(lunaCallActivity.payload.actions[0].conversationId, direct.payload.conversation.id);
    assert.equal(lunaCallActivity.payload.actions[0].sender.displayName, 'Mar');

    const group = await jsonRequest(`${app.baseUrl}/api/private-conversations`, {
      method: 'POST',
      cookie: luna.cookie,
      body: {type: 'group', name: 'Amigos de la sesión', memberProfileIds: [mar.profile.id, sol.profile.id]},
    });
    assert.equal(group.response.status, 201);
    assert.equal(group.payload.conversation.type, 'group');
    assert.equal(group.payload.conversation.title, 'Amigos de la sesión');
    assert.equal(group.payload.conversation.memberCount, 3);

    const solConversations = await jsonRequest(`${app.baseUrl}/api/private-conversations`, {cookie: sol.cookie});
    assert.equal(solConversations.response.status, 200);
    assert.equal(solConversations.payload.conversations.length, 1);
    assert.equal(solConversations.payload.conversations[0].id, group.payload.conversation.id);
  } finally {
    await app.close();
  }
});

test('los perfiles privados se conectan por enlace, código o QR sin aparecer en el directorio público', async () => {
  const app = await startPlatform();
  try {
    async function createPrivatePerson(email, displayName) {
      const registration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
        method: 'POST',
        body: {email, password: 'password-segura-123', displayName, role: 'listener'},
      });
      const cookie = registration.response.headers.get('set-cookie').split(';')[0];
      const saved = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
        method: 'PUT',
        cookie,
        body: {
          displayName,
          role: 'listener',
          visible: false,
          city: 'Ciudad privada',
          country: 'País privado',
          bio: 'Este texto no debe salir del perfil privado.',
          social: {allowMessages: true, allowMatchmaking: false, showResidence: true},
        },
      });
      return {cookie, profile: saved.payload.profile};
    }

    const rio = await createPrivatePerson('rio-private-invite@example.com', 'Río');
    const cielo = await createPrivatePerson('cielo-private-invite@example.com', 'Cielo');
    const outsider = await createPrivatePerson('outsider-private-invite@example.com', 'Fuera');

    const hiddenPublicProfile = await jsonRequest(`${app.baseUrl}/api/profiles/${cielo.profile.id}`);
    assert.equal(hiddenPublicProfile.response.status, 404);

    const blockedDirect = await jsonRequest(`${app.baseUrl}/api/private-conversations`, {
      method: 'POST', cookie: rio.cookie, body: {type: 'direct', memberProfileIds: [cielo.profile.id]},
    });
    assert.equal(blockedDirect.response.status, 400);
    assert.match(blockedDirect.payload.error, /enlace, código o QR/);

    const invitation = await jsonRequest(`${app.baseUrl}/api/private-chat-invitations`, {
      method: 'POST', cookie: rio.cookie, body: {},
    });
    assert.equal(invitation.response.status, 201);
    assert.match(invitation.payload.invitation.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.match(invitation.payload.invitation.url, /\?chatInvite=[A-HJ-NP-Z2-9]{8}#chat$/);
    assert.equal(JSON.stringify(invitation.payload).includes('Río'), false);

    const accepted = await jsonRequest(`${app.baseUrl}/api/private-chat-invitations/redeem`, {
      method: 'POST', cookie: cielo.cookie, body: {code: invitation.payload.invitation.code},
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.payload.conversation.title, 'Río');
    assert.equal(accepted.payload.conversation.members.find(member => member.id === rio.profile.id).visible, false);

    const reusedByOutsider = await jsonRequest(`${app.baseUrl}/api/private-chat-invitations/redeem`, {
      method: 'POST', cookie: outsider.cookie, body: {code: invitation.payload.invitation.code},
    });
    assert.equal(reusedByOutsider.response.status, 400);
    assert.match(reusedByOutsider.payload.error, /utilizada/);

    const rioContacts = await jsonRequest(`${app.baseUrl}/api/chat/contacts`, {cookie: rio.cookie});
    const cieloContacts = await jsonRequest(`${app.baseUrl}/api/chat/contacts`, {cookie: cielo.cookie});
    assert.deepEqual(rioContacts.payload.contacts.map(contact => contact.displayName), ['Cielo']);
    assert.deepEqual(cieloContacts.payload.contacts.map(contact => contact.displayName), ['Río']);
    const privateContact = rioContacts.payload.contacts[0];
    assert.equal(privateContact.visible, false);
    assert.equal(privateContact.private, true);
    assert.equal(privateContact.avatarUrl, null);
    assert.deepEqual(privateContact.photos, []);
    assert.equal(privateContact.city, null);
    assert.equal(privateContact.country, null);
    assert.equal(privateContact.bio, null);

    const privateMessage = await jsonRequest(`${app.baseUrl}/api/private-conversations/${accepted.payload.conversation.id}/messages`, {
      method: 'POST', cookie: cielo.cookie, body: {text: 'Hola desde un perfil privado.'},
    });
    assert.equal(privateMessage.response.status, 201);
    const rioHistory = await jsonRequest(`${app.baseUrl}/api/private-conversations/${accepted.payload.conversation.id}/messages`, {cookie: rio.cookie});
    assert.equal(rioHistory.payload.messages[0].text, 'Hola desde un perfil privado.');
  } finally {
    await app.close();
  }
});

test('Personas permite guardar, compartir contacto, enviar detalles, matchmaking con flores y abrir chat real', async () => {
  const app = await startPlatform();
  try {
    async function createVisiblePerson(email, displayName, role, allowMatchmaking) {
      const registration = await jsonRequest(`${app.baseUrl}/api/auth/register`, {
        method: 'POST',
        body: {email, password: 'password-segura-123', displayName, role},
      });
      const cookie = registration.response.headers.get('set-cookie').split(';')[0];
      const profile = await jsonRequest(`${app.baseUrl}/api/account/profile`, {
        method: 'PUT',
        cookie,
        body: {
          displayName,
          role,
          visible: true,
          city: 'Bogotá',
          country: 'Colombia',
          social: {allowMatchmaking, allowMessages: true, showResidence: true, shareApproximateLocation: false},
        },
      });
      return {cookie, profile: profile.payload.profile};
    }

    const receiver = await createVisiblePerson('receiver@example.com', 'Alex', 'dj', true);
    const sender = await createVisiblePerson('sender@example.com', 'Sam', 'listener', false);

    const publicProfile = await jsonRequest(`${app.baseUrl}/api/profiles/${receiver.profile.id}`);
    assert.equal(publicProfile.response.status, 200);
    assert.equal(publicProfile.payload.profile.displayName, 'Alex');
    assert.equal(publicProfile.payload.profile.social.allowMatchmaking, true);

    const retiredGlobalDirectory = await jsonRequest(`${app.baseUrl}/api/profiles/public`);
    assert.equal(retiredGlobalDirectory.response.status, 410);
    assert.equal('profiles' in retiredGlobalDirectory.payload, false);

    const saved = await jsonRequest(`${app.baseUrl}/api/profiles/${receiver.profile.id}/saved`, {
      method: 'PUT', cookie: sender.cookie, body: {saved: true},
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.payload.saved, true);
    assert.deepEqual(saved.payload.savedProfileIds, [receiver.profile.id]);

    const gift = await jsonRequest(`${app.baseUrl}/api/profiles/${receiver.profile.id}/actions`, {
      method: 'POST', cookie: sender.cookie, body: {type: 'gift', gift: 'star'},
    });
    assert.equal(gift.response.status, 201);
    assert.equal(gift.payload.action.gift.emoji, '⭐');

    const senderAccountId = app.productStore.snapshot().profiles.find(profile => profile.id === sender.profile.id).accountId;
    let flowerTime = Date.now();
    const RealDate = Date;
    global.Date = class extends RealDate {
      constructor(value) { super(value === undefined ? flowerTime : value); }
      static now() { return flowerTime; }
    };
    try {
      await app.starEconomy.recordListeningPulse({accountId: senderAccountId, roomId: 'room-flower', roomCode: 'FLOR01', artistAccountId: 'artist-flower'});
      for (let minute = 1; minute <= 15; minute += 1) {
        flowerTime += 60_000;
        await app.starEconomy.recordListeningPulse({accountId: senderAccountId, roomId: 'room-flower', roomCode: 'FLOR01', artistAccountId: 'artist-flower'});
      }
    } finally {
      global.Date = RealDate;
    }

    const touch = await jsonRequest(`${app.baseUrl}/api/profiles/${receiver.profile.id}/actions`, {
      method: 'POST', cookie: sender.cookie, body: {type: 'touch'},
    });
    assert.equal(touch.response.status, 201);
    assert.equal(touch.payload.flowerTransfer.flower.id, 'margarita');

    const privateProfessionalRoom = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: sender.cookie,
      body: {name: 'Sesión profesional', roomType: 'professional', allowSocialProfiles: false},
    });
    const blockedSocialAction = await jsonRequest(`${app.baseUrl}/api/profiles/${receiver.profile.id}/actions`, {
      method: 'POST', cookie: sender.cookie,
      body: {type: 'gift', gift: 'music', roomCode: privateProfessionalRoom.payload.room.code},
    });
    assert.equal(blockedSocialAction.response.status, 403);
    assert.match(blockedSocialAction.payload.error, /no utiliza funciones sociales/);

    const senderInbox = await jsonRequest(`${app.baseUrl}/api/profile-actions`, {cookie: sender.cookie});
    assert.equal(senderInbox.payload.actions.length, 0);
    assert.deepEqual(senderInbox.payload.contacts.map(contact => contact.displayName), ['Alex']);
    const receiverInbox = await jsonRequest(`${app.baseUrl}/api/profile-actions`, {cookie: receiver.cookie});
    assert.equal(receiverInbox.response.status, 200);
    assert.equal(receiverInbox.payload.unreadCount, 2);
    assert.equal(receiverInbox.payload.actions[0].sender.displayName, 'Sam');
    assert.deepEqual(receiverInbox.payload.contacts.map(contact => contact.displayName), ['Sam']);

    const marked = await jsonRequest(`${app.baseUrl}/api/profile-actions/read`, {
      method: 'POST', cookie: receiver.cookie, body: {actionIds: receiverInbox.payload.actions.map(action => action.id)},
    });
    assert.equal(marked.payload.count, 2);
    const readInbox = await jsonRequest(`${app.baseUrl}/api/profile-actions`, {cookie: receiver.cookie});
    assert.equal(readInbox.payload.unreadCount, 0);

    const chatRoom = await jsonRequest(`${app.baseUrl}/api/rooms`, {
      method: 'POST',
      cookie: sender.cookie,
      body: {name: 'Sala para conversar', roomType: 'party', allowPublicChat: true, allowSocialProfiles: true},
    });
    assert.equal(chatRoom.response.status, 201);
    const invitation = await jsonRequest(`${app.baseUrl}/api/profiles/${receiver.profile.id}/actions`, {
      method: 'POST', cookie: sender.cookie,
      body: {type: 'room-invite', roomCode: chatRoom.payload.room.code},
    });
    assert.equal(invitation.response.status, 201);
    assert.equal(invitation.payload.action.type, 'room-invite');
    assert.equal(invitation.payload.action.roomCode, chatRoom.payload.room.code);
    const repeatedInvitation = await jsonRequest(`${app.baseUrl}/api/profiles/${receiver.profile.id}/actions`, {
      method: 'POST', cookie: sender.cookie,
      body: {type: 'room-invite', roomCode: chatRoom.payload.room.code},
    });
    assert.equal(repeatedInvitation.response.status, 400);
    assert.match(repeatedInvitation.payload.error, /hace poco/);
    const invitationInbox = await jsonRequest(`${app.baseUrl}/api/profile-actions`, {cookie: receiver.cookie});
    assert.equal(invitationInbox.payload.unreadCount, 1);
    assert.equal(invitationInbox.payload.actions[0].type, 'room-invite');
    assert.equal(invitationInbox.payload.actions[0].roomCode, chatRoom.payload.room.code);
    await jsonRequest(`${app.baseUrl}/api/profile-actions/read`, {
      method: 'POST', cookie: receiver.cookie, body: {actionIds: [invitationInbox.payload.actions[0].id]},
    });

    const conversation = await jsonRequest(`${app.baseUrl}/api/private-conversations`, {
      method: 'POST', cookie: sender.cookie, body: {type: 'direct', memberProfileIds: [receiver.profile.id]},
    });
    assert.equal(conversation.response.status, 201);
    assert.equal(conversation.payload.conversation.title, 'Alex');
    const sentMessage = await jsonRequest(`${app.baseUrl}/api/private-conversations/${conversation.payload.conversation.id}/messages`, {
      method: 'POST', cookie: sender.cookie, body: {kind: 'text', text: 'Hola, conectemos.'},
    });
    assert.equal(sentMessage.response.status, 201);
    const relationshipHistory = await jsonRequest(`${app.baseUrl}/api/private-conversations/${conversation.payload.conversation.id}/messages`, {cookie: sender.cookie});
    assert.deepEqual(relationshipHistory.payload.messages.map(message => message.kind), ['interaction', 'interaction', 'text']);
    assert.deepEqual(relationshipHistory.payload.messages.slice(0, 2).map(message => message.interaction.type), ['gift', 'touch']);
    const receiverConversations = await jsonRequest(`${app.baseUrl}/api/private-conversations`, {cookie: receiver.cookie});
    assert.equal(receiverConversations.payload.conversations.length, 1);
    assert.equal(receiverConversations.payload.conversations[0].title, 'Sam');
    assert.equal(receiverConversations.payload.conversations[0].lastMessage.text, 'Hola, conectemos.');
    const messageActivity = await jsonRequest(`${app.baseUrl}/api/profile-actions`, {cookie: receiver.cookie});
    assert.equal(messageActivity.payload.unreadCount, 1);
    assert.equal(messageActivity.payload.actions[0].type, 'message');
    assert.equal(messageActivity.payload.actions[0].conversationId, conversation.payload.conversation.id);
  } finally {
    await app.close();
  }
});

test('la captura aislada de Chrome pertenece a Q Session y publica sólo el audio elegido', async () => {
  const app = await startPlatform();
  try {
    const pageResponse = await fetch(`${app.baseUrl}/tab-capture.html`);
    const page = await pageResponse.text();
    const scriptResponse = await fetch(`${app.baseUrl}/tab-capture.js`);
    const script = await scriptResponse.text();
    const styleResponse = await fetch(`${app.baseUrl}/tab-capture.css`);
    const style = await styleResponse.text();

    assert.equal(pageResponse.status, 200);
    assert.equal(scriptResponse.status, 200);
    assert.equal(styleResponse.status, 200);
    assert.match(page, /Q Session · Audio de Chrome/);
    assert.match(page, /Compartir audio de la pestaña/);
    assert.match(script, /getDisplayMedia/);
    assert.match(script, /displaySurface:\s*'browser'/);
    assert.match(script, /preferCurrentTab:\s*false/);
    assert.match(script, /audioSelection:\s*'preferred'/);
    assert.match(script, /ScreenShareAudio/);
    assert.match(script, /qsession-chrome-tab-audio/);
    assert.match(script, /forceStereo:\s*true/);
    assert.match(script, /notifyDesktop\('error', message\)/);
    assert.match(script, /dtx:\s*false/);
    assert.match(script, /red:\s*false/);
    assert.match(script, /const CHROME_TAB_AUDIO_BITRATE = 510000/);
    assert.match(script, /maxBitrate:\s*audioBitrate/);
    assert.match(script, /systemAudio:\s*'include'/);
    assert.match(script, /windowAudio:\s*'system'/);
    assert.match(script, /applyConstraints\(chromeTabAudioConstraints\(\)\)/);
    assert.match(script, /track\.contentHint = 'music'/);
    assert.match(script, /parameters\.encodings\[0\]\.maxBitrate = bitrate/);
    assert.match(script, /\^bitrate:\\d\+\$/);
    assert.match(script, /history\.replaceState\(null, '', location\.pathname\)/);
    assert.match(script, /\/api\/rooms\/\$\{encodeURIComponent\(payload\.room\)\}/);
    assert.match(style, /--aqua:\s*#67cdd1/);
  } finally {
    await app.close();
  }
});

test('recepción masiva entrega sólo HLS sin credenciales SFU ni permisos de emisión', async t=>{
  const {createProductStore}=require('../product-store');
  const {syntheticReadiness}=require('./fixtures/mass-readiness.cjs');
  const productStore=createProductStore();
  let app=await startPlatform({productStore});
  try {
    const creator=await registerTestCreator(app);
    const created=await jsonRequest(`${app.baseUrl}/api/rooms`,{method:'POST',cookie:creator.cookie,body:{name:'Evento masivo',visibility:'public'}});
    const code=created.payload.room.code;
    await app.close();
    const evidence=syntheticReadiness(code); evidence.expiresAt=new Date(Date.now()+60000).toISOString();
    app=await startPlatform({productStore,audienceMode:'cdn-only',broadcastAdmissions:syntheticAdmissions(),cdnOnlyRoom:code,massBroadcastReadiness:evidence,edgeBroadcast:{configured:true,provider:'test-cdn',deliveryMode:'object-storage',playbackUrl:code=>`https://cdn.example/live/${code}-xxxxxxxxxxxxxxxxxx/index.m3u8`}});
    await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'dj',hostToken:created.payload.hostToken}});
    const join=await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'listener'}});
    assert.equal(join.response.status,200);assert.equal(join.payload.transport,'hls');assert.equal(join.payload.delivery.fallback,null);
    assert.equal(join.payload.delivery.audienceMode,'cdn-only');assert.deepEqual(join.payload.permissions,['listen']);
    assert.equal(join.payload.token,undefined);assert.equal(join.payload.url,undefined);assert.equal(join.payload.presenceTicket,undefined);
    assert.equal(join.payload.limits.audienceTarget,500000);assert.equal(join.payload.limits.capacityValidated,false);
    const legacy=await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'listener',nativeAudio:true}});
    assert.equal(legacy.response.status,409);
    const dj=await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'dj',hostToken:created.payload.hostToken}});
    assert.equal(dj.response.status,200);assert.ok(dj.payload.token);
    const other=await jsonRequest(`${app.baseUrl}/api/rooms`,{method:'POST',cookie:creator.cookie,body:{name:'Sala habitual',visibility:'public'}});
    const otherJoin=await jsonRequest(`${app.baseUrl}/api/rooms/${other.payload.room.code}/media-token`,{method:'POST',body:{role:'listener'}});
    assert.equal(otherJoin.response.status,200);assert.ok(otherJoin.payload.token);assert.notEqual(otherJoin.payload.delivery.audienceMode,'cdn-only');
    const realNow=Date.now();
    t.mock.method(Date,'now',()=>realNow+61000);
    const expired=await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'listener'}});
    assert.equal(expired.response.status,503);assert.match(expired.payload.error,/Caducó/);assert.equal(expired.payload.token,undefined);
    t.mock.restoreAll();
    productStore.updateRoomConfiguration(code,{capacityMode:'limited',capacity:100});
    const limited=await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'listener'}});
    assert.equal(limited.response.status,200);assert.equal(limited.payload.limits.maxParticipants,100);
    productStore.updateRoomConfiguration(code,{capacityMode:'expected'});
    app.edgeBroadcast.deliveryMode='local-origin';
    const noCdn=await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'listener'}});
    assert.equal(noCdn.response.status,503);assert.equal(noCdn.payload.token,undefined);
    await app.close();
    app=await startPlatform({productStore,audienceMode:'cdn-only',broadcastAdmissions:syntheticAdmissions(),cdnOnlyRoom:code,cdnOnlyPaused:true,massBroadcastReadiness:syntheticReadiness(code)});
    const paused=await jsonRequest(`${app.baseUrl}/api/rooms/${code}/media-token`,{method:'POST',body:{role:'listener'}});
    assert.equal(paused.response.status,503);assert.equal(paused.response.headers.get('retry-after'),'30');assert.equal(paused.payload.token,undefined);
  } finally {await app.close();}
});


test('la configuración masiva incompleta no puede iniciar un despliegue',async()=>{
  await assert.rejects(()=>startPlatform({audienceMode:'cdn-only'}),/QSESSION_CDN_ONLY_ROOM/);
  await assert.rejects(()=>startPlatform({audienceMode:'cdn-only',cdnOnlyRoom:'ABC123',massBroadcastReadiness:{}}),/bloqueada/);
});


test('el servidor lee el expediente montado en Windows con BOM sin exponer referencias',async()=>{
  const {syntheticReadiness}=require('./fixtures/mass-readiness.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qsession-readiness-'));
  const file=path.join(dir,'evidence.json');let app;
  try {
    fs.writeFileSync(file,'\uFEFF'+JSON.stringify(syntheticReadiness('ABC123')));
    app=await startPlatform({audienceMode:'cdn-only',broadcastAdmissions:syntheticAdmissions(),cdnOnlyRoom:'ABC123',env:{QSESSION_MASS_BROADCAST_READINESS_FILE:file}});
    const status=await jsonRequest(`${app.baseUrl}/api/status`);
    assert.equal(status.payload.scale.broadcast.readinessEvidenceAccepted,true);
    assert.equal(status.payload.scale.broadcast.capacityValidated,false);
    assert.doesNotMatch(JSON.stringify(status.payload),/synthetic-test-only|SYNTHETIC TEST FIXTURE/);
  } finally {
    if(app)await app.close();
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('qsession-readiness-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('una sala de 10000 entrega sólo CDN y no activa el perfil de 500000',async()=>{
  const {createProductStore}=require('../product-store');
  const {syntheticReadiness}=require('./fixtures/mass-readiness.cjs');
  const store=createProductStore();store.createRoomRecord({code:'TEN10A',name:'10k simulation',visibility:'public'});
  const app=await startPlatform({productStore:store,audienceMode:'cdn-only',broadcastAdmissions:syntheticAdmissions(),cdnOnlyRoom:'TEN10A',broadcastAudienceTarget:10000,massBroadcastReadiness:syntheticReadiness('TEN10A',{QSESSION_BROADCAST_AUDIENCE_TARGET:'10000'}),edgeBroadcast:{configured:true,provider:'mock-cdn',deliveryMode:'object-storage',playbackUrl:code=>`https://cdn.invalid/live/${code}-xxxxxxxxxxxxxxxxxx/index.m3u8`}});
  try {
    const result=await jsonRequest(`${app.baseUrl}/api/rooms/TEN10A/media-token`,{method:'POST',body:{role:'listener'}});
    assert.equal(result.response.status,200);assert.equal(result.payload.limits.audienceTarget,10000);assert.equal(result.payload.limits.capacityValidated,false);
    assert.equal(result.payload.token,undefined);assert.equal(result.payload.delivery.fallback,null);assert.deepEqual(result.payload.permissions,['listen']);
  } finally {await app.close();}
});
