'use strict';

const IS_QSESSION_ANDROID = /\bQSessionAndroid\//i.test(navigator.userAgent || '');
const PEOPLE_CAMERA_PAGE_SIZE = window.QSessionPeopleCameras.PAGE_SIZE;
const peopleCameraPager = window.QSessionPeopleCameras.createPager();
const CAMERA_FRAMINGS = new Set(['far', 'medium', 'near']);
const CAMERA_ORIENTATIONS = new Set(['portrait', 'landscape']);
const CAMERA_ROTATIONS = new Set(['none', 'clockwise', 'counterclockwise']);
const CAMERA_FORMAT_VERSION = '4';
const CAMERA_ORIENTATION_KEY = 'qsession-camera-orientation';
const CAMERA_ORIENTATION_MODE_KEY = 'qsession-camera-orientation-mode';
const LISTENER_ROOM_HISTORY_KEY = 'qsession-listener-room-history-v1';
const LISTENER_ROOM_HISTORY_LIMIT = 8;
const PHYSICAL_AUDIO_SOURCES = new Set(['microphone', 'usb', 'hdmi', 'line', 'bluetooth']);
const LISTENER_OUTPUT_GAINS = Object.freeze([1, .708, .501]);
const CHROME_TAB_AUDIO_BITRATE = 510000;
const BROADCAST_AUDIO_BITRATES = Object.freeze([128000, 192000, 256000, 320000, CHROME_TAB_AUDIO_BITRATE]);
const BROADCAST_AUDIO_BITRATE_KEY = 'qsession-broadcast-audio-bitrate';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const GLOBAL_RAVE_PUBLIC = false;
const GLOBAL_RAVE_COUNTRY_MAP = window.QSESSION_WORLD_COUNTRIES || {countries: [], microstates: []};
const GLOBAL_RAVE_CAPITALS = Object.freeze([
  ['Bogotá', 4.71, -74.07, true], ['Ciudad de México', 19.43, -99.13, true], ['Washington', 38.9, -77.04, true],
  ['Ottawa', 45.42, -75.7, false], ['Buenos Aires', -34.6, -58.38, true], ['Brasília', -15.79, -47.88, true],
  ['Santiago', -33.45, -70.67, false], ['Lima', -12.05, -77.04, false], ['Caracas', 10.48, -66.9, false],
  ['Londres', 51.51, -0.13, true], ['París', 48.86, 2.35, true], ['Madrid', 40.42, -3.7, true],
  ['Berlín', 52.52, 13.41, false], ['Roma', 41.9, 12.5, false], ['Moscú', 55.76, 37.62, true],
  ['El Cairo', 30.04, 31.24, true], ['Abuya', 9.08, 7.4, false], ['Nairobi', -1.29, 36.82, false],
  ['Pretoria', -25.75, 28.19, true], ['Ankara', 39.93, 32.86, false], ['Riad', 24.71, 46.67, false],
  ['Nueva Delhi', 28.61, 77.21, true], ['Pekín', 39.9, 116.41, true], ['Tokio', 35.68, 139.69, true],
  ['Seúl', 37.57, 126.98, false], ['Yakarta', -6.21, 106.85, false], ['Canberra', -35.28, 149.13, true],
  ['Wellington', -41.29, 174.78, false],
]);
const ROOM_TYPE_PRESETS = Object.freeze({
  custom: {
    description: 'Todos los controles quedan disponibles para construir una experiencia propia.',
    experienceTitle: 'Sala personalizada', experienceIcon: '✦',
    experienceDescription: 'Elige manualmente el ambiente visual, las funciones sociales, la IA, los visuales y el envío de videos.',
    designTheme: 'minimal', designMotion: 'balanced', allowedExperienceTools: 'all',
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: false,
    allowGreetingVideos: false, allowVideoToHost: false, allowVideoToRoom: false, allowPrivateVideoSubmissions: false,
  },
  music: {
    description: 'Música en vivo con una escena moderna, sobria e inmersiva al estilo QSession.',
    experienceTitle: 'Música QSession', experienceIcon: '♪',
    experienceDescription: 'Efectos creados con IA, visuales VJ y videos del público alrededor de la señal del DJ.',
    designTheme: 'midnight', designMotion: 'immersive',
    allowedExperienceTools: ['allowAiCameraEffects', 'allowVjVisuals', 'allowVideoSubmissions', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    allowAiCameraEffects: true, allowVjVisuals: true, allowVideoSubmissions: true,
    allowGreetingVideos: false, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    visibility: 'private', allowPublicChat: true, allowGuestCameras: true,
    allowSocialProfiles: true, allowMatchmaking: true, allowProfileGifts: true,
  },
  'yoga-meditation': {
    description: 'Una experiencia de armonía, paz y equilibrio, sin filtros ni disfraces de cámara.',
    experienceTitle: 'Yoga y meditación', experienceIcon: '♧',
    experienceDescription: 'Una atmósfera serena con videos públicos o privados dirigidos al organizador o a la sala.',
    designTheme: 'serenity', designMotion: 'calm',
    allowedExperienceTools: ['allowVideoSubmissions', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: false, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    visibility: 'private', allowPublicChat: true, allowGuestCameras: false,
    allowSocialProfiles: true, allowMatchmaking: false, allowProfileGifts: false,
  },
  conference: {
    description: 'Una presentación institucional, clara y profesional con identidad QSession.',
    experienceTitle: 'Conferencia', experienceIcon: '◫',
    experienceDescription: 'Jerarquía visual sobria para el ponente, las cámaras autorizadas y la conversación profesional.',
    designTheme: 'institutional', designMotion: 'balanced', allowedExperienceTools: [],
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: false,
    allowGreetingVideos: false, allowVideoToHost: false, allowVideoToRoom: false, allowPrivateVideoSubmissions: false,
    visibility: 'private', allowPublicChat: true, allowGuestCameras: true,
    allowSocialProfiles: true, allowMatchmaking: false, allowProfileGifts: false,
  },
  wedding: {
    description: 'Una celebración armónica para acompañar a la pareja y reunir sus saludos.',
    experienceTitle: 'Boda', experienceIcon: '♡',
    experienceDescription: 'Una escena cálida y elegante donde los invitados pueden enviar videos de saludo.',
    designTheme: 'celebration', designMotion: 'balanced',
    allowedExperienceTools: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    visibility: 'private', allowPublicChat: true, allowGuestCameras: true,
    allowSocialProfiles: true, allowMatchmaking: false, allowProfileGifts: true,
  },
  birthday: {
    description: 'Invitados, saludos y momentos compartidos en una celebración en vivo.',
    experienceTitle: 'Cumpleaños', experienceIcon: '◌',
    experienceDescription: 'Una escena alegre pero elegante, con videos de saludo para el anfitrión o para toda la sala.',
    designTheme: 'celebration', designMotion: 'balanced',
    allowedExperienceTools: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    visibility: 'private', allowPublicChat: true, allowGuestCameras: true,
    allowSocialProfiles: true, allowMatchmaking: false, allowProfileGifts: true,
  },
  'baby-shower': {
    description: 'Familia y amistades reunidas en una celebración delicada, cálida y cercana.',
    experienceTitle: 'Baby shower', experienceIcon: '◇',
    experienceDescription: 'Una escena suave y armónica que reúne videos de saludo y mensajes de la familia.',
    designTheme: 'celebration', designMotion: 'calm',
    allowedExperienceTools: ['allowVideoSubmissions', 'allowGreetingVideos', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'],
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    visibility: 'private', allowPublicChat: true, allowGuestCameras: true,
    allowSocialProfiles: true, allowMatchmaking: false, allowProfileGifts: true,
  },
});
const ROOM_FEATURE_CONTROLS = Object.freeze([
  ['allowRoomChat', 'allowPublicChat', 'Chat'],
  ['allowGuestCameras', 'allowGuestCameras', 'Cámaras de usuarios'],
  ['allowRoomSocialProfiles', 'allowSocialProfiles', 'Perfiles visibles'],
  ['allowRoomMatchmaking', 'allowMatchmaking', 'Matchmaking abierto'],
  ['allowRoomProfileGifts', 'allowProfileGifts', 'Detalles'],
]);
const ROOM_EXPERIENCE_CONTROLS = Object.freeze([
  ['allowAiCameraEffects', 'IA de cámara'],
  ['allowVjVisuals', 'Visuales VJ'],
  ['allowVideoSubmissions', 'Videos'],
  ['allowGreetingVideos', 'Saludos'],
]);
const ROOM_VIDEO_CONTROLS = Object.freeze(['allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions']);
const CONFERENCE_FEATURE_CONTROLS = Object.freeze([
  ['allowSharedFiles', 'allowSharedFiles'],
  ['allowSpeakingQueue', 'allowSpeakingQueue'],
  ['allowQuestions', 'allowQuestions'],
  ['allowPolls', 'allowPolls'],
  ['allowReactions', 'allowReactions'],
  ['allowRecording', 'allowRecording'],
]);
const QMOJI_PALETTES = Object.freeze([
  ['#dbe9f6', '#315f8c'], ['#b8d3ec', '#163f69'], ['#c9dcf0', '#426f9b'], ['#b7c9e6', '#304f7e'],
  ['#98bfdf', '#174f7b'], ['#d5e1ee', '#4d6f92'], ['#adc7e2', '#2d5d88'], ['#c4d7ea', '#234d76'],
]);
const QMOJIS = Object.freeze([
  {token: ':q01:', labels: {es: 'Carcajada', en: 'Big laugh', de: 'Lachflash'}, eyes: 'joy', mouth: 'laugh', mark: 'tears'},
  {token: ':q02:', labels: {es: 'Amor total', en: 'Pure love', de: 'Volle Liebe'}, eyes: 'soft', mouth: 'smile', mark: 'heart'},
  {token: ':q03:', labels: {es: 'Enamorado', en: 'In love', de: 'Verliebt'}, eyes: 'heart', mouth: 'smile', mark: 'blush'},
  {token: ':q04:', labels: {es: 'Risa rodante', en: 'Rolling laugh', de: 'Kugelndes Lachen'}, eyes: 'tilted', mouth: 'laugh', mark: 'motion'},
  {token: ':q05:', labels: {es: 'Sonrisa serena', en: 'Gentle smile', de: 'Sanftes Lächeln'}, eyes: 'joy', mouth: 'smile', mark: 'calm'},
  {token: ':q06:', labels: {es: 'Gracias', en: 'Thank you', de: 'Danke'}, eyes: 'soft', mouth: 'soft', mark: 'thanks'},
  {token: ':q07:', labels: {es: 'Mucho cariño', en: 'Lots of love', de: 'Viel Zuneigung'}, eyes: 'soft', mouth: 'smile', mark: 'hearts'},
  {token: ':q08:', labels: {es: 'Llanto grande', en: 'Big cry', de: 'Großes Weinen'}, eyes: 'sad', mouth: 'cry', mark: 'rain'},
  {token: ':q09:', labels: {es: 'Beso', en: 'Kiss', de: 'Kuss'}, eyes: 'wink', mouth: 'kiss', mark: 'kiss'},
  {token: ':q10:', labels: {es: 'Aprobado', en: 'Approved', de: 'Bestätigt'}, eyes: 'bright', mouth: 'smile', mark: 'approve'},
  {token: ':q11:', labels: {es: 'Uf, salió bien', en: 'That was close', de: 'Gerade geschafft'}, eyes: 'joy', mouth: 'grin', mark: 'sweat'},
  {token: ':q12:', labels: {es: 'Aplauso', en: 'Applause', de: 'Applaus'}, eyes: 'bright', mouth: 'smile', mark: 'clap'},
  {token: ':q13:', labels: {es: 'Sonrisa enorme', en: 'Huge grin', de: 'Riesiges Grinsen'}, eyes: 'bright', mouth: 'teeth', mark: 'blush'},
  {token: ':q14:', labels: {es: 'Corazón cálido', en: 'Warm heart', de: 'Warmes Herz'}, eyes: 'joy', mouth: 'smile', mark: 'warmheart'},
  {token: ':q15:', labels: {es: 'Fuego', en: 'On fire', de: 'Feuer'}, eyes: 'fierce', mouth: 'grin', mark: 'flame'},
  {token: ':q16:', labels: {es: 'Corazón roto', en: 'Broken heart', de: 'Gebrochenes Herz'}, eyes: 'sad', mouth: 'cry', mark: 'broken'},
  {token: ':q17:', labels: {es: 'Corazón brillante', en: 'Shining heart', de: 'Glänzendes Herz'}, eyes: 'soft', mouth: 'smile', mark: 'sparkleheart'},
  {token: ':q18:', labels: {es: 'Corazón azul', en: 'Blue heart', de: 'Blaues Herz'}, eyes: 'calm', mouth: 'soft', mark: 'blueheart'},
  {token: ':q19:', labels: {es: 'Tristeza', en: 'Sadness', de: 'Traurigkeit'}, eyes: 'sad', mouth: 'cry', mark: 'tear'},
  {token: ':q20:', labels: {es: 'Pensando', en: 'Thinking', de: 'Nachdenklich'}, eyes: 'side', mouth: 'flat', mark: 'think'},
  {token: ':q21:', labels: {es: 'Risa explosiva', en: 'Bursting laugh', de: 'Explosives Lachen'}, eyes: 'squint', mouth: 'laugh', mark: 'bursts'},
  {token: ':q22:', labels: {es: 'Ojos al cielo', en: 'Eye roll', de: 'Augenrollen'}, eyes: 'roll', mouth: 'flat', mark: 'orbit'},
  {token: ':q23:', labels: {es: 'Fuerza', en: 'Strength', de: 'Stärke'}, eyes: 'fierce', mouth: 'grin', mark: 'muscle'},
  {token: ':q24:', labels: {es: 'Guiño', en: 'Wink', de: 'Zwinkern'}, eyes: 'wink', mouth: 'smirk', mark: 'spark'},
  {token: ':q25:', labels: {es: 'Todo en calma', en: 'All calm', de: 'Alles ruhig'}, eyes: 'closed', mouth: 'soft', mark: 'calm'},
  {token: ':q26:', labels: {es: 'Perfecto', en: 'Perfect', de: 'Perfekt'}, eyes: 'bright', mouth: 'smile', mark: 'okay'},
  {token: ':q27:', labels: {es: 'Abrazo', en: 'Hug', de: 'Umarmung'}, eyes: 'joy', mouth: 'soft', mark: 'hug'},
  {token: ':q28:', labels: {es: 'Corazón violeta', en: 'Violet heart', de: 'Violettes Herz'}, eyes: 'soft', mouth: 'smile', mark: 'purpleheart'},
  {token: ':q29:', labels: {es: 'Melancolía', en: 'Melancholy', de: 'Melancholie'}, eyes: 'sad', mouth: 'flat', mark: 'cloud'},
  {token: ':q30:', labels: {es: 'Con estilo', en: 'Cool', de: 'Cool'}, eyes: 'shades', mouth: 'smirk', mark: 'shine'},
  {token: ':q31:', labels: {es: 'Alma buena', en: 'Sweet soul', de: 'Gute Seele'}, eyes: 'joy', mouth: 'soft', mark: 'halo'},
  {token: ':q32:', labels: {es: 'Una flor', en: 'A flower', de: 'Eine Blume'}, eyes: 'soft', mouth: 'smile', mark: 'rose'},
  {token: ':q33:', labels: {es: 'Ay, por favor', en: 'Oh, please', de: 'Ach, bitte'}, eyes: 'closed', mouth: 'flat', mark: 'facepalm'},
  {token: ':q34:', labels: {es: 'Fiesta', en: 'Party', de: 'Party'}, eyes: 'bright', mouth: 'laugh', mark: 'party'},
  {token: ':q35:', labels: {es: 'Importante', en: 'Important', de: 'Wichtig'}, eyes: 'wide', mouth: 'wow', mark: 'alert'},
  {token: ':q36:', labels: {es: 'Conectados', en: 'Connected', de: 'Verbunden'}, eyes: 'soft', mouth: 'smile', mark: 'linked'},
  {token: ':q37:', labels: {es: 'Paz', en: 'Peace', de: 'Frieden'}, eyes: 'joy', mouth: 'soft', mark: 'peace'},
  {token: ':q38:', labels: {es: 'Destellos', en: 'Sparkles', de: 'Funkeln'}, eyes: 'star', mouth: 'smile', mark: 'sparkles'},
  {token: ':q39:', labels: {es: 'No sé', en: 'I do not know', de: 'Ich weiß nicht'}, eyes: 'side', mouth: 'flat', mark: 'shrug'},
  {token: ':q40:', labels: {es: 'Sorpresa', en: 'Surprise', de: 'Überraschung'}, eyes: 'wide', mouth: 'wow', mark: 'shock'},
  {token: ':q41:', labels: {es: 'Qué alivio', en: 'What a relief', de: 'Was für eine Erleichterung'}, eyes: 'closed', mouth: 'soft', mark: 'breeze'},
  {token: ':q42:', labels: {es: 'Flor abierta', en: 'Bloom', de: 'Blüte'}, eyes: 'soft', mouth: 'smile', mark: 'flower'},
  {token: ':q43:', labels: {es: 'Celebración', en: 'Celebration', de: 'Jubel'}, eyes: 'joy', mouth: 'laugh', mark: 'handsup'},
  {token: ':q44:', labels: {es: 'Delicioso', en: 'Delicious', de: 'Lecker'}, eyes: 'joy', mouth: 'yum', mark: 'taste'},
  {token: ':q45:', labels: {es: 'Corazón verde', en: 'Green heart', de: 'Grünes Herz'}, eyes: 'calm', mouth: 'soft', mark: 'greenheart'},
  {token: ':q46:', labels: {es: 'Pícaro', en: 'Cheeky', de: 'Schelmisch'}, eyes: 'side', mouth: 'smirk', mark: 'brow'},
  {token: ':q47:', labels: {es: 'Corazón solar', en: 'Sun heart', de: 'Sonnenherz'}, eyes: 'joy', mouth: 'smile', mark: 'yellowheart'},
  {token: ':q48:', labels: {es: 'Buena onda', en: 'Good vibes', de: 'Gute Stimmung'}, eyes: 'bright', mouth: 'smile', mark: 'wave'},
  {token: ':q49:', labels: {es: 'Corazón latiendo', en: 'Heartbeat', de: 'Herzschlag'}, eyes: 'soft', mouth: 'smile', mark: 'pulseheart'},
  {token: ':q50:', labels: {es: 'Fascinado', en: 'Starstruck', de: 'Hin und weg'}, eyes: 'star', mouth: 'wow', mark: 'stars'},
].map((item, index) => Object.freeze({...item, palette: index % QMOJI_PALETTES.length})));
const QMOJI_BY_TOKEN = new Map(QMOJIS.map(item => [item.token, item]));
const QMOJI_FAVORITES = Object.freeze([':q01:', ':q02:', ':q12:', ':q15:', ':q34:', ':q48:']);

function storedPeoplePreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function storedNumberPreference(key, fallback, minimum, maximum) {
  const value = Number(storedPeoplePreference(key, String(fallback)));
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function normalizedListenerOutputGain(value) {
  const numeric = Number(value);
  return LISTENER_OUTPUT_GAINS.reduce((closest, candidate) => (
    Math.abs(candidate - numeric) < Math.abs(closest - numeric) ? candidate : closest
  ), 1);
}

function normalizedBroadcastAudioBitrate(value) {
  const numeric = Number(value);
  return BROADCAST_AUDIO_BITRATES.includes(numeric) ? numeric : CHROME_TAB_AUDIO_BITRATE;
}

function storedListenerRoomHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LISTENER_ROOM_HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(entry => ({
      code: String(entry?.code || '').trim().toUpperCase(),
      name: String(entry?.name || '').trim().slice(0, 120),
      djName: String(entry?.djName || '').trim().slice(0, 80),
      passwordProtected: Boolean(entry?.passwordProtected),
      visitedAt: Number(entry?.visitedAt) || 0,
    })).filter(entry => /^[A-Z0-9]{6}$/.test(entry.code))
      .sort((left, right) => right.visitedAt - left.visitedAt)
      .slice(0, LISTENER_ROOM_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function initialCameraOrientation() {
  return devicePrefersPortraitCamera() ? 'portrait' : 'landscape';
}

function initialCameraOrientationMode() {
  return 'automatic';
}

function initialCameraDeviceId() {
  // Android must start from the front-facing camera every time the app opens.
  // A persisted WebView device id can point to a rear lens (or to an id that
  // changed after an OS update), which prevents the camera button from opening.
  return isNativeAndroidApp() ? '' : storedPeoplePreference('qsession-camera-device', '');
}

const state = {
  account: null,
  profile: null,
  authMode: 'register',
  pendingRoomCreation: false,
  roomPromotions: [],
  hostToken: '',
  roomLink: '',
  currentRoomCode: '',
  currentRoom: null,
  currentRoomAccessToken: '',
  pendingRoomAccess: null,
  waitingRoomTimer: null,
  waitingRoomCheckBusy: false,
  globalRaveTimer: null,
  globalRaveLoading: false,
  globalRaveSnapshot: null,
  globalMapSelectedCountry: '',
  globalMapView: {x: 0, y: 0, width: 1000, height: 500, scale: 1},
  globalMapPointer: null,
  globalPresenceTimer: null,
  globalPresenceBusy: false,
  globalPresenceError: '',
  androidBroadcastBackground: false,
  androidBroadcastRecovering: false,
  globalPresenceCountryCode: '',
  globalPresenceVerifiedAt: 0,
  globalPresenceTicket: '',
  chatPollTimer: null,
  chatRealtimeSocket: null,
  chatRealtimeChannel: '',
  publicMessageHistory: [],
  publicMessageRoomCode: '',
  chatLoading: false,
  chatMode: 'private',
  chatModeChosen: false,
  roomChatParticipantCount: 0,
  publicChatMicOpen: false,
  publicChatPushActive: false,
  chatDirectoryContacts: [],
  chatDirectoryLoading: false,
  chatDirectoryQuery: '',
  privateConversations: [],
  privateMessageHistory: new Map(),
  privateContacts: [],
  privateContactInvitation: null,
  requestedPrivateInviteCode: new URLSearchParams(location.search).get('chatInvite') || '',
  requestedPrivateInviteProcessed: false,
  activePrivateConversationId: '',
  privateConversationOpen: false,
  privateChatLoading: false,
  privateChatKind: 'direct',
  privateVoiceRoom: null,
  privateVoiceConversationId: '',
  privateVoiceMicOpen: false,
  privateVoicePushActive: false,
  privateVoiceCameraOpen: false,
  privateVoiceCameraTrack: null,
  privateVoiceCameraZoomRange: null,
  privateVoiceFilterEngine: null,
  privateVoiceFilterPublication: null,
  privateVoiceFilter: {
    prompt: storedPeoplePreference('qsession-private-filter-prompt', ''),
    trigger: storedPeoplePreference('qsession-private-filter-trigger', 'always'),
  },
  mediaRoom: null,
  mediaConnectRequest: null,
  mediaRoomCode: '',
  mediaRole: null,
  mediaConnected: false,
  broadcastDelivery: null,
  broadcastUsingEdge: false,
  broadcastEdgeReady: false,
  broadcastHls: null,
  broadcastHlsFailures: 0,
  edgePlaybackNeedsGesture: false,
  edgeVideoPlayingListener: null,
  edgeNativeSessionActive: false,
  edgeNativeRoomCode: '',
  edgeNativeBackgroundActive: false,
  edgeNativeForegroundPending: false,
  edgeNativeHandoffGeneration: 0,
  mediaAudioPublication: null,
  mediaCaptureStream: null,
  desktopCaptureRoom: '',
  desktopCaptureActive: false,
  desktopCapturePaused: false,
  desktopCaptureStarting: false,
  voiceOverlayPublication: null,
  voiceOverlayStream: null,
  voiceOverlayProcessor: null,
  voiceOverlayDevices: [],
  voiceOverlayDeviceId: storedPeoplePreference('qsession-voice-overlay-device', ''),
  voiceOverlayVolume: storedNumberPreference('qsession-voice-overlay-volume', 100, 0, 150),
  voiceOverlayBass: storedNumberPreference('qsession-voice-overlay-bass', 0, -12, 12),
  voiceOverlayTreble: storedNumberPreference('qsession-voice-overlay-treble', 0, -12, 12),
  voiceOverlayStarting: false,
  voiceOverlayStopping: false,
  voiceOverlayMeterContext: null,
  voiceOverlayMeterSource: null,
  voiceOverlayMeterTimer: null,
  mediaMeterTimer: null,
  mediaMeterContext: null,
  mediaMeterSource: null,
  mediaSignalStartedAt: 0,
  mediaSignalDetected: false,
  mediaLastSignalAt: 0,
  mediaSilenceWarningShown: false,
  mediaSourceKind: '',
  broadcastAudioBitrate: 320000,
  audioInputDeviceId: storedPeoplePreference('qsession-audio-input-device', ''),
  mediaChangingSource: false,
  mediaDisconnecting: false,
  cameraEffect: storedPeoplePreference('qsession-camera-effect', 'none'),
  cameraEffectIntensity: storedNumberPreference('qsession-camera-effect-intensity', 70, 0, 100),
  cameraEffectEngine: null,
  cameraEffectPublication: null,
  mediaSignalTimer: null,
  connectionMonitorTimer: null,
  connectionMonitorBusy: false,
  broadcastAudiencePollAt: 0,
  broadcastAudiencePollBusy: false,
  connectionStatsPrevious: new Map(),
  connectionQuality: 'unknown',
  connectionLastMetrics: null,
  remoteAudioReceived: false,
  remoteAudioTracks: new Set(),
  listenerOutputGain: normalizedListenerOutputGain(storedNumberPreference('qsession-listener-output-gain', 1, .501, 1)),
  nativeAudioReady: false,
  nativeAudioFallback: false,
  listenerMuted: false,
  localCameraEnabled: false,
  cameraDeviceId: initialCameraDeviceId(),
  cameraDeviceSelectionExplicit: false,
  cameraAutomaticWideDeviceId: '',
  cameraDevices: [],
  cameraFraming: CAMERA_FRAMINGS.has(storedPeoplePreference('qsession-camera-framing', 'far'))
    ? storedPeoplePreference('qsession-camera-framing', 'far')
    : 'far',
  cameraOrientation: initialCameraOrientation(),
  cameraOrientationMode: initialCameraOrientationMode(),
  cameraZoomTrack: null,
  cameraZoomRange: null,
  primaryVideoParticipantIdentity: '',
  participantCameraAllowed: false,
  publicProfiles: [],
  selectedPersonProfileId: '',
  requestedProfileId: new URLSearchParams(location.search).get('profile') || '',
  requestedProfileOpened: false,
  profileActions: [],
  profileContacts: [],
  profileActivityUnread: 0,
  profileActivityTimer: null,
  profileActivityRealtimeSocket: null,
  profileActivityRealtimeChannel: '',
  profileActivityRealtimeRetry: null,
  profileActivityInitialized: false,
  profileActivitySeenIds: new Set(),
  requestedPrivateConversationId: /^[a-z0-9_-]{10,100}$/i.test(new URLSearchParams(location.search).get('conversation') || '')
    ? new URLSearchParams(location.search).get('conversation') : '',
  answeringPrivateCall: new URLSearchParams(location.search).get('answerCall') === '1',
  hostedSessions: [],
  hostedSessionsLoading: false,
  billing: {plans: [], credits: [], orders: [], reservations: [], enforced: false, checkoutConfigured: false, directVideoUploadsConfigured: false, error: ''},
  billingLoading: false,
  stars: {balance: 0, packages: [], checkoutConfigured: false, sponsorRewardStars: 0, sponsorMinimumViewSeconds: 15, flowers: {inventory: [], total: 0}},
  starsLoading: false,
  flowerRewardTimer: null,
  flowerRewardBusy: false,
  sponsorItems: [],
  recordedSessionAssetId: '',
  recordedSessionFile: null,
  sessionVisualPublication: null,
  sessionVisualElement: null,
  sessionVisualObjectUrl: '',
  selectedBillingPlanId: '',
  billingPlanMode: '',
  customQuote: null,
  customQuoteTimer: null,
  publicRooms: [],
  publicRoomsLoading: false,
  publicRoomsError: '',
  publicRoomsTimer: null,
  listenerRoomHistory: storedListenerRoomHistory(),
  peopleVideoTracks: new Map(),
  peopleLayout: storedPeoplePreference('qsession-people-layout', 'mosaic') === 'scroll' ? 'scroll' : 'mosaic',
  peoplePageIds: [],
  peoplePageRoom: null,
  peopleCameraSids: new Set(),
  peopleNativeBackground: false,
  installPrompt: null,
  qrScannerReader: null,
  qrScannerControls: null,
  qrNativeDetector: null,
  qrNativeTimer: null,
  qrScannerHintTimer: null,
  qrScanCompleting: false,
  qrScanMode: 'room',
};

const byId = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];

function hasNativeAndroidAudio() {
  return typeof window.QSessionPlaybackBridge?.postMessage === 'function';
}

function postNativeAudioCommand(command) {
  if (!hasNativeAndroidAudio()) return false;
  try {
    window.QSessionPlaybackBridge.postMessage(JSON.stringify(command));
    return true;
  } catch {
    return false;
  }
}

function listenerAudioElementShouldStayMuted() {
  return state.listenerMuted || listenerShouldUseNativeAudio() || Boolean(state.mediaRoom?.options?.webAudioMix);
}

function listenerShouldUseNativeAudio() {
  // Keep the proven WebView renderer active until the native engine confirms
  // that it has actually subscribed to an audio track. Merely exposing the
  // Android bridge does not mean the hidden LiveKit client is ready yet.
  return hasNativeAndroidAudio() && state.nativeAudioReady && !state.nativeAudioFallback;
}

function listenerWebAudioVolume() {
  return state.listenerMuted || listenerShouldUseNativeAudio() ? 0 : state.listenerOutputGain;
}

function chromeTabAudioConstraints() {
  return {
    channelCount: {ideal: 2},
    sampleRate: {ideal: 48000},
    sampleSize: {ideal: 24},
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

async function prepareChromeTabAudioTrack(track) {
  track.enabled = true;
  try {
    await track.applyConstraints(chromeTabAudioConstraints());
  } catch {
    // Chromium puede fijar el formato de loopback. La pista original sigue
    // siendo la ruta correcta y no debe pasar por un remuestreador Web Audio.
  }
  try { track.contentHint = 'music'; } catch { /* Algunos navegadores no exponen contentHint. */ }
}

async function configureChromeTabAudioSender(publication, requestedBitrate = state.broadcastAudioBitrate) {
  const sender = publication?.track?.sender;
  if (!sender?.getParameters || !sender?.setParameters) return false;
  try {
    const bitrate = normalizedBroadcastAudioBitrate(requestedBitrate);
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = bitrate;
    parameters.encodings[0].networkPriority = 'high';
    await sender.setParameters(parameters);
    return true;
  } catch {
    // LiveKit ya recibió el mismo preset; este ajuste reafirma el techo Opus
    // cuando Chromium conserva parámetros de una sesión previa.
    return false;
  }
}

function effectiveBroadcastAudioBitrate(value, source = state.mediaConnected ? state.mediaSourceKind : byId('broadcastSource').value) {
  const requested=normalizedBroadcastAudioBitrate(value);
  return PHYSICAL_AUDIO_SOURCES.has(source) ? Math.min(requested, byId('microphoneMode').value === 'voice' ? 96000 : 128000) : requested;
}

function renderBroadcastAudioBitrateControl() {
  const bitrate = normalizedBroadcastAudioBitrate(state.broadcastAudioBitrate);
  byId('broadcastAudioBitrate').value = String(bitrate);
  byId('broadcastQualitySummary').textContent = `${localizedUiText('Hasta')} ${Math.round(effectiveBroadcastAudioBitrate(bitrate) / 1000)} kbps`;
}

async function setBroadcastAudioBitrate(value) {
  const bitrate = normalizedBroadcastAudioBitrate(value);
  state.broadcastAudioBitrate = bitrate;
  try { localStorage.setItem(BROADCAST_AUDIO_BITRATE_KEY, String(bitrate)); } catch { /* La selección continúa durante esta visita. */ }
  renderBroadcastAudioBitrateControl();

  const label = `${Math.round(bitrate / 1000)} kbps`;
  if (state.desktopCaptureRoom) {
    const queued = postWindowsDesktopCommand({
      type: 'set-chrome-tab-capture-bitrate',
      room: state.desktopCaptureRoom,
      bitrate,
    });
    setMediaStatus(queued
      ? `Aplicando hasta ${label} sin detener la música…`
      : `Se guardó ${label}, pero esta versión de Q Session para Windows debe actualizarse para aplicarlo en vivo.`,
    !queued);
    return;
  }
  if (state.mediaAudioPublication) {
    const effective=effectiveBroadcastAudioBitrate(bitrate);
    const applied = await configureChromeTabAudioSender(state.mediaAudioPublication, effective);
    setMediaStatus(applied
      ? `Calidad actualizada en vivo: hasta ${Math.round(effective/1000)} kbps. La música no se detuvo.`
      : `Se guardó ${label}. El navegador la aplicará al reconectar la fuente.`);
    return;
  }
  setMediaStatus(`Calidad preparada: hasta ${label}. Se aplicará al iniciar la transmisión.`);
}

function mediaPublicationKind(publication) {
  return String(publication?.kind || publication?.track?.kind || '').toLowerCase();
}

function webMediaAudioEnabled() {
  if (state.mediaRole !== 'listener') return false;
  return !listenerShouldUseNativeAudio();
}

function shouldSubscribeWebMedia(publication, participant) {
  const kind = mediaPublicationKind(publication);
  if (kind === 'video' && !roomParticipantIsOrganizer(participant)) {
    return peopleCamerasVisible() && state.peopleCameraSids.has(publication.trackSid);
  }
  // Do not abandon the direct LiveKit signal until HLS has actually loaded.
  // Some phones reach the CDN before its first playlist exists (or receive a
  // transient 429). Keeping WebRTC subscribed avoids a silent, blank stage.
  if (state.mediaRole === 'listener' && state.broadcastUsingEdge && state.broadcastEdgeReady) return false;
  if (kind === 'video') return true;
  if (kind === 'audio') return webMediaAudioEnabled();
  return false;
}

function syncWebMediaPublication(publication, participant) {
  if (!publication?.setSubscribed) return;
  const subscribe = shouldSubscribeWebMedia(publication, participant);
  try { publication.setSubscribed(subscribe); } catch { /* LiveKit reconciliará la publicación al cambiar su estado. */ }
  if (mediaPublicationKind(publication) !== 'audio' || subscribe || !publication.track) return;
  try { publication.track.setVolume?.(0); } catch { /* La pista se desuscribe igualmente. */ }
  state.remoteAudioTracks.delete(publication.track);
  removeDetachedTrackElements(publication.track);
  state.remoteAudioReceived = (state.broadcastUsingEdge && state.broadcastEdgeReady) || state.remoteAudioTracks.size > 0;
}

function syncWebMediaSubscriptions(room = state.mediaRoom) {
  if (!room) return;
  refreshPeopleCameraPage();
  const entries = [];
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      entries.push({publication, participant});
    }
  }
  // Send all removals before additions, including when HLS or the page changes.
  for (const subscribe of [false, true]) {
    for (const {publication, participant} of entries) {
      if (shouldSubscribeWebMedia(publication, participant) === subscribe) {
        syncWebMediaPublication(publication, participant);
      }
    }
  }
}

function applyListenerWebAudioVolume() {
  const volume = listenerWebAudioVolume();
  state.remoteAudioTracks.forEach(track => {
    try { track.setVolume?.(volume); } catch { /* La reproducción mantiene el nivel disponible del navegador. */ }
  });
}

let listenerAudioRecoveryGeneration = 0;

async function resumeListenerAudio({announce = false, requestFocus = true} = {}) {
  if (state.mediaRole !== 'listener' || !state.mediaConnected || state.listenerMuted) return false;
  const room = state.mediaRoom;
  if (requestFocus) {
    postNativeAudioCommand({
      type: 'listener-audio-focus',
      roomCode: state.currentRoomCode,
    });
  }
  if (state.nativeAudioReady) {
    postNativeAudioCommand({type: 'listener-resume'});
    if (announce) setMediaStatus('Audio de Q Session activo en este dispositivo.');
    return true;
  }
  if (state.broadcastUsingEdge) {
    if (state.edgePlaybackNeedsGesture && !announce) return false;
    if (!state.edgeNativeBackgroundActive && !await playEdgeBroadcastVideo()) return false;
    if (announce) setMediaStatus('Audio de Q Session activo en este dispositivo.');
    return true;
  }
  let started = true;
  try {
    if (typeof room?.startAudio === 'function') await room.startAudio();
  } catch {
    started = false;
  }
  const elements = [...(byId('mediaAudioRack')?.querySelectorAll('audio') || [])];
  elements.forEach(element => {
    element.muted = false;
    element.volume = state.listenerOutputGain;
  });
  const attempts = await Promise.allSettled(
    elements.map(element => element.play?.()).filter(Boolean),
  );
  if (attempts.some(result => result.status === 'rejected')) started = false;
  if (started) {
    setListenerActionButtonLabel('toggleListenerSound', 'Silenciar');
    if (announce) setMediaStatus('Audio de Q Session activo en este dispositivo.');
  }
  return started;
}

function scheduleListenerAudioRecovery({requestFocus = true} = {}) {
  const delivery = state.broadcastDelivery;
  const roomCode = state.currentRoomCode;
  const room = state.mediaRoom;
  const generation = ++listenerAudioRecoveryGeneration;
  [0, 250, 900, 2000].forEach((delay, index, delays) => {
    setTimeout(async () => {
      if (generation !== listenerAudioRecoveryGeneration) return;
      if (state.currentRoomCode !== roomCode || state.broadcastDelivery !== delivery || state.mediaRoom !== room) return;
      if (state.mediaRole !== 'listener' || !state.mediaConnected || state.listenerMuted) return;
      const started = await resumeListenerAudio({requestFocus: requestFocus && index === 0});
      if (started || index === delays.length - 1) listenerAudioRecoveryGeneration += 1;
    }, delay);
  });
}

function renderListenerOutputControl() {
  all('[data-listener-output-gain]').forEach(button => {
    const selected = Math.abs(Number(button.dataset.listenerOutputGain) - state.listenerOutputGain) < .001;
    button.setAttribute('aria-pressed', String(selected));
  });
  const compactLabel = state.listenerOutputGain === 1
    ? 'Normal'
    : state.listenerOutputGain === .708
      ? 'Auriculares'
      : 'Suave';
  byId('listenerOutputSelection').textContent = localizedUiText(compactLabel);
  byId('listenerOutputControl').setAttribute('aria-label', `${localizedUiText('Salida de audio')}: ${localizedUiText(compactLabel)}`);
  const protectedOutput = state.listenerOutputGain < 1;
  byId('listenerOutputControl').dataset.boosted = 'false';
  byId('listenerOutputStatus').textContent = protectedOutput
    ? 'Protección activa sólo en este dispositivo. La señal original no se procesa ni se comprime.'
    : 'Señal original directa, sin refuerzo ni procesamiento.';
}

function setListenerOutputGain(gain, {announce = true} = {}) {
  state.listenerOutputGain = normalizedListenerOutputGain(gain);
  try { localStorage.setItem('qsession-listener-output-gain', String(state.listenerOutputGain)); } catch { /* El ajuste sigue activo durante esta visita. */ }
  applyListenerWebAudioVolume();
  if (state.broadcastUsingEdge) byId('broadcastVideo').volume = state.listenerOutputGain;
  postNativeAudioCommand({type: 'listener-output-gain', gain: state.listenerOutputGain});
  renderListenerOutputControl();
  if (isNativeAndroidApp()) byId('listenerOutputControl').open = false;
  if (announce && state.mediaRole === 'listener') {
    const message = state.listenerOutputGain === 1
      ? 'Normal 0 dB: señal original directa.'
      : state.listenerOutputGain === .708
        ? 'Protección para auriculares -3 dB.'
        : 'Protección para auriculares sensibles -6 dB.';
    setMediaStatus(message);
  }
}

window.addEventListener('qsession-native-audio-status', event => {
  let status;
  try { status = JSON.parse(String(event.detail || '{}')); } catch { return; }
  if (status.type === 'broadcast-continuity' && status.roomCode === state.currentRoomCode) {
    void ensureAndroidBroadcastContinuity();
    return;
  }
  if (status.type === 'broadcast-runtime-stop' && state.mediaRole === 'dj') {
    void disconnectMedia();
    return;
  }
  if (status.type === 'focus-gained') {
    scheduleListenerAudioRecovery({requestFocus: false});
    return;
  }
  if (status.type === 'focus-lost') return;
  if (status.type === 'ready') {
    state.nativeAudioReady = true;
    state.nativeAudioFallback = false;
    syncWebMediaSubscriptions();
    applyListenerWebAudioVolume();
    byId('mediaAudioRack')?.querySelectorAll('audio').forEach(element => {
      element.muted = true;
      element.pause?.();
    });
    if (state.mediaRole === 'listener' && !state.listenerMuted) {
      setMediaStatus(`Audio nativo estéreo recibido desde la sala ${state.currentRoomCode}.`);
    }
    return;
  }
  if (status.type !== 'error') return;
  state.nativeAudioReady = false;
  state.nativeAudioFallback = true;
  syncWebMediaSubscriptions();
  applyListenerWebAudioVolume();
  const elements = [...(byId('mediaAudioRack')?.querySelectorAll('audio') || [])];
  elements.forEach(element => { element.muted = listenerAudioElementShouldStayMuted(); });
  if (!state.listenerMuted) elements.forEach(element => void element.play?.().catch(() => undefined));
  if (state.mediaRole === 'listener') {
    setMediaStatus(status.message || 'El audio nativo no respondió. QSession continúa con reproducción web.', true);
  }
});

async function ensureAndroidBroadcastContinuity() {
  if (!hasNativeAndroidAudio() || state.mediaRole !== 'dj' || !state.mediaConnected || state.mediaDisconnecting || state.mediaChangingSource || state.androidBroadcastRecovering) return;
  state.androidBroadcastRecovering = true;
  try {
    if (state.mediaSourceKind === 'library') await window.QSessionMusic?.resumeBroadcast?.();
    const context = state.voiceOverlayProcessor?.context;
    if (context?.state === 'suspended' || context?.state === 'interrupted') await context.resume();
  } catch (error) {
    setMediaStatus('La señal requiere atención: ' + (error?.message || 'abre Q Session y comprueba la fuente.'), true);
  } finally { state.androidBroadcastRecovering = false; }
}

window.addEventListener('qsession-native-broadcast-background', event => {
  state.androidBroadcastBackground = event.detail?.active === true;
  void ensureAndroidBroadcastContinuity();
});

window.addEventListener('qsession-native-edge-background', event => {
  state.peopleNativeBackground = event.detail?.active === true;
  syncWebMediaSubscriptions();
  if (state.peopleNativeBackground) detachPeopleVideos();
  else if (!byId('view-people').hidden) renderPeople();
  if (!state.broadcastUsingEdge || !state.edgeNativeSessionActive) return;
  const active = event.detail?.active === true;
  state.edgeNativeBackgroundActive = active;
  state.edgeNativeForegroundPending = !active;
  state.edgeNativeHandoffGeneration = (state.edgeNativeHandoffGeneration || 0) + 1;
  const video = byId('broadcastVideo');
  if (active) {
    // Android's foreground player is now the sole audio owner. Stop fetching
    // video segments while the display is off so lock-screen continuity does
    // not double the listener's mobile-data usage.
    video.muted = true;
    video.pause?.();
    state.broadcastHls?.stopLoad?.();
    return;
  }
  // Resume at the live edge first. Native audio is released only after the
  // WebView confirms that playback has started, avoiding a silent handoff.
  state.broadcastHls?.startLoad?.(-1);
  video.muted = true;
  video.volume = state.listenerOutputGain;
  void playEdgeBroadcastVideo();
});

function localizedUiText(source) {
  return window.QSessionI18n?.translateCore(source, window.QSessionI18n?.getLocale?.()) || source;
}

function isWindowsDesktopApp() {
  const query = new URLSearchParams(location.search);
  return query.get('desktop') === 'windows' || /\bQSessionDesktop\//i.test(navigator.userAgent || '');
}

function mediaActionPresentation(buttonId, label) {
  const value = String(label || '');
  if (buttonId === 'toggleBroadcastAudio') {
    if (/^Reactivar música/i.test(value)) return {icon: 'play', state: 'paused'};
    if (/^Silenciar música/i.test(value)) return {icon: 'pause', state: 'active'};
    if (/^Reactivar/i.test(value)) return {icon: 'volume-muted', state: 'muted'};
    return {icon: 'volume-on', state: 'active'};
  }
  if (buttonId === 'toggleListenerSound') {
    if (/^Activar sonido/i.test(value)) return {icon: 'play', state: 'paused'};
    if (/^Reactivar/i.test(value)) return {icon: 'volume-muted', state: 'muted'};
    return {icon: 'volume-on', state: 'active'};
  }
  if (buttonId === 'toggleCamera' || buttonId === 'toggleListenerCamera') {
    const active = /^Detener|^Apagar/i.test(value);
    return {icon: active ? 'camera' : 'camera-off', state: active ? 'active' : 'inactive'};
  }
  return {icon: 'ports', state: 'neutral'};
}

function broadcastActionIconSvg(name) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
  if (name === 'play') return `<svg ${common}><path d="m8 5 11 7-11 7Z"/></svg>`;
  if (name === 'pause') return `<svg ${common}><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
  if (name === 'volume-on') return `<svg ${common}><path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.7 6.5a7.8 7.8 0 0 1 0 11"/></svg>`;
  if (name === 'volume-muted') return `<svg ${common}><path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="m15 10 5 5m0-5-5 5"/></svg>`;
  if (name === 'camera-off') return `<svg ${common}><path d="M3 7.5h4l1.4-2h5.2l1.4 2h2.5A2.5 2.5 0 0 1 20 10v5.5"/><path d="M18 18H5.5A2.5 2.5 0 0 1 3 15.5V10"/><path d="m3 3 18 18"/><path d="M9.8 10.1A3.4 3.4 0 0 0 14 14.2"/></svg>`;
  if (name === 'camera') return `<svg ${common}><path d="M3 9a2 2 0 0 1 2-2h2l1.5-2h7L17 7h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
  return `<svg ${common}><rect x="3" y="7" width="6" height="10" rx="1.5"/><path d="M6 10v4M9 12h3c2 0 3-1 3-3M12 12c2 0 3 1 3 3"/><rect x="15" y="4" width="6" height="6" rx="1.5"/><rect x="15" y="14" width="6" height="6" rx="1.5"/></svg>`;
}

function setBroadcastActionButtonLabel(buttonOrId, label) {
  const button = typeof buttonOrId === 'string' ? byId(buttonOrId) : buttonOrId;
  if (!button) return;
  const translatedLabel = localizedUiText(label);
  if (isWindowsDesktopApp()) document.documentElement.dataset.qsessionDesktop = 'windows';
  const presentation = mediaActionPresentation(button.id, label);
  const iconName = presentation.icon;
  const icon = document.createElement('span');
  icon.className = 'media-action-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = broadcastActionIconSvg(iconName);
  const accessibleLabel = document.createElement('span');
  accessibleLabel.className = 'media-action-label';
  accessibleLabel.textContent = translatedLabel;
  button.replaceChildren(icon, accessibleLabel);
  button.classList.add('media-icon-action');
  button.dataset.actionIcon = iconName;
  button.dataset.controlState = presentation.state;
  button.setAttribute('aria-label', translatedLabel);
  button.title = translatedLabel;
}

function initializeBroadcastActionButtons() {
  setBroadcastActionButtonLabel('toggleBroadcastAudio', 'Silenciar audio');
  setBroadcastActionButtonLabel('toggleCamera', 'Activar cámara');
  setBroadcastActionButtonLabel('changeBroadcastSource', 'Cambiar fuente de música');
}

function isNativeAndroidApp() {
  return /\bQSessionAndroid\//i.test(navigator.userAgent || '');
}

function setListenerActionButtonLabel(buttonOrId, label) {
  const button = typeof buttonOrId === 'string' ? byId(buttonOrId) : buttonOrId;
  if (!button) return;
  const translatedLabel = localizedUiText(label);
  if (isNativeAndroidApp()) document.documentElement.dataset.qsessionAndroid = 'true';
  const presentation = mediaActionPresentation(button.id, label);
  const iconName = presentation.icon;
  const icon = document.createElement('span');
  icon.className = 'media-action-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = broadcastActionIconSvg(iconName);
  const accessibleLabel = document.createElement('span');
  accessibleLabel.className = 'media-action-label';
  accessibleLabel.textContent = translatedLabel;
  button.replaceChildren(icon, accessibleLabel);
  button.classList.add('media-icon-action');
  button.dataset.actionIcon = iconName;
  button.dataset.controlState = presentation.state;
  button.setAttribute('aria-label', translatedLabel);
  button.title = translatedLabel;
}

function initializeListenerActionButtons() {
  setListenerActionButtonLabel('toggleListenerSound', 'Silenciar');
  setListenerActionButtonLabel('toggleListenerCamera', 'Activar mi cámara');
  const leaveButton = byId('leaveBroadcast');
  const leaveLabel = localizedUiText('Salir de la sala');
  leaveButton.textContent = leaveLabel;
  leaveButton.setAttribute('aria-label', leaveLabel);
  if (!isNativeAndroidApp()) return;
  byId('listenerOutputControl').open = false;
}

let confirmationResolver = null;

function settleConfirmation(accepted) {
  const resolve = confirmationResolver;
  confirmationResolver = null;
  const dialog = byId('confirmationDialog');
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  resolve?.(accepted);
}

function requestConfirmation({title, message, context = '', confirmLabel, cancelLabel = 'Cancelar'}) {
  if (confirmationResolver) settleConfirmation(false);
  byId('confirmationDialogTitle').textContent = localizedUiText(title);
  byId('confirmationDialogMessage').textContent = localizedUiText(message);
  byId('confirmationAccept').textContent = localizedUiText(confirmLabel);
  byId('confirmationCancel').textContent = localizedUiText(cancelLabel);
  const contextElement = byId('confirmationDialogContext');
  const contextValue = byId('confirmationDialogContextValue');
  contextValue.textContent = context;
  contextElement.hidden = !context;
  const dialog = byId('confirmationDialog');
  return new Promise(resolve => {
    confirmationResolver = resolve;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? {'Content-Type': 'application/json', ...(options.headers || {})} : options.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la acción');
  return payload;
}

function setStatus(element, message, error = false) {
  element.textContent = message || '';
  window.QSessionI18n?.applyTranslations(element);
  element.classList.toggle('error', error);
}

let toastTimer;
function toast(message) {
  const element = byId('toast');
  element.textContent = message;
  window.QSessionI18n?.applyTranslations(element);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 2800);
}

function appIsInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

const FALLBACK_APP_RELEASES = Object.freeze({
  android: Object.freeze({version: '0.1.42', url: '/downloads/QSession-Android-latest.apk?version=0.1.42', filename: 'QSession-Android-0.1.42.apk'}),
  windows: Object.freeze({version: '0.4.15', url: '/downloads/QSession-Windows-latest.exe?version=0.4.15', filename: 'Instalar-QSession-Windows.exe'}),
});
let appReleases = FALLBACK_APP_RELEASES;

function nativeAppIdentity(userAgent = navigator.userAgent || '', search = location.search) {
  const androidVersion = userAgent.match(/\bQSessionAndroid\/([^\s;,)]+)/i)?.[1] || '';
  if (androidVersion) return {platform: 'android', version: androidVersion};
  const windowsVersion = userAgent.match(/\bQSessionDesktop\/([^\s;,)]+)/i)?.[1] || '';
  if (windowsVersion) return {platform: 'windows', version: windowsVersion};
  const query = new URLSearchParams(search);
  const launcherVersion = query.get('desktop') === 'windows'
    ? query.get('app')?.match(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/)?.[0] || ''
    : '';
  return launcherVersion ? {platform: 'windows', version: launcherVersion} : null;
}

function compareAppVersions(left, right) {
  const parts = value => String(value || '').split(/[+-]/, 1)[0].split('.').map(part => Number(part) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function updateInstallButton() {
  const identity = nativeAppIdentity();
  const platform = identity?.platform || (/Android/i.test(navigator.userAgent) ? 'android' : /Windows/i.test(navigator.userAgent) ? 'windows' : '');
  const release = platform ? appReleases[platform] : null;
  const updateAvailable = Boolean(identity?.version && release?.version && compareAppVersions(identity.version, release.version) < 0);
  const button = byId('installAppButton');
  button.hidden = false;
  button.classList.toggle('has-update', updateAvailable);
  byId('appUpdateIndicator').hidden = !updateAvailable;
  byId('installAppButtonLabel').textContent = updateAvailable ? 'ACTUALIZAR' : 'APP';
  const description = updateAvailable
    ? `Actualizar Q Session de ${identity.version} a ${release.version}`
    : identity || appIsInstalled()
      ? 'Q Session está actualizada. Descargar instalador'
      : 'Descargar Q Session';
  button.setAttribute('aria-label', description);
  button.title = description;
  byId('windowsInstallCard').hidden = !/Windows/i.test(navigator.userAgent);
}

async function loadAppReleases() {
  try {
    const response = await fetch(`/api/app-releases?time=${Date.now()}`, {cache: 'no-store'});
    if (!response.ok) throw new Error('release catalog unavailable');
    const catalog = await response.json();
    for (const platform of ['android', 'windows']) {
      const release = catalog?.[platform];
      if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(release?.version || '')
        || !/^\/downloads\/[A-Za-z0-9._?=&-]+$/.test(release?.url || '')
        || !/^[A-Za-z0-9._-]+\.(?:apk|exe)$/.test(release?.filename || '')) throw new Error('invalid release catalog');
    }
    appReleases = catalog;
  } catch {
    appReleases = FALLBACK_APP_RELEASES;
  }
  byId('androidInstallFilename').textContent = appReleases.android.filename;
  updateInstallButton();
}

function currentAppVersionLabel(userAgent = navigator.userAgent || '') {
  const androidVersion = userAgent.match(/\bQSessionAndroid\/([^\s;,)]+)/i)?.[1];
  if (androidVersion) return `Q Session Android · v${androidVersion}`;

  const windowsVersion = userAgent.match(/\bQSessionDesktop\/([^\s;,)]+)/i)?.[1];
  if (windowsVersion) return `Q Session Windows · v${windowsVersion}`;

  const query = new URLSearchParams(location.search);
  const launchedFromWindows = query.get('desktop') === 'windows';
  const launcherVersion = query.get('app')?.match(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/)?.[0];
  if (launchedFromWindows && launcherVersion) return `Q Session Windows · v${launcherVersion}`;

  return 'Q Session Web · v0.1.4';
}

function renderAppVersionLabel() {
  const label = byId('appVersionLabel');
  label.textContent = currentAppVersionLabel();
  label.title = label.textContent;
}

function downloadWindowsApp() {
  const release = appReleases.windows;
  downloadNativeApp(
    release.url,
    release.filename,
    'Descargando el instalador de Q Session para Windows…',
  );
}

const ANDROID_APP_INTENT = 'intent://join#Intent;scheme=qsession;package=org.qsession.app;end';

function androidAppIntentUrl(roomCode = '', fallback = '') {
  const code = normalizeRoomCode(roomCode);
  const fallbackUrl = fallback || new URL(appReleases.android.url, window.location.origin).href;
  const destination = code ? `join?room=${encodeURIComponent(code)}` : 'join';
  return `intent://${destination}#Intent;scheme=qsession;package=org.qsession.app;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

function openAndroidInvitationInInstalledApp() {
  if (!/Android/i.test(navigator.userAgent) || /QSessionAndroid\//i.test(navigator.userAgent)) return;
  const query = new URLSearchParams(location.search);
  if (query.get('open') !== 'app') return;
  const code = normalizeRoomCode(query.get('room'));
  if (code.length !== 6) return;
  const fallbackUrl = new URL(location.href);
  fallbackUrl.searchParams.delete('open');
  window.location.replace(androidAppIntentUrl(code, fallbackUrl.href));
}

openAndroidInvitationInInstalledApp();

function downloadAndroidApp() {
  openAndroidInstallHelp();
  repeatAndroidDownload();
}

function openAndroidApp() {
  window.location.assign(ANDROID_APP_INTENT);
}

function repeatAndroidDownload() {
  const release = appReleases.android;
  downloadNativeApp(
    release.url,
    release.filename,
    'Descargando Q Session para Android…',
  );
}

function downloadNativeApp(href, filename, message) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  toast(message);
}

function downloadPreferredApp() {
  if (/Android/i.test(navigator.userAgent)) {
    downloadAndroidApp();
    return;
  }
  if (/Windows/i.test(navigator.userAgent)) {
    downloadWindowsApp();
    return;
  }
  void installApp();
}

function openInstallHelp() {
  const dialog = byId('installDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function openAndroidInstallHelp() {
  const dialog = byId('androidInstallDialog');
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

async function installApp() {
  if (appIsInstalled()) {
    toast('Q Session ya está instalada en este dispositivo.');
    return;
  }

  if (!state.installPrompt) {
    openInstallHelp();
    return;
  }

  const promptEvent = state.installPrompt;
  state.installPrompt = null;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  if (choice.outcome === 'accepted') toast('Q Session se está instalando.');
  else openInstallHelp();
}

function initializeHomeSessionActions() {
  const createStage = document.querySelector('#view-create .create-session-stage');
  const createPanel = byId('homeCreatePanel');
  if (createStage && createPanel && createStage.parentElement !== createPanel) createPanel.append(createStage);
}

function windowsDesktopBridge() {
  const bridge = window.chrome?.webview;
  const version = navigator.userAgent.match(/QSessionDesktop\/(\d+)\.(\d+)(?:\.\d+)?\s+Windows/i);
  const supportsExternalTabCapture = version && (Number(version[1]) > 0 || Number(version[2]) >= 3);
  return supportsExternalTabCapture && bridge?.postMessage ? bridge : null;
}

function postWindowsDesktopCommand(command) {
  const bridge = windowsDesktopBridge();
  if (!bridge) return false;
  bridge.postMessage(command);
  return true;
}

function resetDesktopCaptureState() {
  state.desktopCaptureRoom = '';
  state.desktopCaptureActive = false;
  state.desktopCapturePaused = false;
  state.desktopCaptureStarting = false;
}

function stopDesktopChromeCapture() {
  if (!state.desktopCaptureRoom) return;
  postWindowsDesktopCommand({type: 'stop-chrome-tab-capture', room: state.desktopCaptureRoom});
  resetDesktopCaptureState();
}

function initializeWindowsDesktopCaptureBridge() {
  const bridge = windowsDesktopBridge();
  if (!bridge?.addEventListener) return;
  bridge.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'chrome-tab-capture-state' || message.room !== state.desktopCaptureRoom) return;
    const captureState = String(message.state || '');
    state.desktopCaptureStarting = captureState === 'selecting';
    state.desktopCaptureActive = captureState === 'live' || captureState === 'paused';
    state.desktopCapturePaused = captureState === 'paused';
    if (captureState === 'live') {
      byId('mediaLiveBadge').textContent = 'MÚSICA EN VIVO';
      byId('mediaQuality').textContent = `Pestaña de Chrome · estéreo 48 kHz · hasta ${Math.round(state.broadcastAudioBitrate / 1000)} kbps`;
      setBroadcastActionButtonLabel('toggleBroadcastAudio', 'Silenciar música');
      const bitrateApplied = String(message.detail || '').match(/^bitrate:(\d+)$/);
      const bitrateFailed = String(message.detail || '').match(/^bitrate-error:(\d+)$/);
      setMediaStatus(bitrateApplied
        ? `Calidad actualizada en vivo: hasta ${Math.round(Number(bitrateApplied[1]) / 1000)} kbps. La música no se detuvo.`
        : bitrateFailed
          ? `No fue posible cambiar la calidad ahora. Se aplicará al reconectar la pestaña.`
          : 'Audio digital de Chrome conectado y transmitiéndose. La ventana auxiliar quedó oculta.',
      Boolean(bitrateFailed));
    } else if (captureState === 'paused') {
      byId('mediaLiveBadge').textContent = 'MÚSICA EN PAUSA';
      setBroadcastActionButtonLabel('toggleBroadcastAudio', 'Reactivar música');
      setMediaStatus('La música está pausada. La cámara y el micrófono adicional continúan activos.');
    } else if (captureState === 'selecting') {
      setMediaStatus('En la ventana de Chrome, elige una pestaña y activa “Compartir audio de la pestaña”.');
    } else if (captureState === 'error') {
      state.desktopCaptureActive = false;
      setMediaStatus(message.detail || 'Chrome necesita atención. Revisa la ventana auxiliar y vuelve a elegir la pestaña.', true);
    } else if (captureState === 'stopped') {
      state.desktopCaptureActive = false;
      state.desktopCapturePaused = false;
      if (!state.mediaDisconnecting && state.mediaRole === 'dj') {
        byId('mediaLiveBadge').textContent = 'SIN MÚSICA';
        setMediaStatus('La captura de Chrome se detuvo. Pulsa “Cambiar fuente de música” para volver a conectarla.', true);
      }
    }
  });
}

function setHomeSessionAction(action = null) {
  const selectedAction = action === 'join' || action === 'create' ? action : null;
  byId('homeJoinPanel').hidden = selectedAction !== 'join';
  byId('homeCreatePanel').hidden = selectedAction !== 'create';
  document.querySelector('.session-entry-actions')?.classList.toggle('is-create-open', selectedAction === 'create');
  all('[data-home-session-action]').forEach(button => {
    const active = button.dataset.homeSessionAction === selectedAction;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-expanded', String(active));
  });
}

function roomCreatorProfileIsActive() {
  return Boolean(
    state.account?.status === 'active'
    && state.profile?.id
    && String(state.profile.displayName || '').trim()
  );
}

function explainRoomCreatorAccess() {
  const signedIn = Boolean(state.account);
  const message = signedIn
    ? 'Completa y guarda tu perfil antes de crear una sala.'
    : 'Para crear una sala, primero crea un perfil o inicia sesión.';
  setStatus(byId(signedIn ? 'profileStatus' : 'accountStatus'), message, true);
  toast(message);
  requestAnimationFrame(() => byId(signedIn ? 'profileName' : (state.authMode === 'login' ? 'accountEmail' : 'accountName'))?.focus());
}

function showView(name, {updateHash = true} = {}) {
  let requestedName = ['live', 'create', 'people', 'chat', 'global', 'sponsors', 'vision', 'profile', 'music'].includes(name) ? name : 'live';
  if (requestedName === 'global' && !GLOBAL_RAVE_PUBLIC) requestedName = 'live';
  const creatorAccessBlocked = requestedName === 'create' && !roomCreatorProfileIsActive();
  if (creatorAccessBlocked) {
    state.pendingRoomCreation = true;
    requestedName = 'profile';
  } else if (requestedName === 'create') {
    state.pendingRoomCreation = false;
  }
  const safeName = requestedName === 'create' ? 'live' : requestedName;
  all('[data-view-panel]').forEach(panel => {
    const active = panel.dataset.viewPanel === safeName;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  syncWebMediaSubscriptions();
  if (safeName !== 'people') detachPeopleVideos();
  all('button[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === requestedName));
  setHomeSessionAction(requestedName === 'create' ? 'create' : null);
  if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}#${requestedName}`);
  if (safeName === 'live') void loadPublicRooms({quiet: state.publicRooms.length > 0});
  if (safeName === 'people') loadPeople();
  if (safeName === 'global') {
    void loadGlobalRave({quiet: Boolean(state.globalRaveSnapshot)});
    void refreshGrantedGlobalLocation();
  }
  if (safeName === 'sponsors') void loadSponsorRoom();
  if (safeName === 'vision') requestAnimationFrame(renderVisionWorldMap);
  if (safeName === 'chat') renderChat();
  else {
    stopChatPolling();
    void disconnectPrivateVoice();
  }
  if (safeName === 'profile') renderAccount();
  window.scrollTo({top: 0, behavior: 'smooth'});
  if (creatorAccessBlocked) explainRoomCreatorAccess();
  return requestedName;
}

function setSessionBackVisible(visible) {
  byId('sessionBackButton').hidden = !visible;
  document.querySelector('.topbar')?.classList.toggle('has-active-session', visible);
}

function profileInitial(profile = state.profile) {
  return String(profile?.displayName || state.account?.email || 'Q').trim().charAt(0).toUpperCase() || 'Q';
}

function profilePhotoUrl(profile = state.profile) {
  return profile?.photos?.[0]?.url || profile?.avatarUrl || '';
}

function renderProfileAvatar(elementId, profile = state.profile, {signedIn = true} = {}) {
  const element = byId(elementId);
  const fallback = signedIn ? profileInitial(profile) : 'Q';
  const photoUrl = signedIn ? profilePhotoUrl(profile) : '';
  element.replaceChildren();
  element.classList.toggle('has-photo', Boolean(photoUrl));
  if (!photoUrl) {
    element.textContent = fallback;
    return;
  }
  const image = document.createElement('img');
  image.src = photoUrl;
  image.alt = '';
  image.addEventListener('error', () => {
    element.classList.remove('has-photo');
    element.textContent = fallback;
  }, {once: true});
  element.append(image);
}

function normalizeRoomCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function roomCodeFromSharedEntry(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const sharedLinkMatch = text.match(/[?&]room=([a-z0-9]{6})(?=[^a-z0-9]|$)/i);
  if (sharedLinkMatch) return normalizeRoomCode(sharedLinkMatch[1]);
  const pathLinkMatch = text.match(/\/join\/([a-z0-9]{6})(?=[^a-z0-9]|$)/i);
  if (pathLinkMatch) return normalizeRoomCode(pathLinkMatch[1]);
  try {
    const url = new URL(text, location.origin);
    const code = normalizeRoomCode(url.searchParams.get('room'));
    if (code.length === 6) return code;
  } catch { /* La entrada también puede contener únicamente el código. */ }
  return /^[a-z0-9]{6}$/i.test(text) ? normalizeRoomCode(text) : '';
}

function roomCodeFromQrText(value) {
  return roomCodeFromSharedEntry(value);
}

function normalizePrivateContactInviteCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function privateContactInviteCodeFromSharedEntry(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const sharedLinkMatch = text.match(/[?&]chatInvite=([a-z0-9]{8})(?=[^a-z0-9]|$)/i);
  if (sharedLinkMatch) return normalizePrivateContactInviteCode(sharedLinkMatch[1]);
  try {
    const url = new URL(text, location.origin);
    const code = normalizePrivateContactInviteCode(url.searchParams.get('chatInvite'));
    if (code.length === 8) return code;
  } catch { /* La entrada también puede contener únicamente el código. */ }
  return /^[a-z0-9]{8}$/i.test(text) ? normalizePrivateContactInviteCode(text) : '';
}

function publicRoomDateLabel(room) {
  const date = new Date(room.startedAt || room.scheduledAt || '');
  if (Number.isNaN(date.getTime())) return '';
  const locale = window.QSessionI18n?.getLocale?.() || 'es';
  const localeTag = locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-US' : 'es-CO';
  return new Intl.DateTimeFormat(localeTag, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function listenerRoomHistoryDateLabel(visitedAt) {
  const date = new Date(Number(visitedAt) || 0);
  if (Number.isNaN(date.getTime())) return '';
  const locale = window.QSessionI18n?.getLocale?.() || 'es';
  const localeTag = locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-US' : 'es-CO';
  return new Intl.DateTimeFormat(localeTag, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function setListenerRoomsPanelOpen(open) {
  const toggle = byId('listenerRoomsToggle');
  const panel = byId('listenerRoomsPanel');
  if (!toggle || !panel) return;
  const nextOpen = Boolean(open);
  toggle.setAttribute('aria-expanded', String(nextOpen));
  panel.hidden = !nextOpen;
  if (nextOpen) {
    renderListenerRoomHistory();
  }
}

function rememberListenerRoom(room) {
  const code = normalizeRoomCode(room?.code);
  if (code.length !== 6) return;
  const entry = {
    code,
    name: String(room?.name || 'Sesión Q Session').trim().slice(0, 120),
    djName: String(room?.djName || '').trim().slice(0, 80),
    passwordProtected: Boolean(room?.passwordProtected),
    visitedAt: Date.now(),
  };
  state.listenerRoomHistory = [
    entry,
    ...state.listenerRoomHistory.filter(savedRoom => savedRoom.code !== code),
  ].slice(0, LISTENER_ROOM_HISTORY_LIMIT);
  try { localStorage.setItem(LISTENER_ROOM_HISTORY_KEY, JSON.stringify(state.listenerRoomHistory)); } catch { /* El historial continúa disponible durante esta visita. */ }
  renderListenerRoomHistory();
}

function renderListenerRoomHistory() {
  const list = byId('listenerRoomsList');
  const count = byId('listenerRoomHistoryCount');
  if (!list || !count) return;
  count.textContent = String(state.listenerRoomHistory.length);
  count.hidden = state.listenerRoomHistory.length === 0;
  list.replaceChildren();

  if (!state.listenerRoomHistory.length) {
    const empty = document.createElement('div');
    empty.className = 'listener-rooms-empty';
    const title = document.createElement('strong');
    title.textContent = 'Todavía no abriste ninguna sala.';
    const detail = document.createElement('span');
    detail.textContent = 'Cuando entres a una sala, quedará guardada aquí.';
    empty.append(title, detail);
    list.append(empty);
    window.QSessionI18n?.applyTranslations(list);
    return;
  }

  state.listenerRoomHistory.forEach(room => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'listener-room-history-item';
    item.dataset.listenerRoomCode = room.code;
    item.setAttribute('aria-label', `Volver a la sala ${room.name || room.code}`);

    const topline = document.createElement('span');
    topline.className = 'listener-room-history-topline';
    const name = document.createElement('strong');
    name.textContent = room.name || 'Sesión Q Session';
    name.dataset.i18nIgnore = '';
    const code = document.createElement('code');
    code.textContent = `${room.passwordProtected ? '🔒 ' : ''}${room.code}`;
    code.dataset.i18nIgnore = '';
    topline.append(name, code);

    const details = document.createElement('span');
    details.className = 'listener-room-history-details';
    const host = document.createElement('span');
    host.textContent = room.djName ? `${localizedUiText('Con')} ${room.djName}` : localizedUiText('Sala visitada');
    host.dataset.i18nIgnore = '';
    const date = document.createElement('time');
    date.dateTime = new Date(room.visitedAt).toISOString();
    date.textContent = listenerRoomHistoryDateLabel(room.visitedAt);
    date.dataset.i18nIgnore = '';
    details.append(host, date);

    const action = document.createElement('span');
    action.className = 'listener-room-history-action';
    action.textContent = 'Entrar de nuevo →';
    item.append(topline, details, action);
    list.append(item);
  });
  window.QSessionI18n?.applyTranslations(list);
}

function setPublicRoomsPanelOpen(open) {
  const toggle = byId('publicRoomsToggle');
  const panel = byId('publicRoomsPanel');
  if (!toggle || !panel) return;
  const nextOpen = Boolean(open);
  toggle.setAttribute('aria-expanded', String(nextOpen));
  panel.hidden = !nextOpen;
  if (nextOpen) {
    const historyToggle = byId('listenerRoomsToggle');
    const historyPanel = byId('listenerRoomsPanel');
    historyToggle?.setAttribute('aria-expanded', 'false');
    if (historyPanel) historyPanel.hidden = true;
  }
}

function roomAudienceCopy(room) {
  if (room?.audienceMode === 'cdn-only') {
    if (room.broadcastSessionsStatus !== 'ready' || !Number.isSafeInteger(room.activeBroadcastSessions)) return 'Conteo de sesiones no disponible';
    return `${room.activeBroadcastSessions} ${room.activeBroadcastSessions === 1 ? 'sesión activa' : 'sesiones activas'}`;
  }
  const count = Math.max(1, Number(room?.participantCount) || 1);
  return `${count} ${count === 1 ? 'persona dentro' : 'personas dentro'}`;
}

function renderPublicRooms() {
  renderQuickLiveRooms();
  const list = byId('publicRoomsList');
  if (!list) return;
  byId('publicRoomCount').textContent = String(state.publicRooms.length);
  list.replaceChildren();

  if (!state.publicRooms.length) {
    const empty = document.createElement('div');
    empty.className = 'public-room-empty';
    const title = document.createElement('strong');
    title.textContent = state.publicRoomsLoading
      ? 'Buscando transmisiones en vivo…'
      : state.publicRoomsError || 'No hay salas transmitiendo ahora.';
    empty.append(title);
    if (!state.publicRoomsLoading && !state.publicRoomsError) {
      const detail = document.createElement('span');
      detail.textContent = 'Cuando una sala pública inicie su audio, aparecerá aquí.';
      empty.append(detail);
    }
    list.append(empty);
    window.QSessionI18n?.applyTranslations(list);
    return;
  }

  state.publicRooms.forEach(room => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'public-room-card';
    card.dataset.publicRoomCode = room.code;
    card.setAttribute('aria-label', `Entrar a la sala ${room.name || room.code}`);

    const topline = document.createElement('div');
    topline.className = 'public-room-card-topline';
    const liveState = document.createElement('span');
    liveState.textContent = room.broadcastMode === 'recorded' ? '▶ GRABADA' : room.broadcastMode === 'image' ? '▣ IMAGEN + AUDIO' : '● EN VIVO';
    const code = document.createElement('code');
    code.textContent = `${room.starPrice ? `★ ${room.starPrice} · ` : ''}${room.passwordProtected ? '🔒 ' : ''}${room.code}`;
    code.dataset.i18nIgnore = '';
    topline.append(liveState, code);

    const name = document.createElement('h3');
    name.textContent = room.name || 'Sesión Q Session';
    name.dataset.i18nIgnore = '';

    const host = document.createElement('p');
    const hostPrefix = document.createElement('span');
    hostPrefix.textContent = 'Con ';
    const hostName = document.createElement('strong');
    hostName.textContent = room.djName || 'DJ invitado';
    hostName.dataset.i18nIgnore = '';
    host.append(hostPrefix, hostName);

    const footer = document.createElement('div');
    footer.className = 'public-room-card-footer';
    const date = document.createElement('span');
    date.textContent = roomAudienceCopy(room);
    const enter = document.createElement('b');
    enter.textContent = 'Entrar ahora →';
    footer.append(date, enter);
    card.append(topline, name, host, footer);
    list.append(card);
  });
  window.QSessionI18n?.applyTranslations(list);
}

function renderQuickLiveRooms() {
  const list = byId('quickLiveRoomsList');
  const count = byId('quickLiveRoomCount');
  if (!list || !count) return;
  count.textContent = String(state.publicRooms.length);
  count.hidden = state.publicRooms.length === 0;
  list.replaceChildren();

  if (!state.publicRooms.length) {
    const empty = document.createElement('div');
    empty.className = 'quick-live-rooms-empty';
    empty.textContent = state.publicRoomsLoading
      ? 'Buscando transmisiones en vivo…'
      : state.publicRoomsError || 'No hay salas transmitiendo ahora.';
    list.append(empty);
    window.QSessionI18n?.applyTranslations(list);
    return;
  }

  state.publicRooms.forEach(room => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'quick-live-room';
    item.dataset.publicRoomCode = room.code;
    item.setAttribute('aria-label', `Entrar a la sala ${room.name || room.code}`);

    const topline = document.createElement('div');
    topline.className = 'quick-live-room-topline';
    const live = document.createElement('span');
    live.textContent = 'EN VIVO';
    const code = document.createElement('code');
    code.textContent = `${room.passwordProtected ? '🔒 ' : ''}${room.code}`;
    code.dataset.i18nIgnore = '';
    topline.append(live, code);

    const name = document.createElement('h3');
    name.textContent = room.name || 'Sesión Q Session';
    name.dataset.i18nIgnore = '';

    const meta = document.createElement('div');
    meta.className = 'quick-live-room-meta';
    const host = document.createElement('span');
    const hostPrefix = document.createElement('span');
    hostPrefix.textContent = 'Con ';
    const hostName = document.createElement('strong');
    hostName.textContent = room.djName || 'DJ invitado';
    hostName.dataset.i18nIgnore = '';
    host.append(hostPrefix, hostName);
    const people = document.createElement('b');
    people.textContent = roomAudienceCopy(room);
    meta.append(host, people);
    item.append(topline, name, meta);
    list.append(item);
  });
  window.QSessionI18n?.applyTranslations(list);
}

async function loadPublicRooms({quiet = false} = {}) {
  if (state.publicRoomsLoading) return;
  state.publicRoomsLoading = true;
  state.publicRoomsError = '';
  if (!quiet && !state.publicRooms.length) renderPublicRooms();
  try {
    const result = await api('/api/rooms');
    state.publicRooms = Array.isArray(result.rooms) ? result.rooms : [];
  } catch {
    state.publicRoomsError = 'No pudimos cargar las salas públicas.';
  } finally {
    state.publicRoomsLoading = false;
    renderPublicRooms();
  }
}

function startPublicRoomPolling() {
  if (state.publicRoomsTimer) clearInterval(state.publicRoomsTimer);
  state.publicRoomsTimer = setInterval(() => {
    if (isCdnOnlyAudience()) return;
    if (document.visibilityState === 'visible' && (!byId('view-live').hidden || byId('quickLiveRoomsMenu').open)) {
      void loadPublicRooms({quiet: true});
    }
  }, 10000);
}

function globalMapPosition(latitude, longitude) {
  return {
    x: ((Number(longitude) + 180) / 360) * 1000,
    y: ((90 - Number(latitude)) / 180) * 500,
  };
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function renderVisionWorldMap() {
  const layer = byId('visionWorldCountries');
  if (!layer || layer.childElementCount) return;
  const countryMap = window.QSESSION_WORLD_COUNTRIES;
  if (!countryMap?.countries?.length) {
    const attempts = Number(layer.dataset.loadAttempts || 0);
    if (attempts < 8) {
      layer.dataset.loadAttempts = String(attempts + 1);
      window.setTimeout(renderVisionWorldMap, 250);
    }
    return;
  }
  delete layer.dataset.loadAttempts;
  const audioCountries = new Set(['AR', 'AU', 'CO', 'GB', 'IN', 'JP', 'NG', 'US', 'ZA']);
  const countries = document.createDocumentFragment();
  countryMap.countries.forEach(country => {
    countries.append(createSvgElement('path', {
      d: country.path,
      class: `vision-country${audioCountries.has(country.code) ? ' carries-audio' : ''}`,
    }));
  });
  (countryMap.microstates || []).forEach(country => {
    countries.append(createSvgElement('circle', {
      cx: country.x,
      cy: country.y,
      r: 1.35,
      class: 'vision-microstate',
    }));
  });
  layer.append(countries);
  layer.closest('svg')?.classList.add('has-vision-world');
}

function renderGlobalRaveCapitals() {
  const layer = byId('globalRaveCapitals');
  if (!layer || layer.childElementCount) return;
  GLOBAL_RAVE_CAPITALS.forEach(([name, latitude, longitude, showLabel]) => {
    const {x, y} = globalMapPosition(latitude, longitude);
    const group = createSvgElement('g', {transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`});
    const title = createSvgElement('title');
    title.textContent = name;
    group.append(title, createSvgElement('circle', {r: showLabel ? 3.1 : 2.35}));
    if (showLabel) {
      const label = createSvgElement('text', {x: 6, y: -5});
      label.textContent = name;
      group.append(label);
    }
    layer.append(group);
  });
}

function globalCountryElement(code) {
  const safeCode = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(safeCode)) return null;
  return byId('globalRaveCountries')?.querySelector(`[data-country-code="${safeCode}"]`)
    || byId('globalRaveMicrostates')?.querySelector(`[data-country-code="${safeCode}"]`)
    || null;
}

function globalCountryName(code) {
  const country = globalCountryElement(code);
  if (!country) return String(code || 'País');
  const locale = window.QSessionI18n?.getLocale?.() || 'es';
  const localeKey = `countryName${locale[0].toUpperCase()}${locale.slice(1)}`;
  return country.dataset[localeKey] || country.dataset.countryNameEs || country.dataset.countryCode;
}

function globalCountryPresence(code, snapshot = state.globalRaveSnapshot || {}) {
  const safeCode = String(code || '').trim().toUpperCase();
  return (Array.isArray(snapshot.countries) ? snapshot.countries : [])
    .find(country => String(country?.code || '').toUpperCase() === safeCode) || null;
}

function renderGlobalCountryPanel(code = state.globalMapSelectedCountry) {
  const panel = byId('globalCountryPanel');
  if (!panel) return;
  const safeCode = String(code || '').trim().toUpperCase();
  const presence = globalCountryPresence(safeCode);
  const count = Math.max(0, Number(presence?.count) || 0);
  const publicPeople = [...new Set((Array.isArray(presence?.publicPeople) ? presence.publicPeople : [])
    .map(person => String(person || '').trim()).filter(Boolean))].slice(0, 25);
  const privateCount = Math.max(0, presence?.privateCount === undefined
    ? count - publicPeople.length
    : Number(presence.privateCount) || 0);
  const status = byId('globalCountryStatus');
  const list = byId('globalCountryPeopleList');
  panel.classList.toggle('is-open', Boolean(safeCode && globalCountryElement(safeCode)));
  if (!safeCode || !globalCountryElement(safeCode)) {
    byId('globalCountryName').textContent = 'Explora el mapa';
    byId('globalCountryPeopleCount').textContent = '—';
    status.textContent = 'Sin seleccionar';
    status.classList.remove('is-active');
    list.replaceChildren();
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = 'Selecciona un país para ver su presencia.';
    list.append(item);
    return;
  }
  byId('globalCountryName').textContent = globalCountryName(safeCode);
  byId('globalCountryPeopleCount').textContent = String(count);
  status.textContent = count ? 'Activo ahora' : 'Sin presencia';
  status.classList.toggle('is-active', count > 0);
  list.replaceChildren();
  if (!count) {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = 'Aún no hay personas compartiendo presencia desde este país.';
    list.append(item);
    return;
  }
  publicPeople.forEach(name => {
    const item = document.createElement('li');
    item.textContent = name;
    list.append(item);
  });
  if (privateCount) {
    const item = document.createElement('li');
    item.className = 'private';
    item.textContent = `${privateCount} ${privateCount === 1 ? 'perfil privado' : 'perfiles privados'}`;
    list.append(item);
  }
  if (!publicPeople.length && !privateCount) {
    const item = document.createElement('li');
    item.className = 'private';
    item.textContent = `${count} ${count === 1 ? 'persona anónima' : 'personas anónimas'}`;
    list.append(item);
  }
}

function selectGlobalRaveCountry(code) {
  const safeCode = String(code || '').trim().toUpperCase();
  state.globalMapSelectedCountry = globalCountryElement(safeCode) ? safeCode : '';
  document.querySelectorAll('#globalRaveCountries [data-country-code],#globalRaveMicrostates [data-country-code]').forEach(country => {
    const selected = Boolean(state.globalMapSelectedCountry) && country.dataset.countryCode === state.globalMapSelectedCountry;
    country.classList.toggle('is-selected', selected);
    country.setAttribute('aria-pressed', String(selected));
  });
  renderGlobalCountryPanel(state.globalMapSelectedCountry);
}

function renderGlobalRaveCountries(snapshot = {}) {
  const countryLayer = byId('globalRaveCountries');
  const microstateLayer = byId('globalRaveMicrostates');
  if (!countryLayer || !microstateLayer) return;
  if (!countryLayer.childElementCount) {
    GLOBAL_RAVE_COUNTRY_MAP.countries.forEach(country => {
      const shape = createSvgElement('path', {
        class: 'country-shape',
        d: country.path,
        'data-country-code': country.code,
        'data-country-name-es': country.names?.es || country.name || country.code,
        'data-country-name-en': country.names?.en || country.name || country.code,
        'data-country-name-de': country.names?.de || country.name || country.code,
        tabindex: '0',
        role: 'button',
        'aria-pressed': 'false',
      });
      shape.append(createSvgElement('title'));
      countryLayer.append(shape);
    });
    GLOBAL_RAVE_COUNTRY_MAP.microstates.forEach(country => {
      const marker = createSvgElement('circle', {
        class: 'microstate-marker',
        cx: country.x,
        cy: country.y,
        r: 2.2,
        'data-country-code': country.code,
        'data-country-name-es': country.names?.es || country.name || country.code,
        'data-country-name-en': country.names?.en || country.name || country.code,
        'data-country-name-de': country.names?.de || country.name || country.code,
        tabindex: '0',
        role: 'button',
        'aria-pressed': 'false',
      });
      marker.append(createSvgElement('title'));
      microstateLayer.append(marker);
    });
  }
  const activeCountries = new Map((Array.isArray(snapshot.countries) ? snapshot.countries : []).map(country => [
    String(country?.code || '').toUpperCase(),
    Math.max(0, Number(country?.count) || 0),
  ]));
  const locale = window.QSessionI18n?.getLocale?.() || 'es';
  [countryLayer, microstateLayer].forEach(layer => {
    layer.querySelectorAll('[data-country-code]').forEach(country => {
      const count = activeCountries.get(country.dataset.countryCode) || 0;
      const countryName = country.dataset[`countryName${locale[0].toUpperCase()}${locale.slice(1)}`]
        || country.dataset.countryNameEs
        || country.dataset.countryCode;
      country.classList.toggle('has-presence', count > 0);
      country.classList.toggle('is-selected', country.dataset.countryCode === state.globalMapSelectedCountry);
      country.setAttribute('aria-label', count > 0
        ? `${countryName}, ${count} ${count === 1 ? 'persona activa' : 'personas activas'}`
        : `${countryName}, sin presencia activa`);
      country.setAttribute('aria-pressed', String(country.dataset.countryCode === state.globalMapSelectedCountry));
      const title = country.querySelector('title');
      if (title) title.textContent = count > 0
        ? `${countryName} · ${count} ${count === 1 ? 'persona conectada' : 'personas conectadas'}`
        : `${countryName} · sin presencia compartida`;
    });
  });
}

function seededGlobalMapValue(seed) {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  value += value << 13;
  value ^= value >>> 7;
  value += value << 3;
  value ^= value >>> 17;
  value += value << 5;
  return (value >>> 0) / 4294967295;
}

function countryPresenceMarkerPosition(countryElement, countryCode, markerIndex) {
  if (countryElement.tagName?.toLowerCase() === 'circle') {
    const angle = seededGlobalMapValue(`${countryCode}:${markerIndex}:angle`) * Math.PI * 2;
    const distance = Math.min(3.8, markerIndex * .48);
    return {
      x: Number(countryElement.getAttribute('cx')) + Math.cos(angle) * distance,
      y: Number(countryElement.getAttribute('cy')) + Math.sin(angle) * distance,
    };
  }
  const bounds = countryElement.getBBox();
  const svg = byId('globalRaveMap');
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const x = bounds.x + bounds.width * (.12 + seededGlobalMapValue(`${countryCode}:${markerIndex}:${attempt}:x`) * .76);
    const y = bounds.y + bounds.height * (.12 + seededGlobalMapValue(`${countryCode}:${markerIndex}:${attempt}:y`) * .76);
    if (typeof countryElement.isPointInFill !== 'function') return {x, y};
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    if (countryElement.isPointInFill(point)) return {x, y};
  }
  return {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
}

function renderGlobalCountryPresenceMarkers(snapshot = {}) {
  const layer = byId('globalRavePresencePoints');
  layer.replaceChildren();
  (Array.isArray(snapshot.countries) ? snapshot.countries : []).forEach(country => {
    const code = String(country?.code || '').trim().toUpperCase();
    const countryElement = globalCountryElement(code);
    if (!countryElement) return;
    const markerCount = Math.min(25, Math.max(0, Number(country?.count) || 0));
    for (let index = 0; index < markerCount; index += 1) {
      const {x, y} = countryPresenceMarkerPosition(countryElement, code, index);
      const group = createSvgElement('g', {
        transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
        'data-country-code': code,
        'aria-hidden': 'true',
      });
      const title = createSvgElement('title');
      title.textContent = `Presencia en ${globalCountryName(code)} · sin ubicación exacta`;
      group.append(
        title,
        createSvgElement('circle', {class: 'presence-halo', r: 10}),
        createSvgElement('circle', {class: 'presence-core', r: 3}),
      );
      layer.append(group);
    }
  });
}

function renderGlobalRave(snapshot = {}) {
  renderGlobalRaveCountries(snapshot);
  renderGlobalRaveCapitals();
  const people = Math.max(0, Number(snapshot.total) || 0);
  const visiblePeople = Math.max(0, Number(snapshot.visiblePresenceCount ?? snapshot.total) || 0);
  const activeCountries = Math.max(0, Number(snapshot.activeCountries) || 0);
  byId('globalRavePeople').textContent = String(people);
  byId('globalRaveCountryCount').textContent = String(activeCountries);
  renderGlobalCountryPresenceMarkers(snapshot);
  renderGlobalCountryPanel();
  byId('globalRaveStatus').textContent = visiblePeople
    ? `${visiblePeople} ${visiblePeople === 1 ? 'persona comparte' : 'personas comparten'} su país actual en este momento.`
    : people
      ? `${people} ${people === 1 ? 'persona conectada' : 'personas conectadas'}; aún no comparten ubicación.`
      : 'Todavía no hay países compartidos. El mapa se actualizará automáticamente.';
  renderGlobalPresenceControl();
}

function clampGlobalMapView(view) {
  const width = Math.max(1000 / 6, Math.min(1000, Number(view.width) || 1000));
  const height = width / 2;
  return {
    width,
    height,
    x: Math.max(0, Math.min(1000 - width, Number(view.x) || 0)),
    y: Math.max(0, Math.min(500 - height, Number(view.y) || 0)),
    scale: 1000 / width,
  };
}

function applyGlobalMapView(view = state.globalMapView) {
  state.globalMapView = clampGlobalMapView(view);
  const {x, y, width, height, scale} = state.globalMapView;
  byId('globalRaveMap').setAttribute('viewBox', `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`);
  byId('globalMapZoomValue').textContent = `${Math.round(scale * 100)}%`;
  byId('globalMapZoomOut').disabled = scale <= 1.001;
  byId('globalMapZoomIn').disabled = scale >= 5.999;
}

function globalMapPointFromClient(clientX, clientY) {
  const svg = byId('globalRaveMap');
  const rect = svg.getBoundingClientRect();
  const view = state.globalMapView;
  return {
    x: view.x + ((clientX - rect.left) / Math.max(1, rect.width)) * view.width,
    y: view.y + ((clientY - rect.top) / Math.max(1, rect.height)) * view.height,
  };
}

function zoomGlobalMap(nextScale, anchor = null) {
  const current = state.globalMapView;
  const safeScale = Math.max(1, Math.min(6, Number(nextScale) || 1));
  const focus = anchor || {x: current.x + current.width / 2, y: current.y + current.height / 2};
  const ratioX = (focus.x - current.x) / current.width;
  const ratioY = (focus.y - current.y) / current.height;
  const width = 1000 / safeScale;
  const height = 500 / safeScale;
  applyGlobalMapView({x: focus.x - ratioX * width, y: focus.y - ratioY * height, width, height});
}

function resetGlobalMapView() {
  applyGlobalMapView({x: 0, y: 0, width: 1000, height: 500});
}

function initializeGlobalRaveMap() {
  const svg = byId('globalRaveMap');
  const viewport = byId('globalRaveMapViewport');
  if (!svg || svg.dataset.interactive === 'true') return;
  svg.dataset.interactive = 'true';
  // Political geometry is useful even while the live presence endpoint is
  // reconnecting. Rendering it here prevents an empty ocean when the first
  // API request is slow or temporarily unavailable.
  renderGlobalRaveCountries(state.globalRaveSnapshot || {});
  renderGlobalRaveCapitals();
  let suppressClick = false;
  let pinchDistance = 0;
  let pinchScale = 1;
  let pinchAnchor = null;
  let pinching = false;
  let momentumFrame = 0;
  const countryTarget = target => {
    let element = target;
    while (element && element !== svg) {
      if (element.dataset?.countryCode) return element;
      element = element.parentNode;
    }
    return null;
  };
  const stopMomentum = () => {
    if (momentumFrame) cancelAnimationFrame(momentumFrame);
    momentumFrame = 0;
  };
  const showCountryTooltip = (country, clientX, clientY, {pinned = false} = {}) => {
    const tooltip = byId('globalMapTooltip');
    if (!country) {
      if (tooltip.dataset.pinned !== 'true') tooltip.hidden = true;
      return;
    }
    const presence = globalCountryPresence(country.dataset.countryCode);
    const count = Math.max(0, Number(presence?.count) || 0);
    const rect = viewport.getBoundingClientRect();
    tooltip.textContent = `${globalCountryName(country.dataset.countryCode)}\n${count ? `${count} ${count === 1 ? 'persona conectada' : 'personas conectadas'} ahora` : 'Sin personas conectadas ahora'}`;
    tooltip.dataset.pinned = String(pinned);
    tooltip.classList.toggle('is-pinned', pinned);
    tooltip.hidden = false;
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.width - tooltipRect.width - 8, clientX - rect.left + 12));
    const top = Math.max(8, Math.min(rect.height - tooltipRect.height - 8, clientY - rect.top + 12));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const startMomentum = (velocityX, velocityY) => {
    stopMomentum();
    const animate = () => {
      velocityX *= .91;
      velocityY *= .91;
      if (Math.hypot(velocityX, velocityY) < .055) {
        momentumFrame = 0;
        return;
      }
      applyGlobalMapView({
        ...state.globalMapView,
        x: state.globalMapView.x + velocityX,
        y: state.globalMapView.y + velocityY,
      });
      momentumFrame = requestAnimationFrame(animate);
    };
    momentumFrame = requestAnimationFrame(animate);
  };
  byId('globalMapZoomIn').addEventListener('click', () => zoomGlobalMap(state.globalMapView.scale * 1.35));
  byId('globalMapZoomOut').addEventListener('click', () => zoomGlobalMap(state.globalMapView.scale / 1.35));
  byId('globalMapReset').addEventListener('click', () => {
    stopMomentum();
    resetGlobalMapView();
  });
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    stopMomentum();
    zoomGlobalMap(state.globalMapView.scale * (event.deltaY < 0 ? 1.18 : 1 / 1.18), globalMapPointFromClient(event.clientX, event.clientY));
  }, {passive: false});
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.pointerType === 'touch' && !event.isPrimary)) return;
    stopMomentum();
    const tooltip = byId('globalMapTooltip');
    tooltip.dataset.pinned = 'false';
    tooltip.hidden = true;
    state.globalMapPointer = {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      velocityX: 0,
      velocityY: 0,
    };
    // Capture only after a drag begins; capturing a tap retargets its click
    // to the SVG root and loses the country under the pointer.
  });
  svg.addEventListener('pointermove', event => {
    const country = countryTarget(event.target);
    if (!state.globalMapPointer && event.pointerType !== 'touch') {
      showCountryTooltip(country, event.clientX, event.clientY);
    }
    const pointer = state.globalMapPointer;
    if (!pointer || pointer.id !== event.pointerId || pinching) return;
    const dx = event.clientX - pointer.clientX;
    const dy = event.clientY - pointer.clientY;
    if (!pointer.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      pointer.moved = true;
      svg.setPointerCapture?.(event.pointerId);
    }
    if (!pointer.moved) return;
    const rect = svg.getBoundingClientRect();
    pointer.velocityX = -dx * state.globalMapView.width / Math.max(1, rect.width);
    pointer.velocityY = -dy * state.globalMapView.height / Math.max(1, rect.height);
    applyGlobalMapView({
      ...state.globalMapView,
      x: state.globalMapView.x + pointer.velocityX,
      y: state.globalMapView.y + pointer.velocityY,
    });
    pointer.clientX = event.clientX;
    pointer.clientY = event.clientY;
    viewport.classList.add('is-dragging');
  });
  const finishPointer = event => {
    if (state.globalMapPointer?.id !== event.pointerId) return;
    const pointer = state.globalMapPointer;
    suppressClick = pointer.moved;
    state.globalMapPointer = null;
    viewport.classList.remove('is-dragging');
    if (pointer.moved && !pinching) startMomentum(pointer.velocityX, pointer.velocityY);
    setTimeout(() => { suppressClick = false; }, 80);
  };
  svg.addEventListener('pointerup', finishPointer);
  svg.addEventListener('pointercancel', finishPointer);
  svg.addEventListener('pointerleave', () => {
    const tooltip = byId('globalMapTooltip');
    if (tooltip.dataset.pinned !== 'true') tooltip.hidden = true;
  });
  svg.addEventListener('click', event => {
    if (suppressClick) return;
    const country = countryTarget(event.target);
    if (country) {
      selectGlobalRaveCountry(country.dataset.countryCode);
      showCountryTooltip(country, event.clientX, event.clientY, {pinned: true});
    } else {
      selectGlobalRaveCountry('');
      const tooltip = byId('globalMapTooltip');
      tooltip.dataset.pinned = 'false';
      tooltip.hidden = true;
    }
  });
  svg.addEventListener('dblclick', event => {
    const country = countryTarget(event.target);
    if (!country) return;
    event.preventDefault();
    selectGlobalRaveCountry(country.dataset.countryCode);
    const bounds = country.getBBox();
    zoomGlobalMap(Math.max(2.4, state.globalMapView.scale * 1.35), {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2});
  });
  svg.addEventListener('keydown', event => {
    const country = countryTarget(event.target);
    if (country && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      selectGlobalRaveCountry(country.dataset.countryCode);
      return;
    }
    if (event.key === '+' || event.key === '=') zoomGlobalMap(state.globalMapView.scale * 1.3);
    else if (event.key === '-') zoomGlobalMap(state.globalMapView.scale / 1.3);
    else if (event.key === '0') resetGlobalMapView();
    else return;
    event.preventDefault();
  });
  svg.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;
    pinching = true;
    stopMomentum();
    state.globalMapPointer = null;
    viewport.classList.add('is-dragging');
    const [first, second] = event.touches;
    pinchDistance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    pinchScale = state.globalMapView.scale;
    pinchAnchor = globalMapPointFromClient((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
  }, {passive: true});
  svg.addEventListener('touchmove', event => {
    if (event.touches.length !== 2 || !pinchDistance) return;
    event.preventDefault();
    const [first, second] = event.touches;
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    zoomGlobalMap(pinchScale * distance / pinchDistance, pinchAnchor);
  }, {passive: false});
  svg.addEventListener('touchend', event => {
    if (event.touches.length >= 2) return;
    pinchDistance = 0;
    pinchAnchor = null;
    pinching = false;
    viewport.classList.remove('is-dragging');
  }, {passive: true});
  document.addEventListener('qsession:languagechange', () => {
    renderGlobalRave(state.globalRaveSnapshot || {});
    renderGlobalCountryPanel();
  });
  applyGlobalMapView();
}

async function loadGlobalRave({quiet = false} = {}) {
  if (state.globalRaveLoading) return;
  state.globalRaveLoading = true;
  if (!quiet && !state.globalRaveSnapshot) byId('globalRaveStatus').textContent = 'Buscando presencias alrededor del mundo…';
  try {
    const result = await api('/api/global-rave');
    state.globalRaveSnapshot = result;
    renderGlobalRave(result);
  } catch {
    if (!quiet) byId('globalRaveStatus').textContent = 'El mapa global se está reconectando.';
  } finally {
    state.globalRaveLoading = false;
  }
}

function startGlobalRavePolling() {
  if (state.globalRaveTimer) clearInterval(state.globalRaveTimer);
  state.globalRaveTimer = setInterval(() => {
    if (isCdnOnlyAudience()) return;
    if (document.visibilityState === 'visible' && !byId('view-global').hidden) void loadGlobalRave({quiet: true});
  }, 5000);
}

function nativeGpsCountryCode() {
  const bridge = window.QSessionNativeBridge;
  if (typeof bridge?.requestGpsCountry !== 'function') return null;
  const requestId = `gps-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('qsession-native-gps-country', onResult);
      callback(value);
    };
    const onResult = event => {
      const detail = event?.detail || {};
      if (detail.requestId !== requestId) return;
      const code = String(detail.countryCode || '').trim().toUpperCase();
      if (detail.verifiedBy !== 'gps' || !Number.isFinite(detail.accuracy) || detail.accuracy > 1000 || detail.accuracy < 0) {
        finish(reject, new Error(detail.error || 'No fue posible verificar el país mediante GPS.'));
        return;
      }
      if (/^[A-Z]{2}$/.test(code)) {
        finish(resolve, code);
        return;
      }
      // Some Android builds can obtain a precise satellite fix but have no
      // working Geocoder backend. In that case the native shell hands the fix
      // to this local page, which resolves the political shape without ever
      // sending the coordinates to Q Session.
      const localCode = countryCodeFromApproximatePosition({coords: {
        latitude: Number(detail.latitude),
        longitude: Number(detail.longitude),
      }});
      if (/^[A-Z]{2}$/.test(localCode)) finish(resolve, localCode);
      else finish(reject, new Error(detail.error || 'El GPS respondió, pero no pudimos identificar el país.'));
    };
    const timeout = setTimeout(() => {
      finish(reject, new Error('El GPS tardó demasiado en responder. Comprueba que la ubicación esté activa e inténtalo nuevamente.'));
    }, 40_000);
    window.addEventListener('qsession-native-gps-country', onResult);
    try {
      bridge.requestGpsCountry(requestId);
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function verifiedGpsCountryCode() {
  const nativeRequest = nativeGpsCountryCode();
  if (nativeRequest) return nativeRequest;
  throw new Error('Este dispositivo no ofrece GPS confirmado a Q Session. La ubicación por Wi-Fi, IP o predeterminada no activa el localizador. Usa la app Android con GPS y un perfil público; luego toca Usar GPS de mi cuenta aquí.');
}

function globalCountryStorageKey() {
  return state.account?.id ? `qsession-global-country-gps-public-v3-${state.account.id}` : '';
}

function storedGlobalCountryCode() {
  if (!state.account) return '';
  const memory = {code: state.globalPresenceCountryCode, verifiedAt: state.globalPresenceVerifiedAt, verifiedBy: state.globalPresenceVerifiedBy};
  if (window.QSessionCountryLocation.freshCountry(memory)) return memory.code;
  try {
    const record = JSON.parse(localStorage.getItem(globalCountryStorageKey()) || 'null');
    const code = window.QSessionCountryLocation.freshCountry(record);
    if (code) {
      state.globalPresenceCountryCode = code;
      state.globalPresenceVerifiedAt = record.verifiedAt;
      state.globalPresenceVerifiedBy = 'gps';
    }
    return code;
  } catch { return ''; }
}

function rememberGlobalCountryCode(code, verifiedAt = Date.now()) {
  const safeCode = String(code || '').trim().toUpperCase();
  const key = globalCountryStorageKey();
  if (!key || !/^[A-Z]{2}$/.test(safeCode)) return;
  state.globalPresenceCountryCode = safeCode;
  state.globalPresenceVerifiedAt = verifiedAt;
  state.globalPresenceVerifiedBy = 'gps';
  try { localStorage.setItem(key, JSON.stringify({code: safeCode, verifiedAt: state.globalPresenceVerifiedAt, verifiedBy: 'gps'})); } catch { /* Sigue activa durante esta visita. */ }
}

function forgetGlobalCountryCode() {
  const key = globalCountryStorageKey();
  state.globalPresenceCountryCode = '';
  state.globalPresenceVerifiedAt = 0;
  state.globalPresenceVerifiedBy = '';
  if (key) try { localStorage.removeItem(key); } catch { /* La presencia del servidor también expira. */ }
}

async function refreshGrantedGlobalLocation() {
  // A new GPS request is explicit: no browser permission can prove a satellite source.
}

async function resumeGlobalPresenceFromProfile() {
  if (!state.account || !state.profile?.visible || !state.profile?.social?.shareApproximateLocation) { forgetGlobalCountryCode(); await stopWebGlobalPresence(); return; }
  // A saved profile country is residence/history, never a current location fix.
  if (storedGlobalCountryCode()) startWebGlobalPresence();
  else {
    forgetGlobalCountryCode();
    await stopWebGlobalPresence();
    await refreshGrantedGlobalLocation();
  }
}

function countryCodeFromApproximatePosition(position) {
  return window.QSessionCountryLocation.countryCode(GLOBAL_RAVE_COUNTRY_MAP, position?.coords);
}

function globalPresenceProfilePayload() {
  const profile = state.profile || {};
  const social = profile.social || {};
  return {
    displayName: profile.displayName || '',
    role: profile.role === 'dj' ? 'dj' : 'listener',
    bio: profile.bio || '',
    country: profile.country || '',
    city: profile.city || '',
    visible: Boolean(profile.visible),
    photos: (profile.photos || []).map(photo => ({id: photo.id, caption: photo.caption || null})),
    social: {
      allowMatchmaking: Boolean(social.allowMatchmaking),
      allowMessages: Boolean(social.allowMessages),
      showResidence: Boolean(social.showResidence),
      shareApproximateLocation: true,
      allowDjContact: social.allowDjContact !== false,
      allowTips: social.allowTips !== false,
    },
  };
}

function renderGlobalPresenceControl() {
  const button = byId('shareGlobalCountry');
  const status = byId('globalShareCountryStatus');
  if (!button || !status) return;
  const phoneButton = byId('useAccountGpsCountry');
  if (phoneButton) { phoneButton.hidden = isNativeAndroidApp(); phoneButton.disabled = state.globalPresenceBusy || !state.account || !state.profile?.visible; }
  const code = storedGlobalCountryCode();
  if (code) state.globalPresenceCountryCode = code;
  const active = Boolean(code && state.profile?.visible && state.profile?.social?.shareApproximateLocation);
  button.classList.toggle('is-active', active);
  button.disabled = state.globalPresenceBusy;
  if (!state.account) {
    button.innerHTML = '<span aria-hidden="true">◎</span> Iniciar sesión para compartir';
    status.textContent = 'Necesitas un perfil para que cada persona cuente una sola vez.';
    return;
  }
  if (!state.profile?.visible) {
    button.innerHTML = '<span aria-hidden="true">◎</span> Perfil público requerido';
    status.textContent = 'Haz público tu perfil para activar el localizador por GPS. El país no se comparte desde perfiles privados.';
    button.disabled = true;
    return;
  }
  if (active) {
    button.innerHTML = `<span aria-hidden="true">●</span> ${escapeAttribute(globalCountryName(code))} · Actualizar ubicación`;
    if (state.globalPresenceError) {
      status.textContent = state.globalPresenceError;
      return;
    }
    status.textContent = state.profile?.visible
      ? 'Tu país está activo y tu nombre público puede aparecer dentro de sus perfiles.'
      : 'Tu país está activo. Tu punto y tu perfil permanecen anónimos.';
    return;
  }
  button.innerHTML = '<span aria-hidden="true">◎</span> Compartir mi país';
  status.textContent = state.globalPresenceError || 'Activa tu país únicamente con GPS confirmado y tu perfil público. Solo se comparte el país; las coordenadas permanecen en el dispositivo.';
}

async function updateWebGlobalPresence() {
  if (isCdnOnlyAudience()) return;
  if (state.globalPresenceBusy || !state.account) return;
  if (!state.profile?.visible || !state.profile?.social?.shareApproximateLocation) { forgetGlobalCountryCode(); await stopWebGlobalPresence(); renderGlobalPresenceControl(); return; }
  const countryCode = storedGlobalCountryCode();
  if (!countryCode) {
    forgetGlobalCountryCode();
    await stopWebGlobalPresence();
    renderGlobalPresenceControl();
    void refreshGrantedGlobalLocation();
    return;
  }
  state.globalPresenceBusy = true;
  renderGlobalPresenceControl();
  try {
    await api('/api/global-rave/presence', {
      method: 'POST',
      body: JSON.stringify({countryCode, verifiedAt: state.globalPresenceVerifiedAt, verifiedBy: 'gps'}),
    });
    state.globalPresenceError = '';
    if (!byId('view-global').hidden) void loadGlobalRave({quiet: true});
  } catch (error) {
    state.globalPresenceError = error?.message || 'El mapa no pudo confirmar tu presencia. Q Session volverá a intentarlo.';
  } finally {
    state.globalPresenceBusy = false;
    renderGlobalPresenceControl();
  }
}

function startWebGlobalPresence() {
  if (state.globalPresenceTimer) clearInterval(state.globalPresenceTimer);
  void updateWebGlobalPresence();
  state.globalPresenceTimer = setInterval(() => void updateWebGlobalPresence(), 60000);
}

async function stopWebGlobalPresence({remove = true} = {}) {
  if (state.globalPresenceTimer) clearInterval(state.globalPresenceTimer);
  state.globalPresenceTimer = null;
  if (remove && state.account) await api('/api/global-rave/presence', {method: 'DELETE', keepalive: true}).catch(() => {});
}

async function useAccountGpsCountry() {
  if (!state.account || !state.profile?.visible || state.globalPresenceBusy) return;
  state.globalPresenceBusy = true; renderGlobalPresenceControl();
  try {
    const verification = await api('/api/global-rave/verification');
    const code = window.QSessionCountryLocation.freshCountry({code:verification.countryCode,verifiedAt:verification.verifiedAt,verifiedBy:verification.verifiedBy});
    if (!code) throw new Error('La verificación GPS caducó. Actualízala desde el teléfono.');
    rememberGlobalCountryCode(code, verification.verifiedAt);
    state.profile.social.shareApproximateLocation = true;
    state.globalPresenceError = ''; startWebGlobalPresence(); selectGlobalRaveCountry(code);
    await loadGlobalRave({quiet:true}); toast('País confirmado por GPS en tu cuenta: ' + globalCountryName(code));
  } catch (error) { state.globalPresenceError = error.message; }
  finally { state.globalPresenceBusy = false; renderGlobalPresenceControl(); }
}

async function shareGlobalCountry() {
  const status = byId('globalShareCountryStatus');
  let failureMessage = '';
  if (!state.account || !state.profile) {
    showView('profile');
    toast('Inicia sesión para compartir tu país');
    return;
  }
  if (!state.profile.visible) { state.globalPresenceError = 'Haz público tu perfil antes de activar el localizador por GPS.'; forgetGlobalCountryCode(); await stopWebGlobalPresence(); renderGlobalPresenceControl(); return; }
  if (state.globalPresenceBusy) return;
  state.globalPresenceBusy = true;
  renderGlobalPresenceControl();
  status.textContent = 'Verificando la ubicación actual de este dispositivo…';
  try {
    const countryCode = await verifiedGpsCountryCode();
    const saved = await api('/api/account/profile', {
      method: 'PUT',
      body: JSON.stringify(globalPresenceProfilePayload()),
    });
    state.profile = saved.profile;
    rememberGlobalCountryCode(countryCode);
    await api('/api/global-rave/presence', {
      method: 'POST',
      body: JSON.stringify({countryCode, verifiedAt: state.globalPresenceVerifiedAt, verifiedBy: 'gps'}),
    });
    state.globalPresenceError = '';
    startWebGlobalPresence();
    renderAccount();
    selectGlobalRaveCountry(countryCode);
    await loadGlobalRave({quiet: true});
    toast(`${globalCountryName(countryCode)} ya cuenta en Global Rave`);
  } catch (error) {
    const denied = error?.code === 1 || error?.name === 'NotAllowedError';
    failureMessage = denied
      ? 'No se compartió nada. Autoriza la ubicación del dispositivo e inténtalo nuevamente.'
      : (error?.message || 'No pudimos activar tu país. Inténtalo nuevamente.');
    state.globalPresenceError = failureMessage;
    forgetGlobalCountryCode();
    await stopWebGlobalPresence();
  } finally {
    state.globalPresenceBusy = false;
    renderGlobalPresenceControl();
    if (failureMessage) status.textContent = failureMessage;
  }
}

function profileResidence(profile = {}) {
  let city = String(profile.city || '').trim();
  let country = String(profile.country || '').trim();
  if (!country && /^,\s*\S/.test(city)) {
    country = city.replace(/^,\s*/, '');
    city = '';
  }
  return {city, country};
}

function normalizedCountryLookup(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function profileCountryCode(profile = {}) {
  const countryName = profileResidence(profile).country;
  const normalized = normalizedCountryLookup(countryName);
  if (/^[a-z]{2}$/.test(normalized)) return normalized.toUpperCase();
  const aliases = {
    'estados unidos': 'US', 'estados unidos de america': 'US', usa: 'US',
    'reino unido': 'GB', inglaterra: 'GB', uk: 'GB',
    'corea del sur': 'KR', 'corea del norte': 'KP',
    'republica dominicana': 'DO', 'republica checa': 'CZ',
  };
  if (aliases[normalized]) return aliases[normalized];
  const countries = [...GLOBAL_RAVE_COUNTRY_MAP.countries, ...GLOBAL_RAVE_COUNTRY_MAP.microstates];
  const match = countries.find(country => Object.values(country.names || {})
    .some(name => normalizedCountryLookup(name) === normalized));
  return match?.code || '';
}

function profileResidenceLabel(profile = {}) {
  const residence = profileResidence(profile);
  return [residence.city, residence.country].filter(Boolean).join(', ');
}

function stopRoomQrScanner({close = false} = {}) {
  clearTimeout(state.qrNativeTimer);
  clearTimeout(state.qrScannerHintTimer);
  state.qrNativeTimer = null;
  state.qrScannerHintTimer = null;
  state.qrNativeDetector = null;
  try { state.qrScannerControls?.stop?.(); } catch { /* La cámara ya estaba detenida. */ }
  state.qrScannerControls = null;
  state.qrScannerReader = null;
  const video = byId('roomQrVideo');
  video.srcObject?.getTracks?.().forEach(track => track.stop());
  video.pause();
  video.srcObject = null;
  const dialog = byId('roomQrScannerDialog');
  if (close && dialog.open) dialog.close();
}

function completeRoomQrScan(rawValue, status, controls = state.qrScannerControls) {
  if (!rawValue || state.qrScanCompleting) return false;
  if (state.qrScanMode === 'private-contact') {
    const privateCode = privateContactInviteCodeFromSharedEntry(rawValue);
    if (!privateCode) {
      setStatus(status, 'Ese QR no contiene una invitación de contacto privado de Q Session.', true);
      return false;
    }
    state.qrScanCompleting = true;
    try { controls?.stop?.(); } catch { /* La lectura ya finalizó. */ }
    byId('privateContactInviteInput').value = privateCode;
    setStatus(status, 'Invitación reconocida. Conectando…');
    stopRoomQrScanner({close: true});
    requestAnimationFrame(() => {
      state.qrScanCompleting = false;
      byId('redeemPrivateContactInviteForm').requestSubmit();
    });
    return true;
  }
  const code = roomCodeFromQrText(rawValue);
  if (!code) {
    setStatus(status, 'Ese QR no contiene una sala de Q Session. Prueba con el QR que muestra el DJ.', true);
    return false;
  }
  state.qrScanCompleting = true;
  try { controls?.stop?.(); } catch { /* La lectura ya finalizó. */ }
  byId('roomCode').value = code;
  setStatus(status, `Sala ${code} encontrada. Entrando…`);
  stopRoomQrScanner({close: true});
  requestAnimationFrame(() => {
    state.qrScanCompleting = false;
    byId('joinRoomForm').requestSubmit();
  });
  return true;
}

async function tuneRoomQrCamera(video) {
  const track = video.srcObject?.getVideoTracks?.()[0];
  if (!track?.applyConstraints) return;
  const capabilities = track.getCapabilities?.() || {};
  const settings = track.getSettings?.() || {};
  const advanced = [];
  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
    advanced.push({focusMode: 'continuous'});
  }
  const zoom = capabilities.zoom;
  if (Number.isFinite(zoom?.min) && Number.isFinite(zoom?.max) && zoom.max > zoom.min) {
    const current = Number.isFinite(Number(settings.zoom)) ? Number(settings.zoom) : zoom.min;
    const desired = Math.min(zoom.max, Math.max(zoom.min, 1));
    const step = Number(zoom.step) || .1;
    const target = Math.min(zoom.max, Math.max(zoom.min, zoom.min + Math.round((desired - zoom.min) / step) * step));
    if (Math.abs(target - current) > .01) advanced.push({zoom: target});
  }
  if (!advanced.length) return;
  try { await track.applyConstraints({advanced}); } catch { /* El lector continúa sin estos ajustes opcionales. */ }
}

async function startNativeRoomQrDetection(video, status) {
  if (typeof window.BarcodeDetector !== 'function') return false;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats?.();
    if (Array.isArray(supported) && !supported.includes('qr_code')) return false;
    const detector = new window.BarcodeDetector({formats: ['qr_code']});
    state.qrNativeDetector = detector;
    const detectFrame = async () => {
      if (state.qrNativeDetector !== detector || state.qrScanCompleting || !byId('roomQrScannerDialog').open) return;
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const codes = await detector.detect(video);
          const rawValue = codes.find(code => code.rawValue)?.rawValue;
          if (completeRoomQrScan(rawValue, status)) return;
        }
      } catch { /* ZXing continúa leyendo cuando el detector nativo no reconoce este cuadro. */ }
      if (state.qrNativeDetector === detector) state.qrNativeTimer = setTimeout(detectFrame, 180);
    };
    state.qrNativeTimer = setTimeout(detectFrame, 100);
    return true;
  } catch {
    state.qrNativeDetector = null;
    return false;
  }
}

async function startRoomQrScanner(mode = 'room') {
  const dialog = byId('roomQrScannerDialog');
  const status = byId('roomQrScannerStatus');
  const ZXing = window.ZXingBrowser;
  state.qrScanMode = mode === 'private-contact' ? 'private-contact' : 'room';
  const privateContactMode = state.qrScanMode === 'private-contact';
  if (!ZXing?.BrowserQRCodeReader || !navigator.mediaDevices?.getUserMedia) {
    setStatus(privateContactMode ? byId('privateContactInviteStatus') : byId('joinStatus'), 'Este dispositivo no puede abrir el escáner QR. Puedes escribir el código.', true);
    return;
  }

  stopRoomQrScanner();
  state.qrScanCompleting = false;
  byId('roomQrScannerEyebrow').textContent = privateContactMode ? 'CONTACTO PRIVADO' : 'ENTRAR A UNA SALA';
  byId('roomQrScannerTitle').textContent = privateContactMode ? 'Escanea la invitación' : 'Escanea el QR de la sesión';
  setStatus(status, 'Abriendo la cámara…');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  try {
    const reader = new ZXing.BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 300,
    });
    state.qrScannerReader = reader;
    const controls = await reader.decodeFromConstraints({
      audio: false,
      video: {
        facingMode: {ideal: 'environment'},
        width: {ideal: 1920},
        height: {ideal: 1080},
        frameRate: {ideal: 30},
      },
    }, byId('roomQrVideo'), (result, _error, controls) => {
      completeRoomQrScan(result?.getText?.() || result?.text, status, controls);
    });
    if (state.qrScannerReader !== reader || !dialog.open) {
      controls.stop?.();
      return;
    }
    state.qrScannerControls = controls;
    const video = byId('roomQrVideo');
    await tuneRoomQrCamera(video);
    await startNativeRoomQrDetection(video, status);
    setStatus(status, privateContactMode
      ? 'Mantén el QR privado completo y nítido dentro del recuadro.'
      : 'Mantén el QR completo y nítido dentro del recuadro. No es necesario acercarte demasiado.');
    state.qrScannerHintTimer = setTimeout(() => {
      if (dialog.open && !state.qrScanCompleting) {
        setStatus(status, 'Si se ve borroso, aléjate un poco, limpia la cámara y evita reflejos sobre el QR.');
      }
    }, 4500);
  } catch (error) {
    if (!dialog.open) return;
    stopRoomQrScanner();
    const denied = error?.name === 'NotAllowedError';
    setStatus(status, denied
      ? 'No se autorizó la cámara. Puedes habilitarla en el navegador o escribir el código.'
      : 'No pudimos abrir la cámara. Puedes escribir el código de la sala.', true);
  }
}

function renderAccount() {
  const signedIn = Boolean(state.account);
  renderCreatorBilling();
  renderGlobalPresenceControl();
  byId('signedOutPanel').hidden = signedIn;
  byId('profileEditor').hidden = !signedIn;
  byId('accountDataPanel').hidden = !signedIn;
  byId('sessionHistoryPanel').hidden = !signedIn;
  byId('starWalletPanel').hidden = !signedIn;
  byId('flowerWalletPanel').hidden = !signedIn;
  byId('accountRewardsShortcut').hidden = !signedIn;
  renderProfileAvatar('accountInitial', state.profile, {signedIn});
  renderProfileAvatar('accountMenuAvatar', state.profile, {signedIn});
  byId('accountLabel').textContent = 'MENÚ';
  byId('accountMenuTitle').textContent = signedIn ? (state.profile?.displayName || 'Mi cuenta') : 'Menú';
  byId('accountMenuStatus').textContent = signedIn ? 'Sesión iniciada' : 'Puedes entrar sin crear una cuenta.';
  byId('accountMenuProfileLabel').textContent = signedIn ? 'Perfil' : 'Entrar o crear cuenta';
  byId('accountShortcut').classList.toggle('signed-in', signedIn);
  const creatorName = byId('djName');
  creatorName.readOnly = signedIn;
  if (signedIn) creatorName.value = String(state.profile?.displayName || '').trim();
  if (!signedIn) {
    renderSessionHistory();
    return;
  }

  const profile = state.profile || {};
  byId('profileGreeting').textContent = profile.displayName ? `Hola, ${profile.displayName}` : 'Completa tu perfil';
  renderProfileAvatar('profileAvatar', profile);
  byId('profileName').value = profile.displayName || '';
  byId('profileRole').value = profile.role === 'dj' ? 'dj' : 'listener';
  byId('profileBio').value = profile.bio || '';
  const residence = profileResidence(profile);
  byId('profileCountry').value = residence.country;
  byId('profileCity').value = residence.city;
  byId('profileVisible').checked = Boolean(profile.visible);
  byId('allowMatchmaking').checked = Boolean(profile.social?.allowMatchmaking);
  byId('allowMessages').checked = Boolean(profile.social?.allowMessages);
  byId('showResidence').checked = Boolean(profile.social?.showResidence);
  byId('shareLocation').checked = Boolean(profile.social?.shareApproximateLocation);
  renderGallery();
  renderSessionHistory();
  renderStarWallet();
}

function renderStarWallet() {
  const list = byId('starPackageList');
  if (!list) return;
  byId('starWalletBalance').textContent = `${Number(state.stars.balance) || 0} ★`;
  byId('sponsorWalletBalance').textContent = String(Number(state.stars.balance) || 0);
  const earnedStars = (Array.isArray(state.stars.transactions) ? state.stars.transactions : []).filter(item => Number(item.stars) > 0);
  const starTotalByType = predicate => earnedStars.filter(item => predicate(item.type)).reduce((total, item) => total + Number(item.stars || 0), 0);
  byId('starPurchasedTotal').textContent = String(starTotalByType(type => type === 'purchase'));
  byId('starGiftTotal').textContent = String(starTotalByType(type => type === 'tip_received' || type === 'session_unlock_received'));
  byId('starSponsorTotal').textContent = String(starTotalByType(type => type === 'sponsor_reward'));
  list.replaceChildren();
  (state.stars.packages || []).forEach(pack => {
    const card = document.createElement('article');
    card.className = 'star-package-card';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    const price = document.createElement('span');
    title.textContent = `★ ${pack.stars} estrellas`;
    price.textContent = billingMoney(pack.amountCents);
    copy.append(title, price);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.buyStarPackage = pack.id;
    button.textContent = state.stars.checkoutConfigured ? 'Comprar' : 'Próximamente';
    button.disabled = !state.stars.checkoutConfigured || IS_QSESSION_ANDROID;
    card.append(copy, button);
    list.append(card);
  });
  renderFlowerWallet();
}

function renderFlowerWallet() {
  const list = byId('flowerWalletList');
  if (!list) return;
  const flowers = state.stars.flowers || {inventory: [], total: 0};
  byId('flowerWalletTotal').textContent = String(Number(flowers.total) || 0);
  const earnedFlowers = (Array.isArray(flowers.recent) ? flowers.recent : []).filter(item => Number(item.quantity) > 0);
  const flowerTotalByType = predicate => earnedFlowers.filter(item => predicate(item.type)).reduce((total, item) => total + Number(item.quantity || 0), 0);
  byId('flowerListeningTotal').textContent = String(flowerTotalByType(type => type === 'listening_reward'));
  byId('flowerGiftTotal').textContent = String(flowerTotalByType(type => type === 'artist_gift_received'));
  byId('flowerMatchTotal').textContent = String(flowerTotalByType(type => type === 'matchmaking_received'));
  list.replaceChildren();
  const available = (flowers.inventory || []).filter(flower => Number(flower.quantity) > 0);
  if (!available.length) {
    const empty = document.createElement('p');
    empty.className = 'flower-wallet-empty';
    empty.textContent = 'Tu primera flor aparecerá después de 15 minutos de escucha continua.';
    list.append(empty);
    return;
  }
  available.forEach(flower => {
    const item = document.createElement('span');
    item.className = 'flower-wallet-item';
    const symbol = document.createElement('i'); symbol.textContent = flower.symbol || '✿';
    const copy = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = flower.name;
    const meaning = document.createElement('small'); meaning.textContent = 'Tiempo compartido';
    const quantity = document.createElement('b'); quantity.textContent = `× ${flower.quantity}`;
    copy.append(name, meaning);
    item.append(symbol, copy, quantity);
    list.append(item);
  });
}

function stopFlowerListeningRewards() {
  window.clearInterval(state.flowerRewardTimer);
  state.flowerRewardTimer = null;
  state.flowerRewardBusy = false;
  const status = byId('flowerListeningStatus');
  if (status) status.hidden = true;
}

async function pulseFlowerListeningReward() {
  if (state.flowerRewardBusy || !state.account || state.mediaRole !== 'listener' || !state.mediaConnected || !state.currentRoomCode) return;
  state.flowerRewardBusy = true;
  try {
    const result = await api(`/api/rooms/${encodeURIComponent(state.currentRoomCode)}/flowers/pulse`, {method: 'POST'});
    if (result.reward?.flowers) {
      state.stars.flowers = result.reward.flowers;
      renderFlowerWallet();
    }
    (result.reward?.awarded || []).forEach(flower => {
      toast(`${flower.symbol || '✿'} Guardaste una ${String(flower.name || 'flor').toLowerCase()} por el tiempo compartido.`);
    });
  } catch {
    // El reconocimiento permanece silencioso si la sala se reconecta o la
    // presencia no puede validarse en este instante.
  } finally {
    state.flowerRewardBusy = false;
  }
}

function startFlowerListeningRewards() {
  if (isCdnOnlyAudience()) return;
  stopFlowerListeningRewards();
  if (!state.account || state.mediaRole !== 'listener' || !state.mediaConnected) return;
  const status = byId('flowerListeningStatus');
  if (status) status.hidden = false;
  void pulseFlowerListeningReward();
  state.flowerRewardTimer = window.setInterval(() => void pulseFlowerListeningReward(), 60_000);
}

async function loadStars({quiet = false} = {}) {
  if (state.starsLoading) return;
  state.starsLoading = true;
  try {
    const result = await api(state.account ? '/api/account/stars' : '/api/stars/catalog');
    state.stars = {...state.stars, ...result, packages: result.packages || []};
    if (!quiet) setStatus(byId('starWalletStatus'), 'Billetera actualizada.');
  } catch (error) {
    if (!quiet && byId('starWalletStatus')) setStatus(byId('starWalletStatus'), error.message, true);
  } finally {
    state.starsLoading = false;
    renderStarWallet();
  }
}

async function buyStarPackage(packageId) {
  if (!state.account) return showView('profile');
  try {
    setStatus(byId('starWalletStatus'), 'Preparando pago seguro con Wompi…');
    const result = await api('/api/stars/orders', {method: 'POST', body: JSON.stringify({packageId})});
    location.href = result.checkout.url;
  } catch (error) { setStatus(byId('starWalletStatus'), error.message, true); }
}

function renderSponsorRoom() {
  const grid = byId('sponsorRoomGrid');
  if (!grid) return;
  byId('sponsorWalletBalance').textContent = String(Number(state.stars.balance) || 0);
  grid.replaceChildren();
  if (!state.sponsorItems.length) {
    const empty = document.createElement('p');
    empty.className = 'sponsor-room-empty';
    empty.textContent = 'Todavía no hay campañas patrocinadas activas.';
    grid.append(empty);
    return;
  }
  state.sponsorItems.forEach(item => {
    const card = document.createElement('article');
    card.className = 'sponsor-card';
    if (item.media?.url) {
      const media = document.createElement(item.media.contentType?.startsWith('video/') ? 'video' : 'img');
      media.src = item.media.url;
      if (media.tagName === 'VIDEO') { media.controls = true; media.preload = 'metadata'; }
      else media.alt = item.sponsor || 'Sponsor';
      card.append(media);
    }
    const copy = document.createElement('div');
    const label = document.createElement('small'); label.textContent = item.artist ? `SPONSOR DE ${item.artist}` : 'SPONSOR';
    const title = document.createElement('h2'); title.textContent = item.sponsor || 'Sponsor Q Session';
    const text = document.createElement('p'); text.textContent = item.headline || 'Conoce esta propuesta.';
    const action = document.createElement('button');
    action.type = 'button'; action.dataset.watchSponsor = item.id; action.dataset.roomCode = item.roomCode;
    action.textContent = state.account ? `Ver y ganar ${state.stars.sponsorRewardStars || 0} ★` : 'Inicia sesión para ganar ★';
    copy.append(label, title, text, action);
    if (item.linkUrl) { const link = document.createElement('a'); link.href = item.linkUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Visitar marca ↗'; copy.append(link); }
    card.append(copy); grid.append(card);
  });
}

async function loadSponsorRoom() {
  try {
    const result = await api('/api/sponsors');
    state.sponsorItems = result.sponsors || [];
    state.stars.sponsorRewardStars = result.rewardStars || state.stars.sponsorRewardStars;
    if (state.account) await loadStars({quiet: true});
    setStatus(byId('sponsorRoomStatus'), `${state.sponsorItems.length} campañas disponibles.`);
    renderSponsorRoom();
  } catch (error) { setStatus(byId('sponsorRoomStatus'), error.message, true); }
}

async function watchSponsor(itemId, roomCode, button) {
  if (!state.account) return showView('profile');
  button.disabled = true;
  try {
    const started = await api(`/api/sponsors/${encodeURIComponent(itemId)}/views`, {method: 'POST', body: JSON.stringify({roomCode})});
    let remaining = Number(started.view.waitSeconds) || 15;
    button.textContent = `Mirando… ${remaining}s`;
    const timer = setInterval(() => { remaining -= 1; button.textContent = remaining > 0 ? `Mirando… ${remaining}s` : 'Validando…'; }, 1000);
    await new Promise(resolve => setTimeout(resolve, (Number(started.view.waitSeconds) || 15) * 1000));
    clearInterval(timer);
    const result = await api(`/api/sponsors/views/${encodeURIComponent(started.view.id)}/reward`, {method: 'POST'});
    state.stars.balance = result.reward.balance;
    renderStarWallet();
    button.textContent = `Recibiste ${result.reward.stars} ★`;
    setStatus(byId('sponsorRoomStatus'), 'Las estrellas ya están en tu billetera.');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Intentar de nuevo';
    setStatus(byId('sponsorRoomStatus'), error.message, true);
  }
}

function billingMoney(cents) {
  return new Intl.NumberFormat('es-CO', {style: 'currency', currency: 'COP', maximumFractionDigits: 0}).format((Number(cents) || 0) / 100);
}

function availableBillingUnits(planId) {
  return (state.billing.credits || []).filter(credit => credit.planId === planId
    && credit.status === 'available'
    && Number(credit.unitsRemaining) > 0
    && (!credit.expiresAt || new Date(credit.expiresAt).getTime() > Date.now()))
    .reduce((total, credit) => total + Number(credit.unitsRemaining || 0), 0);
}

function creatorBillingPlans() {
  const plans = Array.isArray(state.billing.plans) ? state.billing.plans.filter(plan => plan.active !== false) : [];
  const known = new Set(plans.map(plan => plan.id));
  (state.billing.credits || []).forEach(credit => {
    if (!credit.plan?.id || known.has(credit.plan.id) || !String(credit.plan.id).startsWith('custom-quote-')) return;
    if (credit.status !== 'available' || Number(credit.unitsRemaining) < 1) return;
    plans.push({...credit.plan, active: true});
    known.add(credit.plan.id);
  });
  return plans;
}

function appendEventQuoteOptions(list, customQuoteButton, largeEventQuoteButton) {
  const options = document.createElement('div');
  options.className = 'creator-event-quotes';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Cotizar un evento');
  [largeEventQuoteButton, customQuoteButton].filter(Boolean).forEach(button => {
    button.classList.remove('is-first-option', 'creator-plan-custom-mode');
    button.removeAttribute('aria-pressed');
    options.append(button);
  });
  list.append(options);
}

function renderCreatorBilling() {
  const panel = byId('creatorBillingPanel');
  const list = byId('creatorPlanList');
  const customQuoteButton = byId('customQuoteOpen');
  const largeEventQuoteButton = byId('largeEventQuoteOpen');
  if (!panel || !list) return;
  const plans = creatorBillingPlans();
  panel.hidden = !state.account;
  if (!state.account) return;
  const ownedPlans = plans.filter(plan => availableBillingUnits(plan.id) > 0);
  if (ownedPlans.length && !ownedPlans.some(plan => plan.id === state.selectedBillingPlanId)) {
    state.selectedBillingPlanId = ownedPlans[0].id;
  } else if (!ownedPlans.length && (!state.selectedBillingPlanId || !plans.some(plan => plan.id === state.selectedBillingPlanId))) {
    state.selectedBillingPlanId = plans[0]?.id || '';
  }
  const availableTotal = plans.reduce((total, plan) => total + availableBillingUnits(plan.id), 0);
  byId('creatorCreditBalance').textContent = availableTotal === 1 ? '1 sala disponible' : `${availableTotal} salas disponibles`;
  list.replaceChildren();
  if (!plans.length) {
    const empty = document.createElement('div');
    empty.className = 'creator-plan-load-state';
    const signal = document.createElement('span');
    signal.className = 'creator-plan-load-signal';
    signal.setAttribute('aria-hidden', 'true');
    signal.textContent = state.billingLoading ? '' : '!';
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = state.billingLoading ? 'Cargando planes…' : 'No pudimos mostrar los planes';
    const detail = document.createElement('small');
    detail.textContent = state.billingLoading
      ? 'Estamos consultando precios, funciones y bonos disponibles.'
      : (state.billing.error || 'Comprueba la conexión e inténtalo nuevamente.');
    copy.append(title, detail);
    empty.append(signal, copy);
    if (!state.billingLoading) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.dataset.reloadBilling = 'true';
      retry.textContent = 'Volver a cargar';
      empty.append(retry);
    }
    list.append(empty);
    appendEventQuoteOptions(list, customQuoteButton, largeEventQuoteButton);
    byId('creatorBillingTitle').textContent = 'Plan y acceso';
    const submit = document.querySelector('#createRoomForm > button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus(byId('creatorBillingStatus'), state.billingLoading
      ? 'Consultando los planes de compra…'
      : 'Los planes no se cargaron. Pulsa “Volver a cargar”; no se realizará ningún cobro.', !state.billingLoading);
    return;
  }
  const groups = new Map();
  plans.forEach(plan => {
    const purchaseMode = plan.billingInterval === 'monthly' ? 'monthly' : 'one_time';
    if (!groups.has(purchaseMode)) groups.set(purchaseMode, []);
    groups.get(purchaseMode).push(plan);
  });
  const currentPlan = plans.find(plan => plan.id === state.selectedBillingPlanId) || plans[0];
  if (!state.billingPlanMode) state.billingPlanMode = currentPlan?.billingInterval === 'monthly' ? 'monthly' : 'one_time';
  const activeMode = state.billingPlanMode === 'monthly' ? 'monthly' : 'one_time';
  const modeLabels = {
    one_time: ['Por evento', 'Un solo pago'],
    monthly: ['Mensual', 'Salas recurrentes'],
  };
  const modes = document.createElement('div');
  modes.className = 'creator-plan-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Forma de compra');
  ['one_time', 'monthly'].forEach(purchaseMode => {
    const groupedPlans = groups.get(purchaseMode) || [];
    if (!groupedPlans.length) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.billingPlanMode = purchaseMode;
    button.setAttribute('aria-pressed', String(purchaseMode === activeMode));
    const title = document.createElement('strong'); title.textContent = modeLabels[purchaseMode][0];
    const detail = document.createElement('small');
    detail.textContent = purchaseMode === 'monthly'
      ? modeLabels[purchaseMode][1]
      : `${groupedPlans.length} ${groupedPlans.length === 1 ? 'opción' : 'opciones'}`;
    button.append(title, detail);
    modes.append(button);
  });
  list.append(modes);
  appendEventQuoteOptions(list, customQuoteButton, largeEventQuoteButton);

  const guide = document.createElement('p');
  guide.className = 'creator-plan-guide';
  guide.textContent = activeMode === 'monthly'
    ? 'Para quienes crean salas con frecuencia. Sin permanencia y con renovación manual.'
    : 'Compara capacidad, duración y funciones. El pago corresponde al plan completo.';
  list.append(guide);

  const cards = document.createElement('div');
  cards.className = 'creator-plan-grid';
  const segmentLabels = {
    event: 'EVENTO',
    professional: 'INSTRUCTOR',
    business: 'COMERCIO',
    enterprise: 'GRAN EVENTO',
    membership: 'MENSUAL',
  };
  const formatDuration = minutes => {
    const value = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(value / 60);
    const remainder = value % 60;
    if (!hours) return `${remainder} min`;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  };
  const countFormatter = new Intl.NumberFormat('es-CO');

  const selectedOverview = document.createElement('details');
  selectedOverview.className = 'creator-plan-selected-overview';
  const overviewSummary = document.createElement('summary');
  const overviewCopy = document.createElement('span');
  const overviewEyebrow = document.createElement('small'); overviewEyebrow.textContent = 'TUS PLANES';
  const ownedCurrentPlan = ownedPlans.find(plan => plan.id === state.selectedBillingPlanId) || null;
  const overviewName = document.createElement('strong'); overviewName.textContent = ownedCurrentPlan?.name || 'Aún no tienes planes';
  const overviewMeta = document.createElement('span');
  if (ownedCurrentPlan) {
    const sessionCount = Number(ownedCurrentPlan.creditsPerPurchase) || 1;
    overviewMeta.textContent = `${countFormatter.format(Number(ownedCurrentPlan.maxParticipants) || 0)} personas · ${formatDuration(ownedCurrentPlan.durationMinutes)} · ${sessionCount} ${sessionCount === 1 ? 'sesión' : 'sesiones'} · ${ownedCurrentPlan.features?.hostVideo === false ? 'solo audio' : 'audio + video'}`;
  } else {
    overviewMeta.textContent = 'Los bonos comprados u obtenidos aparecerán aquí.';
  }
  overviewCopy.append(overviewEyebrow, overviewName, overviewMeta);
  const overviewAvailability = document.createElement('span');
  const currentUnits = availableBillingUnits(ownedCurrentPlan?.id);
  const overviewUnits = document.createElement('b'); overviewUnits.textContent = String(currentUnits);
  const overviewUnitsLabel = document.createElement('small'); overviewUnitsLabel.textContent = currentUnits === 1 ? 'sala disponible' : 'salas disponibles';
  overviewAvailability.append(overviewUnits, overviewUnitsLabel);
  const overviewChevron = document.createElement('i'); overviewChevron.className = 'disclosure-chevron'; overviewChevron.setAttribute('aria-hidden', 'true');
  overviewSummary.append(overviewCopy, overviewAvailability, overviewChevron);
  const planSwitcher = document.createElement('div');
  planSwitcher.className = 'creator-plan-switcher';
  if (!ownedPlans.length) {
    const empty = document.createElement('p');
    empty.className = 'creator-owned-plans-empty';
    empty.textContent = 'No tienes bonos disponibles. Abre “Adquiere tu plan” para comprar el primero.';
    planSwitcher.append(empty);
  } else {
    ownedPlans.forEach(plan => {
      const units = availableBillingUnits(plan.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.selectBillingPlan = plan.id;
      button.classList.toggle('selected', plan.id === state.selectedBillingPlanId);
      button.classList.toggle('is-owned', units > 0);
      const planCopy = document.createElement('span');
      const planName = document.createElement('strong'); planName.textContent = plan.name;
      const sessionCount = Number(plan.creditsPerPurchase) || 1;
      const planMeta = document.createElement('small');
      planMeta.textContent = `${countFormatter.format(Number(plan.maxParticipants) || 0)} personas · ${formatDuration(plan.durationMinutes)} · ${sessionCount} ${sessionCount === 1 ? 'sesión' : 'sesiones'}`;
      planCopy.append(planName, planMeta);
      const planState = document.createElement('span');
      const planValue = document.createElement('b'); planValue.textContent = `${units} disponibles`;
      const planLabel = document.createElement('small'); planLabel.textContent = 'Plan propio';
      planState.append(planValue, planLabel);
      button.append(planCopy, planState);
      planSwitcher.append(button);
    });
  }
  selectedOverview.append(overviewSummary, planSwitcher);
  list.append(selectedOverview);

  const catalog = document.createElement('details');
  catalog.className = 'creator-plan-catalog';
  const catalogSummary = document.createElement('summary');
  const catalogCopy = document.createElement('span');
  const catalogTitle = document.createElement('strong'); catalogTitle.textContent = 'Adquiere tu plan';
  const activePlans = groups.get(activeMode) || [];
  const catalogCount = document.createElement('small'); catalogCount.textContent = `${activePlans.length} ${activePlans.length === 1 ? 'opción disponible' : 'opciones disponibles'}`;
  catalogCopy.append(catalogTitle, catalogCount);
  const catalogChevron = document.createElement('i'); catalogChevron.className = 'disclosure-chevron'; catalogChevron.setAttribute('aria-hidden', 'true');
  catalogSummary.append(catalogCopy, catalogChevron);
  const catalogBody = document.createElement('div');
  catalogBody.className = 'creator-plan-catalog-body';

  activePlans.forEach(plan => {
    const units = availableBillingUnits(plan.id);
    const card = document.createElement('article');
    card.className = 'creator-plan-option';
    card.classList.toggle('selected', plan.id === state.selectedBillingPlanId);
    card.classList.toggle('highlighted', Boolean(plan.highlighted));
    card.classList.toggle('has-credit', units > 0);

    const control = document.createElement('input');
    control.className = 'creator-plan-radio';
    control.type = 'radio';
    control.name = 'billingPlan';
    control.id = `billing-plan-${String(plan.id).replace(/[^a-z0-9_-]/gi, '-')}`;
    control.value = plan.id;
    control.checked = plan.id === state.selectedBillingPlanId;

    const select = document.createElement('label');
    select.className = 'creator-plan-option-select';
    select.htmlFor = control.id;
    const topLine = document.createElement('span'); topLine.className = 'creator-plan-topline';
    const segment = document.createElement('small');
    segment.className = 'creator-plan-segment';
    segment.textContent = segmentLabels[plan.segment] || 'PLAN';
    topLine.append(segment);
    if (plan.highlighted) {
      const recommended = document.createElement('b');
      recommended.className = 'creator-plan-recommended';
      recommended.textContent = 'Recomendado';
      topLine.append(recommended);
    }
    const title = document.createElement('h4'); title.textContent = plan.name;
    const sessionCount = Number(plan.creditsPerPurchase) || 1;
    const feature = key => plan.features?.[key] !== false;
    const essentials = document.createElement('span'); essentials.className = 'creator-plan-essentials';
    [
      [countFormatter.format(Number(plan.maxParticipants) || 0), 'personas'],
      [formatDuration(plan.durationMinutes), 'por sala'],
      [String(sessionCount), sessionCount === 1 ? 'sesión' : 'sesiones'],
    ].forEach(([value, label]) => {
      const item = document.createElement('span');
      const itemValue = document.createElement('b'); itemValue.textContent = value;
      const itemLabel = document.createElement('small'); itemLabel.textContent = label;
      item.append(itemValue, itemLabel);
      essentials.append(item);
    });
    const format = document.createElement('span');
    format.className = 'creator-plan-format';
    format.textContent = feature('hostVideo') ? '◉ Audio + video' : '≋ Solo audio';
    essentials.append(format);

    const features = document.createElement('span'); features.className = 'creator-plan-features';
    [
      [feature('hostVideo') ? 'Audio + video' : 'Solo audio', feature('hostVideo')],
      ['Chat', feature('publicChat')],
      ['Cámaras', feature('guestCameras')],
      [feature('videoUploads') ? 'Envío de videos' : 'Sin envío de videos', feature('videoUploads')],
    ].forEach(([label, enabled]) => {
      const item = document.createElement('span');
      item.className = 'creator-plan-feature';
      item.classList.toggle('is-off', !enabled);
      item.textContent = `${enabled ? '✓' : '—'} ${label}`;
      features.append(item);
    });
    select.append(topLine, title, essentials);

    const details = document.createElement('details');
    details.className = 'creator-plan-details';
    const detailsSummary = document.createElement('summary');
    const detailsLabel = document.createElement('span'); detailsLabel.textContent = 'Incluye';
    const detailsChevron = document.createElement('i'); detailsChevron.className = 'disclosure-chevron';
    detailsChevron.setAttribute('aria-hidden', 'true');
    detailsSummary.append(detailsLabel, detailsChevron);
    const detailsBody = document.createElement('div');
    const description = document.createElement('p');
    description.className = 'creator-plan-description';
    description.textContent = plan.description;
    detailsBody.append(description, features);
    details.append(detailsSummary, detailsBody);

    const footer = document.createElement('footer');
    const priceWrap = document.createElement('span'); priceWrap.className = 'creator-plan-price';
    const price = document.createElement('b'); price.textContent = billingMoney(plan.priceCents);
    const priceDetail = document.createElement('small');
    priceDetail.textContent = units
      ? `${units} ${units === 1 ? 'sala disponible' : 'salas disponibles'}`
      : plan.billingInterval === 'monthly'
        ? `${sessionCount} salas al mes · renovación manual`
      : sessionCount > 1 ? `${billingMoney(Math.round(plan.priceCents / sessionCount))} por sesión` : 'Pago único';
    const action = document.createElement('button'); action.type = 'button'; action.dataset.purchasePlan = plan.id;
    action.textContent = units ? 'Listo para usar' : IS_QSESSION_ANDROID
      ? 'Compra no disponible en esta app'
      : state.billing.checkoutConfigured
        ? plan.billingInterval === 'monthly' ? 'Comprar mensualidad' : 'Comprar plan'
        : 'Pagos en preparación';
    action.disabled = Boolean(units) || IS_QSESSION_ANDROID || !state.billing.checkoutConfigured;
    priceWrap.append(price, priceDetail);
    footer.append(priceWrap, action);
    card.append(control, select, details, footer);
    cards.append(card);
  });
  catalogBody.append(cards);
  catalog.append(catalogSummary, catalogBody);
  list.append(catalog);
  const selectedPlan = plans.find(plan => plan.id === state.selectedBillingPlanId);
  byId('creatorBillingTitle').textContent = 'Plan y acceso';
  const capacityInput = byId('roomCapacity');
  if (selectedPlan && capacityInput) {
    capacityInput.max = String(selectedPlan.maxParticipants);
    if (!Number(capacityInput.value) || Number(capacityInput.value) > selectedPlan.maxParticipants) {
      capacityInput.value = String(selectedPlan.maxParticipants);
    }
    const capacityHelp = byId('roomCapacityPlanHelp');
    if (capacityHelp) capacityHelp.textContent = `Tu plan permite hasta ${selectedPlan.maxParticipants} personas por sala.`;
  }
  const selectedUnits = availableBillingUnits(state.selectedBillingPlanId);
  const submit = document.querySelector('#createRoomForm > button[type="submit"]');
  if (submit && state.billing.enforced) submit.disabled = selectedUnits < 1;
  if (state.billing.enforced && selectedUnits < 1) {
    setStatus(byId('creatorBillingStatus'), IS_QSESSION_ANDROID
      ? 'Usa aquí un bono asociado a tu cuenta. Las compras dentro de Android se habilitarán con Google Play.'
      : state.billing.checkoutConfigured
      ? 'Compra un bono para habilitar la creación de esta sala.'
      : 'Los cobros todavía no están conectados. La creación pagada permanecerá bloqueada.', true);
  } else if (selectedUnits > 0) {
    setStatus(byId('creatorBillingStatus'), `Tu bono se reservará al crear la sala y se consumirá al transmitir. Incluye ${selectedPlan?.durationMinutes || 120} minutos.`);
  } else {
    setStatus(byId('creatorBillingStatus'), 'Modo de preparación: puedes diseñar salas mientras terminamos de conectar los cobros.');
  }
}

async function loadBilling({quiet = false, poll = false} = {}) {
  if (state.billingLoading) return;
  state.billingLoading = true;
  state.billing.error = '';
  if (!state.billing.plans.length) renderCreatorBilling();
  if (!quiet) setStatus(byId('creatorBillingStatus'), 'Actualizando tus bonos…');
  try {
    let result;
    let accountBillingError = '';
    try {
      result = await api(state.account ? '/api/account/billing' : '/api/billing/plans');
    } catch (error) {
      if (!state.account) throw error;
      accountBillingError = error.message;
      result = await api('/api/billing/plans');
    }
    if (state.account && (!Array.isArray(result.plans) || !result.plans.length)) {
      const catalog = await api('/api/billing/plans');
      result = {
        ...catalog,
        credits: result.credits,
        orders: result.orders,
        reservations: result.reservations,
      };
      accountBillingError = 'Los planes están disponibles, pero tus bonos no pudieron actualizarse todavía.';
    }
    state.billing = {
      plans: Array.isArray(result.plans) ? result.plans : [],
      credits: Array.isArray(result.credits) ? result.credits : [],
      orders: Array.isArray(result.orders) ? result.orders : [],
      reservations: Array.isArray(result.reservations) ? result.reservations : [],
      enforced: Boolean(result.billingEnforced),
      checkoutConfigured: Boolean(result.checkoutConfigured),
      directVideoUploadsConfigured: Boolean(result.directVideoUploadsConfigured),
      error: accountBillingError,
    };
    const customVideoUpload = document.querySelector('[data-custom-feature="videoUploads"]');
    if (customVideoUpload) {
      customVideoUpload.disabled = !state.billing.directVideoUploadsConfigured;
      if (customVideoUpload.disabled) customVideoUpload.checked = false;
      customVideoUpload.closest('label')?.classList.toggle('is-disabled', customVideoUpload.disabled);
      customVideoUpload.closest('label')?.setAttribute('title', customVideoUpload.disabled
        ? 'La recepción de archivos de video se habilitará próximamente.'
        : 'Incluye recepción de videos enviados por participantes.');
    }
    syncRoomExperienceDependencies();
    renderCreatorBilling();
    if (accountBillingError) {
      setStatus(byId('creatorBillingStatus'), 'Los planes están disponibles. Actualiza tus bonos antes de crear una sala.', true);
    }
    if (poll && state.billing.orders.some(order => order.status === 'pending')) {
      window.setTimeout(() => void loadBilling({quiet: true}), 2500);
    }
  } catch (error) {
    state.billing.error = error.message;
  } finally {
    state.billingLoading = false;
    if (!state.billing.plans.length) renderCreatorBilling();
  }
}

async function purchaseBillingPlan(planId) {
  if (!state.account) return showView('profile');
  if (IS_QSESSION_ANDROID) {
    setStatus(byId('creatorBillingStatus'), 'Las compras dentro de Android se habilitarán con Google Play.', true);
    return;
  }
  setStatus(byId('creatorBillingStatus'), 'Preparando el pago seguro con Wompi…');
  try {
    const result = await api('/api/billing/orders', {method: 'POST', body: JSON.stringify({planId})});
    if (!result.checkout?.url) throw new Error('Wompi no entregó una dirección de pago');
    location.assign(result.checkout.url);
  } catch (error) {
    setStatus(byId('creatorBillingStatus'), error.message, true);
  }
}

function syncCustomQuoteControls() {
  const capacity = Number(byId('customQuoteCapacity').value);
  const broadcast = capacity > 5000;
  byId('customQuoteDeliveryHelp').hidden = !broadcast;
  all('[data-quote-capacity]').forEach(button => {
    const selected = button.dataset.quoteCapacity === 'manual' ? capacity !== 10000 : capacity === 10000;
    button.setAttribute('aria-pressed', String(selected));
  });
  all('[data-custom-feature]').forEach(input => {
    if (input.dataset.customFeature === 'dedicatedSupport') return;
    if (broadcast && !input.disabled) input.dataset.beforeBroadcast = String(input.checked);
    if (!broadcast && input.dataset.beforeBroadcast !== undefined) {
      input.checked = input.dataset.beforeBroadcast === 'true';
      delete input.dataset.beforeBroadcast;
    }
    const unavailable = input.dataset.customFeature === 'videoUploads' && !state.billing.directVideoUploadsConfigured;
    input.disabled = broadcast || unavailable;
    if (input.disabled) input.checked = false;
    input.closest('label')?.classList.toggle('is-disabled', input.disabled);
    if (input.closest('label')) input.closest('label').hidden = broadcast;
  });
  byId('customQuoteLanguages').disabled = broadcast;
  byId('customQuoteLanguages').closest('label').hidden = broadcast;
}

function invalidateCustomQuote() {
  state.customQuoteRequestId = (state.customQuoteRequestId || 0) + 1;
  state.customQuote = null;
  byId('customQuotePriceLabel').textContent = 'COTIZACIÓN';
  byId('customQuotePrice').textContent = 'Por calcular';
  byId('customQuotePerSession').textContent = 'Actualiza la cotización con estas condiciones.';
  byId('customQuoteBreakdown').replaceChildren();
  byId('customQuoteValidity').textContent = '';
  byId('customQuotePurchase').disabled = true;
  byId('customQuotePurchase').textContent = 'Actualiza la cotización';
  byId('customQuoteCopy').disabled = true;
}

function openCustomQuote(capacity = null) {
  if (!state.account) return showView('profile');
  if (capacity !== null) byId('customQuoteCapacity').value = String(capacity);
  syncCustomQuoteControls();
  invalidateCustomQuote();
  byId('customQuoteDialog').showModal();
  if (capacity === null) byId('customQuoteCapacity').focus();
  void calculateCustomQuote();
}

function customQuoteInput() {
  return {
    capacity: Number(byId('customQuoteCapacity').value),
    durationMinutes: Number(byId('customQuoteDuration').value),
    sessions: Number(byId('customQuoteSessions').value),
    translationLanguages: Number(byId('customQuoteCapacity').value) > 5000 ? 0 : Number(byId('customQuoteLanguages').value),
    ...Object.fromEntries(all('[data-custom-feature]').map(input => [input.dataset.customFeature, input.checked])),
  };
}

function renderCustomQuote(result) {
  state.customQuote = result;
  const quote = result?.quote;
  if (!quote) return;
  byId('customQuoteCopy').disabled = false;
  byId('customQuotePriceLabel').textContent = quote.requiresReview ? 'ESTIMACIÓN · PENDIENTE DE REVISIÓN' : 'COTIZACIÓN';
  byId('customQuotePrice').textContent = billingMoney(quote.priceCents);
  byId('customQuotePerSession').textContent = quote.requiresReview
    ? `${quote.capacity.toLocaleString('es-CO')} personas · estimación en pesos colombianos`
    : quote.sessions > 1
    ? `${billingMoney(quote.pricePerSessionCents)} por sala · ${quote.discountPercent}% de descuento aplicado`
    : 'Precio final por una sala personalizada';
  byId('customQuoteBreakdown').replaceChildren(...quote.lineItems.map(item => {
    const row = document.createElement('li'); row.textContent = item.label; return row;
  }));
  byId('customQuoteValidity').textContent = quote.requiresReview
    ? 'La tarifa y el aforo deben confirmarse antes de contratar. Esta estimación no activa una sala ni modifica tu plan.'
    : `Cotización válida hasta ${new Intl.DateTimeFormat('es-CO', {hour: 'numeric', minute: '2-digit'}).format(new Date(result.expiresAt))}.`;
  const purchase = byId('customQuotePurchase');
  purchase.disabled = quote.requiresReview || IS_QSESSION_ANDROID || !result.checkoutConfigured;
  purchase.textContent = quote.requiresReview
    ? 'Requiere revisión del evento'
    : IS_QSESSION_ANDROID
    ? 'Compra no disponible en esta app'
    : result.checkoutConfigured ? `Pagar ${billingMoney(quote.priceCents)}` : 'Pagos en preparación';
}

async function calculateCustomQuote({quiet = false} = {}) {
  if (!state.account) return;
  syncCustomQuoteControls();
  invalidateCustomQuote();
  const requestId = state.customQuoteRequestId;
  if (!byId('customQuoteForm').checkValidity()) {
    setStatus(byId('customQuoteStatus'), 'Revisa el aforo: usa un número entero entre 1 y 50.000, y completa los demás campos.', true);
    return;
  }
  if (!quiet) setStatus(byId('customQuoteStatus'), 'Calculando el precio seguro…');
  try {
    const result = await api('/api/billing/custom-quotes', {method: 'POST', body: JSON.stringify(customQuoteInput())});
    if (requestId !== state.customQuoteRequestId) return;
    renderCustomQuote(result);
    setStatus(byId('customQuoteStatus'), result.quote.requiresReview
      ? 'Estimación lista. Puedes copiar el resumen para preparar la contratación del evento.'
      : IS_QSESSION_ANDROID
      ? 'Cotización lista. Las compras dentro de Android se habilitarán con Google Play.'
      : result.checkoutConfigured
      ? 'Precio confirmado. Puedes continuar al pago seguro.'
      : 'Cotización lista. El pago se habilitará cuando conectemos Wompi.');
  } catch (error) {
    if (requestId !== state.customQuoteRequestId) return;
    setStatus(byId('customQuoteStatus'), error.message, true);
  }
}

function scheduleCustomQuote() {
  syncCustomQuoteControls();
  invalidateCustomQuote();
  window.clearTimeout(state.customQuoteTimer);
  state.customQuoteTimer = window.setTimeout(() => void calculateCustomQuote({quiet: true}), 260);
}

async function copyCustomQuote() {
  const result = state.customQuote;
  const quote = result?.quote;
  if (!quote) return;
  const text = [
    'Q Session · Cotización de evento',
    `Referencia: ${result.quoteId}`,
    `${quote.capacity.toLocaleString('es-CO')} personas simultáneas`,
    `${quote.durationMinutes} minutos por sala · ${quote.sessions} ${quote.sessions === 1 ? 'sala' : 'salas'}`,
    `${quote.requiresReview ? 'Estimación' : 'Precio'}: ${billingMoney(quote.priceCents)}`,
    ...quote.lineItems.map(item => `• ${item.label}`),
    quote.requiresReview
      ? 'Pendiente de revisión de tarifa y capacidad antes de contratar. No activa una sala ni modifica el plan.'
      : `Válida hasta ${new Date(result.expiresAt).toLocaleString('es-CO')}.`,
  ].join('\n');
  await copyRoomShareValue(text, 'Cotización copiada.');
}

async function purchaseCustomQuote() {
  if (!state.customQuote?.quoteToken || state.customQuote.quote?.requiresReview || !state.customQuote.checkoutConfigured) return;
  const quoteToken = state.customQuote.quoteToken;
  const button = byId('customQuotePurchase');
  if (IS_QSESSION_ANDROID) {
    setStatus(byId('customQuoteStatus'), 'Las compras dentro de Android se habilitarán con Google Play.', true);
    return;
  }
  button.disabled = true;
  setStatus(byId('customQuoteStatus'), 'Preparando el pago seguro con Wompi…');
  try {
    const result = await api('/api/billing/orders', {method: 'POST', body: JSON.stringify({quoteToken})});
    if (state.customQuote?.quoteToken !== quoteToken) return;
    if (!result.checkout?.url) throw new Error('Wompi no entregó una dirección de pago');
    location.assign(result.checkout.url);
  } catch (error) {
    if (state.customQuote?.quoteToken !== quoteToken) return;
    button.disabled = Boolean(state.customQuote.quote?.requiresReview) || !state.customQuote.checkoutConfigured;
    setStatus(byId('customQuoteStatus'), error.message, true);
  }
}

function sessionDurationLabel(seconds) {
  const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function sessionDateLabel(session) {
  const value = session.startedAt || session.scheduledAt || session.createdAt;
  if (!value) return 'Fecha no disponible';
  try {
    return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function hostedSessionStatus(session) {
  if (session.status === 'archived') return 'Cerrada';
  if (session.status === 'waiting') return 'Programada';
  return 'En vivo';
}

function renderSessionHistory() {
  const panel = byId('sessionHistoryPanel');
  const list = byId('sessionHistoryList');
  const summary = byId('sessionHistorySummary');
  if (!state.account) {
    panel.hidden = true;
    summary.hidden = true;
    list.replaceChildren();
    return;
  }

  panel.hidden = false;
  const sessions = Array.isArray(state.hostedSessions) ? state.hostedSessions : [];
  if (!sessions.length) {
    summary.hidden = true;
    const empty = document.createElement('p');
    empty.className = 'session-history-empty';
    empty.textContent = state.hostedSessionsLoading ? 'Cargando tus sesiones…' : 'Cuando organices una sesión, aparecerá aquí.';
    list.replaceChildren(empty);
    window.QSessionI18n?.applyTranslations(list);
    return;
  }

  const totalJoins = sessions.reduce((total, session) => total + (Number(session.metrics?.totalJoins) || 0), 0);
  const totalDuration = sessions.reduce((total, session) => total + (Number(session.durationSeconds) || 0), 0);
  summary.replaceChildren();
  [
    [String(sessions.length), 'sesiones creadas'],
    [String(totalJoins), 'ingresos acumulados'],
    [sessionDurationLabel(totalDuration), 'tiempo transmitido'],
  ].forEach(([value, label]) => {
    const metric = document.createElement('div');
    const strong = document.createElement('strong');
    const span = document.createElement('span');
    strong.textContent = value;
    strong.dataset.i18nIgnore = '';
    span.textContent = label;
    metric.append(strong, span);
    summary.append(metric);
  });
  summary.hidden = false;

  list.replaceChildren();
  sessions.forEach(session => {
    const card = document.createElement('article');
    card.className = 'session-history-card';
    const header = document.createElement('header');
    const identity = document.createElement('div');
    const name = document.createElement('h3');
    const metadata = document.createElement('p');
    const status = document.createElement('span');
    name.textContent = session.name || 'Sesión Q Session';
    name.dataset.i18nIgnore = '';
    const visibility = session.visibility === 'public' ? 'Pública' : 'Privada';
    const localizedVisibility = window.QSessionI18n?.translateCore(visibility, window.QSessionI18n?.getLocale?.()) || visibility;
    const format = session.broadcastMode === 'recorded' ? 'Grabada' : session.broadcastMode === 'image' ? 'Imagen + audio' : 'En vivo';
    const price = Number(session.starPrice) > 0 ? ` · ${session.starPrice} ★` : ' · Gratis';
    metadata.textContent = `${session.code} · ${localizedVisibility} · ${format}${price} · ${sessionDateLabel(session)}`;
    metadata.dataset.i18nIgnore = '';
    status.className = 'session-history-status';
    status.dataset.status = session.status || 'archived';
    status.textContent = hostedSessionStatus(session);
    identity.append(name, metadata);
    header.append(identity, status);

    const metrics = document.createElement('div');
    metrics.className = 'session-history-metrics';
    [
      [sessionDurationLabel(session.durationSeconds), 'Duración'],
      [String(Number(session.metrics?.peakListeners) || 0), 'Pico de oyentes'],
      [String(Number(session.metrics?.totalJoins) || 0), 'Ingresos'],
    ].forEach(([value, label]) => {
      const item = document.createElement('div');
      const strong = document.createElement('strong');
      const span = document.createElement('span');
      strong.textContent = value;
      strong.dataset.i18nIgnore = '';
      span.textContent = label;
      item.append(strong, span);
      metrics.append(item);
    });
    const actions = document.createElement('div');
    actions.className = 'session-history-actions';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'session-history-delete';
    removeButton.dataset.deleteHostedSession = session.id;
    removeButton.textContent = session.status === 'archived' ? 'Eliminar sesión' : 'Finalizar y eliminar';
    removeButton.setAttribute('aria-label', `${removeButton.textContent}: ${session.name || session.code}`);
    actions.append(removeButton);
    card.append(header, metrics, actions);
    list.append(card);
  });
  window.QSessionI18n?.applyTranslations(panel);
}

async function loadSessionHistory({quiet = false} = {}) {
  if (!state.account || state.hostedSessionsLoading) return;
  state.hostedSessionsLoading = true;
  if (!quiet) setStatus(byId('sessionHistoryStatus'), 'Actualizando historial…');
  renderSessionHistory();
  try {
    const result = await api('/api/account/sessions');
    state.hostedSessions = Array.isArray(result.sessions) ? result.sessions : [];
    setStatus(byId('sessionHistoryStatus'), '');
  } catch (error) {
    if (!quiet) setStatus(byId('sessionHistoryStatus'), error.message, true);
  } finally {
    state.hostedSessionsLoading = false;
    renderSessionHistory();
  }
}

async function deleteHostedSession(sessionId) {
  const session = state.hostedSessions.find(item => item.id === sessionId);
  if (!session || !session.id) return;
  const confirmed = await requestConfirmation({
    title: session.status === 'archived' ? '¿Eliminar esta sesión?' : '¿Finalizar y eliminar esta sesión?',
    message: session.status === 'archived'
      ? 'Se quitará definitivamente de tu historial.'
      : 'La transmisión se cerrará para todas las personas.',
    context: session.name || session.code,
    confirmLabel: session.status === 'archived' ? 'Eliminar sesión' : 'Finalizar y eliminar',
    cancelLabel: 'Cancelar',
  });
  if (!confirmed) return;
  const buttons = all('[data-delete-hosted-session]')
    .filter(button => button.dataset.deleteHostedSession === session.id);
  buttons.forEach(button => { button.disabled = true; });
  setStatus(byId('sessionHistoryStatus'), session.status === 'archived' ? 'Eliminando sesión…' : 'Finalizando y eliminando sesión…');
  try {
    await api(`/api/account/sessions/${encodeURIComponent(session.id)}`, {method: 'DELETE'});
    if (state.currentRoomCode === session.code) {
      await disconnectMedia({keepConsole: false});
      try { sessionStorage.removeItem(`qsession-host-${session.code}`); } catch { /* La sesión ya fue eliminada. */ }
      state.hostToken = '';
      state.mediaRole = null;
      setRoomShareMenuOpen(false);
      byId('roomResult').hidden = true;
      setCurrentRoom('', null);
    }
    state.hostedSessions = state.hostedSessions.filter(item => item.id !== session.id);
    renderSessionHistory();
    setStatus(byId('sessionHistoryStatus'), 'La sesión fue eliminada.');
    await loadPublicRooms({quiet: true});
    toast('Sesión eliminada del historial y de Salas activas.');
  } catch (error) {
    setStatus(byId('sessionHistoryStatus'), error.message, true);
  } finally {
    buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
  }
}

function renderGallery() {
  const photos = Array.isArray(state.profile?.photos) ? state.profile.photos : [];
  byId('photoCount').textContent = `${photos.length}/6`;
  byId('profilePhotoInput').disabled = photos.length >= 6;
  byId('profileGallery').innerHTML = photos.map((photo, index) => `
    <figure class="gallery-item">
      <img src="${escapeAttribute(photo.url)}" alt="Foto ${index + 1} del perfil" />
      <button type="button" data-remove-photo="${escapeAttribute(photo.id)}" aria-label="Quitar foto ${index + 1}">×</button>
    </figure>
  `).join('');
}

function escapeAttribute(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character]));
}

function qmojiLabel(item) {
  const locale = window.QSessionI18n?.getLocale?.() || document.documentElement.lang || 'es';
  return item?.labels?.[locale] || item?.labels?.es || 'Qmoji';
}

function qmojiEyes(style, ink) {
  const common = `fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`;
  const dot = (x, y, radius = 2.7) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="${ink}"/>`;
  const star = x => `<path d="M${x} 20l1.8 4 4.2.4-3.2 2.8 1 4.1-3.8-2.2-3.8 2.2 1-4.1-3.2-2.8 4.2-.4z" fill="${ink}"/>`;
  if (style === 'joy') return `<path d="M18 28q4-6 8 0M38 28q4-6 8 0" ${common}/>`;
  if (style === 'soft') return `${dot(23, 27, 2.3)}${dot(41, 27, 2.3)}`;
  if (style === 'heart') return `<path d="M17 24c0-4 6-5 7-1 2-4 8-3 8 1 0 5-8 9-8 9s-7-4-7-9zM33 24c0-4 6-5 7-1 2-4 8-3 8 1 0 5-8 9-8 9s-7-4-7-9z" fill="${ink}" transform="scale(.72) translate(6 9)"/>`;
  if (style === 'tilted') return `<path d="M18 27l7-3M39 24l7 3" ${common}/>`;
  if (style === 'sad') return `<path d="M18 27q4-5 8-1M38 26q4-4 8 1" ${common}/>`;
  if (style === 'wink') return `<path d="M17 27q5-5 10 0" ${common}/>${dot(42, 26)}`;
  if (style === 'bright') return `${dot(22, 26, 3.1)}${dot(42, 26, 3.1)}<circle cx="21" cy="25" r=".8" fill="white"/><circle cx="41" cy="25" r=".8" fill="white"/>`;
  if (style === 'fierce') return `<path d="M17 22l10 3M47 22l-10 3" ${common}/>${dot(23, 28, 2.4)}${dot(41, 28, 2.4)}`;
  if (style === 'calm') return `<path d="M18 27q4 3 8 0M38 27q4 3 8 0" ${common}/>`;
  if (style === 'side') return `<ellipse cx="23" cy="27" rx="4" ry="5" fill="white" stroke="${ink}" stroke-width="2"/><ellipse cx="41" cy="27" rx="4" ry="5" fill="white" stroke="${ink}" stroke-width="2"/><circle cx="25" cy="27" r="1.8" fill="${ink}"/><circle cx="43" cy="27" r="1.8" fill="${ink}"/>`;
  if (style === 'squint') return `<path d="M18 23l8 7M26 23l-8 7M38 23l8 7M46 23l-8 7" ${common}/>`;
  if (style === 'roll') return `<ellipse cx="23" cy="27" rx="5" ry="6" fill="white" stroke="${ink}" stroke-width="2"/><ellipse cx="41" cy="27" rx="5" ry="6" fill="white" stroke="${ink}" stroke-width="2"/><circle cx="23" cy="24" r="2" fill="${ink}"/><circle cx="41" cy="24" r="2" fill="${ink}"/>`;
  if (style === 'closed') return `<path d="M18 27q4 4 8 0M38 27q4 4 8 0" ${common}/>`;
  if (style === 'shades') return `<path d="M15 23h14l-1 8q-6 5-11 0zm20 0h14l-2 8q-6 5-11 0zm-6 2h6" fill="${ink}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
  if (style === 'wide') return `<circle cx="22" cy="26" r="5" fill="white" stroke="${ink}" stroke-width="2"/><circle cx="42" cy="26" r="5" fill="white" stroke="${ink}" stroke-width="2"/>${dot(22, 26, 2)}${dot(42, 26, 2)}`;
  if (style === 'star') return `${star(23)}${star(41)}`;
  return `${dot(23, 27)}${dot(41, 27)}`;
}

function qmojiMouth(style, ink, accent) {
  const common = `fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`;
  if (style === 'laugh') return `<path d="M19 36q13 17 26 0z" fill="${ink}" stroke="${ink}" stroke-width="2"/><path d="M25 44q7 4 14 0" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`;
  if (style === 'smile') return `<path d="M21 37q11 10 22 0" ${common}/>`;
  if (style === 'soft') return `<path d="M25 39q7 5 14 0" ${common}/>`;
  if (style === 'cry') return `<path d="M24 44q8-8 16 0" ${common}/>`;
  if (style === 'kiss') return `<path d="M29 38l5-2 4 3-5 2 4 3" ${common}/>`;
  if (style === 'grin') return `<path d="M21 37q11 11 22 0" fill="white" stroke="${ink}" stroke-width="2.5"/>`;
  if (style === 'teeth') return `<path d="M19 36q13 14 26 0z" fill="white" stroke="${ink}" stroke-width="2.5"/><path d="M23 40h18" stroke="${ink}" stroke-width="1.4"/>`;
  if (style === 'flat') return `<path d="M26 41h13" ${common}/>`;
  if (style === 'wow') return `<ellipse cx="32" cy="41" rx="5" ry="7" fill="${ink}"/>`;
  if (style === 'smirk') return `<path d="M25 41q9 3 15-3" ${common}/>`;
  if (style === 'yum') return `<path d="M22 37q10 9 20 0" ${common}/><path d="M34 42q5 1 4 6" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`;
  return `<path d="M25 40q7 4 14 0" ${common}/>`;
}

function qmojiMark(mark, ink, accent) {
  const line = `fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const inkLine = `fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const heart = (x, y, scale = 1) => `<path d="M${x} ${y}c-4-5-11 1-7 7l7 7 7-7c4-6-3-12-7-7z" fill="${accent}" transform="translate(${x * (1 - scale)} ${y * (1 - scale)}) scale(${scale})"/>`;
  if (mark === 'tears') return `<path d="M14 31c-5 7-3 11 1 11s6-5-1-11zm36 0c-5 7-3 11 1 11s6-5-1-11z" fill="#4ca9d8"/>`;
  if (mark === 'heart') return heart(32, 8, .72);
  if (mark === 'blush') return `<ellipse cx="17" cy="35" rx="5" ry="2.5" fill="${accent}" opacity=".45"/><ellipse cx="47" cy="35" rx="5" ry="2.5" fill="${accent}" opacity=".45"/>`;
  if (mark === 'motion') return `<path d="M7 19l-4-3M8 12l-2-5M57 43l4 3M56 50l2 5" ${line}/>`;
  if (mark === 'calm') return `<path d="M13 48q7 4 14 0M37 51q6 3 12-1" ${line} opacity=".55"/>`;
  if (mark === 'thanks') return `<path d="M24 53q-5-9-1-16l4 8V34l4 10 2-11 3 11 4-8q4 8-1 17" fill="#fff8e8" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
  if (mark === 'hearts') return `${heart(12, 12, .5)}${heart(52, 17, .42)}${heart(47, 49, .34)}`;
  if (mark === 'rain') return `<path d="M14 33c-6 9-3 14 1 14s7-6-1-14zm36 0c-6 9-3 14 1 14s7-6-1-14z" fill="#4ca9d8"/><path d="M10 52l-3 5M18 53l-2 6M48 53l2 6M55 52l3 5" stroke="#4ca9d8" stroke-width="2"/>`;
  if (mark === 'kiss') return `<path d="M47 35c-4-5-11 1-7 7l7 7 7-7c4-6-3-12-7-7z" fill="${accent}" opacity=".9"/>`;
  if (mark === 'approve') return `<circle cx="52" cy="42" r="10" fill="white" opacity=".72"/><path d="M45 43l5 5 10-14" ${line}/>`;
  if (mark === 'sweat') return `<path d="M50 13c-7 8-4 13 0 13s7-6 0-13z" fill="#4ca9d8"/>`;
  if (mark === 'clap') return `<path d="M8 36l10-8 8 17-11 6zm48 0l-10-8-8 17 11 6M8 23l-4-4M56 23l4-4" fill="#fff8e8" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
  if (mark === 'warmheart') return `${heart(32, 10, .62)}<path d="M24 8l-2-4M40 8l2-4" ${line}/>`;
  if (mark === 'flame') return `<path d="M49 7c3 9-8 10-1 20 7-4 9-10 8-15 9 12 5 22-5 25-9-3-12-14-2-30z" fill="${accent}" stroke="${ink}" stroke-width="1.7"/>`;
  if (mark === 'broken') return `<path d="M47 8c-7-8-18 2-12 12l12 12 12-12C65 10 54 0 47 8z" fill="${accent}"/><path d="M48 7l-4 8 6 3-5 9" ${inkLine}/>`;
  if (mark === 'sparkleheart') return `${heart(46, 9, .7)}<path d="M13 12v8M9 16h8M53 35v7M49 39h8" ${line}/>`;
  if (mark === 'blueheart') return `<path d="M50 8c-7-8-18 2-12 12l12 12 12-12C68 10 57 0 50 8z" fill="#3489c8" opacity=".9"/>`;
  if (mark === 'tear') return `<path d="M45 31c-5 8-3 12 1 12s7-5-1-12z" fill="#4ca9d8"/>`;
  if (mark === 'think') return `<path d="M45 45q6 0 8-7M50 40l7 3" ${inkLine}/><circle cx="53" cy="16" r="2" fill="${accent}"/><circle cx="59" cy="10" r="3" fill="${accent}"/>`;
  if (mark === 'bursts') return `<path d="M10 15l-5-5M54 15l5-5M9 47l-6 4M55 47l6 4" ${line}/>`;
  if (mark === 'orbit') return `<path d="M13 16q19-13 38 0" ${line} opacity=".7"/><circle cx="32" cy="8" r="2" fill="${accent}"/>`;
  if (mark === 'muscle') return `<path d="M42 48q6-10 13-4l4 5q-6 10-19 8l-7-5 4-8z" fill="#fff8e8" stroke="${ink}" stroke-width="2"/>`;
  if (mark === 'spark') return `<path d="M52 8v12M46 14h12" ${line}/>`;
  if (mark === 'okay') return `<circle cx="50" cy="45" r="6" fill="none" stroke="${ink}" stroke-width="3"/><path d="M55 41l5-7M57 44l6-2M54 49l5 5" ${inkLine}/>`;
  if (mark === 'hug') return `<path d="M8 38q8 16 24 14 16 2 24-14M9 38l7-5M55 38l-7-5" ${line}/>`;
  if (mark === 'purpleheart') return `<path d="M50 8c-7-8-18 2-12 12l12 12 12-12C68 10 57 0 50 8z" fill="#7657bd" opacity=".92"/>`;
  if (mark === 'cloud') return `<path d="M9 50q-5-8 5-10 2-8 10-3 8-3 10 5 8 1 4 8z" fill="#8ba3b0" opacity=".55"/>`;
  if (mark === 'shine') return `<path d="M51 8v10M46 13h10" ${line}/>`;
  if (mark === 'halo') return `<ellipse cx="32" cy="8" rx="15" ry="4" fill="none" stroke="${accent}" stroke-width="3"/>`;
  if (mark === 'rose') return `<path d="M49 8c7 2 7 10 1 13-7 1-11-8-5-12 3-4 8 0 4 4-4 3-7-2-3-4M47 21l-5 13M44 28l-6-2" ${line}/>`;
  if (mark === 'facepalm') return `<path d="M14 48l7-19 5 2-1 12 4-9 4 3-5 16z" fill="#fff8e8" stroke="${ink}" stroke-width="2"/>`;
  if (mark === 'party') return `<path d="M47 14l14 19-22 2z" fill="${accent}" stroke="${ink}" stroke-width="2"/><path d="M48 7l2-5M55 10l6-3M42 7l-3-5" ${line}/><circle cx="54" cy="19" r="2" fill="#fff8e8"/>`;
  if (mark === 'alert') return `<path d="M54 7v15M54 28v1" ${line}/>`;
  if (mark === 'linked') return `${heart(17, 9, .52)}${heart(47, 9, .52)}<path d="M24 18q8 7 16 0" ${line}/>`;
  if (mark === 'peace') return `<path d="M49 34v18M49 42l-8-10M49 42l8-11" ${inkLine}/><circle cx="49" cy="43" r="10" fill="none" stroke="${accent}" stroke-width="2"/>`;
  if (mark === 'sparkles') return `<path d="M12 8v12M6 14h12M53 36v15M46 43h14M49 7v7M45 11h8" ${line}/>`;
  if (mark === 'shrug') return `<path d="M7 48l9-7 8 8M57 48l-9-7-8 8M6 42l-3 4 5 1M58 42l3 4-5 1" ${inkLine}/>`;
  if (mark === 'shock') return `<path d="M11 9l5 8M5 19l9 3M53 9l-5 8M59 19l-9 3" ${line}/>`;
  if (mark === 'breeze') return `<path d="M10 47q10-4 19 0M39 49q8-4 15-1" ${line} opacity=".65"/>`;
  if (mark === 'flower') return `<g transform="translate(49 14)" fill="${accent}" stroke="${ink}" stroke-width="1.5"><circle cy="-6" r="5"/><circle cx="6" r="5"/><circle cy="6" r="5"/><circle cx="-6" r="5"/><circle r="4" fill="#fff8e8"/></g>`;
  if (mark === 'handsup') return `<path d="M7 42l6-16 7 3-2 17M57 42l-6-16-7 3 2 17M8 20l-4-5M56 20l4-5" fill="#fff8e8" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
  if (mark === 'taste') return `<path d="M46 49q7 4 9-3" ${line}/>`;
  if (mark === 'greenheart') return `<path d="M50 8c-7-8-18 2-12 12l12 12 12-12C68 10 57 0 50 8z" fill="#45a86c" opacity=".92"/>`;
  if (mark === 'brow') return `<path d="M16 18l11 3M39 20l9-4" ${inkLine}/>`;
  if (mark === 'yellowheart') return `<path d="M50 8c-7-8-18 2-12 12l12 12 12-12C68 10 57 0 50 8z" fill="#f1bd35" opacity=".96"/>`;
  if (mark === 'wave') return `<path d="M46 45q5-10 9-1l2 6q-7 8-16 2M51 38l1-5M57 39l3-4" fill="#fff8e8" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
  if (mark === 'pulseheart') return `${heart(47, 9, .68)}<path d="M7 49h10l3-6 5 12 5-9 4 3h8" ${line}/>`;
  if (mark === 'stars') return `<path d="M12 8l2 5 5 .5-4 3.5 1 5-4-3-4 3 1-5-4-3.5 5-.5zM53 35l2 5 5 .5-4 3.5 1 5-4-3-4 3 1-5-4-3.5 5-.5z" fill="${accent}"/>`;
  return '';
}

function qmojiSvg(item, {decorative = false} = {}) {
  if (!item) return '';
  const [tone, accent] = QMOJI_PALETTES[item.palette];
  const ink = '#102d50';
  const label = qmojiLabel(item);
  return `<svg class="qmoji" viewBox="0 0 64 64" role="${decorative ? 'presentation' : 'img'}"${decorative ? ' aria-hidden="true"' : ` aria-label="${escapeAttribute(label)}"`}>
    <path d="M32 5C17 4 7 14 7 30c0 17 10 27 25 27 5 0 9-1 13-3l10 5-3-12c4-5 6-11 5-18C56 13 47 5 32 5z" fill="${tone}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M18 13q12-7 25-1" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" opacity=".38"/>
    ${qmojiEyes(item.eyes, ink)}${qmojiMouth(item.mouth, ink, accent)}${qmojiMark(item.mark, ink, accent)}
  </svg>`;
}

function qmojiButton(item, scope, compact = false) {
  const label = qmojiLabel(item);
  return `<button class="qmoji-option${compact ? ' compact' : ''}" type="button" data-qmoji-token="${item.token}" data-qmoji-target="${scope}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">${qmojiSvg(item, {decorative: true})}</button>`;
}

function normalizedQmojiSearch(value) {
  return String(value || '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function renderQmojiGrid(scope, query = '') {
  const grid = document.querySelector(`[data-qmoji-grid="${scope}"]`);
  if (!grid) return;
  const normalizedQuery = normalizedQmojiSearch(query);
  const matches = QMOJIS.filter(item => !normalizedQuery || Object.values(item.labels).some(label => normalizedQmojiSearch(label).includes(normalizedQuery)));
  grid.innerHTML = matches.length
    ? matches.map(item => qmojiButton(item, scope)).join('')
    : '<p class="qmoji-empty">No encontramos esa emoción.</p>';
}

function renderQmojiPickers() {
  all('[data-qmoji-favorites]').forEach(container => {
    const scope = container.dataset.qmojiFavorites;
    container.innerHTML = QMOJI_FAVORITES.map(token => qmojiButton(QMOJI_BY_TOKEN.get(token), scope, true)).join('');
  });
  all('[data-qmoji-grid]').forEach(grid => renderQmojiGrid(grid.dataset.qmojiGrid));
}

function setQmojiPickerOpen(scope, open) {
  all('[data-qmoji-picker]').forEach(picker => { picker.hidden = !open || picker.dataset.qmojiPicker !== scope; });
  all('[data-qmoji-open]').forEach(button => button.setAttribute('aria-expanded', String(open && button.dataset.qmojiOpen === scope)));
  if (open) document.querySelector(`[data-qmoji-search="${scope}"]`)?.focus();
}

function closeQmojiPickers() {
  setQmojiPickerOpen('', false);
}

function sendQmoji(scope, token) {
  if (!QMOJI_BY_TOKEN.has(token)) return;
  closeQmojiPickers();
  if (scope === 'private') void sendPrivateChatMessage(token, 'reaction');
  else void sendChatMessage(token, 'reaction');
}

function profilePayload(photos = state.profile?.photos || []) {
  return {
    displayName: byId('profileName').value.trim(),
    role: byId('profileRole').value,
    bio: byId('profileBio').value.trim(),
    country: byId('profileCountry').value.trim(),
    city: byId('profileCity').value.trim(),
    visible: byId('profileVisible').checked,
    photos: photos.map(photo => ({id: photo.id, caption: photo.caption || null})),
    social: {
      allowMatchmaking: byId('allowMatchmaking').checked,
      allowMessages: byId('allowMessages').checked,
      showResidence: byId('showResidence').checked,
      shareApproximateLocation: byId('shareLocation').checked,
      allowDjContact: true,
      allowTips: true,
    },
  };
}

async function saveProfile(photos) {
  const result = await api('/api/account/profile', {method: 'PUT', body: JSON.stringify(profilePayload(photos))});
  state.profile = result.profile;
  await syncLocalRoomProfileMetadata();
  renderAccount();
  renderChat();
  if (state.profile?.social?.shareApproximateLocation && (storedGlobalCountryCode())) {
    startWebGlobalPresence();
  } else {
    if (!state.profile?.social?.shareApproximateLocation) forgetGlobalCountryCode();
    stopWebGlobalPresence();
  }
  renderGlobalPresenceControl();
  return result.profile;
}

async function restoreAccount() {
  try {
    const result = await api('/api/account');
    state.account = result.account;
    state.profile = result.profile;
  } catch {
    state.account = null;
    state.profile = null;
    state.chatDirectoryContacts = [];
    state.chatDirectoryQuery = '';
  }
  renderAccount();
  renderChat();
  if (state.account) {
    resumeGlobalPresenceFromProfile();
    void loadBilling({quiet: true, poll: new URLSearchParams(location.search).get('payment') === 'returned'});
    void loadStars({quiet: true});
    void loadProfileActivity({quiet: true, notify: false});
    void loadSessionHistory({quiet: true});
    startProfileActivityPolling();
    setTimeout(requestNativeSocialNotifications, 800);
    if (state.pendingRoomCreation) {
      if (roomCreatorProfileIsActive()) showView('create');
      else explainRoomCreatorAccess();
    }
    void redeemRequestedPrivateContactInvite();
  } else {
    stopProfileActivityPolling();
    renderProfileActivityBadge();
  }
}

function setPasswordVisible(inputId, buttonId, visible) {
  const input = byId(inputId);
  const button = byId(buttonId);
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.textContent = localizedUiText(visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
}

function setAccountPasswordVisible(visible) {
  setPasswordVisible('accountPassword', 'toggleAccountPassword', visible);
}

function rememberAccountEmail() {
  try {
    if (byId('rememberAccountEmail').checked) {
      localStorage.setItem('qsession-remembered-email', byId('accountEmail').value.trim());
    } else {
      localStorage.removeItem('qsession-remembered-email');
    }
  } catch { /* El acceso funciona también cuando el almacenamiento está bloqueado. */ }
}

function restoreRememberedAccountEmail() {
  try {
    const email = localStorage.getItem('qsession-remembered-email') || '';
    if (!email) return false;
    if (!byId('accountEmail').value) byId('accountEmail').value = email;
    byId('rememberAccountEmail').checked = true;
    return true;
  } catch { return false; }
}

function setAuthMode(mode) {
  state.authMode = mode === 'login' ? 'login' : 'register';
  const registering = state.authMode === 'register';
  all('[data-auth-mode]').forEach(button => button.classList.toggle('active', button.dataset.authMode === state.authMode));
  byId('registrationFields').hidden = !registering;
  byId('accountPasswordConfirmationField').hidden = !registering;
  byId('accountName').required = registering;
  byId('accountName').disabled = !registering;
  byId('accountPasswordConfirmation').required = registering;
  byId('accountPasswordConfirmation').disabled = !registering;
  all('input[name="accountRole"]').forEach(input => { input.disabled = !registering; });
  byId('accountSubmit').innerHTML = state.authMode === 'login' ? 'Entrar a mi cuenta <span>→</span>' : 'Crear mi cuenta <span>→</span>';
  byId('accountPassword').autocomplete = state.authMode === 'login' ? 'current-password' : 'new-password';
  byId('accountPassword').minLength = registering ? 10 : 1;
  byId('accountPassword').placeholder = localizedUiText(registering ? 'Mínimo 10 caracteres' : 'Tu contraseña');
  byId('accountForm').action = `/api/auth/${state.authMode}`;
  setAccountPasswordVisible(false);
  setPasswordVisible('accountPasswordConfirmation', 'toggleAccountPasswordConfirmation', false);
  setStatus(byId('accountStatus'), '');
}

function openAccountRecovery() {
  const dialog = byId('accountRecoveryDialog');
  byId('recoveryEmail').value = byId('accountEmail').value.trim();
  byId('accountRecoveryRequestForm').hidden = false;
  byId('accountRecoveryResetForm').hidden = true;
  byId('recoveryCode').value = '';
  byId('recoveryPassword').value = '';
  byId('recoveryPasswordConfirmation').value = '';
  setStatus(byId('accountRecoveryStatus'), '');
  if (!dialog.open) dialog.showModal();
  byId('recoveryEmail').focus();
}

function renderRecoveredSession(result) {
  state.account = result.account;
  state.profile = result.profile;
  state.chatDirectoryContacts = [];
  state.chatDirectoryQuery = '';
  byId('accountEmail').value = result.account?.email || byId('recoveryEmail').value.trim();
  rememberAccountEmail();
  renderAccount();
  renderChat();
  resumeGlobalPresenceFromProfile();
  void loadBilling({quiet: true});
  void loadStars({quiet: true});
  void loadProfileActivity({quiet: true, notify: false});
  void loadSessionHistory({quiet: true});
  startProfileActivityPolling();
  requestNativeSocialNotifications();
}

async function downloadAccountData() {
  const status = byId('accountDataStatus');
  setStatus(status, 'Preparando una copia segura…');
  try {
    const data = await api('/api/account/export');
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qsession-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(status, 'La copia de tus datos fue descargada.');
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

function openDeleteAccountDialog() {
  const dialog = byId('deleteAccountDialog');
  byId('deleteAccountForm').reset();
  setPasswordVisible('deleteAccountPassword', 'toggleDeleteAccountPassword', false);
  setStatus(byId('deleteAccountStatus'), '');
  if (!dialog.open) dialog.showModal();
  byId('deleteAccountPassword').focus();
}

function clearDeletedAccountState() {
  stopFlowerListeningRewards();
  state.account = null;
  state.profile = null;
  state.globalPresenceCountryCode = '';
  state.profileActions = [];
  state.profileContacts = [];
  state.chatDirectoryContacts = [];
  state.chatDirectoryQuery = '';
  state.hostedSessions = [];
  state.billing = {plans: [], credits: [], orders: [], reservations: [], enforced: false, checkoutConfigured: false, directVideoUploadsConfigured: false, error: ''};
  state.stars = {balance: 0, packages: [], checkoutConfigured: false, sponsorRewardStars: 0, sponsorMinimumViewSeconds: 15, flowers: {inventory: [], total: 0}};
  state.selectedBillingPlanId = '';
  state.billingPlanMode = '';
  state.customQuote = null;
  state.privateMessageHistory.clear();
  state.profileActivityUnread = 0;
  window.clearTimeout(state.customQuoteTimer);
  stopProfileActivityPolling();
  try { localStorage.removeItem('qsession-remembered-email'); } catch { /* Sin almacenamiento. */ }
  byId('rememberAccountEmail').checked = false;
  byId('accountEmail').value = '';
  byId('accountPassword').value = '';
  byId('accountPasswordConfirmation').value = '';
  setAuthMode('register');
  renderProfileActivityBadge();
  renderAccount();
  renderChat();
  renderCreatorBilling();
}

function personRole(profile) {
  return profile?.role === 'dj' ? 'DJ / artista' : 'Oyente';
}

function localRoomProfileMetadata() {
  if (!state.profile?.visible || (state.currentRoomCode && state.currentRoom?.allowSocialProfiles === false)) return null;
  return {
    profileId: state.profile.id,
    visible: true,
    displayName: state.profile.displayName,
    role: state.profile.role,
    avatarUrl: profilePhotoUrl(state.profile) || null,
    city: state.profile.social?.showResidence ? state.profile.city || null : null,
    country: state.profile.social?.showResidence ? state.profile.country || null : null,
    social: state.profile.social || null,
  };
}

async function syncLocalRoomProfileMetadata() {
  const participant = state.mediaConnected ? state.mediaRoom?.localParticipant : null;
  if (!participant || typeof participant.setMetadata !== 'function') return;
  const metadata = localRoomProfileMetadata();
  await participant.setMetadata(metadata ? JSON.stringify(metadata) : '').catch(() => undefined);
  void loadPeople();
}

function participantPublicProfile(participant, {local = false} = {}) {
  if (state.currentRoomCode && state.currentRoom?.allowSocialProfiles === false) return null;
  if (local) return localRoomProfileMetadata();
  try {
    const metadata = typeof participant?.metadata === 'string'
      ? JSON.parse(participant.metadata || '{}')
      : participant?.metadata;
    return metadata?.visible && metadata.profileId ? metadata : null;
  } catch {
    return null;
  }
}

function cameraParticipantKey(participant, {local = false} = {}) {
  return local ? `local-${state.mediaRole || 'participant'}` : String(participant?.identity || '');
}

function roomParticipantIsOrganizer(participant, {local = false} = {}) {
  return local
    ? state.mediaRole === 'dj'
    : String(participant?.identity || '').startsWith('dj-');
}

function organizerRoomProfile(participant, {local = false} = {}) {
  if (!roomParticipantIsOrganizer(participant, {local})) return null;
  const presence = participantPublicProfile(participant, {local});
  const displayName = presence?.displayName
    || state.currentRoom?.djName
    || participant?.name
    || 'DJ / Organizador';
  return {
    id: presence?.profileId || `organizer-${String(state.currentRoomCode || 'room').toLowerCase()}`,
    displayName,
    role: 'dj',
    avatarUrl: presence?.avatarUrl || null,
    photos: [],
    city: presence?.city || null,
    country: presence?.country || null,
    bio: null,
    musicGenres: [],
    social: presence?.social || null,
    visible: true,
    roomActive: true,
    roomLocal: local,
    roomOrganizer: true,
    organizerPlaceholder: !presence?.profileId,
  };
}

function profileFromRoomParticipant(participant, {local = false} = {}) {
  const presence = participantPublicProfile(participant, {local});
  if (!presence?.profileId || !presence.visible) return null;
  const known = state.publicProfiles.find(profile => profile.id === presence.profileId);
  const roomOrganizer = roomParticipantIsOrganizer(participant, {local});
  return {
    ...(known || {}),
    id: presence.profileId,
    displayName: presence.displayName || known?.displayName || 'Perfil Q Session',
    role: presence.role || known?.role || 'listener',
    avatarUrl: presence.avatarUrl || known?.avatarUrl || null,
    photos: known?.photos || [],
    city: presence.city || known?.city || null,
    country: presence.country || known?.country || null,
    bio: known?.bio || null,
    musicGenres: known?.musicGenres || [],
    social: presence.social || known?.social || null,
    visible: true,
    roomActive: true,
    roomLocal: local,
    roomOrganizer,
  };
}

function activeRoomProfiles() {
  const profiles = new Map();
  if (!state.currentRoomCode || !state.mediaConnected || !state.mediaRoom) return profiles;
  const localProfile = profileFromRoomParticipant(state.mediaRoom.localParticipant, {local: true});
  if (localProfile) profiles.set(localProfile.id, localProfile);
  for (const participant of state.mediaRoom.remoteParticipants.values()) {
    const profile = profileFromRoomParticipant(participant);
    if (profile) profiles.set(profile.id, profile);
  }
  return profiles;
}

function detachedTrackElements(track, target = null) {
  if (!track || typeof track.detach !== 'function') return [];
  const detached = target ? track.detach(target) : track.detach();
  if (!detached) return [];
  return Array.isArray(detached) ? detached : [detached];
}

function removeDetachedTrackElements(track, target = null, {preserveTarget = false} = {}) {
  detachedTrackElements(track, target).forEach(element => {
    // The stage belongs to the page, even after LiveKit releases its track.
    // HLS reuses this element; removing it makes subsequent lookups fail.
    if (!element || element.id === 'liveVideo' || element.id === 'broadcastVideo' || (preserveTarget && element === target)) return;
    element.remove?.();
  });
}

function detachPeopleVideos() {
  byId('peopleGrid').querySelectorAll('video[data-camera-participant]').forEach(video => {
    const entry = state.peopleVideoTracks.get(video.dataset.cameraParticipant);
    entry?.track?.detach(video);
  });
  byId('peopleGrid').querySelectorAll('video[data-people-edge-video]').forEach(video => {
    video.qsessionPeopleHls?.destroy?.();
    delete video.qsessionPeopleHls;
    video.pause?.();
    video.removeAttribute('src');
    video.load?.();
  });
}

function personCaption(profile, {cameraLive = false, local = false, roomActive = false} = {}) {
  const caption = document.createElement('div');
  caption.className = 'person-card-caption';
  const name = document.createElement('strong');
  name.textContent = profile.displayName || 'Perfil Q Session';
  const residence = profileResidenceLabel(profile);
  const detailsText = roomActive
    ? residence || (profile.roomOrganizer ? 'Organizador de la sala' : '')
    : `${personRole(profile)}${residence ? ` · ${residence}` : ''}`;
  caption.append(name);
  if (detailsText) {
    const details = document.createElement('span');
    details.textContent = detailsText;
    caption.append(details);
  }
  return caption;
}

function personOrganizerBadge(profile) {
  if (!profile.roomOrganizer) return null;
  const badge = document.createElement('span');
  badge.className = 'person-organizer-badge';
  badge.textContent = 'DJ / ORGANIZADOR';
  return badge;
}

function staticPersonCard(profile, {roomActive = false, local = false} = {}) {
  const card = document.createElement('article');
  card.className = `person-card${profile.roomOrganizer ? ' person-card-organizer' : ''}`;
  const media = document.createElement('div');
  media.className = 'person-card-media';
  const photo = profile.photos?.[0]?.url || profile.avatarUrl;
  if (photo) {
    const image = document.createElement('img');
    image.src = photo;
    image.alt = `Foto de ${profile.displayName || 'usuario'}`;
    media.append(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'person-placeholder';
    placeholder.textContent = String(profile.displayName || 'Q').charAt(0).toUpperCase();
    media.append(placeholder);
  }
  const organizerBadge = personOrganizerBadge(profile);
  if (organizerBadge) media.append(organizerBadge);
  if (!profile.organizerPlaceholder) media.append(personProfileTrigger(profile));
  card.append(media, personCaption(profile, {roomActive, local}));
  return card;
}

function personProfileTrigger(profile) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'person-profile-hit';
  button.dataset.personProfile = profile.id;
  button.setAttribute('aria-label', `Abrir opciones de ${profile.displayName || 'esta persona'}`);
  const hint = document.createElement('span');
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = '•••';
  button.append(hint);
  return button;
}

function livePersonCard(key, entry, profile) {
  const card = document.createElement('article');
  card.className = `person-card person-card-live${profile.roomOrganizer ? ' person-card-organizer' : ''}`;
  const stage = document.createElement('div');
  stage.className = 'person-live-media';
  stage.dataset.cameraFraming = entry.local ? state.cameraFraming : participantCameraFraming(entry.participant);
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.dataset.cameraParticipant = key;
  video.setAttribute('aria-label', `Video en vivo de ${profile.displayName || 'usuario'}`);
  const badge = document.createElement('span');
  badge.className = 'person-live-badge';
  badge.textContent = '● EN VIVO';
  stage.append(video, badge);
  const organizerBadge = personOrganizerBadge(profile);
  if (organizerBadge) stage.append(organizerBadge);
  if (!profile.organizerPlaceholder) stage.append(personProfileTrigger(profile));
  card.append(stage, personCaption(profile, {cameraLive: true, roomActive: true, local: entry.local}));
  entry.track.attach(video);
  bindVideoAspectSync(video, () => syncVideoContainerAspect(
    stage,
    entry.track,
    video,
    entry.local ? state.cameraOrientation : participantCameraOrientation(entry.participant, entry.track, video),
    entry.local ? 'none' : participantCameraRotation(entry.participant),
  ));
  void video.play().catch(() => undefined);
  return card;
}

function edgeOrganizerPersonCard(profile) {
  const url = String(state.broadcastDelivery?.url || '');
  if (!url) return staticPersonCard(profile, {roomActive: true});
  const card = document.createElement('article');
  card.className = 'person-card person-card-live person-card-organizer';
  const stage = document.createElement('div');
  stage.className = 'person-live-media';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.dataset.peopleEdgeVideo = 'true';
  video.setAttribute('aria-label', `Video en vivo de ${profile.displayName || 'DJ / Organizador'}`);
  const badge = document.createElement('span');
  badge.className = 'person-live-badge';
  badge.textContent = '● EN VIVO';
  stage.append(video, badge, personOrganizerBadge(profile));
  if (!profile.organizerPlaceholder) stage.append(personProfileTrigger(profile));
  card.append(stage, personCaption(profile, {cameraLive: true, roomActive: true}));

  if (window.Hls?.isSupported?.()) {
    const hls = new window.Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 5,
      maxBufferLength: 8,
      backBufferLength: 4,
      enableWorker: true,
    });
    video.qsessionPeopleHls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  }
  void video.play().catch(() => undefined);
  return card;
}

function savePeoplePreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // La vista continúa funcionando aunque el navegador bloquee el almacenamiento local.
  }
}

function peopleCamerasVisible() {
  return Boolean(state.mediaConnected && state.mediaRoom
    && state.currentRoom?.allowSocialProfiles !== false
    && !state.peopleNativeBackground
    && !byId('view-people').hidden && document.visibilityState !== 'hidden');
}

function peopleCameraCandidates() {
  if (!state.mediaRoom || !state.mediaConnected || state.currentRoom?.allowSocialProfiles === false) return [];
  const candidatesByProfile = new Map();
  const participants = [
    {participant: state.mediaRoom.localParticipant, local: true},
    ...[...state.mediaRoom.remoteParticipants.values()].map(participant => ({participant, local: false})),
  ].sort((left, right) => String(left.participant?.identity || '').localeCompare(String(right.participant?.identity || '')));

  for (const {participant, local} of participants) {
    if (!participant) continue;
    const profile = profileFromRoomParticipant(participant, {local}) || organizerRoomProfile(participant, {local})
      || (local && state.profile?.id ? {...state.profile,roomLocal:true,roomOrganizer:false} : null);
    if (!profile) continue;
    const publications = [...participant.trackPublications.values()]
      .filter(item => mediaPublicationKind(item) === 'video'
        && (!item.source || item.source === window.LivekitClient.Track.Source.Camera)
        && !item.isMuted)
      .sort((left, right) => String(left.trackSid || '').localeCompare(String(right.trackSid || '')));
    const publication = publications[0];
    const identity = String(participant.identity || cameraParticipantKey(participant, {local}));
    const candidate = {
      id: identity,
      trackKey: cameraParticipantKey(participant, {local}),
      participant,
      profile,
      publication,
      local,
    };
    const current = candidatesByProfile.get(profile.id);
    const candidateScore = (profile.roomOrganizer ? 4 : 0) + (publication ? 2 : 0) + (local ? 3 : 0)
      + (String(profile.id || '') === identity ? 0.5 : 0);
    const currentScore = current
      ? (current.profile.roomOrganizer ? 4 : 0) + (current.publication ? 2 : 0) + (current.local ? 3 : 0)
        + (String(current.profile.id || '') === current.id ? 0.5 : 0)
      : -1;
    if (!current || candidateScore > currentScore) candidatesByProfile.set(profile.id, candidate);
  }

  return [...candidatesByProfile.values()].sort((left, right) => {
    if (Boolean(left.profile.roomOrganizer) !== Boolean(right.profile.roomOrganizer)) return left.profile.roomOrganizer ? -1 : 1;
    if (Boolean(left.publication) !== Boolean(right.publication)) return left.publication ? -1 : 1;
    const nameOrder = String(left.profile.displayName || '').localeCompare(String(right.profile.displayName || ''));
    return nameOrder || left.id.localeCompare(right.id);
  });
}

function refreshPeopleCameraPage({next = false} = {}) {
  if (state.peoplePageRoom !== state.mediaRoom) {
    peopleCameraPager.reset();
    state.peoplePageRoom = state.mediaRoom;
  }
  const candidates = peopleCameraCandidates();
  const pinned = candidates.filter(item => item.profile.roomOrganizer).map(item => item.id)
    .concat(candidates.filter(item => item.local && !item.profile.roomOrganizer).map(item => item.id));
  state.peoplePageIds = peopleCameraPager.update(candidates.map(item => item.id), {next, pinned});
  const selected = new Set(state.peoplePageIds);
  state.peopleCameraSids = new Set(candidates
    .filter(item => selected.has(item.id) && item.publication)
    .map(item => item.publication.trackSid));
  byId('peopleNextGroup').disabled = candidates.length <= PEOPLE_CAMERA_PAGE_SIZE;
  return candidates;
}

function applyPeopleView({render = false} = {}) {
  const grid = byId('peopleGrid');
  grid.dataset.layout = state.peopleLayout;
  grid.dataset.size = String(PEOPLE_CAMERA_PAGE_SIZE);
  if (state.peopleLayout === 'scroll') {
    grid.tabIndex = 0;
    grid.setAttribute('aria-label', 'Personas en una lista vertical. Desplázate hacia abajo para recorrerlas.');
  } else {
    grid.removeAttribute('tabindex');
    grid.setAttribute('aria-label', 'Personas en mosaico.');
  }
  all('[data-people-layout]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.peopleLayout === state.peopleLayout));
  });
  savePeoplePreference('qsession-people-layout', state.peopleLayout);
  if (render) renderPeople();
}

function renderPeople() {
  const grid = byId('peopleGrid');
  syncWebMediaSubscriptions();
  const candidates = refreshPeopleCameraPage();
  detachPeopleVideos();
  grid.replaceChildren();
  if (!state.currentRoomCode || !state.mediaConnected || !state.mediaRoom) {
    byId('peopleVisibleCount').textContent = '';
    const noRoomNotice = document.createElement('div');
    noRoomNotice.className = 'empty-state';
    noRoomNotice.innerHTML = '<img src="/icons/qsession-mark-contrast.png?v=20260911-brand-logo-v1" alt="" /><strong>Entra a una sala para ver quién está activo</strong><span>Personas sólo muestra los perfiles presentes en tu sesión actual.</span>';
    grid.append(noRoomNotice);
    window.QSessionI18n?.applyTranslations(grid);
    return;
  }
  if (state.currentRoomCode && state.currentRoom?.allowSocialProfiles === false) {
    byId('peopleVisibleCount').textContent = '';
    const privateNotice = document.createElement('div');
    privateNotice.className = 'empty-state';
    privateNotice.innerHTML = '<img src="/icons/qsession-mark-contrast.png?v=20260911-brand-logo-v1" alt="" /><strong>Esta sesión protege los perfiles</strong><span>El anfitrión desactivó las funciones sociales para este encuentro.</span>';
    grid.append(privateNotice);
    window.QSessionI18n?.applyTranslations(grid);
    return;
  }
  const selected = state.peoplePageIds.map(id => candidates.find(item => item.id === id)).filter(Boolean);
  for (const {trackKey, profile, publication, local} of selected) {
    const entry = state.peopleVideoTracks.get(trackKey);
    const edgeOrganizer = profile.roomOrganizer && state.broadcastUsingEdge
      && state.broadcastEdgeReady && state.broadcastDelivery?.url;
    const live = peopleCamerasVisible() && publication && entry?.track && entry.track === publication.track;
    const card = edgeOrganizer
      ? edgeOrganizerPersonCard(profile)
      : live
        ? livePersonCard(trackKey, entry, profile)
        : staticPersonCard(profile, {roomActive: true});
    if(local && !profile.roomOrganizer)card.classList.add('person-card-self');
    grid.append(card);
  }
  byId('peopleVisibleCount').textContent = candidates.length
    ? `${selected.length} de ${candidates.length} personas · DJ · tú · sala`
    : '';

  if (!grid.children.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<img src="/icons/qsession-mark-contrast.png?v=20260911-brand-logo-v1" alt="" /><strong>No hay perfiles visibles en esta sala</strong><span>Cuando una persona conectada decida mostrarse, aparecerá aquí mientras siga presente.</span>';
    grid.append(empty);
  }
  window.QSessionI18n?.applyTranslations(grid);
}

async function loadPeople() {
  state.publicProfiles = [...activeRoomProfiles().values()];
  renderPeople();
  renderPublicChatDirectory();
  await openRequestedPersonProfile();
}

function selectedPersonProfile() {
  return state.publicProfiles.find(profile => profile.id === state.selectedPersonProfileId) || null;
}

function personIsSaved(profileId) {
  return Array.isArray(state.profile?.savedProfileIds) && state.profile.savedProfileIds.includes(profileId);
}

function setPersonActionStatus(message, error = false) {
  setStatus(byId('personActionStatus'), message, error);
}

function renderPersonActionDialog(profile) {
  const ownProfile = Boolean(state.profile?.id && profile.id === state.profile.id);
  const socialEnabled = !state.currentRoomCode || state.currentRoom?.allowSocialProfiles !== false;
  const giftsEnabled = socialEnabled && state.currentRoom?.allowProfileGifts !== false;
  const matchmakingEnabled = socialEnabled && state.currentRoom?.allowMatchmaking !== false;
  const roomActive = activeRoomProfiles().has(profile.id);
  const retainedContact = personIsSaved(profile.id) || state.profileContacts.some(contact => contact.id === profile.id);
  renderProfileAvatar('personActionAvatar', profile);
  byId('personActionName').textContent = profile.displayName || 'Persona Q Session';
  byId('personActionPresence').textContent = roomActive ? '● ACTIVO EN ESTA SALA' : retainedContact ? 'CONTACTO GUARDADO' : 'PERFIL COMPARTIDO';
  byId('personActionMeta').textContent = [personRole(profile), profileResidenceLabel(profile)].filter(Boolean).join(' · ') || 'Comunidad Q Session';

  const details = byId('personProfileDetails');
  details.hidden = true;
  const gallery = byId('personProfileGallery');
  gallery.replaceChildren();
  const photos = (profile.photos?.length ? profile.photos : (profile.avatarUrl ? [{url: profile.avatarUrl}] : [])).slice(0, 6);
  photos.forEach((photo, index) => {
    const image = document.createElement('img');
    image.src = photo.url;
    image.alt = `Foto ${index + 1} de ${profile.displayName || 'la persona'}`;
    gallery.append(image);
  });
  byId('personProfileBio').textContent = profile.bio || 'Este perfil todavía no agregó una descripción.';
  const flowerChoices = byId('personGiftChoices');
  flowerChoices.hidden = true;
  flowerChoices.replaceChildren();
  const availableFlowers = (state.stars.flowers?.inventory || []).filter(flower => Number(flower.quantity) > 0);
  availableFlowers.forEach(flower => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sendFlower = flower.id;
    const symbol = document.createElement('span'); symbol.textContent = flower.symbol || '✿';
    button.append(symbol, document.createTextNode(`${flower.name} · ${flower.quantity}`));
    flowerChoices.append(button);
  });
  byId('personStarChoices').hidden = true;

  const canMessage = socialEnabled && !ownProfile && Boolean(profile.social?.allowMessages);
  byId('messagePerson').disabled = !canMessage;
  byId('messagePerson').querySelector('small').textContent = ownProfile
    ? 'Este es tu perfil'
    : !socialEnabled ? 'No disponible en esta sesión' : canMessage ? 'Abrir un chat privado' : 'Esta persona no recibe mensajes';
  const artistProfile = ['dj', 'organizer'].includes(String(profile.role || '').toLowerCase());
  byId('giftPerson').disabled = ownProfile || !giftsEnabled || !artistProfile || !availableFlowers.length;
  byId('giftPerson').querySelector('small').textContent = !giftsEnabled
    ? 'No disponible en esta sesión'
    : !artistProfile ? 'Las flores reconocen a artistas y organizadores'
      : availableFlowers.length ? 'Elige una flor de tu florero' : 'Escucha una sesión para recibir flores';
  const canReceiveStars = !ownProfile && Boolean(profile.social?.allowTips) && ['dj', 'organizer'].includes(String(profile.role || '').toLowerCase());
  byId('tipPerson').disabled = !canReceiveStars;
  byId('tipPerson').querySelector('small').textContent = canReceiveStars ? 'Apoya directamente a este artista' : 'Este perfil no recibe estrellas';
  const hasFlowers = Number(state.stars.flowers?.total) > 0;
  const availableForMatchmaking = matchmakingEnabled && !ownProfile && Boolean(profile.social?.allowMatchmaking) && hasFlowers;
  byId('personMatchmakingStatus').textContent = ownProfile
    ? 'Este es tu perfil'
    : !matchmakingEnabled ? 'No disponible en esta sesión'
      : !hasFlowers ? 'Necesitas una flor de tu florero'
        : availableForMatchmaking ? 'Disponible para conectar' : 'No disponible por ahora';
  byId('touchPerson').disabled = !availableForMatchmaking;
  byId('touchPerson').textContent = availableForMatchmaking ? 'Conectar con una flor' : 'No disponible';
  byId('savePersonProfile').disabled = ownProfile || !socialEnabled;
  byId('sharePersonProfile').disabled = !socialEnabled;
  byId('savePersonProfile').classList.toggle('is-saved', personIsSaved(profile.id));
  byId('savePersonProfile').innerHTML = personIsSaved(profile.id)
    ? '<span aria-hidden="true">♥</span> Perfil guardado'
    : '<span aria-hidden="true">♡</span> Guardar perfil';
  setPersonActionStatus(ownProfile ? 'Este es tu perfil público.' : '');
}

async function openPersonActions(profileId) {
  let profile = state.publicProfiles.find(item => item.id === profileId) || null;
  if (!profile?._detailsLoaded) {
    try {
      const result = await api(`/api/profiles/${encodeURIComponent(profileId)}`);
      profile = {...result.profile, _detailsLoaded: true};
      const profileIndex = state.publicProfiles.findIndex(item => item.id === profile.id);
      if (profileIndex >= 0) state.publicProfiles.splice(profileIndex, 1, profile);
      else state.publicProfiles.push(profile);
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  state.selectedPersonProfileId = profile.id;
  renderPersonActionDialog(profile);
  const dialog = byId('personActionDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closePersonActions() {
  const dialog = byId('personActionDialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function openRequestedPersonProfile() {
  if (!state.requestedProfileId || state.requestedProfileOpened) return;
  state.requestedProfileOpened = true;
  await openPersonActions(state.requestedProfileId);
}

function requirePersonActionAccount() {
  if (state.account) return true;
  closePersonActions();
  showView('profile');
  toast('Inicia sesión para conectar con esta persona.');
  return false;
}

async function messageSelectedPerson() {
  const profile = selectedPersonProfile();
  if (!profile || !requirePersonActionAccount()) return;
  if (!state.profile?.social?.allowMessages) {
    closePersonActions();
    showView('profile');
    toast('Activa Mensajes en tu perfil para conversar.');
    return;
  }
  setPersonActionStatus('Abriendo una conversación privada…');
  try {
    const result = await api('/api/private-conversations', {
      method: 'POST',
      body: JSON.stringify({type: 'direct', memberProfileIds: [profile.id]}),
    });
    state.chatMode = 'private';
    state.chatModeChosen = true;
    closePersonActions();
    showView('chat');
    await loadPrivateConversations({quiet: true});
    await openPrivateConversation(result.conversation.id);
    byId('privateChatMessageInput').focus();
  } catch (error) {
    setPersonActionStatus(error.message, true);
  }
}

async function sendSelectedProfileAction(type, gift = null) {
  const profile = selectedPersonProfile();
  if (!profile || !requirePersonActionAccount()) return;
  setPersonActionStatus(type === 'touch' ? 'Enviando tu toque…' : 'Enviando el detalle…');
  try {
    const result = await api(`/api/profiles/${encodeURIComponent(profile.id)}/actions`, {
      method: 'POST',
      body: JSON.stringify({type, gift, roomCode: state.currentRoomCode || undefined, roomId: state.currentRoom?.id || undefined}),
    });
    if (result.flowerTransfer?.flowers) {
      state.stars.flowers = result.flowerTransfer.flowers;
      renderFlowerWallet();
    }
    byId('personGiftChoices').hidden = true;
    if (type === 'touch') {
      byId('touchPerson').disabled = true;
      byId('touchPerson').textContent = 'Flor enviada';
    }
    setPersonActionStatus(type === 'touch'
      ? `${profile.displayName || 'La persona'} recibió tu invitación y una flor.`
      : `${profile.displayName || 'La persona'} recibirá tu detalle.`);
    void loadProfileActivity({quiet: true});
  } catch (error) {
    setPersonActionStatus(error.message, true);
  }
}

async function sendSelectedFlower(flowerId) {
  const profile = selectedPersonProfile();
  if (!profile || !requirePersonActionAccount()) return;
  setPersonActionStatus('Enviando tu flor…');
  try {
    const result = await api('/api/flowers/send', {
      method: 'POST',
      body: JSON.stringify({
        profileId: profile.id,
        flowerId,
        roomId: state.currentRoom?.id || undefined,
        roomCode: state.currentRoomCode || undefined,
      }),
    });
    state.stars.flowers = result.transfer.flowers;
    renderFlowerWallet();
    byId('personGiftChoices').hidden = true;
    const name = result.transfer.flower?.name || 'flor';
    setPersonActionStatus(`${profile.displayName || 'El artista'} recibió tu ${name.toLowerCase()}.`);
    void loadProfileActivity({quiet: true});
  } catch (error) {
    setPersonActionStatus(error.message, true);
  }
}

async function toggleSavedPersonProfile() {
  const profile = selectedPersonProfile();
  if (!profile || !requirePersonActionAccount()) return;
  const saved = !personIsSaved(profile.id);
  setPersonActionStatus(saved ? 'Guardando el perfil…' : 'Quitando el perfil guardado…');
  try {
    const result = await api(`/api/profiles/${encodeURIComponent(profile.id)}/saved`, {
      method: 'PUT',
      body: JSON.stringify({saved}),
    });
    state.profile.savedProfileIds = result.savedProfileIds || [];
    renderPersonActionDialog(profile);
    setPersonActionStatus(result.saved ? 'Perfil guardado en tu cuenta.' : 'Perfil quitado de tus guardados.');
    void loadProfileActivity({quiet: true});
  } catch (error) {
    setPersonActionStatus(error.message, true);
  }
}

async function shareSelectedPersonProfile() {
  const profile = selectedPersonProfile();
  if (!profile) return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('profile', profile.id);
  url.hash = 'people';
  const shareData = {
    title: `${profile.displayName || 'Perfil'} · Q Session`,
    text: `Mira el perfil de ${profile.displayName || 'esta persona'} en Q Session.`,
    url: url.toString(),
  };
  try {
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(shareData.url);
      setPersonActionStatus('Enlace del perfil copiado.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') setPersonActionStatus('No fue posible compartir el perfil.', true);
  }
}

function renderProfileActivityBadge() {
  const badge = byId('peopleActivityCount');
  const count = Number(state.profileActivityUnread) || 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}

function profileActionDescription(action) {
  if (action.type === 'message') return 'te envió un mensaje privado.';
  if (action.type === 'call') return 'te está llamando.';
  if (action.type === 'touch') return 'te envió un toque para conectar.';
  if (action.type === 'gift') return 'te envió un detalle.';
  if (action.type === 'room-invite') return `te invitó al chat de la sala ${action.roomCode || ''}.`;
  return 'interactuó con tu perfil.';
}

function profileActionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(document.documentElement.lang || 'es', {dateStyle: 'short', timeStyle: 'short'}).format(date);
}

function renderProfileActivity() {
  const list = byId('profileActivityList');
  if (!state.profileActions.length && !state.profileContacts.length) {
    list.innerHTML = '<p class="profile-activity-empty">Los perfiles sólo se conservarán aquí cuando los guardes o exista una interacción.</p>';
    return;
  }
  const contacts = state.profileContacts.map(contact => {
    const avatar = contact.avatarUrl || contact.photos?.[0]?.url
      ? `<img src="${escapeAttribute(contact.avatarUrl || contact.photos[0].url)}" alt="" />`
      : escapeAttribute(String(contact.displayName || 'Q').charAt(0).toUpperCase());
    const saved = personIsSaved(contact.id) ? 'Perfil guardado' : 'Contacto por interacción';
    return `<button type="button" class="profile-activity-item" data-activity-profile="${escapeAttribute(contact.id)}">
      <span>${avatar}</span><span><strong data-i18n-ignore>${escapeAttribute(contact.displayName || 'Usuario Q Session')}</strong><small>${escapeAttribute(saved)}</small></span><b aria-hidden="true">›</b>
    </button>`;
  }).join('');
  const actions = state.profileActions.map(action => {
    const sender = action.sender || {};
    const avatar = sender.avatarUrl
      ? `<img src="${escapeAttribute(sender.avatarUrl)}" alt="" />`
      : escapeAttribute(String(sender.displayName || 'Q').charAt(0).toUpperCase());
    const gift = action.gift ? `${action.gift.emoji || '◇'} ${action.gift.label || 'Un detalle'} · ` : '';
    return `<button type="button" class="profile-activity-item${action.readAt ? '' : ' unread'}" data-activity-profile="${escapeAttribute(sender.id)}"${action.conversationId ? ` data-activity-conversation="${escapeAttribute(action.conversationId)}"` : ''}${action.roomCode ? ` data-activity-room="${escapeAttribute(action.roomCode)}"` : ''}>
      <span>${avatar}</span><span><strong><span data-i18n-ignore>${escapeAttribute(sender.displayName || 'Usuario Q Session')}</span> <span>${escapeAttribute(profileActionDescription(action))}</span></strong><small>${escapeAttribute(gift)}${escapeAttribute(profileActionTime(action.createdAt))}</small></span><b aria-hidden="true">›</b>
    </button>`;
  }).join('');
  list.innerHTML = `${contacts ? `<section class="profile-activity-group"><h3>Contactos conservados</h3>${contacts}</section>` : ''}${actions ? `<section class="profile-activity-group"><h3>Actividad reciente</h3>${actions}</section>` : ''}`;
  window.QSessionI18n?.applyTranslations(list);
}

async function openProfileActivityItem(item) {
  byId('profileActivityDialog').close();
  if (item.dataset.activityRoom) {
    const code = item.dataset.activityRoom.toUpperCase();
    if (activePublicChatCode() === code) {
      showView('chat');
      setChatMode('public', {userInitiated: true});
      return;
    }
    showView('live');
    setHomeSessionAction('join');
    byId('roomCode').value = code;
    setStatus(byId('joinStatus'), `Invitación al chat de la sala ${code}. Entra a la transmisión para conversar.`);
    byId('roomCode').focus();
    return;
  }
  if (item.dataset.activityConversation) {
    state.chatMode = 'private';
    state.chatModeChosen = true;
    showView('chat');
    await loadPrivateConversations({quiet: true});
    await openPrivateConversation(item.dataset.activityConversation);
    return;
  }
  showView('people');
  await openPersonActions(item.dataset.activityProfile);
}

function notifyNativeProfileAction(action) {
  if (!action || !['message', 'call'].includes(action.type) || action.readAt) return;
  const bridge = window.QSessionNativeBridge;
  if (typeof bridge?.showSocialNotification !== 'function') return;
  const senderName = action.sender?.displayName || 'Usuario Q Session';
  const body = action.type === 'call'
    ? 'Llamada privada entrante'
    : 'Te envió un mensaje privado';
  try {
    bridge.showSocialNotification(
      action.type,
      String(action.id || ''),
      String(action.conversationId || ''),
      senderName,
      body,
    );
  } catch { /* La actividad seguirá visible dentro de Q Session. */ }
}

function stopProfileActivityRealtime() {
  if (state.profileActivityRealtimeRetry) clearTimeout(state.profileActivityRealtimeRetry);
  state.profileActivityRealtimeRetry = null;
  const socket = state.profileActivityRealtimeSocket;
  state.profileActivityRealtimeSocket = null;
  state.profileActivityRealtimeChannel = '';
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Sesión finalizada');
}

function connectProfileActivityRealtime(realtime) {
  if (!state.account || !realtime?.token || !realtime?.channel || typeof WebSocket === 'undefined') return;
  const expectedChannel = `profile:${state.profile?.id || ''}`;
  if (realtime.channel !== expectedChannel) return;
  if (state.profileActivityRealtimeSocket?.readyState <= WebSocket.OPEN
      && state.profileActivityRealtimeChannel === expectedChannel) return;
  stopProfileActivityRealtime();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/api/realtime?channel=${encodeURIComponent(realtime.channel)}&token=${encodeURIComponent(realtime.token)}`;
  const socket = new WebSocket(url);
  state.profileActivityRealtimeSocket = socket;
  state.profileActivityRealtimeChannel = expectedChannel;
  socket.addEventListener('message', event => {
    if (state.profileActivityRealtimeSocket !== socket) return;
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (['private-message', 'private-call', 'private-conversation'].includes(payload.type)) {
      void loadProfileActivity({quiet: true, notify: true});
      if (payload.type !== 'private-conversation') void loadPrivateConversations({quiet: true});
    }
  });
  socket.addEventListener('close', () => {
    if (state.profileActivityRealtimeSocket !== socket) return;
    state.profileActivityRealtimeSocket = null;
    state.profileActivityRealtimeChannel = '';
    if (state.account) state.profileActivityRealtimeRetry = setTimeout(() => void loadProfileActivity({quiet: true}), 3000);
  });
}

let registeredNativePushToken = '';

async function registerNativePushToken(detail = {}) {
  if (!state.account) return;
  const token = String(detail.token || '').trim();
  if (detail.platform !== 'android' || token.length < 32 || token.length > 4096 || token === registeredNativePushToken) return;
  try {
    await api('/api/push/devices', {
      method: 'PUT',
      body: JSON.stringify({token, platform: 'android'}),
    });
    registeredNativePushToken = token;
  } catch { /* El canal en tiempo real continúa funcionando mientras la app esté activa. */ }
}

window.addEventListener('qsession-native-push-token', event => {
  void registerNativePushToken(event?.detail || {});
});

function requestNativeSocialNotifications() {
  try { window.QSessionNativeBridge?.requestNotificationPermission?.(); } catch { /* Sólo Android expone este permiso. */ }
  try { window.QSessionNativeBridge?.requestPushToken?.(); } catch { /* Firebase sólo existe en Android. */ }
}

async function loadProfileActivity({quiet = false, notify = true} = {}) {
  if (!state.account) return;
  try {
    const result = await api('/api/profile-actions?limit=100');
    const actions = result.actions || [];
    if (state.profileActivityInitialized && notify) {
      actions.forEach(action => {
        if (!state.profileActivitySeenIds.has(action.id)) notifyNativeProfileAction(action);
      });
    }
    actions.forEach(action => state.profileActivitySeenIds.add(action.id));
    state.profileActivityInitialized = true;
    state.profileActions = actions;
    state.profileContacts = result.contacts || [];
    state.profileActivityUnread = result.unreadCount || 0;
    if (state.profile && Array.isArray(result.savedProfileIds)) state.profile.savedProfileIds = result.savedProfileIds;
    renderProfileActivity();
    renderProfileActivityBadge();
    connectProfileActivityRealtime(result.realtime);
  } catch (error) {
    if (!quiet) toast(error.message);
  }
}

function stopProfileActivityPolling() {
  if (state.profileActivityTimer) clearInterval(state.profileActivityTimer);
  state.profileActivityTimer = null;
  stopProfileActivityRealtime();
}

function startProfileActivityPolling() {
  if (state.profileActivityTimer) clearInterval(state.profileActivityTimer);
  state.profileActivityTimer = null;
  if (!state.account) return;
  state.profileActivityTimer = setInterval(() => {
    if (isCdnOnlyAudience()) return;
    void loadProfileActivity({quiet: true});
  }, 15000);
}

async function openProfileActivity() {
  if (!state.account) {
    showView('profile');
    toast('Inicia sesión para ver tu actividad.');
    return;
  }
  await loadProfileActivity();
  const dialog = byId('profileActivityDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  const unreadIds = state.profileActions.filter(action => !action.readAt).map(action => action.id);
  if (unreadIds.length) {
    await api('/api/profile-actions/read', {method: 'POST', body: JSON.stringify({actionIds: unreadIds})}).catch(() => {});
    const readAt = new Date().toISOString();
    state.profileActions.forEach(action => { if (unreadIds.includes(action.id)) action.readAt = readAt; });
    state.profileActivityUnread = 0;
    renderProfileActivityBadge();
  }
}

function chatViewIsVisible() {
  return !byId('view-chat').hidden;
}

function activePublicChatCode() {
  if (!state.mediaConnected || !state.mediaRoom) return '';
  if (state.mediaRoomCode !== state.currentRoomCode) return '';
  return state.currentRoomCode.length === 6 ? state.currentRoomCode : '';
}

function publicChatParticipantCount() {
  if (!activePublicChatCode()) return 0;
  return Math.max(1, Number(state.roomChatParticipantCount) || mediaParticipantCount());
}

function publicChatPresenceCopy(count = publicChatParticipantCount()) {
  return count === 1 ? '1 persona conectada' : `${count} personas conectadas`;
}

function updatePublicChatCallControls() {
  const connected = false;
  byId('mutePublicChatMic').disabled = !connected;
  byId('openPublicChatMic').disabled = !connected;
  byId('publicChatPushToTalk').disabled = !connected || state.publicChatMicOpen;
  byId('mutePublicChatMic').classList.toggle('is-active', connected && !state.publicChatMicOpen && !state.publicChatPushActive);
  byId('openPublicChatMic').classList.toggle('is-active', state.publicChatMicOpen);
  byId('publicChatPushToTalk').classList.toggle('is-active', state.publicChatPushActive);
  byId('publicChatAudioSummary').textContent = !connected
    ? 'Usa la voz en un chat privado o un grupo de hasta 10 personas'
    : state.publicChatMicOpen
      ? 'Micrófono abierto'
      : state.publicChatPushActive
        ? 'Hablando ahora'
        : 'Micrófono silenciado';
}

function setPublicChatCallStatus(message, error = false) {
  setStatus(byId('publicChatCallStatus'), message, error);
}

async function setPublicChatMicrophone(enabled, {push = false} = {}) {
  if (enabled) {
    state.publicChatPushActive = false;
    state.publicChatMicOpen = false;
    updatePublicChatCallControls();
    setPublicChatCallStatus('El micrófono de la transmisión es del DJ. Habla desde un chat privado o un grupo de hasta 10 personas.');
    return;
  }
  const room = state.mediaRoom;
  if (!room || !state.mediaConnected || !activePublicChatCode()) return;
  try {
    await room.localParticipant.setMicrophoneEnabled(enabled, enabled ? {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    } : undefined);
    if (push) state.publicChatPushActive = enabled;
    else state.publicChatMicOpen = enabled;
    updatePublicChatCallControls();
    setPublicChatCallStatus(enabled
      ? (push ? 'Te escuchan mientras mantienes presionado.' : 'Micrófono abierto para las personas de esta sala.')
      : 'Micrófono silenciado. Sigues escuchando y escribiendo.');
  } catch (error) {
    state.publicChatPushActive = false;
    state.publicChatMicOpen = false;
    updatePublicChatCallControls();
    setPublicChatCallStatus(error?.name === 'NotAllowedError'
      ? 'No autorizaste el micrófono.'
      : error.message || 'Esta sala no autorizó el micrófono del chat.', true);
  }
}

async function mutePublicChatMicrophone() {
  state.publicChatPushActive = false;
  await setPublicChatMicrophone(false);
}

async function startPublicChatPushToTalk() {
  if (state.publicChatMicOpen || state.publicChatPushActive) return;
  state.publicChatPushActive = true;
  updatePublicChatCallControls();
  await setPublicChatMicrophone(true, {push: true});
}

async function stopPublicChatPushToTalk() {
  if (!state.publicChatPushActive || state.publicChatMicOpen) return;
  state.publicChatPushActive = false;
  updatePublicChatCallControls();
  await setPublicChatMicrophone(false, {push: true});
}

function publicChatDirectoryEntries() {
  const activeProfiles = [...activeRoomProfiles().values()].filter(profile => profile.visible && profile.social?.allowMessages);
  const activeIds = new Set(activeProfiles.map(profile => profile.id));
  const entries = activeProfiles.map(profile => ({profile, active: true, contact: personIsSaved(profile.id)}));
  state.chatDirectoryContacts.forEach(profile => {
    if (!profile?.visible || activeIds.has(profile.id)) return;
    entries.push({profile, active: false, contact: true});
  });
  return entries.sort((left, right) => (
    Number(right.profile.id === state.profile?.id) - Number(left.profile.id === state.profile?.id)
    || Number(right.active) - Number(left.active)
    || String(left.profile.displayName || '').localeCompare(String(right.profile.displayName || ''))
  ));
}

function renderPublicChatDirectory() {
  const list = byId('publicChatPeopleList');
  const activeCode = activePublicChatCode();
  const total = publicChatParticipantCount();
  byId('publicChatPeopleCount').textContent = activeCode ? publicChatPresenceCopy(total) : 'Nadie conectado todavía';
  const inviteDisabled = !activeCode || state.currentRoom?.allowPublicChat === false;
  ['copyChatInviteLink', 'showChatInviteQr', 'focusChatInviteContact'].forEach(id => { byId(id).disabled = inviteDisabled; });
  if (!activeCode) {
    list.innerHTML = '<p>Entra a la sala para ver quién está conectado.</p>';
    return;
  }

  const query = state.chatDirectoryQuery.trim().toLocaleLowerCase();
  const entries = publicChatDirectoryEntries().filter(({profile}) => (
    !query || String(profile.displayName || '').toLocaleLowerCase().includes(query)
  ));
  if (!entries.length) {
    list.innerHTML = `<p>${query ? 'No encontramos ese nombre entre las personas y contactos.' : 'Las personas conectadas todavía no comparten un perfil visible.'}</p>`;
  } else {
    list.innerHTML = entries.map(({profile, active}) => {
      const own = profile.id === state.profile?.id;
      const avatarUrl = profile.avatarUrl || profile.photos?.[0]?.url;
      const avatar = avatarUrl
        ? `<span class="public-chat-person-avatar"><img src="${escapeAttribute(avatarUrl)}" alt="" /></span>`
        : `<span class="public-chat-person-avatar">${escapeAttribute(String(profile.displayName || 'Q').charAt(0).toUpperCase())}</span>`;
      const status = own ? 'Tú · en el chat ahora' : active ? 'En el chat ahora' : 'Contacto guardado';
      const action = own ? '' : active
        ? (profile.social?.allowMessages ? `<button class="public-chat-person-action" type="button" data-chat-directory-message="${escapeAttribute(profile.id)}">Mensaje</button>` : '')
        : `<button class="public-chat-person-action" type="button" data-chat-directory-invite="${escapeAttribute(profile.id)}">Invitar</button>`;
      return `<div class="public-chat-person${active ? ' is-active' : ''}">
        ${avatar}
        <button class="public-chat-person-copy" type="button" data-chat-directory-profile="${escapeAttribute(profile.id)}"><strong data-i18n-ignore>${escapeAttribute(profile.displayName || 'Usuario Q Session')}</strong><small>${escapeAttribute(status)}</small></button>
        ${action}
      </div>`;
    }).join('');
  }
  const visibleActiveCount = [...activeRoomProfiles().values()].filter(profile => profile.visible && profile.social?.allowMessages).length;
  const privateCount = Math.max(0, total - visibleActiveCount);
  if (!query && privateCount > 0) {
    setStatus(byId('publicChatDirectoryStatus'), `${privateCount} ${privateCount === 1 ? 'persona no aparece' : 'personas no aparecen'} por sus preferencias de privacidad o chat.`);
  } else if (!state.chatDirectoryLoading) {
    setStatus(byId('publicChatDirectoryStatus'), 'Busca un contacto y pulsa “Invitar” para avisarle dentro de Q Session.');
  }
  window.QSessionI18n?.applyTranslations(list);
}

async function loadChatDirectoryContacts({quiet = false} = {}) {
  if (state.chatDirectoryLoading || !state.profile?.social?.allowMessages) return;
  state.chatDirectoryLoading = true;
  if (!quiet) setStatus(byId('publicChatDirectoryStatus'), 'Actualizando personas y contactos…');
  try {
    const result = await api('/api/chat/contacts');
    state.chatDirectoryContacts = result.contacts || [];
    renderPublicChatDirectory();
    if (!quiet) setStatus(byId('publicChatDirectoryStatus'), 'Lista actualizada.');
  } catch (error) {
    setStatus(byId('publicChatDirectoryStatus'), error.message, true);
  } finally {
    state.chatDirectoryLoading = false;
  }
}

function chatInvitationPayload() {
  const code = activePublicChatCode();
  const name = state.currentRoom?.name || 'Sesión Q Session';
  const url = code ? `${location.origin}/join/${encodeURIComponent(code)}#chat` : '';
  return {
    code,
    name,
    url,
    title: `Invitación al chat · ${name}`,
    text: `Únete al chat de ${name}\nSala: ${code}\n${url}`,
  };
}

function renderChatInvitationQr(url) {
  const container = byId('chatInviteQr');
  container.replaceChildren();
  if (!url || !window.ZXingBrowser?.BrowserQRCodeSvgWriter) {
    container.textContent = 'QR';
    return;
  }
  try {
    const writer = new window.ZXingBrowser.BrowserQRCodeSvgWriter();
    writer.writeToDom(container, url, 260, 260);
  } catch {
    container.textContent = 'QR';
  }
}

function renderPrivateContactInvitationQr(url) {
  const container = byId('privateContactInviteQr');
  container.replaceChildren();
  if (!url || !window.ZXingBrowser?.BrowserQRCodeSvgWriter) {
    container.textContent = 'QR';
    return;
  }
  try {
    const writer = new window.ZXingBrowser.BrowserQRCodeSvgWriter();
    writer.writeToDom(container, url, 260, 260);
  } catch {
    container.textContent = 'QR';
  }
}

function openPrivateContactInviteDialog({code = ''} = {}) {
  if (!state.account) {
    showView('profile');
    toast('Inicia sesión para usar una invitación de contacto privado.');
    return false;
  }
  if (!state.profile?.social?.allowMessages) {
    showView('chat');
    toast('Activa Mensajes para conectar por enlace, código o QR.');
    return false;
  }
  const dialog = byId('privateContactInviteDialog');
  if (code) byId('privateContactInviteInput').value = normalizePrivateContactInviteCode(code);
  setStatus(byId('privateContactInviteStatus'), '');
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  else dialog.setAttribute('open', '');
  return true;
}

function closePrivateContactInviteDialog() {
  const dialog = byId('privateContactInviteDialog');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

async function createPrivateContactInvitation() {
  const status = byId('privateContactInviteStatus');
  const button = byId('createPrivateContactInvite');
  button.disabled = true;
  setStatus(status, 'Creando una invitación privada…');
  try {
    const result = await api('/api/private-chat-invitations', {method: 'POST', body: '{}'});
    const invitation = result.invitation || {};
    invitation.url = new URL(invitation.url || `/?chatInvite=${encodeURIComponent(invitation.code || '')}#chat`, location.origin).href;
    state.privateContactInvitation = invitation;
    byId('privateContactInviteCode').textContent = invitation.code || '--------';
    byId('privateContactInviteLink').value = invitation.url;
    const expiresAt = new Date(invitation.expiresAt || '');
    byId('privateContactInviteExpiry').textContent = Number.isNaN(expiresAt.getTime())
      ? 'Válido durante 24 horas'
      : `Válido hasta ${expiresAt.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})}`;
    renderPrivateContactInvitationQr(invitation.url);
    byId('privateContactInviteResult').hidden = false;
    setStatus(status, 'Comparte solamente con la persona que quieres agregar. Se puede usar una sola vez.');
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    button.disabled = false;
  }
}

function clearPrivateContactInviteFromUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('chatInvite');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash || '#chat'}`);
}

async function redeemPrivateContactInvitation(rawCode, {fromSharedLink = false} = {}) {
  const status = byId('privateContactInviteStatus');
  const code = privateContactInviteCodeFromSharedEntry(rawCode);
  if (!code) {
    setStatus(status, 'Escribe un código privado de ocho caracteres.', true);
    return false;
  }
  byId('privateContactInviteInput').value = code;
  setStatus(status, 'Verificando la invitación…');
  try {
    const result = await api('/api/private-chat-invitations/redeem', {
      method: 'POST',
      body: JSON.stringify({code}),
    });
    state.requestedPrivateInviteProcessed = true;
    state.requestedPrivateInviteCode = '';
    clearPrivateContactInviteFromUrl();
    closePrivateContactInviteDialog();
    setChatMode('private', {userInitiated: true});
    showView('chat');
    await loadPrivateConversations({quiet: true});
    await openPrivateConversation(result.conversation.id);
    toast(`Contacto privado conectado con ${result.conversation.title || 'Q Session'}.`);
    return true;
  } catch (error) {
    if (fromSharedLink) openPrivateContactInviteDialog({code});
    setStatus(status, error.message, true);
    return false;
  }
}

async function redeemRequestedPrivateContactInvite() {
  const code = privateContactInviteCodeFromSharedEntry(state.requestedPrivateInviteCode);
  if (!code || state.requestedPrivateInviteProcessed) return;
  if (!state.account) {
    showView('chat');
    toast('Inicia sesión y activa Mensajes para aceptar esta invitación privada.');
    return;
  }
  if (!state.profile?.social?.allowMessages) {
    showView('chat');
    toast('Activa Mensajes para aceptar la invitación privada.');
    return;
  }
  state.requestedPrivateInviteProcessed = true;
  openPrivateContactInviteDialog({code});
  const accepted = await redeemPrivateContactInvitation(code, {fromSharedLink: true});
  if (!accepted) state.requestedPrivateInviteProcessed = true;
}

async function sharePrivateContactInvitation() {
  const invitation = state.privateContactInvitation;
  if (!invitation?.code || !invitation.url) return;
  const title = 'Contacto privado · Q Session';
  const text = `Conectémonos por chat privado en Q Session\nCódigo: ${invitation.code}\n${invitation.url}`;
  try {
    if (typeof window.QSessionNativeBridge?.shareRoom === 'function') window.QSessionNativeBridge.shareRoom(title, text);
    else if (navigator.share) await navigator.share({title, text, url: invitation.url});
    else await copyRoomShareValue(text, 'Invitación privada copiada.');
  } catch (error) {
    if (error?.name !== 'AbortError') toast('No fue posible compartir la invitación privada.');
  }
}

function openChatInviteDialog() {
  const payload = chatInvitationPayload();
  if (!payload.code) return;
  byId('chatInviteRoomCode').textContent = payload.code;
  byId('chatInviteRoomName').textContent = payload.name;
  byId('chatInviteLink').value = payload.url;
  renderChatInvitationQr(payload.url);
  const dialog = byId('chatInviteDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeChatInviteDialog() {
  const dialog = byId('chatInviteDialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function shareChatInvitation() {
  const payload = chatInvitationPayload();
  if (!payload.code) return;
  try {
    if (typeof window.QSessionNativeBridge?.shareRoom === 'function') {
      window.QSessionNativeBridge.shareRoom(payload.title, payload.text);
    } else if (navigator.share) {
      await navigator.share({title: payload.title, text: payload.text, url: payload.url});
    } else {
      await copyRoomShareValue(payload.text, 'Invitación al chat copiada.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast('No fue posible compartir la invitación al chat.');
  }
}

async function openChatDirectoryMessage(profileId) {
  if (!profileId) return;
  setStatus(byId('publicChatDirectoryStatus'), 'Abriendo la conversación privada…');
  try {
    const result = await api('/api/private-conversations', {
      method: 'POST',
      body: JSON.stringify({type: 'direct', memberProfileIds: [profileId]}),
    });
    setChatMode('private', {userInitiated: true});
    await loadPrivateConversations({quiet: true});
    await openPrivateConversation(result.conversation.id);
  } catch (error) {
    setStatus(byId('publicChatDirectoryStatus'), error.message, true);
  }
}

async function sendChatPlatformInvitation(profileId) {
  const payload = chatInvitationPayload();
  const profile = state.chatDirectoryContacts.find(contact => contact.id === profileId);
  if (!payload.code || !profile) return;
  setStatus(byId('publicChatDirectoryStatus'), `Enviando invitación a ${profile.displayName || 'tu contacto'}…`);
  try {
    await api(`/api/profiles/${encodeURIComponent(profileId)}/actions`, {
      method: 'POST',
      body: JSON.stringify({type: 'room-invite', roomCode: payload.code}),
    });
    setStatus(byId('publicChatDirectoryStatus'), `Invitación enviada a ${profile.displayName || 'tu contacto'} dentro de Q Session.`);
  } catch (error) {
    setStatus(byId('publicChatDirectoryStatus'), error.message, true);
  }
}

function resetPublicChatMessages() {
  state.roomChatParticipantCount = 0;
  renderChatMessages([]);
  setStatus(byId('chatMessageStatus'), '');
}

function syncChatContext() {
  const activeCode = activePublicChatCode();
  const context = byId('chatContextStrip');
  context.classList.toggle('is-room-chat', Boolean(activeCode));
  renderProfileAvatar('chatIdentityInitial');
  if (activeCode) {
    byId('chatContextLabel').textContent = 'CHAT ACTIVO AHORA';
    byId('chatIdentityName').textContent = state.currentRoom?.name || 'Sesión Q Session';
    const identity = state.profile?.displayName || 'Oyente';
    byId('chatIdentityPrivacy').textContent = `${identity} · sala ${activeCode} · ${publicChatPresenceCopy()}`;
    byId('publicChatTabStatus').textContent = 'AHORA';
    return;
  }
  byId('chatContextLabel').textContent = 'TUS CONVERSACIONES';
  byId('chatIdentityName').textContent = state.profile?.displayName || 'Mi perfil Q Session';
  byId('chatIdentityPrivacy').textContent = 'Tus conversaciones privadas permanecen guardadas.';
  byId('publicChatTabStatus').textContent = 'SALA';
}

function stopChatPolling() {
  if (state.chatPollTimer) clearInterval(state.chatPollTimer);
  state.chatPollTimer = null;
  const socket = state.chatRealtimeSocket;
  state.chatRealtimeSocket = null;
  state.chatRealtimeChannel = '';
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Cambio de conversación');
}

function realtimeChatChannel() {
  if (state.chatMode === 'public') {
    const code = activePublicChatCode();
    return code ? `room:${code}` : '';
  }
  return state.activePrivateConversationId ? `private:${state.activePrivateConversationId}` : '';
}

function mergePublicMessage(message) {
  if (!message?.id || state.publicMessageRoomCode !== activePublicChatCode()) return;
  const position = state.publicMessageHistory.findIndex(item => item.id === message.id);
  if (position >= 0) state.publicMessageHistory[position] = message;
  else state.publicMessageHistory.push(message);
  if (state.publicMessageHistory.length > 100) state.publicMessageHistory.splice(0, state.publicMessageHistory.length - 100);
  renderChatMessages(state.publicMessageHistory);
}

function mergeRealtimePrivateMessage(conversationId, message) {
  if (!conversationId || !message?.id) return;
  const cached = state.privateMessageHistory.get(conversationId) || {messages: [], hasMore: false, expanded: false};
  cached.messages = mergePrivateMessageHistory(cached.messages, [message]);
  state.privateMessageHistory.set(conversationId, cached);
  if (state.activePrivateConversationId === conversationId) {
    renderPrivateMessageCollection(cached.messages);
    byId('loadEarlierPrivateMessages').hidden = !cached.hasMore;
  }
}

function startChatFallbackPolling() {
  if (state.chatPollTimer) clearInterval(state.chatPollTimer);
  state.chatPollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || state.chatRealtimeSocket?.readyState === WebSocket.OPEN) return;
    if (state.chatMode !== 'public') {
      loadPrivateConversations({quiet: true});
      if (state.activePrivateConversationId) loadPrivateChatMessages({quiet: true});
    } else {
      loadChatMessages({quiet: true});
    }
  }, 15000);
}

function connectChatRealtime(realtime) {
  if (!realtime?.token || !realtime?.channel || typeof WebSocket === 'undefined') {
    startChatFallbackPolling();
    return;
  }
  const expectedChannel = realtimeChatChannel();
  if (!expectedChannel || expectedChannel !== realtime.channel || !chatViewIsVisible()) return;
  if (state.chatRealtimeSocket?.readyState <= WebSocket.OPEN && state.chatRealtimeChannel === expectedChannel) return;
  stopChatPolling();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/api/realtime?channel=${encodeURIComponent(realtime.channel)}&token=${encodeURIComponent(realtime.token)}`;
  const socket = new WebSocket(url);
  state.chatRealtimeSocket = socket;
  state.chatRealtimeChannel = realtime.channel;
  socket.addEventListener('open', () => {
    if (state.chatRealtimeSocket !== socket) return socket.close();
    if (state.chatPollTimer) clearInterval(state.chatPollTimer);
    state.chatPollTimer = null;
  });
  socket.addEventListener('message', event => {
    if (state.chatRealtimeSocket !== socket) return;
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type === 'room-message' && payload.channel === realtime.channel) mergePublicMessage(payload.message);
    if (payload.type === 'private-message' && payload.channel === realtime.channel) {
      mergeRealtimePrivateMessage(realtime.channel.slice('private:'.length), payload.message);
      void loadPrivateConversations({quiet: true});
    }
  });
  socket.addEventListener('close', () => {
    if (state.chatRealtimeSocket !== socket) return;
    state.chatRealtimeSocket = null;
    state.chatRealtimeChannel = '';
    if (chatViewIsVisible()) startChatFallbackPolling();
  });
  socket.addEventListener('error', () => {
    if (state.chatRealtimeSocket === socket) startChatFallbackPolling();
  });
}

function startChatPolling() {
  if (isCdnOnlyAudience() && state.chatMode === 'public') return;
  if (!chatViewIsVisible() || !state.profile?.social?.allowMessages) return;
  if (state.chatMode === 'public' && !activePublicChatCode()) return;
  startChatFallbackPolling();
}

function setCurrentRoom(code, room = null) {
  const previousRoomCode = state.currentRoomCode;
  state.currentRoomCode = normalizeRoomCode(code);
  state.currentRoom = room || (state.currentRoom?.code === state.currentRoomCode ? state.currentRoom : null);
  if (state.currentRoomCode !== previousRoomCode) {
    stopWaitingRoomMonitor();
    state.currentRoomAccessToken = '';
    resetPublicChatMessages();
  }
  if (state.currentRoomCode) sessionStorage.setItem('qsession-current-room', state.currentRoomCode);
  else sessionStorage.removeItem('qsession-current-room');
  if (state.currentRoomCode && state.currentRoomCode !== previousRoomCode) {
    state.chatMode = 'public';
    state.chatModeChosen = false;
  }
  syncPublicChatPanel();
}

function setMediaStatus(message, error = false) {
  setStatus(byId('mediaStatus'), message, error);
}

function formatConnectionRate(bitsPerSecond) {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '—';
  if (bitsPerSecond >= 1000000) return `${(bitsPerSecond / 1000000).toFixed(bitsPerSecond >= 10000000 ? 0 : 1)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

function connectionQualityCopy(value) {
  const quality = String(value || 'unknown').toLowerCase();
  if (quality.includes('excellent')) return 'Excelente';
  if (quality.includes('good')) return 'Buena';
  if (quality.includes('poor')) return 'Débil';
  if (quality.includes('lost')) return 'Sin señal';
  return 'Midiendo';
}

function connectionHealth(metrics = {}) {
  const quality = String(state.connectionQuality || '').toLowerCase();
  if (quality.includes('lost') || metrics.packetLoss >= 8 || metrics.rtt >= 650) return 'critical';
  if (quality.includes('poor') || metrics.packetLoss >= 3 || metrics.rtt >= 300) return 'warning';
  return metrics.measured || quality.includes('good') || quality.includes('excellent') ? 'stable' : 'measuring';
}

function renderConnectionMonitor(metrics = state.connectionLastMetrics || {}) {
  const monitor = byId('connectionMonitor');
  const health = connectionHealth(metrics);
  monitor.dataset.health = health;
  byId('connectionHealth').textContent = health === 'stable' ? 'Estable' : health === 'warning' ? 'Atención' : health === 'critical' ? 'Inestable' : 'Midiendo…';
  byId('connectionUpload').textContent = formatConnectionRate(metrics.upload);
  byId('connectionDownload').textContent = formatConnectionRate(metrics.download);
  const capacity = state.mediaRole === 'dj' ? metrics.outgoingCapacity : metrics.incomingCapacity;
  byId('connectionCapacity').textContent = formatConnectionRate(capacity);
  byId('connectionLatency').textContent = Number.isFinite(metrics.rtt) ? `${Math.round(metrics.rtt)} ms` : '—';
  byId('connectionLoss').textContent = Number.isFinite(metrics.packetLoss) ? `${metrics.packetLoss.toFixed(1)}%` : '—';
  byId('connectionQuality').textContent = connectionQualityCopy(state.connectionQuality);
  byId('connectionUploadBar').style.width = `${Math.max(2, Math.min(100, Math.round((metrics.upload || 0) / 2000000 * 100)))}%`;
  byId('connectionDownloadBar').style.width = `${Math.max(2, Math.min(100, Math.round((metrics.download || 0) / 2000000 * 100)))}%`;
  byId('connectionAdvice').textContent = health === 'critical'
    ? 'La red está perdiendo señal. Q Session prioriza el audio; apaga temporalmente la cámara si continúa.'
    : health === 'warning'
      ? 'La red está variando. El video reducirá calidad automáticamente para conservar el audio.'
      : health === 'stable'
        ? 'La conexión está estable y la transmisión fluye normalmente.'
        : 'Esperando suficientes datos para evaluar la transmisión.';
}

function connectionTrackEntries(room) {
  const entries = [];
  const append = (publications, direction, owner) => {
    if (typeof publications?.values !== 'function') return;
    let index = 0;
    for (const publication of publications.values()) {
      const track = publication?.track;
      if (typeof track?.getRTCStatsReport !== 'function') continue;
      entries.push({track, direction, key: `${direction}:${owner}:${publication.trackSid || publication.sid || `${track.kind}-${index}`}`});
      index += 1;
    }
  };
  append(room?.localParticipant?.trackPublications, 'out', 'local');
  for (const [identity, participant] of room?.remoteParticipants || []) append(participant.trackPublications, 'in', identity);
  return entries;
}

function connectionStatDelta(key, stat) {
  const timestamp = Number(stat.timestamp) || performance.now();
  const current = {
    timestamp,
    bytes: Number(stat.bytesSent ?? stat.bytesReceived) || 0,
    packets: Number(stat.packetsSent ?? stat.packetsReceived) || 0,
    lost: Number(stat.packetsLost) || 0,
  };
  const previous = state.connectionStatsPrevious.get(key);
  state.connectionStatsPrevious.set(key, current);
  if (!previous) return null;
  const seconds = (timestamp - previous.timestamp) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    bitrate: Math.max(0, current.bytes - previous.bytes) * 8 / seconds,
    packets: Math.max(0, current.packets - previous.packets),
    lost: Math.max(0, current.lost - previous.lost),
  };
}

async function sampleConnectionMonitor(room = state.mediaRoom) {
  if (!room || room !== state.mediaRoom || !state.mediaConnected || state.connectionMonitorBusy) return;
  state.connectionMonitorBusy = true;
  void refreshDjBroadcastAudience();
  try {
    const entries = connectionTrackEntries(room);
    const reports = await Promise.all(entries.map(async entry => {
      try {
        return {...entry, report: await entry.track.getRTCStatsReport()};
      } catch {
        return {...entry, report: null};
      }
    }));
    if (room !== state.mediaRoom || !state.mediaConnected) return;
    const metrics = {upload: 0, download: 0, outgoingCapacity: null, incomingCapacity: null, rtt: null, packetLoss: null, measured: false};
    let receivedPackets = 0;
    let sentPackets = 0;
    let incomingLost = 0;
    let outgoingLost = 0;
    const seenTransport = new Set();
    for (const entry of reports) {
      entry.report?.forEach(stat => {
        const key = `${entry.key}:${stat.id}`;
        if (entry.direction === 'out' && stat.type === 'outbound-rtp' && !stat.isRemote) {
          const delta = connectionStatDelta(key, stat);
          if (delta) {
            metrics.upload += delta.bitrate;
            sentPackets += delta.packets;
            metrics.measured = true;
          }
        } else if (entry.direction === 'in' && stat.type === 'inbound-rtp' && !stat.isRemote) {
          const delta = connectionStatDelta(key, stat);
          if (delta) {
            metrics.download += delta.bitrate;
            receivedPackets += delta.packets;
            incomingLost += delta.lost;
            metrics.measured = true;
          }
        } else if (entry.direction === 'out' && stat.type === 'remote-inbound-rtp') {
          const delta = connectionStatDelta(key, stat);
          if (delta) outgoingLost += delta.lost;
          const rtt = Number(stat.roundTripTime);
          if (Number.isFinite(rtt)) metrics.rtt = Math.max(metrics.rtt || 0, rtt * 1000);
        } else if (stat.type === 'candidate-pair' && (stat.selected || stat.nominated || stat.state === 'succeeded') && !seenTransport.has(stat.id)) {
          seenTransport.add(stat.id);
          const outgoing = Number(stat.availableOutgoingBitrate);
          const incoming = Number(stat.availableIncomingBitrate);
          const rtt = Number(stat.currentRoundTripTime);
          if (Number.isFinite(outgoing)) metrics.outgoingCapacity = Math.max(metrics.outgoingCapacity || 0, outgoing);
          if (Number.isFinite(incoming)) metrics.incomingCapacity = Math.max(metrics.incomingCapacity || 0, incoming);
          if (Number.isFinite(rtt)) metrics.rtt = Math.max(metrics.rtt || 0, rtt * 1000);
        }
      });
    }
    if (!metrics.incomingCapacity && Number.isFinite(Number(navigator.connection?.downlink))) metrics.incomingCapacity = Number(navigator.connection.downlink) * 1000000;
    if (!Number.isFinite(metrics.rtt) && Number.isFinite(Number(navigator.connection?.rtt))) metrics.rtt = Number(navigator.connection.rtt);
    const lost = state.mediaRole === 'dj' ? outgoingLost : incomingLost;
    const delivered = state.mediaRole === 'dj' ? sentPackets : receivedPackets;
    if (lost + delivered > 0) metrics.packetLoss = lost / (lost + delivered) * 100;
    state.connectionLastMetrics = metrics;
    window.QSessionAnalytics?.network?.(metrics);
    renderConnectionMonitor(metrics);
  } finally {
    state.connectionMonitorBusy = false;
  }
}

function startConnectionMonitor(room) {
  stopConnectionMonitor();
  state.connectionQuality = String(room?.localParticipant?.connectionQuality || 'unknown');
  state.connectionStatsPrevious.clear();
  state.connectionLastMetrics = null;
  byId('connectionMonitor').hidden = false;
  renderConnectionMonitor();
  void sampleConnectionMonitor(room);
  state.connectionMonitorTimer = setInterval(() => void sampleConnectionMonitor(room), 2000);
}

function stopConnectionMonitor() {
  if (state.connectionMonitorTimer) clearInterval(state.connectionMonitorTimer);
  state.connectionMonitorTimer = null;
  state.connectionMonitorBusy = false;
  state.connectionStatsPrevious.clear();
  state.connectionLastMetrics = null;
  state.connectionQuality = 'unknown';
  byId('connectionMonitor').hidden = true;
  byId('connectionMonitor').open = false;
}

function resetCameraFraming() {
  state.cameraZoomTrack = null;
  state.cameraZoomRange = null;
  const control = byId('cameraFramingControl');
  const zoomGroup = byId('cameraZoomGroup');
  const select = byId('cameraZoom');
  control.hidden = true;
  zoomGroup.hidden = true;
  zoomGroup.open = false;
  select.disabled = true;
  select.value = '1';
  byId('cameraZoomSummary').textContent = '1×';
  [...select.options].forEach(option => { option.disabled = false; });
  byId('cameraZoomStatus').textContent = 'Disponible si la cámara permite zoom real.';
}

function cameraFramingCopy(mode) {
  if (mode === 'near') return 'Cerca aproxima la imagen para un primer plano.';
  if (mode === 'medium') return 'Medio equilibra tu rostro y el espacio alrededor.';
  return 'Lejos muestra el encuadre completo y el mayor ángulo disponible.';
}

function renderCameraSettingsSummary() {
  const rawCamera = byId('cameraDeviceLabel')?.textContent?.trim() || '';
  const camera = !rawCamera || rawCamera === 'Buscando cámaras…'
    ? localizedUiText('Cámara preparada')
    : rawCamera;
  const orientation = localizedUiText(state.cameraOrientation === 'portrait' ? 'Vertical' : 'Horizontal');
  const framing = localizedUiText(state.cameraFraming === 'near' ? 'Cerca' : state.cameraFraming === 'medium' ? 'Medio' : 'Lejos');
  byId('cameraSettingsSelection').textContent = `${camera} · ${orientation} · ${framing}`;
}

const CAMERA_EFFECT_NAMES = Object.freeze({
  none: 'Natural', qfauna: 'Q‑Fauna Jaguar', halo: 'Resonance Halo', veil: 'Quantum Veil',
  field: 'Resonance Field', photons: 'Photon Garden', nocturne: 'Nocturne 27', spectral: 'Spectral Ink',
});

function renderCameraEffectControl() {
  if (!(state.cameraEffect in CAMERA_EFFECT_NAMES)) state.cameraEffect = 'none';
  all('[data-camera-effect]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cameraEffect === state.cameraEffect)));
  byId('cameraEffectSelection').textContent = CAMERA_EFFECT_NAMES[state.cameraEffect];
  byId('cameraEffectIntensity').value = String(state.cameraEffectIntensity);
  byId('cameraEffectIntensityValue').textContent = `${state.cameraEffectIntensity}%`;
}

function applyCameraEffect(effect, intensity = state.cameraEffectIntensity) {
  state.cameraEffect = effect in CAMERA_EFFECT_NAMES ? effect : 'none';
  state.cameraEffectIntensity = Math.max(0, Math.min(100, Number(intensity) || 0));
  state.cameraEffectEngine?.setEffect(state.cameraEffect, state.cameraEffectIntensity / 100);
  try {
    localStorage.setItem('qsession-camera-effect', state.cameraEffect);
    localStorage.setItem('qsession-camera-effect-intensity', String(state.cameraEffectIntensity));
  } catch { /* El efecto continúa aunque no se guarde la preferencia. */ }
  renderCameraEffectControl();
  byId('cameraEffectStatus').textContent = state.localCameraEnabled
    ? `${CAMERA_EFFECT_NAMES[state.cameraEffect]} aplicado a la señal en vivo.`
    : `${CAMERA_EFFECT_NAMES[state.cameraEffect]} preparado para la próxima activación de cámara.`;
}

function applyStageCameraFraming(mode) {
  const framing = CAMERA_FRAMINGS.has(mode) ? mode : 'far';
  byId('mediaStage').dataset.cameraFraming = framing;
}

function applyLocalCameraFraming(mode, {remember = false} = {}) {
  const framing = CAMERA_FRAMINGS.has(mode) ? mode : 'far';
  if (state.mediaRole === 'dj') applyStageCameraFraming(framing);
  all('button[data-camera-framing]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cameraFraming === framing)));
  byId('cameraFramingStatus').textContent = cameraFramingCopy(framing);
  renderCameraSettingsSummary();
  if (!remember) return;
  state.cameraFraming = framing;
  try { localStorage.setItem('qsession-camera-framing', framing); } catch { /* La cámara continúa sin guardar la preferencia. */ }
  if (!byId('view-people').hidden) renderPeople();
}

async function setLocalCameraFraming(mode) {
  applyLocalCameraFraming(mode, {remember: true});
  if (state.mediaConnected && state.localCameraEnabled && typeof state.mediaRoom?.localParticipant?.setAttributes === 'function') {
    const publication = state.mediaRoom.localParticipant.getTrackPublication?.(window.LivekitClient.Track.Source.Camera);
    await publishLocalCameraDeliveryAttributes(state.mediaRoom, publication?.track).catch(() => undefined);
  }
  setMediaStatus(`Plano ${state.cameraFraming === 'far' ? 'lejano' : state.cameraFraming === 'medium' ? 'medio' : 'cercano'} activo.`);
}

function participantCameraFraming(participant) {
  const mode = participant?.attributes?.['qsession.cameraFraming'];
  return CAMERA_FRAMINGS.has(mode) ? mode : 'far';
}

function devicePrefersPortraitCamera() {
  if (navigator.userAgentData?.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) return true;
  return window.matchMedia?.('(pointer: coarse)')?.matches === true && Math.min(screen.width, screen.height) <= 820;
}

function cameraDeviceClass() {
  return devicePrefersPortraitCamera() ? 'mobile' : 'desktop';
}

function automaticCameraOrientation() {
  return devicePrefersPortraitCamera() ? 'portrait' : 'landscape';
}

function refreshAutomaticCameraOrientation({force = false} = {}) {
  if (!force && state.cameraOrientationMode === 'manual') return state.cameraOrientation;
  if (force) state.cameraOrientationMode = 'automatic';
  const automatic = automaticCameraOrientation();
  applyLocalCameraOrientation(automatic);
  return automatic;
}

function cameraOrientationCopy(orientation) {
  return orientation === 'portrait'
    ? 'Vertical · ideal para teléfonos y video a pantalla completa.'
    : 'Horizontal · ideal para computadores, laptops y escenas amplias.';
}

function applyLocalCameraOrientation(orientation, {remember = false} = {}) {
  const next = CAMERA_ORIENTATIONS.has(orientation) ? orientation : initialCameraOrientation();
  if (remember) state.cameraOrientationMode = 'manual';
  state.cameraOrientation = next;
  all('button[data-camera-orientation]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.cameraOrientation === next));
  });
  byId('cameraOrientationDefault').textContent = state.cameraOrientationMode === 'manual'
    ? 'Selección manual'
    : devicePrefersPortraitCamera() ? 'Teléfono: vertical automático' : 'Computador: horizontal automático';
  byId('cameraOrientationStatus').textContent = cameraOrientationCopy(next);
  renderCameraSettingsSummary();
  if (state.mediaRole === 'dj' && state.primaryVideoTrack) {
    syncPrimaryVideoAspect(state.primaryVideoTrack, byId('liveVideo'), next);
  }
  if (remember) {
    try {
      localStorage.setItem(CAMERA_ORIENTATION_KEY, next);
      localStorage.setItem(CAMERA_ORIENTATION_MODE_KEY, 'manual');
    } catch { /* La cámara continúa sin guardar la preferencia. */ }
  }
  if (!byId('view-people').hidden) renderPeople();
}

function trackCameraDimensions(track, video = null) {
  const settings = track?.mediaStreamTrack?.getSettings?.() || {};
  const width = Number(video?.videoWidth || settings.width);
  const height = Number(video?.videoHeight || settings.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {width, height};
}

function trackCameraOrientation(track, video = null) {
  const dimensions = trackCameraDimensions(track, video);
  if (!dimensions) return '';
  return dimensions.width >= dimensions.height ? 'landscape' : 'portrait';
}

function participantCameraOrientation(participant, track = null, video = null) {
  const deviceClass = participant?.attributes?.['qsession.cameraDeviceClass'];
  // The sender device defines the delivery format. This takes precedence over
  // stale manual preferences and over sensor dimensions: Android cameras can
  // expose a landscape sensor while the phone and its intended frame are
  // portrait. Computers always keep their native 16:9 presentation.
  if (deviceClass === 'mobile') return 'portrait';
  if (deviceClass === 'desktop') return 'landscape';
  const orientation = participant?.attributes?.['qsession.cameraOrientation'];
  if (CAMERA_ORIENTATIONS.has(orientation)) return orientation;
  const declaredWidth = Number(participant?.attributes?.['qsession.cameraFrameWidth']);
  const declaredHeight = Number(participant?.attributes?.['qsession.cameraFrameHeight']);
  if (declaredWidth > 0 && declaredHeight > 0) return declaredWidth >= declaredHeight ? 'landscape' : 'portrait';
  const measured = trackCameraOrientation(track, video);
  if (CAMERA_ORIENTATIONS.has(measured)) return measured;
  return 'landscape';
}

function participantCameraRotation(participant) {
  const rotation = participant?.attributes?.['qsession.cameraRotation'];
  return CAMERA_ROTATIONS.has(rotation) ? rotation : 'none';
}

function syncVideoRotationCorrection(container, video, requestedRotation = 'none') {
  if (!container || !video) return false;
  const rotation = CAMERA_ROTATIONS.has(requestedRotation) ? requestedRotation : 'none';
  if (rotation === 'none') {
    container.qsessionRotationObserver?.disconnect?.();
    delete container.qsessionRotationObserver;
    delete container.dataset.cameraRotation;
    container.style.removeProperty('--rotated-video-width');
    container.style.removeProperty('--rotated-video-height');
    return false;
  }
  container.dataset.cameraRotation = rotation;
  const updateSize = () => {
    if (!container.isConnected) return;
    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    container.style.setProperty('--rotated-video-width', `${bounds.height}px`);
    container.style.setProperty('--rotated-video-height', `${bounds.width}px`);
  };
  if (!container.qsessionRotationObserver && typeof ResizeObserver === 'function') {
    container.qsessionRotationObserver = new ResizeObserver(updateSize);
    container.qsessionRotationObserver.observe(container);
  }
  updateSize();
  requestAnimationFrame(updateSize);
  return true;
}

function syncVideoContainerAspect(container, track, video, preferredOrientation = '', requestedRotation = 'none') {
  if (!container) return '';
  const dimensions = trackCameraDimensions(track, video);
  const measuredOrientation = dimensions
    ? (dimensions.width >= dimensions.height ? 'landscape' : 'portrait')
    : '';
  const preference = CAMERA_ORIENTATIONS.has(preferredOrientation) ? preferredOrientation : '';
  const orientation = preference || measuredOrientation || 'landscape';
  const streamMatchesPreference = Boolean(dimensions && (!preference || measuredOrientation === preference));
  const aspect = streamMatchesPreference
    ? `${dimensions.width} / ${dimensions.height}`
    : (orientation === 'portrait' ? '3 / 4' : '16 / 9');
  container.style.setProperty('--camera-aspect', aspect);
  container.dataset.cameraOrientation = orientation;
  container.dataset.cameraAspectSource = streamMatchesPreference ? 'stream' : preference ? 'preference' : 'fallback';
  container.dataset.cameraFormatMismatch = String(Boolean(preference && measuredOrientation && preference !== measuredOrientation));
  if (measuredOrientation) container.dataset.cameraSourceOrientation = measuredOrientation;
  else delete container.dataset.cameraSourceOrientation;
  syncVideoRotationCorrection(container, video, requestedRotation);
  return orientation;
}

function bindVideoAspectSync(video, synchronize) {
  const previous = video?.qsessionAspectSync;
  if (previous) {
    video.removeEventListener('loadedmetadata', previous);
    video.removeEventListener('resize', previous);
  }
  if (!video || typeof synchronize !== 'function') return;
  video.qsessionAspectSync = synchronize;
  video.addEventListener('loadedmetadata', synchronize);
  video.addEventListener('resize', synchronize);
  requestAnimationFrame(synchronize);
}

async function setLocalCameraOrientation(orientation) {
  const next = CAMERA_ORIENTATIONS.has(orientation) ? orientation : initialCameraOrientation();
  const previous = state.cameraOrientation;
  const previousMode = state.cameraOrientationMode;
  const buttons = all('button[data-camera-orientation]');
  buttons.forEach(button => { button.disabled = true; });
  state.cameraOrientationMode = 'manual';
  applyLocalCameraOrientation(next);
  try {
    const room = state.mediaRoom;
    if (room && state.mediaConnected && state.localCameraEnabled) {
      let publication = room.localParticipant.getTrackPublication(window.LivekitClient.Track.Source.Camera);
      if (typeof publication?.track?.restartTrack !== 'function') {
        throw new Error('Esta cámara no permite cambiar el formato mientras está activa. Apágala, cambia el formato y vuelve a encenderla.');
      }
      await publication.track.restartTrack(localCameraCaptureOptions());
      publication = room.localParticipant.getTrackPublication(window.LivekitClient.Track.Source.Camera) || publication;
      await calibrateLocalCameraTrack(publication.track, {resetToWidest: true});
      configureCameraFraming(publication);
      registerPeopleCamera(publication.track, room.localParticipant, {local: true});
      if (state.mediaRole === 'dj') showPrimaryVideo(publication.track, {local: true});
      await publishLocalCameraDeliveryAttributes(room, publication.track).catch(() => undefined);
    }
    applyLocalCameraOrientation(next, {remember: true});
    setMediaStatus(`Formato ${next === 'portrait' ? 'vertical' : 'horizontal'} preparado${state.localCameraEnabled ? ' y transmitiéndose' : ''}.`);
  } catch (error) {
    state.cameraOrientationMode = previousMode;
    applyLocalCameraOrientation(previous);
    setMediaStatus(error.message || 'No fue posible cambiar el formato de video.', true);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function localCameraFormat() {
  const portrait = state.cameraOrientation === 'portrait';
  return portrait
    // 3:4 preserves substantially more of a phone sensor than a 9:16 crop,
    // while remaining unmistakably vertical for mobile participants.
    ? {width: 960, height: 1280, aspectRatio: 3 / 4, frameRate: 24}
    : {width: 1280, height: 720, aspectRatio: 16 / 9, frameRate: 24};
}

function localCameraDeviceConstraint({forceFront = false} = {}) {
  const useSelectedDevice = Boolean(
    state.cameraDeviceId
    && !forceFront
    && (
      !isNativeAndroidApp()
      || state.cameraDeviceSelectionExplicit
      || state.cameraDeviceId === state.cameraAutomaticWideDeviceId
    ),
  );
  return useSelectedDevice
    ? {deviceId: {exact: state.cameraDeviceId}}
    : {facingMode: 'user'};
}

function localCameraCaptureOptions({forceFront = false} = {}) {
  return {
    resolution: localCameraFormat(),
    ...localCameraDeviceConstraint({forceFront}),
  };
}

async function resetCameraTrackToWidestAngle(mediaTrack) {
  const range = cameraZoomRange(mediaTrack);
  if (!range || typeof mediaTrack?.applyConstraints !== 'function') return null;
  const current = Number(mediaTrack.getSettings?.().zoom);
  if (Number.isFinite(current) && Math.abs(current - range.min) < .001) return range.min;
  try {
    await mediaTrack.applyConstraints({advanced: [{zoom: range.min}]});
    return range.min;
  } catch {
    return null;
  }
}

async function resetCameraStreamToWidestAngle(stream) {
  const mediaTrack = stream?.getVideoTracks?.()[0] || null;
  return resetCameraTrackToWidestAngle(mediaTrack);
}

async function calibrateLocalCameraTrack(track, {resetToWidest = false} = {}) {
  const mediaTrack = track?.mediaStreamTrack;
  if (!mediaTrack) return null;
  try { mediaTrack.contentHint = 'motion'; } catch { /* El navegador conserva su ajuste de movimiento. */ }
  const format = localCameraFormat();
  if (typeof mediaTrack.applyConstraints === 'function') {
    await mediaTrack.applyConstraints({
      width: {ideal: format.width},
      height: {ideal: format.height},
      aspectRatio: {ideal: format.aspectRatio},
      frameRate: {ideal: format.frameRate, max: 30},
    }).catch(() => undefined);
  }
  if (resetToWidest) await resetCameraTrackToWidestAngle(mediaTrack);
  return trackCameraDimensions(track);
}

function cameraDeliveryAttributes(track = null) {
  const format = localCameraFormat();
  const dimensions = trackCameraDimensions(track) || format;
  return {
    'qsession.cameraFraming': state.cameraFraming,
    'qsession.cameraOrientation': state.cameraOrientation,
    'qsession.cameraOrientationMode': state.cameraOrientationMode,
    'qsession.cameraDeviceClass': cameraDeviceClass(),
    'qsession.cameraFrameWidth': String(Math.round(dimensions.width)),
    'qsession.cameraFrameHeight': String(Math.round(dimensions.height)),
    'qsession.cameraRotation': 'none',
    'qsession.cameraFormatVersion': CAMERA_FORMAT_VERSION,
  };
}

async function publishLocalCameraDeliveryAttributes(room, track = null) {
  await room?.localParticipant?.setAttributes?.(cameraDeliveryAttributes(track));
}

function stableCameraPublishOptions() {
  return {
    simulcast: true,
    degradationPreference: 'maintain-framerate',
    videoEncoding: {maxBitrate: 1200000, maxFramerate: 24},
  };
}

function publicCameraPublishOptions() {
  // The CDN consumes one continuous camera input. Avoid relying on a
  // simulcast layer that may be suspended after direct viewers unsubscribe.
  if (state.mediaRole === 'dj') return {...stableCameraPublishOptions(), simulcast: false};
  if (state.mediaRole !== 'listener') return stableCameraPublishOptions();
  // One bounded stream per guest: no hidden high-resolution simulcast layer.
  return {
    simulcast: false,
    degradationPreference: 'maintain-framerate',
    videoEncoding: {maxBitrate: 300000, maxFramerate: 15},
  };
}

function cameraDeviceType(device) {
  const label = String(device?.label || '').trim();
  if (/hdmi|capture|cam\s*link|avermedia|elgato|video\s*grabber/i.test(label)) return 'hdmi';
  if (/front|frontal|user|facetime/i.test(label)) return 'front';
  if (/back|rear|trasera|environment/i.test(label)) return 'back';
  if (/usb|webcam|logitech|brio|obs virtual camera/i.test(label)) return 'usb';
  return 'camera';
}

function frontCameraDevice(cameras) {
  return cameras.find(device => cameraDeviceType(device) === 'front') || null;
}

function cameraDeviceIsWideAngle(device) {
  const label = String(device?.label || '').trim();
  return /ultra[\s-]?wide|ultrawide|wide[\s-]?angle|0[.,]5\s*[x×]|gran\s+angular|grand[\s-]?angle/i.test(label);
}

function widestFrontCameraDevice(cameras) {
  const frontCameras = cameras.filter(device => cameraDeviceType(device) === 'front');
  return frontCameras.find(cameraDeviceIsWideAngle) || frontCameras[0] || null;
}

function describedCameraDevices(cameras) {
  const positions = new Map();
  return cameras.map((device, index) => {
    const type = cameraDeviceType(device);
    const position = (positions.get(type) || 0) + 1;
    positions.set(type, position);
    const suffix = position > 1 ? ` ${position}` : ' principal';
    if (type === 'front') {
      const wide = cameraDeviceIsWideAngle(device);
      return {
        device,
        type,
        name: wide ? 'Cámara frontal gran angular' : `Cámara frontal${suffix}`,
        description: wide
          ? 'Mayor campo visual: mantiene la cara más pequeña y muestra más espacio.'
          : position === 1 ? 'Ideal para hablar mirando la pantalla.' : 'Otro ángulo frontal disponible en este dispositivo.',
      };
    }
    if (type === 'back') return {device, type, name: `Cámara trasera${suffix}`, description: position === 1 ? 'Ideal para mostrar el espacio con mayor calidad.' : 'Otro ángulo trasero disponible en este dispositivo.'};
    if (type === 'hdmi') return {device, type, name: `Entrada HDMI${position > 1 ? ` ${position}` : ''}`, description: 'Capturadora externa para una señal de video.'};
    if (type === 'usb') return {device, type, name: `Cámara USB${position > 1 ? ` ${position}` : ''}`, description: 'Cámara o fuente de video conectada por USB.'};
    return {device, type, name: index ? `Cámara alternativa ${index + 1}` : 'Cámara principal', description: 'Fuente de video disponible en este dispositivo.'};
  });
}

function closeCameraDeviceMenu() {
  byId('cameraDeviceMenu').hidden = true;
  byId('cameraDeviceTrigger').setAttribute('aria-expanded', 'false');
}

function renderCameraDevicePicker(cameras) {
  const entries = describedCameraDevices(cameras);
  state.cameraDevices = entries;
  const selected = entries.find(entry => entry.device.deviceId === state.cameraDeviceId) || entries[0];
  const trigger = byId('cameraDeviceTrigger');
  const menu = byId('cameraDeviceMenu');
  byId('cameraDeviceLabel').textContent = selected?.name || 'No se encontró una cámara';
  byId('cameraDeviceDescription').textContent = selected?.description || 'Conecta una cámara y vuelve a buscar.';
  trigger.disabled = entries.length < 2;
  trigger.setAttribute('aria-label', selected ? `Cámara seleccionada: ${selected.name}. Cambiar cámara.` : 'No se encontró una cámara');
  menu.replaceChildren(...entries.map(entry => {
    const option = document.createElement('button');
    const selectedOption = entry.device.deviceId === state.cameraDeviceId;
    option.type = 'button';
    option.className = 'camera-device-option';
    option.dataset.cameraDeviceId = entry.device.deviceId;
    option.dataset.cameraType = entry.type;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(selectedOption));
    const icon = document.createElement('span');
    icon.className = 'camera-device-icon';
    icon.textContent = entry.type === 'front' ? '◉' : entry.type === 'back' ? '◎' : entry.type === 'hdmi' ? '▭' : '▣';
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const description = document.createElement('small');
    description.textContent = entry.description;
    copy.append(name, description);
    const check = document.createElement('i');
    check.textContent = selectedOption ? '✓' : '';
    check.setAttribute('aria-hidden', 'true');
    option.append(icon, copy, check);
    return option;
  }));
  closeCameraDeviceMenu();
  window.QSessionI18n?.applyTranslations(byId('cameraDevicePicker'));
  renderCameraSettingsSummary();
}

function resetCameraSourceControl() {
  const control = byId('cameraSourceControl');
  const select = byId('cameraDevice');
  control.hidden = true;
  state.cameraDevices = [];
  select.disabled = true;
  select.replaceChildren(new Option('Buscando cámaras…', ''));
  byId('cameraDeviceLabel').textContent = 'Buscando cámaras…';
  byId('cameraDeviceDescription').textContent = 'Q Session identificará las cámaras disponibles.';
  byId('cameraDeviceTrigger').disabled = true;
  byId('cameraDeviceMenu').replaceChildren();
  closeCameraDeviceMenu();
  byId('cameraSourceStatus').textContent = 'Una capturadora HDMI compatible aparecerá aquí como entrada de video USB.';
  renderCameraSettingsSummary();
}

async function refreshCameraDevices({quiet = false} = {}) {
  const control = byId('cameraSourceControl');
  const select = byId('cameraDevice');
  if (!state.mediaConnected || typeof navigator.mediaDevices?.enumerateDevices !== 'function') {
    resetCameraSourceControl();
    return [];
  }
  try {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    if (!cameras.length) {
      control.hidden = false;
      select.disabled = true;
      select.replaceChildren(new Option('No se encontró una cámara', ''));
      renderCameraDevicePicker([]);
      byId('cameraSourceStatus').textContent = 'Conecta una cámara USB o una capturadora HDMI y pulsa actualizar.';
      return [];
    }
    const publication = state.mediaRoom?.localParticipant?.getTrackPublication?.(window.LivekitClient?.Track?.Source?.Camera);
    const activeDeviceId = publication?.track?.mediaStreamTrack?.getSettings?.().deviceId || '';
    const explicitDeviceId = state.cameraDeviceSelectionExplicit
      && cameras.some(device => device.deviceId === state.cameraDeviceId)
      ? state.cameraDeviceId
      : '';
    const automaticWideCamera = devicePrefersPortraitCamera() ? widestFrontCameraDevice(cameras) : null;
    const frontDeviceId = automaticWideCamera?.deviceId || (isNativeAndroidApp() ? frontCameraDevice(cameras)?.deviceId || '' : '');
    state.cameraAutomaticWideDeviceId = automaticWideCamera?.deviceId || '';
    const preferredId = cameras.some(device => device.deviceId === activeDeviceId)
      ? activeDeviceId
      : explicitDeviceId
        || frontDeviceId
        || (cameras.some(device => device.deviceId === state.cameraDeviceId) ? state.cameraDeviceId : cameras[0].deviceId);
    state.cameraDeviceId = preferredId;
    if (!isNativeAndroidApp() || state.cameraDeviceSelectionExplicit) {
      try { localStorage.setItem('qsession-camera-device', preferredId); } catch { /* La selección sigue activa durante esta visita. */ }
    }
    const described = describedCameraDevices(cameras);
    select.replaceChildren(...described.map(entry => new Option(entry.name, entry.device.deviceId)));
    select.value = preferredId;
    select.disabled = cameras.length < 2;
    renderCameraDevicePicker(cameras);
    control.hidden = false;
    byId('cameraSourceStatus').textContent = cameras.length > 1
      ? `${cameras.length} fuentes disponibles. Puedes cambiar sin cerrar la sala.`
      : 'Sólo hay una fuente disponible. HDMI requiere una capturadora USB/UVC.';
    return cameras;
  } catch (error) {
    resetCameraSourceControl();
    if (!quiet) setMediaStatus(error.message || 'No fue posible leer las cámaras disponibles.', true);
    return [];
  }
}

async function switchCameraDevice(deviceId) {
  const room = state.mediaRoom;
  const select = byId('cameraDevice');
  if (!room || !state.mediaConnected || !deviceId) return;
  const previousId = state.cameraDeviceId;
  const previousExplicitSelection = state.cameraDeviceSelectionExplicit;
  select.disabled = true;
  byId('cameraDeviceTrigger').disabled = true;
  closeCameraDeviceMenu();
  try {
    state.cameraDeviceId = deviceId;
    state.cameraDeviceSelectionExplicit = true;
    try { localStorage.setItem('qsession-camera-device', deviceId); } catch { /* La selección sigue activa durante esta visita. */ }
    if (!state.localCameraEnabled) {
      setMediaStatus(`${select.selectedOptions[0]?.textContent || 'Fuente de video'} preparada. Se usará al activar la cámara.`);
      return;
    }
    const switched = await room.switchActiveDevice('videoinput', deviceId);
    if (switched === false) throw new Error('La cámara no aceptó el cambio de fuente.');
    const publication = room.localParticipant.getTrackPublication(window.LivekitClient.Track.Source.Camera);
    if (publication?.track) {
      await calibrateLocalCameraTrack(publication.track, {resetToWidest: true});
      await publishLocalCameraDeliveryAttributes(room, publication.track).catch(() => undefined);
      configureCameraFraming(publication);
      registerPeopleCamera(publication.track, room.localParticipant, {local: true});
      if (state.mediaRole === 'dj') showPrimaryVideo(publication.track, {local: true});
    }
    setMediaStatus(`${select.selectedOptions[0]?.textContent || 'Fuente de video'} activa.`);
  } catch (error) {
    state.cameraDeviceId = previousId;
    state.cameraDeviceSelectionExplicit = previousExplicitSelection;
    select.value = previousId;
    setMediaStatus(error.message || 'No fue posible cambiar la fuente de video.', true);
  } finally {
    await refreshCameraDevices({quiet: true});
  }
}

function cameraZoomRange(mediaStreamTrack) {
  try {
    const zoom = mediaStreamTrack?.getCapabilities?.().zoom;
    const min = Number(zoom?.min);
    const max = Number(zoom?.max);
    const step = Number(zoom?.step);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    return {min, max, step: Number.isFinite(step) && step > 0 ? step : .1};
  } catch {
    return null;
  }
}

function zoomIsAvailable(value, range) {
  return Number.isFinite(value) && value >= range.min - .001 && value <= range.max + .001;
}

function cameraZoomValue(optionValue, range = state.cameraZoomRange) {
  if (!range) return null;
  return Number(optionValue);
}

function configureCameraFraming(publication) {
  const mediaStreamTrack = publication?.track?.mediaStreamTrack || publication?.mediaStreamTrack || null;
  const control = byId('cameraFramingControl');
  const zoomGroup = byId('cameraZoomGroup');
  const select = byId('cameraZoom');
  const status = byId('cameraZoomStatus');
  state.cameraZoomTrack = mediaStreamTrack;
  state.cameraZoomRange = cameraZoomRange(mediaStreamTrack);
  control.hidden = false;
  applyLocalCameraFraming(state.cameraFraming);

  const range = state.cameraZoomRange;
  if (!range || typeof mediaStreamTrack?.applyConstraints !== 'function') {
    zoomGroup.hidden = true;
    zoomGroup.open = false;
    select.disabled = true;
    [...select.options].forEach(option => { option.disabled = option.value !== '1'; });
    select.value = '1';
    status.textContent = 'Esta cámara mantiene su encuadre original.';
    return;
  }

  ['0.5', '1', '2', '3'].forEach(value => {
    select.querySelector(`option[value="${value}"]`).disabled = !zoomIsAvailable(Number(value), range);
  });
  const available = [...select.options].filter(option => !option.disabled);
  select.disabled = available.length < 2;
  zoomGroup.hidden = available.length < 2;
  if (zoomGroup.hidden) zoomGroup.open = false;
  const current = Number(mediaStreamTrack.getSettings?.().zoom);
  const selected = Number.isFinite(current)
    ? available.reduce((best, option) => {
      if (!best) return option;
      const distance = Math.abs(cameraZoomValue(option.value, range) - current);
      const bestDistance = Math.abs(cameraZoomValue(best.value, range) - current);
      return distance < bestDistance ? option : best;
    }, null)
    : available.find(option => option.value === '1') || available[0];
  select.value = selected?.value || '1';
  byId('cameraZoomSummary').textContent = selected?.textContent || '1×';
  status.textContent = select.disabled
    ? `Encuadre fijo en ${Number.isFinite(current) ? current.toFixed(1) : range.min.toFixed(1)}×.`
    : `Disponible de ${range.min.toFixed(1)}× a ${range.max.toFixed(1)}×.`;
}

async function applyCameraZoom(optionValue) {
  const track = state.cameraZoomTrack;
  const range = state.cameraZoomRange;
  const select = byId('cameraZoom');
  const target = cameraZoomValue(optionValue, range);
  if (!track || !range || !zoomIsAvailable(target, range)) return;
  select.disabled = true;
  try {
    await track.applyConstraints({advanced: [{zoom: target}]});
    const applied = Number(track.getSettings?.().zoom);
    const label = select.selectedOptions[0]?.textContent || `${target}×`;
    byId('cameraZoomSummary').textContent = label;
    byId('cameraZoomStatus').textContent = `${label} activo${Number.isFinite(applied) ? ` · ${applied.toFixed(1)}× real` : ''}.`;
    setMediaStatus(`Encuadre ${label} aplicado.`);
  } catch {
    configureCameraFraming({mediaStreamTrack: track});
    setMediaStatus('Este dispositivo no pudo aplicar ese encuadre.', true);
    return;
  }
  select.disabled = false;
}

function clearMediaSignalTimer() {
  if (state.mediaSignalTimer) clearTimeout(state.mediaSignalTimer);
  state.mediaSignalTimer = null;
}

function djIsInMediaRoom(room = state.mediaRoom) {
  return Boolean(room && [...room.remoteParticipants.values()].some(participant => String(participant.identity || '').startsWith('dj-')));
}

function djHasPublishedAudio(room = state.mediaRoom) {
  if (!room) return false;
  return [...room.remoteParticipants.values()].some(participant => {
    if (!String(participant.identity || '').startsWith('dj-')) return false;
    return [...participant.trackPublications.values()].some(publication => mediaPublicationKind(publication) === 'audio');
  });
}

function scheduleListenerSignalCheck(room = state.mediaRoom, delay = 5000) {
  clearMediaSignalTimer();
  if (!room || state.mediaRole !== 'listener' || state.remoteAudioReceived) return;
  state.mediaSignalTimer = setTimeout(() => {
    if (state.mediaRoom !== room || !state.mediaConnected || state.remoteAudioReceived) return;
    const code = state.currentRoomCode || 'indicada';
    if (!djIsInMediaRoom(room)) {
      byId('mediaLiveBadge').textContent = 'ESPERANDO AL DJ';
      setMediaStatus(`Estás conectado a ${code}, pero el DJ no está en esta sala. Confirma que ambos tengan exactamente el mismo código.`, true);
      return;
    }
    if ((state.broadcastUsingEdge && !state.broadcastEdgeReady) || djHasPublishedAudio(room)) {
      byId('mediaLiveBadge').textContent = 'RECUPERANDO SEÑAL';
      syncWebMediaSubscriptions(room);
      void room.startAudio?.().catch(() => undefined);
      setMediaStatus(`El DJ está transmitiendo en ${code}. Este teléfono está recuperando automáticamente el audio y el video…`);
      scheduleListenerSignalCheck(room, 10000);
      return;
    }
    byId('mediaLiveBadge').textContent = 'DJ SIN AUDIO';
    setMediaStatus(`El DJ está conectado a ${code}, pero todavía no publicó audio. Debe pulsar “Iniciar transmisión”.`, true);
  }, delay);
}

async function checkRoomAfterDjDeparture(room = state.mediaRoom) {
  const code = state.currentRoomCode;
  if (!room || state.mediaRole !== 'listener' || !code) return;
  await new Promise(resolve => setTimeout(resolve, 900));
  if (room !== state.mediaRoom || !state.mediaConnected) return;
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {credentials: 'same-origin', cache: 'no-store'});
    if (response.status !== 404) {
      scheduleListenerSignalCheck(room);
      return;
    }
    await disconnectMedia({keepConsole: true});
    byId('mediaLiveBadge').textContent = 'FINALIZADA';
    byId('mediaFallbackTitle').textContent = 'Sala finalizada';
    byId('mediaFallbackText').textContent = 'Esta transmisión terminó. Pulsa “Atrás” para volver.';
    setMediaStatus('La sala finalizó. El botón “Atrás” permanece disponible para salir.');
  } catch {
    scheduleListenerSignalCheck(room);
  }
}

function mediaParticipantCount() {
  return state.mediaRoom ? state.mediaRoom.remoteParticipants.size + 1 : 0;
}

function renderMediaAudienceCount(connected = state.mediaConnected) {
  const counter = byId('mediaParticipantCount');
  const cdn = state.currentRoom?.audienceMode === 'cdn-only' || isCdnOnlyAudience();
  const known = state.currentRoom?.broadcastSessionsStatus === 'ready' && Number.isSafeInteger(state.currentRoom?.activeBroadcastSessions);
  counter.textContent = cdn ? (connected && known ? String(state.currentRoom.activeBroadcastSessions) : '—') : String(connected ? mediaParticipantCount() : 0);
  counter.title = cdn ? 'Sesiones de reproducción activas; el conteo se actualiza aproximadamente cada cinco segundos.' : '' ;
  if (counter.nextSibling?.nodeType === 3) counter.nextSibling.textContent = cdn ? ' sesiones activas' : ' conectados';
}

async function refreshDjBroadcastAudience() {
  if (state.mediaRole !== 'dj' || !state.mediaConnected || state.currentRoom?.audienceMode !== 'cdn-only' || state.broadcastAudiencePollBusy || Date.now() - state.broadcastAudiencePollAt < 5000) return;
  const code = state.currentRoomCode;
  state.broadcastAudiencePollAt = Date.now();
  state.broadcastAudiencePollBusy = true;
  try {
    const result = await api(`/api/rooms/${code}`);
    if (state.currentRoomCode !== code || state.mediaRole !== 'dj' || !state.mediaConnected) return;
    state.currentRoom = {...state.currentRoom, audienceMode: 'cdn-only', activeBroadcastSessions: result.room?.activeBroadcastSessions ?? null, broadcastSessionsStatus: result.room?.broadcastSessionsStatus || 'unavailable', broadcastSessionsMeasuredAt: result.room?.broadcastSessionsMeasuredAt || null, broadcastEventPlan: result.room?.broadcastEventPlan || null};
  } catch {
    if (state.currentRoomCode === code) state.currentRoom = {...state.currentRoom, activeBroadcastSessions: null, broadcastSessionsStatus: 'unavailable'};
  } finally {
    state.broadcastAudiencePollBusy = false;
    renderMediaAudienceCount();
  }
}

function updateMediaConnection(connected = state.mediaConnected) {
  const badge = byId('mediaConnectionBadge');
  badge.classList.toggle('is-live', connected);
  badge.querySelector('b').textContent = connected ? 'Conectado' : 'Sin conectar';
  renderMediaAudienceCount(connected);
  state.roomChatParticipantCount = connected ? mediaParticipantCount() : 0;
  syncPublicChatPanel();
  syncChatContext();
  if (chatViewIsVisible() && state.chatMode === 'public') startChatPolling();
}

function renderRoomQr(joinUrl) {
  const container = byId('roomQr');
  container.replaceChildren();
  if (!joinUrl || !window.ZXingBrowser?.BrowserQRCodeSvgWriter) {
    container.textContent = 'QR';
    return;
  }
  try {
    const writer = new window.ZXingBrowser.BrowserQRCodeSvgWriter();
    writer.writeToDom(container, joinUrl, 280, 280);
  } catch {
    container.textContent = 'QR';
  }
}

function registerPeopleCamera(track, participant, {local = false} = {}) {
  const profile = profileFromRoomParticipant(participant, {local}) || organizerRoomProfile(participant, {local});
  const key = cameraParticipantKey(participant, {local});
  if (!profile || !key) return;
  state.peopleVideoTracks.set(key, {track, participant, profile, local});
  if (!byId('view-people').hidden) renderPeople();
}

function unregisterPeopleCamera(participant, {local = false} = {}) {
  const key = cameraParticipantKey(participant, {local});
  if (!key) return;
  state.peopleVideoTracks.delete(key);
  if (!byId('view-people').hidden) renderPeople();
}

function syncPrimaryVideoAspect(track, video = byId('liveVideo'), preferredOrientation = '', requestedRotation = 'none') {
  const stage = byId('mediaStage');
  return syncVideoContainerAspect(stage, track, video, preferredOrientation, requestedRotation);
}

function showPrimaryVideo(track, {local = false, participant = null} = {}) {
  const video = byId('liveVideo');
  if (state.primaryVideoTrack && state.primaryVideoTrack !== track) {
    removeDetachedTrackElements(state.primaryVideoTrack, video, {preserveTarget: true});
  }
  state.primaryVideoTrack = track;
  state.primaryVideoParticipantIdentity = String(participant?.identity || (local ? state.mediaRoom?.localParticipant?.identity : '') || '');
  video.muted = local;
  track.attach(video);
  video.hidden = false;
  byId('mediaFallback').hidden = true;
  byId('mediaFullscreen').hidden = false;
  byId('mediaStage').classList.remove('is-idle');
  byId('mediaStage').classList.add('has-video');
  applyStageCameraFraming(local ? state.cameraFraming : participantCameraFraming(participant));
  const preferredOrientation = local ? state.cameraOrientation : participantCameraOrientation(participant, track, video);
  const requestedRotation = local ? 'none' : participantCameraRotation(participant);
  syncPrimaryVideoAspect(track, video, preferredOrientation, requestedRotation);
  bindVideoAspectSync(video, () => {
    syncPrimaryVideoAspect(
      track,
      video,
      local ? state.cameraOrientation : participantCameraOrientation(participant, track, video),
      local ? 'none' : participantCameraRotation(participant),
    );
  });
  byId('mediaLiveBadge').textContent = 'VIDEO EN VIVO';
  void video.play().catch(() => undefined);
}

function clearPrimaryVideo(message = 'El audio continúa en vivo.') {
  const video = byId('liveVideo');
  if (state.primaryVideoTrack) {
    removeDetachedTrackElements(state.primaryVideoTrack, video, {preserveTarget: true});
  }
  state.primaryVideoTrack = null;
  state.primaryVideoParticipantIdentity = '';
  video.srcObject = null;
  video.hidden = true;
  const stage = byId('mediaStage');
  stage.classList.remove('has-video');
  stage.style.removeProperty('--camera-aspect');
  stage.qsessionRotationObserver?.disconnect?.();
  delete stage.qsessionRotationObserver;
  delete stage.dataset.cameraOrientation;
  delete stage.dataset.cameraAspectSource;
  delete stage.dataset.cameraFormatMismatch;
  delete stage.dataset.cameraRotation;
  byId('mediaFallback').hidden = false;
  byId('mediaFallbackTitle').textContent = state.mediaConnected ? 'Audio en vivo' : 'Tu escenario está listo';
  byId('mediaFallbackText').textContent = message;
  byId('mediaFullscreen').hidden = true;
  byId('mediaStage').classList.toggle('is-idle', !state.mediaConnected);
  byId('mediaLiveBadge').textContent = state.mediaConnected ? 'AUDIO EN VIVO' : 'PREPARADO';
}

function stopEdgeBroadcastPlayback({keepDelivery = false, preserveNativeListener = false} = {}) {
  state.edgeNativeHandoffGeneration = (state.edgeNativeHandoffGeneration || 0) + 1;
  clearTimeout(state.edgeVideoRestartTimer);
  state.edgeVideoRestartTimer = null;
  state.edgeRecoveryStartedAt = null;
  if (!preserveNativeListener) {
    if (state.edgeNativeSessionActive) postNativeAudioCommand({type: 'listener-edge-stop'});
    state.edgeNativeSessionActive = false;
    state.edgeNativeRoomCode = '';
    state.edgeNativeBackgroundActive = false;
    state.edgeNativeForegroundPending = false;
  }
  state.broadcastHls?.destroy?.();
  state.broadcastHls = null;
  state.broadcastHlsFailures = 0;
  state.edgePlaybackNeedsGesture = false;
  state.broadcastUsingEdge = false;
  state.broadcastEdgeReady = false;
  if (!keepDelivery) state.broadcastDelivery = null;
  const video = byId('broadcastVideo');
  if (state.edgeVideoEndedListener) video.removeEventListener('ended', state.edgeVideoEndedListener);
  state.edgeVideoEndedListener = null;
  if (state.edgeVideoPlayingListener) video.removeEventListener('playing', state.edgeVideoPlayingListener);
  state.edgeVideoPlayingListener = null;
  if (state.edgeVideoErrorListener) video.removeEventListener('error', state.edgeVideoErrorListener);
  state.edgeVideoErrorListener = null;
  video.hidden = true;
  video.pause?.();
  video.removeAttribute('src');
  video.load?.();
}

function showEdgeBroadcastStage() {
  const video = byId('broadcastVideo');
  const directVideo = byId('liveVideo');
  if (state.primaryVideoTrack) {
    removeDetachedTrackElements(state.primaryVideoTrack, directVideo, {preserveTarget: true});
  }
  state.primaryVideoTrack = null;
  state.primaryVideoParticipantIdentity = '';
  directVideo.hidden = true;
  video.muted = state.listenerMuted || state.edgeNativeBackgroundActive || state.edgeNativeForegroundPending || state.edgePlaybackNeedsGesture;
  video.volume = state.listenerOutputGain;
  video.hidden = false;
  byId('mediaFallback').hidden = true;
  byId('mediaFullscreen').hidden = false;
  byId('mediaStage').classList.remove('is-idle');
  byId('mediaStage').classList.add('has-video');
  byId('mediaLiveBadge').textContent = 'SEÑAL EN VIVO';
}

function finishEdgeNativeForegroundHandoff(delivery) {
  if (!state.edgeNativeForegroundPending || state.edgeNativeBackgroundActive || !state.edgeNativeSessionActive || state.edgePlaybackNeedsGesture) return;
  const roomCode = state.currentRoomCode;
  const generation = state.edgeNativeHandoffGeneration;
  postNativeAudioCommand({type: 'listener-edge-foreground-ready'});
  setTimeout(() => {
    if (!state.broadcastUsingEdge || state.broadcastDelivery !== delivery || state.currentRoomCode !== roomCode
      || state.edgeNativeBackgroundActive || state.edgeNativeHandoffGeneration !== generation) return;
    state.edgeNativeForegroundPending = false;
    byId('broadcastVideo').muted = state.listenerMuted || state.edgePlaybackNeedsGesture;
  }, 150);
}

async function playEdgeBroadcastVideo({userGesture = false} = {}) {
  const video = byId('broadcastVideo');
  const delivery = state.broadcastDelivery;
  const stillPlaying = () => state.broadcastUsingEdge && state.broadcastDelivery === delivery;
  video.muted = state.listenerMuted || state.edgeNativeBackgroundActive || state.edgeNativeForegroundPending;
  try {
    await video.play();
    if (!stillPlaying()) return false;
    if (!video.muted || userGesture) state.edgePlaybackNeedsGesture = false;
    finishEdgeNativeForegroundHandoff(delivery);
    return true;
  } catch {
    if (!stillPlaying()) return false;
    if (!state.listenerMuted) state.edgePlaybackNeedsGesture = true;
    if (!video.muted) {
      video.muted = true;
      // A fresh/incognito browser may allow video only after muting it.
      // Preserve the picture while requesting a gesture to enable audio.
      await video.play().catch(() => undefined);
    }
    if (!stillPlaying()) return false;
    setListenerActionButtonLabel('toggleListenerSound', 'Activar sonido');
    setMediaStatus('La señal llegó. Toca “Activar sonido” para iniciar la reproducción con audio.', true);
    return false;
  }
}

function isCdnOnlyAudience() { return state.mediaRole === 'listener' && state.broadcastDelivery?.audienceMode === 'cdn-only'; }

function fallbackEdgeBroadcastToWebRtc(message = 'La red de distribución no respondió. Q Session volvió a la señal directa.') {
  if (!state.broadcastUsingEdge) return;
  if (isCdnOnlyAudience()) {
    stopEdgeBroadcastPlayback({keepDelivery:true});
    state.mediaConnected=false; updateMediaConnection(false); setMediaControlsActive(false);
    showListenerRetry('Volver a conectar');
    setMediaStatus('La señal distribuida se interrumpió. Puedes volver a conectar.',true);
    return;
  }
  stopEdgeBroadcastPlayback({keepDelivery: true});
  clearPrimaryVideo('Recuperando la señal directa del DJ…');
  syncWebMediaSubscriptions();
  if (hasNativeAndroidAudio()) {
    postNativeAudioCommand({
      type: 'listener-start',
      server: location.origin,
      roomCode: state.currentRoomCode,
      accessToken: state.currentRoomAccessToken || '',
      gain: state.listenerOutputGain,
    });
  }
  void state.mediaRoom?.startAudio?.().catch(() => undefined);
  scheduleListenerSignalCheck(state.mediaRoom);
  setMediaStatus(message, true);
}

async function startEdgeBroadcastPlayback(delivery) {
  const video = byId('broadcastVideo');
  const url = String(delivery?.url || '');
  try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return false; } catch { return false; }
  const preserveNativeListener = state.edgeNativeSessionActive && state.edgeNativeRoomCode === state.currentRoomCode;
  stopEdgeBroadcastPlayback({keepDelivery: true, preserveNativeListener});
  state.broadcastDelivery = delivery;
  state.broadcastUsingEdge = true;
  state.broadcastEdgeReady = false;
  state.edgeNativeSessionActive = postNativeAudioCommand({
    type: 'listener-edge-start',
    roomCode: state.currentRoomCode,
    url,
    muted: state.listenerMuted,
    gain: state.listenerOutputGain,
  });
  state.edgeNativeRoomCode = state.edgeNativeSessionActive ? state.currentRoomCode : '';
  const onPlaying = () => {
    if (!state.broadcastUsingEdge || state.broadcastDelivery !== delivery) return;
    clearTimeout(state.edgeVideoRestartTimer);
    state.edgeVideoRestartTimer = null;
    state.edgeRecoveryStartedAt = null;
    state.broadcastHlsFailures = 0;
    state.broadcastEdgeReady = true;
    if (!video.muted) state.edgePlaybackNeedsGesture = false;
    // Only decoded playback can replace the direct camera/audio. A parsed
    // manifest alone says nothing about whether MediaSource can render it.
    showEdgeBroadcastStage();
    syncWebMediaSubscriptions();
    state.remoteAudioReceived = true;
    clearMediaSignalTimer();
    if (!state.edgePlaybackNeedsGesture) setMediaStatus(`Señal distribuida recibida desde la sala ${state.currentRoomCode}.`);
  };
  state.edgeVideoPlayingListener = onPlaying;
  video.addEventListener('playing', onPlaying);
  state.edgeVideoEndedListener = () => scheduleEdgeVideoRestart(delivery);
  video.addEventListener('ended', state.edgeVideoEndedListener);
  // LiveKit remains visible and audible while the first CDN playlist is
  // prepared. We switch only after the edge player proves it can load.
  syncWebMediaSubscriptions();
  setMediaStatus(isCdnOnlyAudience() ? 'Preparando audio y video del DJ…' : `Conectado a ${state.currentRoomCode}. Preparando la señal distribuida sin interrumpir la señal directa…`);

  if (window.Hls?.isSupported?.()) {
    const hls = new window.Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 5,
      maxBufferLength: 16,
      backBufferLength: 8,
      enableWorker: true,
    });
    state.broadcastHls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (state.broadcastHls !== hls || !state.broadcastUsingEdge) return;
      void playEdgeBroadcastVideo();
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data?.fatal || state.broadcastHls !== hls) return;
      state.broadcastHlsFailures += 1;
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && state.broadcastHlsFailures < 4) {
        hls.recoverMediaError();
        return;
      }
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        scheduleEdgeVideoRestart(delivery);
        return;
      }
      fallbackEdgeBroadcastToWebRtc();
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return true;
  }

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      if (!state.broadcastUsingEdge || state.broadcastDelivery !== delivery) return;
      void playEdgeBroadcastVideo();
    }, {once: true});
    state.edgeVideoErrorListener = () => {
      if (state.broadcastUsingEdge && state.broadcastDelivery === delivery) scheduleEdgeVideoRestart(delivery);
    };
    video.addEventListener('error', state.edgeVideoErrorListener);
    return true;
  }

  fallbackEdgeBroadcastToWebRtc(isCdnOnlyAudience()
    ? 'Este navegador no admite la señal HLS de esta sala. Actualiza Q Session o usa un navegador compatible.'
    : 'Este navegador no admite HLS. Q Session usará la señal directa.');
  return false;
}

function scheduleEdgeVideoRestart(delivery, attempt = 0) {
  if (attempt === 0 && state.edgeVideoRestartTimer) return;
  clearTimeout(state.edgeVideoRestartTimer);
  state.edgeRecoveryStartedAt ??= Date.now();
  if (Date.now() - state.edgeRecoveryStartedAt >= 180000) {
    fallbackEdgeBroadcastToWebRtc();
    return;
  }
  const delay = Math.round(Math.min(15000, 2000 * 2 ** Math.min(attempt, 3)) * (0.8 + Math.random() * 0.4));
  state.edgeVideoRestartTimer = setTimeout(async () => {
    state.edgeVideoRestartTimer = null;
    if (!state.broadcastUsingEdge || state.broadcastDelivery !== delivery || state.mediaRole !== 'listener') return;
    try {
      const result = await api(`/api/rooms/${state.currentRoomCode}/broadcast`, {
        headers: state.currentRoomAccessToken ? {'X-QSession-Room-Access': state.currentRoomAccessToken} : undefined,
      });
      if (!state.broadcastUsingEdge || state.broadcastDelivery !== delivery) return;
      if (result.broadcast?.state === 'active') {
        // A camera replacement closes the previous playlist. Re-read the
        // same authorized URL so a fresh encoder can resume without a reload.
        if (state.broadcastHls) state.broadcastHls.loadSource(delivery.url);
        else { byId('broadcastVideo').src = delivery.url; byId('broadcastVideo').load(); }
        void playEdgeBroadcastVideo();
      }
    } catch { /* Keep the same admitted HLS session during a brief outage. */ }
    // Only a subsequent playing event proves recovery. An active encoder or
    // successful play() promise alone must not cancel the bounded retry loop.
    if (state.broadcastUsingEdge && state.broadcastDelivery === delivery && state.edgeRecoveryStartedAt !== null) {
      scheduleEdgeVideoRestart(delivery, attempt + 1);
    }
  }, delay);
}

function scheduleDjBroadcastRefresh(room = state.mediaRoom) {
  if (state.mediaRole !== 'dj') return;
  clearTimeout(state.djBroadcastRefreshTimer);
  const code = state.currentRoomCode;
  state.djBroadcastRefreshTimer = setTimeout(async () => {
    if (state.mediaRole !== 'dj' || !state.mediaConnected || state.mediaRoom !== room || state.currentRoomCode !== code) return;
    try {
      await api(`/api/rooms/${code}/broadcast/start`, {method: 'POST', body: JSON.stringify({hostToken: state.hostToken})});
    } catch {
      if (state.mediaRoom === room && state.mediaConnected) setMediaStatus('La cámara local está activa; no se pudo sincronizar la señal distribuida. Vuelve a activar la cámara.', true);
    }
  }, 1000);
}

function attachRemoteTrack(track, _publication, participant) {
  if (state.mediaRole === 'listener' && state.broadcastUsingEdge && state.broadcastEdgeReady
      && (track.kind === 'audio' || (track.kind === 'video' && String(participant?.identity || '').startsWith('dj-')))) {
    try { _publication?.setSubscribed?.(false); } catch { /* A late subscription must not replace HLS. */ }
    removeDetachedTrackElements(track);
    return;
  }
  if (track.kind === 'audio') {
    if (!webMediaAudioEnabled()) {
      try { track.setVolume?.(0); } catch { /* La desuscripción sigue siendo la protección principal. */ }
      try { _publication?.setSubscribed?.(false); } catch { /* LiveKit completará el cambio de suscripción. */ }
      removeDetachedTrackElements(track);
      return;
    }
    state.remoteAudioTracks.add(track);
    state.remoteAudioReceived = state.remoteAudioTracks.size > 0;
    clearMediaSignalTimer();
    if (state.mediaRole === 'listener') {
      try { track.setVolume?.(listenerWebAudioVolume()); } catch { /* El navegador conserva el nivel disponible. */ }
    }
    const element = track.attach();
    element.autoplay = true;
    element.playsInline = true;
    element.muted = listenerAudioElementShouldStayMuted();
    byId('mediaAudioRack').append(element);
    void element.play?.().then(() => {
      if (state.mediaRole === 'listener' && !state.listenerMuted && !state.nativeAudioReady) {
        setMediaStatus(`Audio recibido desde la sala ${state.currentRoomCode}.`);
      }
    }).catch(() => {
      if (state.mediaRole !== 'listener') return;
      setListenerActionButtonLabel('toggleListenerSound', 'Activar sonido');
      setMediaStatus('Recuperando la salida de audio de Q Session…');
      scheduleListenerAudioRecovery();
    });
    byId('mediaLiveBadge').textContent = 'AUDIO EN VIVO';
    return;
  }
  if (track.kind !== 'video') return;
  registerPeopleCamera(track, participant);
  if (String(participant?.identity || '').startsWith('dj-')) showPrimaryVideo(track, {participant});
}

function detachRemoteTrack(track, _publication, participant) {
  removeDetachedTrackElements(track);
  if (track.kind === 'audio' && state.mediaRole === 'listener') {
    state.remoteAudioTracks.delete(track);
    state.remoteAudioReceived = (state.broadcastUsingEdge && state.broadcastEdgeReady) || state.remoteAudioTracks.size > 0;
    if (!state.remoteAudioReceived) scheduleListenerSignalCheck();
  }
  if (track.kind !== 'video') return;
  unregisterPeopleCamera(participant);
  if (state.mediaRole === 'listener' && state.broadcastUsingEdge && state.broadcastEdgeReady) {
    showEdgeBroadcastStage();
    return;
  }
  if (String(participant?.identity || '').startsWith('dj-') && state.primaryVideoTrack === track) {
    clearPrimaryVideo('La cámara del DJ está apagada; el audio continúa.');
  }
}

function wireMediaRoom(room) {
  const LiveKit = window.LivekitClient;
  room
    .on(LiveKit.RoomEvent.LocalTrackPublished, () => scheduleDjBroadcastRefresh(room))
    .on(LiveKit.RoomEvent.LocalTrackUnpublished, () => scheduleDjBroadcastRefresh(room))
    .on(LiveKit.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      attachRemoteTrack(track, publication, participant);
      if (participant?.identity === `dj-primary-${state.currentRoomCode.toLowerCase()}`) void window.QSessionMusic?.showRoomTrack(participant.attributes?.['qsession.musicTrackId']);
    })
    .on(LiveKit.RoomEvent.TrackUnsubscribed, detachRemoteTrack)
    .on(LiveKit.RoomEvent.TrackPublished, () => { void loadPeople(); })
    .on(LiveKit.RoomEvent.TrackUnpublished, () => { void loadPeople(); })
    .on(LiveKit.RoomEvent.TrackMuted, () => { void loadPeople(); })
    .on(LiveKit.RoomEvent.TrackUnmuted, () => { void loadPeople(); })
    .on(LiveKit.RoomEvent.ParticipantConnected, participant => {
      updateMediaConnection();
      void loadPeople();
      if (state.mediaRole === 'listener' && String(participant?.identity || '').startsWith('dj-') && !state.remoteAudioReceived) {
        setMediaStatus(`DJ conectado a ${state.currentRoomCode}. Esperando que inicie el audio…`);
        scheduleListenerSignalCheck(room);
      }
    })
    .on(LiveKit.RoomEvent.ParticipantDisconnected, participant => {
      unregisterPeopleCamera(participant);
      updateMediaConnection();
      void loadPeople();
      if (state.mediaRole === 'listener' && String(participant?.identity || '').startsWith('dj-')) void checkRoomAfterDjDeparture(room);
    })
    .on(LiveKit.RoomEvent.ParticipantAttributesChanged, (changedAttributes, participant) => {
      if (participant?.identity === `dj-primary-${state.currentRoomCode.toLowerCase()}` && Object.hasOwn(changedAttributes, 'qsession.musicTrackId')) {
        void window.QSessionMusic?.showRoomTrack(changedAttributes['qsession.musicTrackId']);
      }
      const framing = changedAttributes?.['qsession.cameraFraming'];
      const orientation = changedAttributes?.['qsession.cameraOrientation'];
      const rotation = changedAttributes?.['qsession.cameraRotation'];
      if (!CAMERA_FRAMINGS.has(framing) && !CAMERA_ORIENTATIONS.has(orientation) && !CAMERA_ROTATIONS.has(rotation)) return;
      const identity = String(participant?.identity || '');
      if (identity === state.primaryVideoParticipantIdentity) {
        if (CAMERA_FRAMINGS.has(framing)) applyStageCameraFraming(framing);
        syncPrimaryVideoAspect(
          state.primaryVideoTrack,
          byId('liveVideo'),
          participantCameraOrientation(participant, state.primaryVideoTrack, byId('liveVideo')),
          participantCameraRotation(participant),
        );
      }
      if (!byId('view-people').hidden) renderPeople();
    })
    .on(LiveKit.RoomEvent.ParticipantMetadataChanged, () => {
      void loadPeople();
    })
    .on(LiveKit.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (participant !== room.localParticipant && !participant?.isLocal) return;
      state.connectionQuality = String(quality || 'unknown');
      renderConnectionMonitor();
    })
    .on(LiveKit.RoomEvent.Reconnecting, () => {
      state.connectionQuality = 'lost';
      renderConnectionMonitor();
      setMediaStatus('Reconectando con la sala…');
    })
    .on(LiveKit.RoomEvent.Reconnected, () => {
      state.connectionQuality = 'unknown';
      renderConnectionMonitor();
      void sampleConnectionMonitor(room);
      void loadPeople();
      setMediaStatus('Conexión recuperada.');
      scheduleListenerAudioRecovery();
    })
    .on(LiveKit.RoomEvent.AudioPlaybackStatusChanged, () => {
      if (state.mediaRole !== 'listener' || state.listenerMuted || state.nativeAudioReady) return;
      const playable = room.canPlaybackAudio !== false;
      setListenerActionButtonLabel('toggleListenerSound', playable ? 'Silenciar' : 'Activar sonido');
      if (!playable) {
        setMediaStatus('Recuperando la salida de audio de Q Session…');
        scheduleListenerAudioRecovery();
      }
    })
    .on(LiveKit.RoomEvent.TrackSubscriptionFailed, () => {
      if (state.mediaRole === 'listener') setMediaStatus('Una pista no pudo cargarse. Intentando recuperarla…', true);
    })
    .on(LiveKit.RoomEvent.Disconnected, () => {
      if (state.mediaRoom !== room) return;
      window.QSessionMusic?.release();
      void window.QSessionMusic?.showRoomTrack('');
      state.mediaConnected = false;
      stopFlowerListeningRewards();
      clearMediaSignalTimer();
      stopConnectionMonitor();
      updateMediaConnection(false);
      setMediaControlsActive(false);
      void loadPeople();
      if (state.mediaRole === 'listener' && !state.mediaDisconnecting) showListenerRetry('Volver a conectar');
      setMediaStatus('La conexión con la sala terminó.');
    });
}

function rememberedBroadcastAdmission(code) {
  try { return sessionStorage.getItem(`qsession-hls-admission-${code}`) || ''; } catch { return ''; }
}

async function releaseBroadcastAdmission(code) {
  const token = rememberedBroadcastAdmission(code);
  try { sessionStorage.removeItem(`qsession-hls-admission-${code}`); } catch { /* La concesión caducará por sí sola. */ }
  if (!token) return;
  try {
    await api('/api/broadcast/admissions/release', {method: 'POST', body: JSON.stringify({token})});
  } catch { /* Redis libera el aforo al caducar la concesión, aunque la red falle al salir. */ }
}

async function mediaCredentials(role, options = {}) {
  const roomCode = state.currentRoomCode;
  const result = await api(`/api/rooms/${roomCode}/media-token`, {
    method: 'POST',
    body: JSON.stringify({
      role,
      hostToken: role === 'dj' ? state.hostToken : undefined,
      accessToken: role === 'listener' ? state.currentRoomAccessToken || undefined : undefined,
      previousAdmissionToken: role === 'listener' ? rememberedBroadcastAdmission(roomCode) || undefined : undefined,
      ...options,
    }),
  });
  if (role === 'dj' && state.currentRoomCode === roomCode && result.limits?.audienceMode) {
    state.currentRoom = {...state.currentRoom, audienceMode: result.limits.audienceMode, broadcastEventPlan: result.limits.broadcastEventPlan || null};
  }
  if (role === 'listener' && result.delivery?.admissionToken) {
    try { sessionStorage.setItem(`qsession-hls-admission-${roomCode}`, result.delivery.admissionToken); } catch { /* La reproducción conserva la concesión en su URL. */ }
  }
  if (result.audioPolicy?.maxBitrate) state.broadcastAudioBitrate = normalizedBroadcastAudioBitrate(result.audioPolicy.maxBitrate);
  return result;
}

async function connectMedia(role, {request = {}} = {}) {
  if (state.mediaRoom && state.mediaConnected && state.mediaRole === role && state.mediaRoomCode === state.currentRoomCode) return state.mediaRoom;
  state.mediaConnectRequest = request;
  const LiveKit = window.LivekitClient;
  if (!LiveKit?.Room) throw new Error('El motor de transmisión no se cargó. Actualiza la página.');
  const requestedRoomCode = state.currentRoomCode;
  const stillConnecting = () => state.mediaConnectRequest === request && state.currentRoomCode === requestedRoomCode;
  const room = new LiveKit.Room({
    adaptiveStream: true,
    dynacast: role !== 'dj',
    disconnectOnPageLeave: false,
    // Play the music directly without a second Web Audio resampling path.
    webAudioMix: false,
  });
  // Unlock audio during the button gesture, before awaiting credentials.
  if (role === 'listener' && typeof room.startAudio === 'function') void room.startAudio().catch(() => undefined);
  // An admitted listener can retry while Android still owns the old HLS
  // output. Obtain the replacement grant before touching that playback.
  const replacingEdge = role === 'listener' && state.broadcastDelivery?.audienceMode === 'cdn-only'
    && state.mediaRoomCode === requestedRoomCode;
  const preparedCredentials = role === 'listener' ? await mediaCredentials(role) : null;
  if (!stillConnecting()) return false;
  if (replacingEdge || preparedCredentials?.delivery?.audienceMode === 'cdn-only') {
    try {
      if (preparedCredentials.delivery?.kind !== 'broadcast' || preparedCredentials.delivery?.audienceMode !== 'cdn-only'
        || !['https:', 'http:'].includes(new URL(preparedCredentials.delivery.url).protocol)) throw new Error();
    } catch { throw new Error('La sala no entregó una señal HLS válida. Puedes volver a intentar.'); }
  }
  // Al reconectar un oyente Android, no envíes primero listener-stop: ese
  // cierre tiene un resguardo nativo diferido y puede alcanzar a la sesión
  // nueva unos segundos después. El cliente nativo reemplaza por sí mismo la
  // sala anterior cuando recibe el siguiente listener-start.
  request.replacingPlayback = true;
  await disconnectMedia({
    preserveNativeListener: role === 'listener' && hasNativeAndroidAudio(),
    preserveEdgePlayback: replacingEdge && state.edgeNativeRoomCode === requestedRoomCode,
    connectRequest: request,
  });
  if (!stillConnecting()) return false;
  setMediaStatus('Conectando con la red mundial…');
  state.mediaRoom = room;
  state.mediaRole = role;
  if (role === 'dj') await prepareNativeBroadcastService(requestedRoomCode);
  state.remoteAudioReceived = false;
  state.remoteAudioTracks.clear();
  state.nativeAudioReady = false;
  state.nativeAudioFallback = false;
  state.broadcastDelivery = null;
  state.broadcastUsingEdge = false;
  state.broadcastEdgeReady = false;
  wireMediaRoom(room);
  const credentials = preparedCredentials || await mediaCredentials(role);
  if (!stillConnecting()) return false;
  state.globalPresenceTicket = role === 'listener' ? String(credentials.presenceTicket || '') : '';
  state.broadcastDelivery = role === 'listener' ? credentials.delivery || null : null;
  state.broadcastUsingEdge = role === 'listener' && credentials.delivery?.kind === 'broadcast';
  state.participantCameraAllowed = role === 'listener'
    && (credentials.permissions?.includes('participant-camera') || credentials.permissions?.includes('social-camera'));
  if (role === 'listener' && credentials.delivery?.audienceMode === 'cdn-only') {
    state.mediaRoom = null; state.mediaRoomCode = requestedRoomCode;
    state.mediaConnected = true; state.participantCameraAllowed = false;
    stopChatPolling(); stopFlowerListeningRewards();
    startProfileActivityPolling();
    if (state.account) void loadProfileActivity({quiet: true});
    void window.QSessionMusic?.showRoomTrack('');
    if (!await startEdgeBroadcastPlayback(credentials.delivery)) throw new Error('Este dispositivo no pudo abrir la señal HLS.');
    if (!state.broadcastUsingEdge) throw new Error('La señal distribuida no está disponible.');
    if (state.chatMode === 'public') setChatMode('private', {load: false});
    updateMediaConnection(true);
    return null;
  }
  // Todas las suscripciones son explícitas: el DJ nunca recibe de vuelta su
  // propia música y Android deja el audio exclusivamente al motor nativo.
  await room.connect(credentials.url, credentials.token, {autoSubscribe: false});
  syncWebMediaSubscriptions(room);
  refreshAutomaticCameraOrientation({force: true});
  await publishLocalCameraDeliveryAttributes(room).catch(() => undefined);
  state.mediaRoomCode = requestedRoomCode;
  state.mediaConnected = true;
  // Primero confirma la conexión canónica de interfaz/video. Sólo entonces
  // inicia el segundo participante oculto que reproduce audio nativo; así una
  // transición de AudioSession o batería nunca invalida el ingreso a la sala.
  if (role === 'listener') {
    if (state.broadcastUsingEdge) {
      postNativeAudioCommand({type: 'listener-stop'});
      await startEdgeBroadcastPlayback(state.broadcastDelivery);
    } else {
      postNativeAudioCommand({
        type: 'listener-start',
        server: location.origin,
        roomCode: requestedRoomCode,
        accessToken: state.currentRoomAccessToken || '',
        gain: state.listenerOutputGain,
      });
    }
    startWebGlobalPresence();
  }
  state.chatMode = 'public';
  state.chatModeChosen = false;
  updateMediaConnection(true);
  if (role === 'listener') startFlowerListeningRewards();
  void loadPeople();
  startConnectionMonitor(room);
  void refreshCameraDevices({quiet: true});
  // No bloqueamos toda la consola esperando a que Android resuelva autoplay.
  // Si el navegador exige otro gesto, el botón cambia a “Activar sonido”.
  if (role === 'listener' && typeof room.startAudio === 'function') void room.startAudio().catch(() => {
    setListenerActionButtonLabel('toggleListenerSound', 'Activar sonido');
  });
  if (role === 'listener') scheduleListenerAudioRecovery();
  return room;
}

function setMediaControlsActive(active) {
  const cameraControlsAllowed = active && !(state.mediaRole === 'listener' && !state.participantCameraAllowed) && !(state.mediaRole === 'dj' && state.currentRoom?.broadcastMode && state.currentRoom.broadcastMode !== 'live');
  const cameraSettings = byId('cameraSettingsControl');
  cameraSettings.hidden = !cameraControlsAllowed;
  if (!cameraControlsAllowed) cameraSettings.open = false;
  byId('cameraOrientationControl').hidden = !cameraControlsAllowed;
  const cameraEffectsAllowed = cameraControlsAllowed && state.currentRoom?.allowAiCameraEffects === true;
  byId('cameraEffectsControl').hidden = !cameraEffectsAllowed;
  if (!cameraEffectsAllowed && state.cameraEffect !== 'none') applyCameraEffect('none');
  renderCameraSettingsSummary();
  if (state.mediaRole === 'dj') {
    const startButton = byId('startBroadcast');
    startButton.disabled = active;
    startButton.textContent = active ? 'Transmisión activa' : 'Iniciar transmisión';
    byId('toggleBroadcastAudio').disabled = !active;
    byId('toggleCamera').disabled = !active || (state.currentRoom?.broadcastMode || 'live') !== 'live';
    byId('changeBroadcastSource').disabled = !active || state.mediaChangingSource || state.currentRoom?.broadcastMode === 'recorded';
    byId('broadcastSourceTrigger').disabled = state.mediaChangingSource || state.currentRoom?.broadcastMode === 'recorded';
    byId('hostAudioSetup').open = !active;
    const recorded = state.currentRoom?.broadcastMode === 'recorded';
    byId('recordedPlaybackControls').hidden = !recorded;
    byId('toggleRecordedPlayback').disabled = !active;
    byId('restartRecordedPlayback').disabled = !active;
    byId('stopBroadcast').disabled = !(state.currentRoomCode && state.hostToken && state.currentRoom?.status !== 'archived');
    byId('broadcastSource').disabled = false;
  } else {
    byId('joinBroadcast').disabled = active;
    byId('toggleListenerSound').disabled = !active;
    all('[data-listener-output-gain]').forEach(button => { button.disabled = !active; });
    byId('toggleListenerCamera').disabled = !active || !state.participantCameraAllowed;
    if (active && !state.participantCameraAllowed) {
      setListenerActionButtonLabel('toggleListenerCamera', isCdnOnlyAudience() ? 'Solo recepción en este evento' : state.currentRoom?.allowGuestCameras === false
        ? 'Cámaras desactivadas en esta sesión'
        : 'Cuenta necesaria para activar la cámara');
    }
    byId('leaveBroadcast').disabled = !active;
  }
  renderVoiceOverlayControl();
}

function showListenerRetry(label = 'Reintentar conexión') {
  const button = byId('joinBroadcast');
  button.textContent = label;
  button.hidden = false;
  button.disabled = false;
}

function stopMediaMeter({keepContext = false} = {}) {
  if (state.mediaMeterTimer) cancelAnimationFrame(state.mediaMeterTimer);
  state.mediaMeterTimer = null;
  state.mediaMeterSource?.disconnect();
  state.mediaMeterSource = null;
  if (!keepContext) {
    void state.mediaMeterContext?.close().catch(() => undefined);
    state.mediaMeterContext = null;
  }
  state.mediaSignalDetected = false;
  state.mediaLastSignalAt = 0;
  state.mediaSilenceWarningShown = false;
  state.mediaSignalStartedAt = 0;
  byId('mediaStage').classList.remove('has-audio-signal');
  byId('audioMeterLeft').style.width = '2%';
  byId('audioMeterRight').style.width = '2%';
}

function primeMediaMeter() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  if (!state.mediaMeterContext || state.mediaMeterContext.state === 'closed') {
    state.mediaMeterContext = new AudioContext();
  }
  // Debe ejecutarse inmediatamente dentro del toque del usuario en Android.
  void state.mediaMeterContext.resume().catch(() => undefined);
}

function audioLevel(samples) {
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

async function startMediaMeter(mediaStreamTrack) {
  stopMediaMeter({keepContext: true});
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !mediaStreamTrack) return;
  const context = state.mediaMeterContext?.state === 'closed' || !state.mediaMeterContext
    ? new AudioContext()
    : state.mediaMeterContext;
  state.mediaMeterContext = context;
  await context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  const leftAnalyser = context.createAnalyser();
  const rightAnalyser = context.createAnalyser();
  leftAnalyser.fftSize = rightAnalyser.fftSize = 1024;
  const channelCount = Number(mediaStreamTrack.getSettings?.().channelCount || 1);
  if (channelCount > 1) {
    const splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    splitter.connect(leftAnalyser, 0);
    splitter.connect(rightAnalyser, 1);
  } else {
    // Los micrófonos de teléfono suelen ser mono. Mostrar el mismo nivel en L/R
    // evita que el segundo canal inexistente haga parecer que no hay sonido.
    source.connect(leftAnalyser);
  }
  const leftSamples = new Uint8Array(leftAnalyser.fftSize);
  const rightSamples = new Uint8Array(rightAnalyser.fftSize);
  state.mediaMeterContext = context;
  state.mediaMeterSource = source;
  state.mediaSignalStartedAt = performance.now();
  const render = () => {
    leftAnalyser.getByteTimeDomainData(leftSamples);
    if (channelCount > 1) rightAnalyser.getByteTimeDomainData(rightSamples);
    else rightSamples.set(leftSamples);
    const left = Math.max(0, Math.min(1, audioLevel(leftSamples) * 3.2));
    const right = Math.max(0, Math.min(1, audioLevel(rightSamples) * 3.2));
    byId('audioMeterLeft').style.width = `${Math.max(2, Math.round(Math.pow(left, .62) * 100))}%`;
    byId('audioMeterRight').style.width = `${Math.max(2, Math.round(Math.pow(right, .62) * 100))}%`;
    const peak = Math.max(left, right);
    const frameTime = performance.now();
    if (peak > .012 && mediaStreamTrack.enabled) state.mediaLastSignalAt = frameTime;
    const signalIsActive = state.mediaConnected && mediaStreamTrack.enabled && state.mediaLastSignalAt > 0 && frameTime - state.mediaLastSignalAt < 420;
    byId('mediaStage').classList.toggle('has-audio-signal', signalIsActive);
    if (!state.mediaSignalDetected && peak > .012) {
      state.mediaSignalDetected = true;
      byId('mediaLiveBadge').textContent = state.mediaSourceKind === 'tab' ? 'MÚSICA EN VIVO' : 'AUDIO EN VIVO';
      setMediaStatus(state.mediaSourceKind === 'tab' ? 'Música detectada y transmitiéndose.' : 'Sonido detectado y transmitiéndose.');
    } else if (!state.mediaSignalDetected && !state.mediaSilenceWarningShown && performance.now() - state.mediaSignalStartedAt > 3500) {
      state.mediaSilenceWarningShown = true;
      if (state.mediaSourceKind === 'tab') {
        setMediaStatus('La pista está conectada, pero llega en silencio. Reproduce música o pulsa “Cambiar fuente” y activa “Compartir audio”.', true);
      } else if (context.state !== 'running') {
        setMediaStatus('Transmisión activa. Android limita la animación de las barras, pero la entrada sigue abierta.');
      } else {
        setMediaStatus('Transmisión activa. Comprueba que la entrada seleccionada esté enviando sonido.');
      }
    }
    state.mediaMeterTimer = requestAnimationFrame(render);
  };
  render();
}

function audioInputDeviceType(device) {
  const raw = String(device?.label || '').trim();
  if (/hdmi|capture|capturadora|cam link|elgato|avermedia|digital audio/i.test(raw)) return 'hdmi';
  if (/usb|type[ -]?c|audio interface|codec|scarlett|focusrite|behringer|m-audio|presonus|motu|zoom\b|rode\b/i.test(raw)) return 'usb';
  if (/bluetooth|airpods|buds|headset|hands-free|bt\b/i.test(raw)) return 'bluetooth';
  if (/3[,.]5|line[ -]?in|entrada de l[ií]nea|mic[ -]?in|microphone jack|micr[oó]fono externo|realtek/i.test(raw)) return 'line';
  if (/built-in|internal|phone|array|integrado|micr[oó]fono|microphone/i.test(raw)) return 'microphone';
  return 'other';
}

function audioInputDeviceLabel(device, index) {
  const raw = String(device?.label || '').trim() || `Entrada de audio ${index + 1}`;
  const type = audioInputDeviceType(device);
  if (type === 'hdmi') return `HDMI · ${raw}`;
  if (type === 'usb') return `USB · ${raw}`;
  if (type === 'bluetooth') return `Bluetooth · ${raw}`;
  if (type === 'line') return `Conector 3,5 mm · ${raw}`;
  if (type === 'microphone') return `Micrófono integrado · ${raw}`;
  return raw;
}

function describedVoiceOverlayDevices(devices) {
  const positions = new Map();
  const descriptions = {
    microphone: 'Entrada integrada del dispositivo.',
    usb: 'Micrófono o interfaz conectada por USB.',
    bluetooth: 'Micrófono emparejado por Bluetooth.',
    line: 'Micrófono conectado al puerto de 3,5 mm.',
    hdmi: 'Entrada de audio de una capturadora HDMI.',
    other: 'Entrada reconocida por el sistema.',
  };
  const names = {
    microphone: 'Micrófono integrado',
    usb: 'Micrófono USB',
    bluetooth: 'Micrófono Bluetooth',
    line: 'Conector 3,5 mm',
    hdmi: 'Entrada HDMI',
    other: 'Otro micrófono',
  };
  const icons = {microphone: 'MIC', usb: 'USB', bluetooth: 'BT', line: '3,5', hdmi: 'HDMI', other: 'IN'};
  return devices.map((device, index) => {
    const type = audioInputDeviceType(device);
    const position = (positions.get(type) || 0) + 1;
    positions.set(type, position);
    const raw = String(device?.label || '').trim();
    return {
      device,
      type,
      icon: icons[type],
      name: `${names[type]}${position > 1 ? ` ${position}` : ''}`,
      description: raw || descriptions[type] || `Entrada de audio ${index + 1}`,
    };
  });
}

function voiceOverlayDeviceMenuButtons() {
  return [...byId('voiceOverlayDeviceMenu').querySelectorAll('[data-voice-overlay-device-id]')];
}

function setVoiceOverlayDeviceMenuOpen(open, {focusSelected = false} = {}) {
  const trigger = byId('voiceOverlayDeviceTrigger');
  const menu = byId('voiceOverlayDeviceMenu');
  const nextOpen = Boolean(open) && !trigger.disabled;
  menu.hidden = !nextOpen;
  trigger.setAttribute('aria-expanded', String(nextOpen));
  if (nextOpen && focusSelected) {
    (menu.querySelector('[aria-selected="true"]') || voiceOverlayDeviceMenuButtons()[0])?.focus();
  }
}

function renderVoiceOverlayDevicePicker(devices = state.voiceOverlayDevices) {
  state.voiceOverlayDevices = devices;
  const select = byId('voiceOverlayInput');
  const entries = [{
    device: {deviceId: ''}, type: 'auto', icon: 'AUTO',
    name: 'Automática del sistema', description: 'Usa la entrada predeterminada del dispositivo.',
  }, ...describedVoiceOverlayDevices(devices)];
  const selected = entries.find(entry => entry.device.deviceId === select.value) || entries[0];
  byId('voiceOverlayDeviceIcon').innerHTML = window.QSessionStudioIcon(selected.type);
  byId('voiceOverlayDeviceLabel').textContent = localizedUiText(selected.name);
  byId('voiceOverlayDeviceDescription').textContent = selected.type === 'auto'
    ? localizedUiText(selected.description)
    : selected.description;
  byId('voiceOverlayDeviceTrigger').setAttribute('aria-label', `${localizedUiText('Entrada para voz')}: ${localizedUiText(selected.name)}. ${localizedUiText('Cambiar micrófono')}.`);

  const menu = byId('voiceOverlayDeviceMenu');
  const heading = document.createElement('p');
  heading.className = 'voice-overlay-device-menu-heading';
  heading.textContent = localizedUiText('SELECCIONA UN MICRÓFONO');
  const options = entries.map(entry => {
    const option = document.createElement('button');
    const selectedOption = entry.device.deviceId === selected.device.deviceId;
    option.type = 'button';
    option.className = 'voice-overlay-device-option';
    option.dataset.voiceOverlayDeviceId = entry.device.deviceId;
    option.dataset.voiceOverlayDeviceType = entry.type;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(selectedOption));
    const icon = document.createElement('span');
    icon.className = 'voice-overlay-device-icon';
    icon.innerHTML = window.QSessionStudioIcon(entry.type);
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = localizedUiText(entry.name);
    const description = document.createElement('small');
    description.textContent = entry.type === 'auto' ? localizedUiText(entry.description) : entry.description;
    copy.append(name, description);
    const check = document.createElement('i');
    check.textContent = selectedOption ? '✓' : '';
    check.setAttribute('aria-hidden', 'true');
    option.append(icon, copy, check);
    return option;
  });
  const support = document.createElement('div');
  support.className = 'voice-overlay-device-support';
  const supportTitle = document.createElement('strong');
  supportTitle.textContent = localizedUiText('FORMAS DE CONEXIÓN');
  const types = document.createElement('div');
  [['3,5', 'Conector 3,5 mm'], ['BT', 'Bluetooth'], ['USB', 'USB']].forEach(([iconText, label]) => {
    const item = document.createElement('span');
    const icon = document.createElement('b');
    icon.innerHTML = window.QSessionStudioIcon(iconText === 'BT' ? 'bluetooth' : iconText === 'USB' ? 'usb' : 'plug');
    const copy = document.createElement('small');
    copy.textContent = localizedUiText(label);
    item.append(icon, copy);
    types.append(item);
  });
  const note = document.createElement('p');
  note.textContent = localizedUiText('Conéctalo o emparéjalo en tu dispositivo y pulsa ↻ para detectarlo.');
  support.append(supportTitle, types, note);
  menu.replaceChildren(heading, ...options, support);
  setVoiceOverlayDeviceMenuOpen(false);
}

function chooseVoiceOverlayDevice(deviceId) {
  const select = byId('voiceOverlayInput');
  if (![...select.options].some(option => option.value === deviceId)) return;
  select.value = deviceId;
  renderVoiceOverlayDevicePicker();
  select.dispatchEvent(new Event('change', {bubbles: true}));
  byId('voiceOverlayDeviceTrigger').focus();
}

function audioSourceName(source) {
  return {
    microphone: 'micrófono integrado',
    usb: 'entrada USB o interfaz de audio',
    hdmi: 'audio HDMI de una capturadora',
    line: 'conector de micrófono de 3,5 mm',
    bluetooth: 'micrófono Bluetooth',
  }[source] || 'entrada de audio';
}

function matchingAudioInput(devices, source) {
  return devices.find(device => audioInputDeviceType(device) === source) || null;
}

async function refreshAudioInputDevices({quiet = false, activeTrack = null, voiceTrack = null} = {}) {
  const select = byId('audioInput');
  const voiceSelect = byId('voiceOverlayInput');
  if (!navigator.mediaDevices?.enumerateDevices) {
    select.disabled = true;
    voiceSelect.disabled = true;
    byId('voiceOverlayDeviceTrigger').disabled = true;
    byId('audioInputStatus').textContent = 'Este navegador no permite seleccionar una entrada externa.';
    setStatus(byId('voiceOverlayStatus'), 'Este navegador no permite seleccionar un micrófono adicional.', true);
    return;
  }
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
    const activeDeviceId = String(activeTrack?.getSettings?.().deviceId || '');
    const source = byId('broadcastSource').value;
    const categoryMatch = PHYSICAL_AUDIO_SOURCES.has(source) ? matchingAudioInput(devices, source) : null;
    const preferredDeviceId = activeDeviceId || state.audioInputDeviceId || categoryMatch?.deviceId || '';
    const options = [new Option('Automática del sistema', '')];
    devices.forEach((device, index) => options.push(new Option(audioInputDeviceLabel(device, index), device.deviceId)));
    select.replaceChildren(...options);
    const available = devices.some(device => device.deviceId === preferredDeviceId);
    select.value = available ? preferredDeviceId : '';
    if (activeDeviceId && available) state.audioInputDeviceId = activeDeviceId;
    else if (state.audioInputDeviceId && !available) state.audioInputDeviceId = '';
    try { localStorage.setItem('qsession-audio-input-device', state.audioInputDeviceId); } catch { /* La selección continúa durante esta visita. */ }
    select.disabled = devices.length === 0;
    const externalCount = devices.filter(device => !['microphone', 'other'].includes(audioInputDeviceType(device))).length;
    const sourceMatches = PHYSICAL_AUDIO_SOURCES.has(source)
      ? devices.filter(device => audioInputDeviceType(device) === source).length
      : 0;
    byId('audioInputStatus').textContent = source !== 'microphone' && PHYSICAL_AUDIO_SOURCES.has(source)
      ? sourceMatches
        ? `${sourceMatches} entrada${sourceMatches === 1 ? '' : 's'} compatible${sourceMatches === 1 ? '' : 's'} disponible${sourceMatches === 1 ? '' : 's'}: ${audioSourceName(source)}.`
        : `No se detectó ${audioSourceName(source)}. Conéctala y pulsa ↻.`
      : externalCount
        ? `${externalCount} entrada${externalCount === 1 ? '' : 's'} externa${externalCount === 1 ? '' : 's'} disponible${externalCount === 1 ? '' : 's'}.`
        : 'Las entradas que reconozca el sistema aparecerán en esta lista.';

    const activeVoiceTrack = voiceTrack || state.voiceOverlayPublication?.track?.mediaStreamTrack || null;
    const activeVoiceDeviceId = String(activeVoiceTrack?.getSettings?.().deviceId || '');
    const preferredVoiceDeviceId = activeVoiceDeviceId || state.voiceOverlayDeviceId || '';
    const voiceOptions = [new Option('Automática del sistema', '')];
    devices.forEach((device, index) => voiceOptions.push(new Option(audioInputDeviceLabel(device, index), device.deviceId)));
    voiceSelect.replaceChildren(...voiceOptions);
    const voiceAvailable = devices.some(device => device.deviceId === preferredVoiceDeviceId);
    voiceSelect.value = voiceAvailable ? preferredVoiceDeviceId : '';
    if (activeVoiceDeviceId && voiceAvailable) state.voiceOverlayDeviceId = activeVoiceDeviceId;
    else if (state.voiceOverlayDeviceId && !voiceAvailable) state.voiceOverlayDeviceId = '';
    try { localStorage.setItem('qsession-voice-overlay-device', state.voiceOverlayDeviceId); } catch { /* La selección continúa durante esta visita. */ }
    voiceSelect.disabled = state.voiceOverlayStarting || state.voiceOverlayStopping;
    byId('voiceOverlayDeviceTrigger').disabled = state.voiceOverlayStarting || state.voiceOverlayStopping;
    renderVoiceOverlayDevicePicker(devices);
    if (!state.voiceOverlayPublication && !state.voiceOverlayStarting) {
      setStatus(byId('voiceOverlayStatus'), devices.length
        ? `${devices.length} micrófono${devices.length === 1 ? '' : 's'} disponible${devices.length === 1 ? '' : 's'}. La música no se interrumpirá.`
        : 'Conecta un micrófono Bluetooth, USB o de 3,5 mm y pulsa ↻.');
    }
  } catch (error) {
    if (!quiet) setMediaStatus(error.message || 'No fue posible buscar entradas de audio.', true);
  }
}

async function prepareRequestedAudioInput() {
  const source = byId('broadcastSource').value;
  if (!PHYSICAL_AUDIO_SOURCES.has(source) || source === 'microphone' || state.audioInputDeviceId) return;
  if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) return;
  let devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
  let match = matchingAudioInput(devices, source);
  if (!match && devices.some(device => !device.label)) {
    const permissionProbe = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
    permissionProbe.getTracks().forEach(track => track.stop());
    devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
    match = matchingAudioInput(devices, source);
  }
  if (!match) {
    throw new Error(`No se encontró ${audioSourceName(source)}. Comprueba la conexión en Windows o Android y pulsa ↻.`);
  }
  state.audioInputDeviceId = match.deviceId;
  try { localStorage.setItem('qsession-audio-input-device', state.audioInputDeviceId); } catch { /* La selección continúa durante esta visita. */ }
  byId('audioInput').value = match.deviceId;
}

function microphoneCaptureOptions() {
  const musicMode = byId('microphoneMode').value !== 'voice';
  const selectedDevice = state.audioInputDeviceId ? {deviceId: {exact: state.audioInputDeviceId}} : {};
  return {
    audio: musicMode ? {
      ...selectedDevice,
      channelCount: {ideal: 2},
      sampleRate: {ideal: 48000},
      sampleSize: {ideal: 16},
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      latency: {ideal: .02},
    } : {
      ...selectedDevice,
      channelCount: {ideal: 1},
      sampleRate: {ideal: 48000},
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

function microphoneCaptureError(error) {
  const name = String(error?.name || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new Error('Q Session no tiene permiso para usar el micrófono. En Android abre Ajustes › Aplicaciones › Q Session o Chrome › Permisos › Micrófono y elige “Permitir mientras se usa”.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new Error('No encontramos una entrada de audio disponible en este dispositivo.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new Error('El sistema no pudo abrir la entrada de audio. Cierra llamadas, grabadoras u otra aplicación que la esté usando y vuelve a intentarlo.');
  }
  if (name === 'SecurityError') return new Error('El navegador bloqueó el micrófono. Abre Q Session desde https://www.qsession.org.');
  return new Error(error?.message || 'No fue posible activar la entrada de audio.');
}

async function captureMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite capturar el micrófono. Actualiza Chrome o instala Q Session nuevamente.');
  await prepareRequestedAudioInput();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(microphoneCaptureOptions());
  } catch (firstError) {
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(String(firstError?.name || ''))) {
      throw microphoneCaptureError(firstError);
    }
    try {
      if (byId('broadcastSource').value !== 'microphone' && state.audioInputDeviceId) throw firstError;
      // Algunos teléfonos antiguos rechazan opciones de calidad aunque sí permiten audio básico.
      state.audioInputDeviceId = '';
      try { localStorage.removeItem('qsession-audio-input-device'); } catch { /* Continúa con la entrada automática. */ }
      stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
    } catch (fallbackError) {
      throw microphoneCaptureError(fallbackError);
    }
  }
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') {
    stream.getTracks().forEach(item => item.stop());
    throw new Error('El teléfono autorizó el micrófono, pero no entregó una señal de audio activa.');
  }
  track.enabled = true;
  try { track.contentHint = byId('microphoneMode').value === 'voice' ? 'speech' : 'music'; } catch { /* El navegador conserva su tratamiento predeterminado. */ }
  void refreshAudioInputDevices({quiet: true, activeTrack: track});
  return {stream, track};
}

function voiceOverlayCaptureOptions() {
  const selectedDevice = state.voiceOverlayDeviceId ? {deviceId: {exact: state.voiceOverlayDeviceId}} : {};
  return {
    audio: {
      ...selectedDevice,
      channelCount: {ideal: 1},
      sampleRate: {ideal: 48000},
      sampleSize: {ideal: 16},
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      latency: {ideal: .02},
    },
    video: false,
  };
}

async function captureVoiceOverlay() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite abrir un micrófono adicional.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(voiceOverlayCaptureOptions());
  } catch (error) {
    throw microphoneCaptureError(error);
  }
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') {
    stream.getTracks().forEach(item => item.stop());
    throw new Error('El sistema no entregó una señal activa desde el micrófono adicional.');
  }
  track.enabled = true;
  try { track.contentHint = 'speech'; } catch { /* El navegador conserva su tratamiento predeterminado. */ }
  return {stream, track};
}

async function createVoiceOverlayProcessor(capture) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  let context;
  try {
    context = new AudioContext({sampleRate: 48000, latencyHint: 'interactive'});
  } catch {
    context = new AudioContext();
  }
  await context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(capture.stream);
  const highPass = context.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 80;
  highPass.Q.value = .7;
  const bass = context.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 180;
  bass.gain.value = state.voiceOverlayBass;
  const treble = context.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 3500;
  treble.gain.value = state.voiceOverlayTreble;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = .004;
  compressor.release.value = .18;
  const gain = context.createGain();
  gain.gain.value = state.voiceOverlayVolume / 100;
  const destination = context.createMediaStreamDestination();
  source.connect(highPass);
  highPass.connect(bass);
  bass.connect(treble);
  treble.connect(compressor);
  compressor.connect(gain);
  gain.connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    await context.close().catch(() => undefined);
    return null;
  }
  try { track.contentHint = 'speech'; } catch { /* El navegador conserva su tratamiento predeterminado. */ }
  return {context, source, highPass, bass, treble, compressor, gain, destination, track};
}

function disposeVoiceOverlayProcessor(processor = state.voiceOverlayProcessor) {
  if (!processor) return;
  processor.source?.disconnect?.();
  processor.highPass?.disconnect?.();
  processor.bass?.disconnect?.();
  processor.treble?.disconnect?.();
  processor.compressor?.disconnect?.();
  processor.gain?.disconnect?.();
  processor.destination?.stream?.getTracks?.().forEach(track => track.stop());
  void processor.context?.close?.().catch(() => undefined);
  if (processor === state.voiceOverlayProcessor) state.voiceOverlayProcessor = null;
}

function renderVoiceOverlayToneControls() {
  byId('voiceOverlayVolume').value = String(state.voiceOverlayVolume);
  byId('voiceOverlayBass').value = String(state.voiceOverlayBass);
  byId('voiceOverlayTreble').value = String(state.voiceOverlayTreble);
  byId('voiceOverlayVolumeValue').textContent = `${Math.round(state.voiceOverlayVolume)}%`;
  byId('voiceOverlayBassValue').textContent = `${state.voiceOverlayBass > 0 ? '+' : ''}${Math.round(state.voiceOverlayBass)} dB`;
  byId('voiceOverlayTrebleValue').textContent = `${state.voiceOverlayTreble > 0 ? '+' : ''}${Math.round(state.voiceOverlayTreble)} dB`;
}

function applyVoiceOverlayTone() {
  const processor = state.voiceOverlayProcessor;
  const now = processor?.context?.currentTime || 0;
  processor?.gain?.gain?.setTargetAtTime?.(state.voiceOverlayVolume / 100, now, .02);
  processor?.bass?.gain?.setTargetAtTime?.(state.voiceOverlayBass, now, .02);
  processor?.treble?.gain?.setTargetAtTime?.(state.voiceOverlayTreble, now, .02);
  renderVoiceOverlayToneControls();
}

function stopVoiceOverlayMeter({keepContext = false} = {}) {
  if (state.voiceOverlayMeterTimer) cancelAnimationFrame(state.voiceOverlayMeterTimer);
  state.voiceOverlayMeterTimer = null;
  state.voiceOverlayMeterSource?.disconnect?.();
  state.voiceOverlayMeterSource = null;
  if (!keepContext) {
    void state.voiceOverlayMeterContext?.close?.().catch(() => undefined);
    state.voiceOverlayMeterContext = null;
  }
  byId('voiceOverlayMeter').style.width = '2%';
}

async function startVoiceOverlayMeter(mediaStreamTrack) {
  stopVoiceOverlayMeter({keepContext: true});
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !mediaStreamTrack) return;
  const context = state.voiceOverlayMeterContext?.state === 'closed' || !state.voiceOverlayMeterContext
    ? new AudioContext()
    : state.voiceOverlayMeterContext;
  state.voiceOverlayMeterContext = context;
  await context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  state.voiceOverlayMeterSource = source;
  const samples = new Uint8Array(analyser.fftSize);
  const render = () => {
    analyser.getByteTimeDomainData(samples);
    const level = Math.max(0, Math.min(1, audioLevel(samples) * 4));
    const muted = state.voiceOverlayPublication?.track?.isMuted;
    byId('voiceOverlayMeter').style.width = `${muted ? 2 : Math.max(2, Math.round(Math.pow(level, .62) * 100))}%`;
    state.voiceOverlayMeterTimer = requestAnimationFrame(render);
  };
  render();
}

function renderVoiceOverlayControl() {
  const publication = state.voiceOverlayPublication;
  const muted = Boolean(publication?.track?.isMuted);
  const active = Boolean(publication?.track) && !muted;
  const stateLabel = byId('voiceOverlayState');
  stateLabel.textContent = active ? 'Al aire' : muted ? 'Silenciado' : state.voiceOverlayStarting ? 'Conectando' : 'Preparado';
  stateLabel.classList.toggle('is-live', active);
  stateLabel.classList.toggle('is-muted', muted);
  const button = byId('toggleVoiceOverlay');
  button.disabled = state.mediaRole !== 'dj' || !state.mediaConnected || state.voiceOverlayStarting || state.voiceOverlayStopping;
  button.textContent = active ? 'Silenciar micrófono' : muted ? 'Reactivar micrófono' : state.voiceOverlayStarting ? 'Abriendo…' : 'Abrir micrófono';
  byId('voiceOverlayInput').disabled = state.voiceOverlayStarting || state.voiceOverlayStopping;
  byId('voiceOverlayDeviceTrigger').disabled = state.voiceOverlayStarting || state.voiceOverlayStopping;
  if (state.voiceOverlayStarting || state.voiceOverlayStopping) setVoiceOverlayDeviceMenuOpen(false);
  byId('refreshVoiceOverlayInputs').disabled = state.voiceOverlayStarting || state.voiceOverlayStopping;
}

async function stopVoiceOverlay({keepStatus = false} = {}) {
  if (state.voiceOverlayStopping) return;
  state.voiceOverlayStopping = true;
  renderVoiceOverlayControl();
  const publication = state.voiceOverlayPublication;
  const stream = state.voiceOverlayStream;
  const processor = state.voiceOverlayProcessor;
  state.voiceOverlayPublication = null;
  state.voiceOverlayStream = null;
  state.voiceOverlayProcessor = null;
  stopVoiceOverlayMeter();
  try {
    if (state.mediaRoom && publication?.track) {
      await state.mediaRoom.localParticipant.unpublishTrack(publication.track, true).catch(() => undefined);
    }
    stream?.getTracks().forEach(track => track.stop());
    disposeVoiceOverlayProcessor(processor);
  } finally {
    state.voiceOverlayStopping = false;
    renderVoiceOverlayControl();
    if (!keepStatus) setStatus(byId('voiceOverlayStatus'), 'Micrófono adicional cerrado. La transmisión principal continúa.');
  }
}

async function handleVoiceOverlayEnded() {
  if (state.voiceOverlayStopping || state.mediaDisconnecting) return;
  const publication = state.voiceOverlayPublication;
  const processor = state.voiceOverlayProcessor;
  state.voiceOverlayPublication = null;
  state.voiceOverlayProcessor = null;
  state.voiceOverlayStream?.getTracks().forEach(track => track.stop());
  state.privateVoiceFilterEngine?.stop?.();
  state.voiceOverlayStream = null;
  disposeVoiceOverlayProcessor(processor);
  stopVoiceOverlayMeter();
  if (state.mediaRoom && publication?.track) {
    await state.mediaRoom.localParticipant.unpublishTrack(publication.track, false).catch(() => undefined);
  }
  renderVoiceOverlayControl();
  setStatus(byId('voiceOverlayStatus'), 'El micrófono se desconectó. La música continúa; conéctalo nuevamente y pulsa “Abrir micrófono”.', true);
}

async function startVoiceOverlay() {
  if (!state.mediaRoom || !state.mediaConnected || state.mediaRole !== 'dj' || state.voiceOverlayStarting) return;
  state.voiceOverlayStarting = true;
  renderVoiceOverlayControl();
  setStatus(byId('voiceOverlayStatus'), 'Abriendo el micrófono sin detener la transmisión…');
  let capture = null;
  let processor = null;
  try {
    capture = await captureVoiceOverlay();
    const primaryDeviceId = PHYSICAL_AUDIO_SOURCES.has(state.mediaSourceKind)
      ? String(state.mediaAudioPublication?.track?.mediaStreamTrack?.getSettings?.().deviceId || '')
      : '';
    const voiceDeviceId = String(capture.track.getSettings?.().deviceId || '');
    if (primaryDeviceId && voiceDeviceId && primaryDeviceId === voiceDeviceId) {
      throw new Error('El audio principal ya usa ese dispositivo. Elige otro micrófono para evitar duplicar la señal.');
    }
    processor = await createVoiceOverlayProcessor(capture);
    const publishTrack = processor?.track || capture.track;
    const publication = await state.mediaRoom.localParticipant.publishTrack(publishTrack, {
      name: 'qsession-voice-overlay',
      source: window.LivekitClient.Track.Source.Microphone,
      dtx: true,
      red: true,
      forceStereo: false,
      audioPreset: {maxBitrate: 96000, priority: 'high'},
    });
    state.voiceOverlayStream = capture.stream;
    state.voiceOverlayProcessor = processor;
    state.voiceOverlayPublication = publication;
    const sourceTrack = capture.track;
    capture = null;
    processor = null;
    sourceTrack.addEventListener('ended', () => void handleVoiceOverlayEnded(), {once: true});
    const publishedTrack = publication?.track?.mediaStreamTrack || state.voiceOverlayProcessor?.track || sourceTrack;
    await startVoiceOverlayMeter(publishedTrack);
    await refreshAudioInputDevices({quiet: true, voiceTrack: sourceTrack});
    const inputName = byId('voiceOverlayInput').selectedOptions[0]?.textContent || 'Micrófono automático';
    setStatus(byId('voiceOverlayStatus'), `${inputName} al aire. La música continúa sin cortes.`);
  } catch (error) {
    capture?.stream?.getTracks().forEach(track => track.stop());
    disposeVoiceOverlayProcessor(processor);
    setStatus(byId('voiceOverlayStatus'), error.message || 'No fue posible abrir el micrófono adicional.', true);
  } finally {
    state.voiceOverlayStarting = false;
    renderVoiceOverlayControl();
  }
}

async function toggleVoiceOverlay() {
  const track = state.voiceOverlayPublication?.track;
  if (!track) {
    await startVoiceOverlay();
    return;
  }
  try {
    if (track.isMuted) await track.unmute();
    else await track.mute();
    renderVoiceOverlayControl();
    setStatus(byId('voiceOverlayStatus'), track.isMuted
      ? 'Micrófono silenciado. La música continúa transmitiéndose.'
      : 'Micrófono al aire sobre la transmisión.');
  } catch (error) {
    setStatus(byId('voiceOverlayStatus'), error.message || 'No fue posible cambiar el estado del micrófono.', true);
  }
}

async function reconnectVoiceOverlay() {
  const wasActive = Boolean(state.voiceOverlayPublication?.track);
  const wasMuted = Boolean(state.voiceOverlayPublication?.track?.isMuted);
  if (!wasActive) return;
  await stopVoiceOverlay({keepStatus: true});
  await startVoiceOverlay();
  if (wasMuted && state.voiceOverlayPublication?.track) {
    await state.voiceOverlayPublication.track.mute().catch(() => undefined);
    renderVoiceOverlayControl();
  }
}

async function prepareBroadcastAudio(source) {
  if (source === 'library') {await window.QSessionMusic.prime(); return window.QSessionMusic.capture();}
  if (PHYSICAL_AUDIO_SOURCES.has(source)) return captureMicrophone();
  if (source !== 'tab') throw new Error('Elige una fuente de audio disponible.');
  if (windowsDesktopBridge()) return {credentials: await mediaCredentials('dj', {nativeBroadcastAudio: true})};
  if (!navigator.mediaDevices?.getDisplayMedia || isNativeAndroidApp()) throw new Error('En este dispositivo usa la biblioteca o una entrada de audio.');
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {displaySurface:'browser',width:320,height:180,frameRate:1},
    audio: {...chromeTabAudioConstraints(),suppressLocalAudioPlayback:false},
    preferCurrentTab:false,selfBrowserSurface:'exclude',surfaceSwitching:'include',systemAudio:'include',windowAudio:'system',monitorTypeSurfaces:'exclude',audioSelection:'preferred',
  });
  const video=stream.getVideoTracks()[0], track=stream.getAudioTracks()[0];
  if(video?.getSettings?.().displaySurface !== 'browser' || !track) {
    stream.getTracks().forEach(item=>item.stop());
    throw new Error('Elige una pestaña de Chrome y activa Compartir audio de la pestaña.');
  }
  video.stop();
  try {await prepareChromeTabAudioTrack(track);} catch(error) {stream.getTracks().forEach(item=>item.stop());throw error;}
  return {stream,track};
}

async function publishSelectedAudio(room, preparedMicrophone = null, selectedSource = byId('broadcastSource').value) {
  const LiveKit = window.LivekitClient;
  const source = selectedSource;
  state.mediaSourceKind = source;
  if (source === 'library') {
    const capture = preparedMicrophone || await window.QSessionMusic.capture();
    try {
      state.mediaAudioPublication = await room.localParticipant.publishTrack(capture.track, {
        name: 'qsession-audius-library', source: LiveKit.Track.Source.ScreenShareAudio,
        forceStereo: true, dtx: false, red: false,
        audioPreset: {maxBitrate: state.broadcastAudioBitrate, priority: 'high'},
      });
      state.mediaCaptureStream = capture.stream;
      byId('mediaQuality').textContent = 'Biblioteca musical · originales + catálogo · estéreo';
      return capture.track;
    } catch (error) { window.QSessionMusic.release(); throw error; }
  }
  if (source === 'tab') {
    const desktopBridge = windowsDesktopBridge();
    if (desktopBridge) {
      const credentials = preparedMicrophone?.credentials || await mediaCredentials('dj', {nativeBroadcastAudio: true});
      state.desktopCaptureRoom = state.currentRoomCode;
      state.desktopCaptureActive = false;
      state.desktopCapturePaused = false;
      state.desktopCaptureStarting = true;
      byId('mediaQuality').textContent = `Pestaña de Chrome · estéreo 48 kHz · hasta ${Math.round(state.broadcastAudioBitrate / 1000)} kbps`;
      desktopBridge.postMessage({
        type: 'start-chrome-tab-capture',
        room: state.currentRoomCode,
        url: credentials.url,
        token: credentials.token,
        bitrate: state.broadcastAudioBitrate,
      });
      return null;
    }
    if (window.chrome?.webview?.postMessage) {
      throw new Error('Esta copia de Q Session para Windows usa una captación retirada. Instala Q Session Desktop 0.4.2 desde APP para volver a la captación directa de Chrome.');
    }
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Este navegador no permite compartir el audio de una pestaña.');
    const stream = preparedMicrophone?.stream || await navigator.mediaDevices.getDisplayMedia({
      video: {displaySurface: 'browser', width: 320, height: 180, frameRate: 1},
      audio: {...chromeTabAudioConstraints(), suppressLocalAudioPlayback: false},
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
      windowAudio: 'system',
      monitorTypeSurfaces: 'exclude',
      audioSelection: 'preferred',
    });
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    if (!preparedMicrophone && videoTrack?.getSettings?.().displaySurface !== 'browser') {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Elige “Pestaña de Chrome”, no una ventana ni la pantalla completa.');
    }
    if (!audioTrack) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('No llegó audio. Elige una pestaña y activa “Compartir audio de la pestaña”.');
    }
    const surface = preparedMicrophone ? 'browser' : videoTrack?.getSettings?.().displaySurface;
    videoTrack?.stop();
    await prepareChromeTabAudioTrack(audioTrack);
    state.mediaCaptureStream = stream;
    state.mediaAudioPublication = await room.localParticipant.publishTrack(audioTrack, {
      name: 'qsession-tab-audio',
      source: LiveKit.Track.Source.ScreenShareAudio,
      forceStereo: true,
      dtx: false,
      red: false,
      audioPreset: {maxBitrate: state.broadcastAudioBitrate, priority: 'high'},
    });
    await configureChromeTabAudioSender(state.mediaAudioPublication, state.broadcastAudioBitrate);
    audioTrack.addEventListener('ended', () => {
      if (state.mediaChangingSource || state.mediaDisconnecting || state.mediaCaptureStream !== stream) return;
      setMediaStatus('La pestaña dejó de compartirse. Puedes reiniciar la transmisión.', true);
      void disconnectMedia({keepConsole: true});
    }, {once: true});
    audioTrack.addEventListener('mute', () => {
      if (state.mediaAudioPublication?.track?.isMuted) return;
      setMediaStatus('La fuente seleccionada dejó de entregar música.', true);
    });
    byId('mediaQuality').textContent = `${surface === 'browser' ? 'Pestaña de Chrome' : surface === 'monitor' ? 'Audio del computador' : 'Fuente compartida'} · 48 kHz · hasta ${Math.round(state.broadcastAudioBitrate / 1000)} kbps`;
    return audioTrack;
  }
  const capture = preparedMicrophone || await captureMicrophone();
  const musicMode = byId('microphoneMode').value !== 'voice';
  try {
    state.mediaAudioPublication = await room.localParticipant.publishTrack(capture.track, {
      name: 'qsession-physical-audio-input',
      source: LiveKit.Track.Source.Microphone,
      dtx: !musicMode,
      red: true,
      forceStereo: musicMode && Number(capture.track.getSettings?.().channelCount || 1) > 1,
      audioPreset: {maxBitrate: musicMode ? Math.min(state.broadcastAudioBitrate, 128000) : Math.min(state.broadcastAudioBitrate, 96000), priority: 'high'},
    });
    state.mediaCaptureStream = capture.stream;
  } catch (error) {
    capture.stream.getTracks().forEach(item => item.stop());
    throw error;
  }
  const microphoneTrack = state.mediaAudioPublication?.track?.mediaStreamTrack || capture.track;
  if (microphoneTrack) {
    microphoneTrack.addEventListener('mute', () => {
      if (state.mediaCaptureStream !== capture.stream) return;
      if (state.mediaDisconnecting || state.mediaAudioPublication?.track?.isMuted) return;
      byId('mediaLiveBadge').textContent = 'ENTRADA PAUSADA';
      setMediaStatus('El sistema pausó temporalmente la entrada de audio. Mantén Q Session abierta para transmitir.', true);
    });
    microphoneTrack.addEventListener('unmute', () => {
      if (state.mediaCaptureStream !== capture.stream) return;
      byId('mediaLiveBadge').textContent = 'ENTRADA ACTIVA';
      setMediaStatus('Entrada de audio abierta y transmitiendo.');
    });
    microphoneTrack.addEventListener('ended', () => {
      if (state.mediaDisconnecting || state.mediaChangingSource || state.mediaCaptureStream !== capture.stream) return;
      byId('mediaLiveBadge').textContent = 'ENTRADA DETENIDA';
      setMediaStatus('El acceso a la entrada de audio terminó. Reinicia la transmisión para volver a activarla.', true);
    }, {once: true});
  }
  byId('mediaLiveBadge').textContent = 'ENTRADA ACTIVA';
  const inputName = byId('audioInput').selectedOptions[0]?.textContent || 'Entrada de audio';
  byId('mediaQuality').textContent = `${inputName} · ${musicMode ? 'música y ambiente' : 'voz'}`;
  return microphoneTrack;
}

function broadcastSourceMenuButtons() {
  return [...byId('broadcastSourceMenu').querySelectorAll('[data-broadcast-source-value]')];
}

function setBroadcastSourceMenuOpen(open, {focusSelected = false} = {}) {
  const trigger = byId('broadcastSourceTrigger');
  const menu = byId('broadcastSourceMenu');
  const nextOpen = Boolean(open);
  menu.hidden = !nextOpen;
  trigger.setAttribute('aria-expanded', String(nextOpen));
  if (nextOpen && focusSelected) {
    const selected = broadcastSourceMenuButtons().find(button => button.getAttribute('aria-selected') === 'true') || broadcastSourceMenuButtons()[0];
    selected?.focus();
  }
}

function syncBroadcastSourceControl() {
  const select = byId('broadcastSource');
  const buttons = broadcastSourceMenuButtons();
  const selected = buttons.find(button => button.dataset.broadcastSourceValue === select.value) || buttons[0];
  buttons.forEach(button => {
    const active = button === selected;
    button.setAttribute('aria-selected', String(active));
    const check = button.querySelector('i');
    if (check) check.textContent = active ? '✓' : '';
  });
  const name = selected?.querySelector('strong')?.textContent || select.selectedOptions[0]?.textContent || 'Fuente de audio';
  const description = selected?.querySelector('small')?.textContent || '';
  const icon = selected?.querySelector(':scope > span:first-child')?.textContent || '♫';
  byId('broadcastSourceTriggerLabel').textContent = name;
  byId('broadcastSourceTriggerDescription').textContent = description;
  byId('broadcastSourceTrigger').setAttribute('aria-label', `${localizedUiText('Fuente de audio')}: ${name}`);
  byId('broadcastSourceTrigger').querySelector('.broadcast-source-trigger-icon').innerHTML = window.QSessionStudioIcon(({library:'music',tab:'music',line:'plug'})[select.value] || select.value);
}

function chooseBroadcastSource(value) {
  const select = byId('broadcastSource');
  if (![...select.options].some(option => option.value === value)) return;
  select.value = value;
  syncBroadcastSourceControl();
  setBroadcastSourceMenuOpen(false);
  select.dispatchEvent(new Event('change', {bubbles: true}));
  byId('broadcastSourceTrigger').focus();
}

function updateBroadcastSourceHelp() {
  const source = byId('broadcastSource').value;
  const tabAudio = source === 'tab' || source === 'library';
  const musicMode = byId('microphoneMode').value !== 'voice';
  byId('microphoneModeControl').hidden = tabAudio;
  byId('audioInputControl').hidden = tabAudio;
  byId('broadcastQualityControl').hidden = false;
  const captureHelp = byId('captureHelp');
  captureHelp.hidden = tabAudio;
  captureHelp.textContent = tabAudio
    ? ''
    : source === 'hdmi'
      ? 'Selecciona el audio que expone tu capturadora HDMI. La capturadora debe aparecer en el sistema como entrada de audio.'
      : source === 'usb'
        ? 'Selecciona una interfaz, mezclador o micrófono USB. Q Session conservará 48 kHz y estéreo cuando el dispositivo lo permita.'
        : source === 'line'
          ? 'Usa el conector de micrófono o entrada de línea de 3,5 mm reconocido por el sistema.'
          : source === 'bluetooth'
            ? 'Selecciona el micrófono Bluetooth conectado. La calidad máxima depende del perfil de audio del dispositivo.'
            : musicMode
              ? 'Captura música, voces y ambiente desde el micrófono integrado.'
              : 'Optimiza el micrófono para hablar y reduce ruido y eco alrededor de la voz.';
  setBroadcastActionButtonLabel('changeBroadcastSource', tabAudio ? 'Cambiar fuente de música' : 'Reconectar entrada de audio');
  renderBroadcastAudioBitrateControl();
}

function configureDefaultBroadcastSource() {
  const source = byId('broadcastSource');
  const canShareChromeAudio = Boolean(windowsDesktopBridge()) || (!isNativeAndroidApp() && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !devicePrefersPortraitCamera());
  broadcastSourceMenuButtons().forEach(button=>{if(button.dataset.broadcastSourceValue==='tab'){button.hidden=!canShareChromeAudio;button.disabled=!canShareChromeAudio;}});
  const tabOption=[...source.options].find(option=>option.value==='tab');if(tabOption)tabOption.disabled=!canShareChromeAudio;
  source.value = 'library';
  syncBroadcastSourceControl();
  updateBroadcastSourceHelp();
  void refreshAudioInputDevices({quiet: true});
}

async function startBroadcast() {
  // Conserva el permiso del toque antes de esperar la conexión con el servidor.
  primeMediaMeter();
  let preparedMicrophone = null;
  try {
    byId('startBroadcast').disabled = true;
    const source = byId('broadcastSource').value;
    const sessionMode = state.currentRoom?.broadcastMode || 'live';
    if (sessionMode !== 'recorded' && source === 'library') await window.QSessionMusic.prime();
    if (sessionMode !== 'recorded' && PHYSICAL_AUDIO_SOURCES.has(source)) {
      setMediaStatus(`Solicitando acceso a ${audioSourceName(source)}…`);
      // Android necesita recibir esta solicitud directamente desde el toque del usuario.
      preparedMicrophone = await captureMicrophone();
      setMediaStatus('Entrada de audio verificada. Conectando con la sala…');
    }
    const room = await connectMedia('dj');
    if (sessionMode !== 'recorded' && source === 'tab') setMediaStatus('Elige una pestaña y marca “Compartir audio”.');
    const audioTrack = sessionMode === 'recorded'
      ? await publishRecordedSession(room)
      : await publishSelectedAudio(room, preparedMicrophone);
    if (sessionMode === 'image') await publishSessionImage(room);
    preparedMicrophone = null;
    const edge = await api(`/api/rooms/${state.currentRoomCode}/broadcast/start`, {
      method: 'POST',
      body: JSON.stringify({hostToken: state.hostToken}),
    }).catch(error => ({ok: false, error}));
    setMediaControlsActive(true);
    setBroadcastActionButtonLabel('toggleBroadcastAudio', state.mediaSourceKind === 'tab' ? 'Silenciar música' : 'Silenciar audio principal');
    await startMediaMeter(audioTrack);
    if(sessionMode==='live'&&!state.localCameraEnabled)clearPrimaryVideo('La cámara está apagada; el audio ya está en vivo.');
    else if(state.sessionVisualPublication?.track)showPrimaryVideo(state.sessionVisualPublication.track,{local:true});
    const edgeSuffix = edge?.broadcast?.configured
      ? ' La señal económica para el público está iniciando.'
      : '';
    setMediaStatus((sessionMode === 'recorded'
      ? 'Video preeditado transmitiéndose con audio sincronizado.'
      : sessionMode === 'image'
        ? 'Imagen al aire con la fuente de audio seleccionada.'
        : byId('broadcastSource').value === 'tab'
      ? (state.desktopCaptureRoom
        ? 'Chrome se abrirá para que elijas la pestaña y actives “Compartir audio de la pestaña”.'
        : 'Fuente conectada. Reproduce música: las barras confirmarán que está saliendo.')
      : 'Entrada de audio abierta y transmitiendo. Comprueba las barras de nivel.') + edgeSuffix);
  } catch (error) {
    preparedMicrophone?.stream?.getTracks().forEach(track => track.stop());
    await disconnectMedia({keepConsole: true});
    setMediaControlsActive(false);
    byId('startBroadcast').disabled = false;
    setMediaStatus(error.message, true);
  }
}

function hasTypedAndroidBroadcastService() {
  const match = /QSessionAndroid\/(\d+)\.(\d+)\.(\d+)/i.exec(navigator.userAgent || '');
  return !!match && Number(match[1])*1000000+Number(match[2])*1000+Number(match[3]) >= 1040;
}

async function prepareNativeBroadcastService(roomCode, {source = state.mediaConnected ? state.mediaSourceKind : byId('broadcastSource').value, requiresCamera = Boolean(state.localCameraEnabled)} = {}) {
  if (!hasNativeAndroidAudio()) return;
  const requiresMicrophone = state.currentRoom?.broadcastMode !== 'recorded' && PHYSICAL_AUDIO_SOURCES.has(source);
  // Older APKs only support a microphone service, even for music files.
  // Their library broadcasts keep running in the visible WebView until updated.
  if (!hasTypedAndroidBroadcastService()) {
    if (requiresMicrophone) postNativeAudioCommand({type:'broadcast-service-start', roomCode});
    return;
  }
  const requestId = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const onStatus = event => {
      let detail;try{detail=JSON.parse(String(event.detail || '{}'));}catch{return;}
      if(detail.requestId!==requestId)return;
      if(detail.type==='broadcast-service-ready'){cleanup();resolve();}
      else if(detail.type==='broadcast-service-error'){cleanup();reject(new Error(detail.message || 'Android no pudo preparar la transmisión.'));}
    };
    const cleanup = () => {clearTimeout(timeout);window.removeEventListener('qsession-native-audio-status',onStatus);};
    const timeout = setTimeout(()=>{cleanup();reject(new Error('Android no respondió al iniciar la transmisión. Mantén la app abierta y reintenta.'));},8000);
    window.addEventListener('qsession-native-audio-status',onStatus);
    if(!postNativeAudioCommand({type:'broadcast-service-start',roomCode,requiresMicrophone,requiresCamera,requestId})){
      cleanup();reject(new Error('El servicio de transmisión Android no está disponible.'));
    }
  });
}

async function stopPublishedAudio() {
  window.QSessionMusic?.release();
  const visual = state.sessionVisualPublication?.track;
  if (state.mediaRoom && visual) await state.mediaRoom.localParticipant.unpublishTrack(visual, true).catch(() => undefined);
  stopSessionVisual();
  stopMediaMeter();
  stopDesktopChromeCapture();
  const room = state.mediaRoom;
  const track = state.mediaAudioPublication?.track;
  if (room && track) await room.localParticipant.unpublishTrack(track, true).catch(() => undefined);
  state.mediaCaptureStream?.getTracks().forEach(item => item.stop());
  state.mediaCaptureStream = null;
  state.mediaAudioPublication = null;
}

async function changeBroadcastSource() {
  if (!state.mediaRoom || !state.mediaConnected || state.mediaChangingSource) return;
  if (state.currentRoom?.broadcastMode === 'recorded') return;
  const selected=byId('broadcastSource').value;
  if(selected==='library'&&state.mediaSourceKind==='library') {void window.QSessionMusic.open();return;}
  const button=byId('changeBroadcastSource'), room=state.mediaRoom;
  const previous={publication:state.mediaAudioPublication,stream:state.mediaCaptureStream,kind:state.mediaSourceKind,muted:Boolean(state.mediaAudioPublication?.track?.isMuted||state.desktopCapturePaused)};
  let prepared=null,detached=false;
  state.mediaChangingSource=true;button.disabled=true;
  setMediaStatus('Comprobando la nueva fuente. La señal actual continúa.');
  try {
    prepared=await prepareBroadcastAudio(selected);
    if(room!==state.mediaRoom||!state.mediaConnected)throw new Error('La sala se desconectó durante el cambio.');
    await prepareNativeBroadcastService(state.currentRoomCode, {source: selected});
    if(room!==state.mediaRoom||!state.mediaConnected)throw new Error('La sala se desconectó durante el cambio.');
    if(previous.muted&&prepared.track)prepared.track.enabled=false;
    if(previous.publication?.track) {await room.localParticipant.unpublishTrack(previous.publication.track,false);detached=true;}
    const audioTrack=await publishSelectedAudio(room,prepared,selected);
    if(previous.muted&&state.mediaAudioPublication?.track)await state.mediaAudioPublication.track.mute();
    else if(previous.muted&&state.desktopCaptureRoom){state.desktopCapturePaused=true;postWindowsDesktopCommand({type:'set-chrome-tab-capture-paused',room:state.desktopCaptureRoom,paused:true});}
    if(previous.kind==='tab'&&selected!=='tab')stopDesktopChromeCapture();
    if(previous.kind==='library')window.QSessionMusic.release();
    previous.stream?.getTracks().forEach(track=>track.stop());
    await startMediaMeter(audioTrack);
    setBroadcastActionButtonLabel('toggleBroadcastAudio', previous.muted?(['tab','library'].includes(selected)?'Reactivar música':'Reactivar audio principal'):(['tab','library'].includes(selected)?'Silenciar música':'Silenciar audio principal'));
    setMediaStatus(previous.muted?'Nueva fuente preparada. El audio sigue silenciado.':'Nueva fuente al aire. Comprueba las barras de nivel.');
  } catch(error) {
    if(room===state.mediaRoom&&state.mediaAudioPublication?.track&&state.mediaAudioPublication.track!==previous.publication?.track)await room.localParticipant.unpublishTrack(state.mediaAudioPublication.track,true).catch(()=>undefined);
    if(selected==='library'&&previous.kind!=='library')window.QSessionMusic?.release();
    else prepared?.stream?.getTracks().forEach(track=>track.stop());
    if(room===state.mediaRoom&&state.mediaConnected) {
      state.mediaSourceKind=previous.kind;state.mediaCaptureStream=previous.stream;state.mediaAudioPublication=previous.publication;
      if(detached&&previous.publication?.track) {
        try {state.mediaAudioPublication=await room.localParticipant.publishTrack(previous.publication.track,{name:'qsession-restored-audio',source:PHYSICAL_AUDIO_SOURCES.has(previous.kind)?window.LivekitClient.Track.Source.Microphone:window.LivekitClient.Track.Source.ScreenShareAudio,forceStereo:!PHYSICAL_AUDIO_SOURCES.has(previous.kind),audioPreset:{maxBitrate:state.broadcastAudioBitrate,priority:'high'}});}
        catch {state.mediaAudioPublication=null;setMediaStatus('No se pudo restaurar la entrada. Vuelve a iniciar la transmisión.',true);await disconnectMedia({keepConsole:true});return;}
      }
      byId('broadcastSource').value=previous.kind;syncBroadcastSourceControl();updateBroadcastSourceHelp();
      await prepareNativeBroadcastService(state.currentRoomCode, {source: previous.kind}).catch(() => undefined);
      setMediaStatus(error.message+' La fuente anterior sigue al aire.',true);
    }
  } finally {state.mediaChangingSource=false;setMediaControlsActive(state.mediaConnected);renderBroadcastAudioBitrateControl();}
}

async function toggleRecordedPlayback() {
  const video=state.sessionVisualElement;
  if(state.currentRoom?.broadcastMode!=='recorded'||!video?.play)return;
  try {if(video.paused)await video.play();else video.pause();byId('toggleRecordedPlayback').textContent=video.paused?'Reanudar video':'Pausar video';setMediaStatus(video.paused?'Video y audio grabados en pausa.':'Video y audio grabados al aire.');}catch(error){setMediaStatus(error.message,true);}
}

async function restartRecordedPlayback() {
  if(state.currentRoom?.broadcastMode!=='recorded'||!state.mediaConnected||state.mediaChangingSource)return;
  state.mediaChangingSource=true;byId('restartRecordedPlayback').disabled=true;
  try {await stopPublishedAudio();const track=await publishRecordedSession(state.mediaRoom);await startMediaMeter(track);showPrimaryVideo(state.sessionVisualPublication.track,{local:true});byId('toggleRecordedPlayback').textContent='Pausar video';setMediaStatus('Video reiniciado desde el comienzo.');}
  catch(error){await disconnectMedia({keepConsole:true});setMediaStatus(error.message,true);}
  finally{state.mediaChangingSource=false;setMediaControlsActive(state.mediaConnected);}
}

async function toggleBroadcastAudio() {
  if (state.desktopCaptureRoom) {
    state.desktopCapturePaused = !state.desktopCapturePaused;
    postWindowsDesktopCommand({
      type: 'set-chrome-tab-capture-paused',
      room: state.desktopCaptureRoom,
      paused: state.desktopCapturePaused,
    });
    setBroadcastActionButtonLabel('toggleBroadcastAudio', state.desktopCapturePaused ? 'Reactivar música' : 'Silenciar música');
    setMediaStatus(state.desktopCapturePaused
      ? 'Pausando la música; la cámara y el micrófono adicional continúan.'
      : 'Reactivando la música de Chrome.');
    return;
  }
  const track = state.mediaAudioPublication?.track;
  if (!track) return;
  try {
    if (track.isMuted) await track.unmute();
    else await track.mute();
    const music = ['tab','library'].includes(state.mediaSourceKind);
    setBroadcastActionButtonLabel('toggleBroadcastAudio', track.isMuted
      ? (music ? 'Reactivar música' : 'Reactivar audio principal')
      : (music ? 'Silenciar música' : 'Silenciar audio principal'));
    setMediaStatus(track.isMuted
      ? `${music ? 'Música' : 'Audio principal'} silenciado. El micrófono adicional conserva su estado.`
      : `${music ? 'Música' : 'Audio principal'} reactivado.`);
  } catch (error) {
    setMediaStatus(error.message, true);
  }
}

async function enableLocalCamera(room) {
  if (state.mediaRole === 'dj' && window.QSessionCameraEffects?.CameraEffectEngine && HTMLCanvasElement.prototype.captureStream) {
    const format = localCameraFormat();
    const videoConstraints = {
      width: {ideal: format.width},
      height: {ideal: format.height},
      aspectRatio: {ideal: format.aspectRatio},
      frameRate: {ideal: format.frameRate, max: 30},
      ...localCameraDeviceConstraint(),
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({video: videoConstraints, audio: false});
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw error;
      stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: false});
    }
    // The effects engine publishes a canvas track. Reset the physical source
    // before processing it; the canvas itself has no optical zoom capability.
    await resetCameraStreamToWidestAngle(stream);
    const engine = new window.QSessionCameraEffects.CameraEffectEngine(stream, {
      effect: state.cameraEffect,
      intensity: state.cameraEffectIntensity / 100,
      frameRate: format.frameRate,
    });
    try {
      const processedTrack = await engine.start();
      const publication = await room.localParticipant.publishTrack(processedTrack, {
        ...publicCameraPublishOptions(),
        source: window.LivekitClient.Track.Source.Camera,
        name: 'qsession-effects-camera',
      });
      state.cameraEffectEngine = engine;
      state.cameraEffectPublication = publication;
      return publication;
    } catch (error) {
      engine.stop();
      throw error;
    }
  }
  try {
    return await room.localParticipant.setCameraEnabled(
      true,
      localCameraCaptureOptions(),
      publicCameraPublishOptions(),
    );
  } catch (error) {
    if (!isNativeAndroidApp() || error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw error;
    // Some Android/WebView combinations reject a previously enumerated id or
    // portrait resolution even though the front camera itself is available.
    // Retry once with the least restrictive front-camera request.
    state.cameraDeviceId = '';
    state.cameraDeviceSelectionExplicit = false;
    await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
    return room.localParticipant.setCameraEnabled(
      true,
      {facingMode: 'user'},
      publicCameraPublishOptions(),
    );
  }
}

async function disableLocalCamera(room) {
  if (state.cameraEffectPublication?.track) {
    await room.localParticipant.unpublishTrack(state.cameraEffectPublication.track, true).catch(() => undefined);
    state.cameraEffectEngine?.stop();
    state.cameraEffectEngine = null;
    state.cameraEffectPublication = null;
    return null;
  }
  return room.localParticipant.setCameraEnabled(false);
}

async function toggleLocalCamera({listener = false} = {}) {
  const room = state.mediaRoom;
  if (!room || !state.mediaConnected) return;
  if (listener && !state.participantCameraAllowed) {
    setMediaStatus(state.currentRoom?.allowGuestCameras === false
      ? 'El anfitrión desactivó las cámaras de participantes para esta sesión.'
      : 'Para activar tu cámara, inicia sesión en tu cuenta. No necesitas mostrar un perfil público.', true);
    return;
  }
  const button = byId(listener ? 'toggleListenerCamera' : 'toggleCamera');
  try {
    const next = !state.localCameraEnabled;
    button.dataset.controlBusy = 'true';
    button.disabled = true;
    if (next) {
      refreshAutomaticCameraOrientation({force: true});
      // Every camera starts from the complete field of view. The participant
      // can choose a closer framing afterwards, but an old preference must
      // never make a new transmission open cropped or zoomed in.
      state.cameraFraming = 'far';
      applyLocalCameraFraming('far');
    }
    const cameraPublication = next
      ? await enableLocalCamera(room)
      : await disableLocalCamera(room);
    if (!listener && state.mediaRole === 'dj') {
      try { await prepareNativeBroadcastService(state.currentRoomCode, {requiresCamera: next}); }
      catch (error) { if (next) await disableLocalCamera(state.mediaRoom); throw error; }
    }
    state.localCameraEnabled = next;
    if (listener) setListenerActionButtonLabel(button, next ? 'Detener mi cámara' : 'Activar mi cámara');
    else setBroadcastActionButtonLabel(button, next ? 'Detener mi cámara' : 'Activar cámara');
    const publication = cameraPublication || room.localParticipant.getTrackPublication(window.LivekitClient.Track.Source.Camera);
    if (next && publication?.track) {
      void refreshCameraDevices({quiet: true});
      await calibrateLocalCameraTrack(publication.track, {resetToWidest: true});
      configureCameraFraming(publication);
      await publishLocalCameraDeliveryAttributes(room, publication.track).catch(() => undefined);
      registerPeopleCamera(publication.track, room.localParticipant, {local: true});
      if (!listener) showPrimaryVideo(publication.track, {local: true});
      setMediaStatus('Cámara activa.');
    } else {
      resetCameraFraming();
      unregisterPeopleCamera(room.localParticipant, {local: true});
      if (!listener) clearPrimaryVideo('La cámara está apagada; el audio continúa en vivo.');
      setMediaStatus('Cámara apagada.');
    }
  } catch (error) {
    const permissionDenied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    setMediaStatus(permissionDenied
      ? 'No se autorizó la cámara. Permite el acceso a Cámara para Q Session en los ajustes de Android y vuelve a intentarlo.'
      : error?.message || 'Android no pudo abrir la cámara frontal. Vuelve a intentarlo.', true);
  } finally {
    delete button.dataset.controlBusy;
    button.disabled = false;
  }
}

async function joinBroadcast({automatic = false} = {}) {
  const retryButton = byId('joinBroadcast');
  const request = {};
  const requestedRoomCode = state.currentRoomCode;
  const previousDelivery = state.broadcastDelivery;
  try {
    retryButton.hidden = true;
    retryButton.disabled = true;
    if (automatic) setMediaStatus('Conectando automáticamente con la sala…');
    if (await connectMedia('listener', {request}) === false) return;
    setMediaControlsActive(true);
    if (isCdnOnlyAudience()) return;
    scheduleListenerAudioRecovery();
    retryButton.hidden = true;
    // La cámara puede suscribirse mientras room.connect() aún está terminando.
    // No debemos borrar esa pista al completar la conexión.
    if (state.broadcastUsingEdge && state.broadcastEdgeReady) {
      showEdgeBroadcastStage();
      return;
    }
    if (!state.primaryVideoTrack) clearPrimaryVideo('Conectado. Esperando la cámara del DJ…');
    if (state.remoteAudioReceived) setMediaStatus(`Audio recibido desde la sala ${state.currentRoomCode}.`);
    else {
      setMediaStatus(`Conectado a la sala ${state.currentRoomCode}. Buscando la señal del DJ…`);
      scheduleListenerSignalCheck(state.mediaRoom);
    }
  } catch (error) {
    if (state.mediaConnectRequest !== request || state.currentRoomCode !== requestedRoomCode) return;
    if (!request.replacingPlayback || (previousDelivery && state.broadcastDelivery === previousDelivery && state.broadcastUsingEdge)) {
      showListenerRetry();
      setMediaStatus(error.message, true);
      return;
    }
    await disconnectMedia({keepConsole: true});
    setMediaControlsActive(false);
    showListenerRetry();
    setMediaStatus(error.message, true);
  }
}

async function toggleListenerSound() {
  const room = state.mediaRoom;
  const mustActivate = state.listenerMuted || state.edgePlaybackNeedsGesture || room?.canPlaybackAudio === false;
  state.listenerMuted = !mustActivate;
  postNativeAudioCommand({type: 'listener-muted', muted: state.listenerMuted});
  if (!state.listenerMuted) {
    postNativeAudioCommand({type: 'listener-audio-focus', roomCode: state.currentRoomCode});
  }
  applyListenerWebAudioVolume();
  const elements = [...byId('mediaAudioRack').querySelectorAll('audio')];
  elements.forEach(element => { element.muted = listenerAudioElementShouldStayMuted(); });
  if (state.broadcastUsingEdge) {
    const video = byId('broadcastVideo');
    video.muted = state.listenerMuted || state.edgeNativeBackgroundActive || state.edgeNativeForegroundPending;
    video.volume = state.listenerOutputGain;
    if (!state.listenerMuted && !state.edgeNativeBackgroundActive && !await playEdgeBroadcastVideo({userGesture: true})) return;
    setListenerActionButtonLabel('toggleListenerSound', state.listenerMuted ? 'Reactivar sonido' : 'Silenciar');
    setMediaStatus(state.listenerMuted ? 'Sonido silenciado en este dispositivo.' : 'Sonido de la transmisión activo.');
    return;
  }
  if (state.nativeAudioReady) {
    setListenerActionButtonLabel('toggleListenerSound', state.listenerMuted ? 'Reactivar sonido' : 'Silenciar');
    setMediaStatus(state.listenerMuted
      ? 'Sonido nativo silenciado en este dispositivo.'
      : 'Audio nativo estéreo activo en este dispositivo.');
    return;
  }
  if (!state.listenerMuted) {
    try {
      if (typeof room?.startAudio === 'function') await room.startAudio();
      await Promise.all(elements.map(element => element.play?.()).filter(Boolean));
      setListenerActionButtonLabel('toggleListenerSound', 'Silenciar');
      setMediaStatus('Sonido activo en este dispositivo.');
    } catch {
      setListenerActionButtonLabel('toggleListenerSound', 'Activar sonido');
      setMediaStatus('El teléfono bloqueó el audio. Toca nuevamente “Activar sonido”.', true);
    }
    return;
  }
  setListenerActionButtonLabel('toggleListenerSound', 'Reactivar sonido');
  setMediaStatus('Sonido silenciado en este dispositivo.');
}

async function disconnectMedia({keepConsole = true, preserveNativeListener = false, preserveEdgePlayback = false, connectRequest = null} = {}) {
  state.mediaConnectRequest = connectRequest;
  const wasCdnOnly = isCdnOnlyAudience();
  listenerAudioRecoveryGeneration += 1;
  stopFlowerListeningRewards();
  window.QSessionMusic?.release();
  stopSessionVisual();
  void window.QSessionMusic?.showRoomTrack('');
  if (state.mediaRole === 'listener' && !preserveNativeListener) {
    postNativeAudioCommand({type: 'listener-stop'});
  }
  if (state.mediaRole === 'dj') postNativeAudioCommand({type: 'broadcast-service-stop'});
  state.mediaDisconnecting = true;
  state.broadcastAudiencePollAt = 0;
  state.androidBroadcastBackground = false;
  stopEdgeBroadcastPlayback({preserveNativeListener: preserveEdgePlayback});
  clearMediaSignalTimer();
  stopMediaMeter();
  stopDesktopChromeCapture();
  await stopVoiceOverlay({keepStatus: true});
  state.mediaCaptureStream?.getTracks().forEach(track => track.stop());
  state.mediaCaptureStream = null;
  const room = state.mediaRoom;
  state.mediaRoom = null;
  state.mediaRoomCode = '';
  state.globalPresenceTicket = '';
  state.mediaConnected = false;
  state.publicChatMicOpen = false;
  state.publicChatPushActive = false;
  state.mediaAudioPublication = null;
  state.remoteAudioReceived = false;
  state.remoteAudioTracks.clear();
  state.nativeAudioReady = false;
  state.nativeAudioFallback = false;
  state.localCameraEnabled = false;
  state.cameraDeviceSelectionExplicit = false;
  state.cameraAutomaticWideDeviceId = '';
  if (isNativeAndroidApp()) state.cameraDeviceId = '';
  stopConnectionMonitor();
  resetCameraSourceControl();
  resetCameraFraming();
  state.participantCameraAllowed = false;
  byId('mediaAudioRack').replaceChildren();
  state.peopleVideoTracks.clear();
  renderPeople();
  clearPrimaryVideo('La señal está detenida.');
  if (room) await room.disconnect().catch(() => undefined);
  updateMediaConnection(false);
  setMediaControlsActive(false);
  setBroadcastActionButtonLabel('toggleCamera', 'Activar cámara');
  setListenerActionButtonLabel('toggleListenerCamera', 'Activar mi cámara');
  setBroadcastActionButtonLabel('toggleBroadcastAudio', 'Silenciar audio principal');
  setStatus(byId('voiceOverlayStatus'), 'La música seguirá sonando mientras hablas. Admite micrófonos Bluetooth, USB, 3,5 mm e integrados.');
  if (!keepConsole) byId('mediaConsole').hidden = true;
  state.mediaDisconnecting = false;
  if (wasCdnOnly && state.account) startProfileActivityPolling();
}

async function returnFromListenerSession() {
  void releaseBroadcastAdmission(state.mediaRoomCode || state.currentRoomCode);
  const button = byId('sessionBackButton');
  button.disabled = true;
  try {
    await disconnectMedia({keepConsole: false});
    setCurrentRoom('', null);
    state.mediaRole = null;
    byId('roomCode').value = '';
    setStatus(byId('joinStatus'), 'Escribe el código o pega el enlace compartido. No necesitas una cuenta.');
    const nextUrl = new URL(location.href);
    nextUrl.searchParams.delete('room');
    nextUrl.hash = 'live';
    history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    setSessionBackVisible(false);
    showView('live', {updateHash: false});
  } finally {
    button.disabled = false;
  }
}

async function finishBroadcast() {
  const code = state.currentRoomCode;
  if (!code || !state.hostToken) return;
  const confirmed = await requestConfirmation({
    title: '¿Cerrar esta sesión?',
    message: 'La transmisión terminará para todas las personas y dejará de aparecer en Salas activas.',
    context: state.currentRoom?.name || code,
    confirmLabel: 'Cerrar sesión',
    cancelLabel: 'Seguir transmitiendo',
  });
  if (!confirmed) return;
  try {
    byId('stopBroadcast').disabled = true;
    const result = await api(`/api/rooms/${code}/end`, {method: 'POST', body: JSON.stringify({hostToken: state.hostToken})});
    state.currentRoom = result.room;
    state.hostToken = '';
    try { sessionStorage.removeItem(`qsession-host-${code}`); } catch { /* La sala ya fue cerrada en el servidor. */ }
    await disconnectMedia({keepConsole: false});
    setRoomShareMenuOpen(false);
    byId('roomResult').hidden = true;
    setCurrentRoom('', null);
    state.mediaRole = null;
    await loadPublicRooms({quiet: true});
    if (state.account) await loadSessionHistory({quiet: true});
    showView('live');
    toast('La sesión fue cerrada y retirada de Salas activas.');
  } catch (error) {
    setMediaStatus(error.message, true);
    byId('stopBroadcast').disabled = false;
  }
}

function prepareMediaConsole(role, room) {
  state.mediaRole = role;
  const mediaConsole = byId('mediaConsole');
  const mount = byId('liveMediaMount');
  if (mediaConsole.parentElement !== mount) mount.append(mediaConsole);
  mediaConsole.hidden = false;
  mediaConsole.dataset.mediaRole = role;
  mediaConsole.dataset.roomType = room?.roomType || 'custom';
  mediaConsole.dataset.roomDesignTheme = room?.designTheme || 'minimal';
  mediaConsole.dataset.roomDesignMotion = room?.designMotion || 'balanced';
  byId('djControls').hidden = role !== 'dj';
  byId('listenerControls').hidden = role !== 'listener';
  byId('hostSessionDangerZone').hidden = role !== 'dj';
  byId('activeRoomSettings').hidden = role !== 'dj';
  if (role === 'dj') populateActiveRoomSettings(room);
  byId('mediaRoleLabel').textContent = role === 'dj' ? 'CONSOLA DEL DJ' : 'SALA EN VIVO';
  byId('mediaConsoleTitle').textContent = room?.name || 'Sesión Q Session';
  byId('listenerRoomName').textContent = room?.name || 'Entrar a la señal';
  byId('listenerRoomCode').textContent = room?.code || state.currentRoomCode || '——';
  byId('mediaRoomCode').textContent = room?.code || state.currentRoomCode;
  byId('mediaQuality').textContent = 'Audio HD · red mundial';
  renderRoomPromotions(room);
  setSessionBackVisible(role === 'listener');
  updateMediaConnection(false);
  clearPrimaryVideo(role === 'dj' ? 'Elige una fuente y comienza a transmitir.' : 'Conectando con la transmisión…');
  setMediaControlsActive(false);
  if (role === 'dj') {
    updateBroadcastSourceHelp();
  } else {
    byId('joinBroadcast').hidden = true;
    byId('joinBroadcast').textContent = 'Reintentar conexión';
  }
  setMediaStatus(role === 'dj' ? 'Sala creada. Inicia la señal cuando estés listo.' : 'Sala encontrada. Conectando automáticamente…');
  showView('live');
  requestAnimationFrame(() => mediaConsole.scrollIntoView({behavior: 'smooth', block: 'start'}));
}

function syncActiveTranslationLanguages() {
  const source = byId('activeTranslationSource').value;
  all('[data-active-language]').forEach(input => {
    const isSource = input.dataset.activeLanguage === source;
    input.disabled = isSource;
    if (isSource) input.checked = false;
    input.closest('label')?.classList.toggle('is-disabled', isSource);
  });
}

function populateActiveRoomSettings(room = state.currentRoom) {
  if (!room) return;
  byId('activeRoomVisibility').value = room.visibility === 'public' ? 'public' : 'private';
  byId('activeRoomCapacity').value = room.capacity || '';
  byId('activeRoomCapacityMode').value = room.capacityMode === 'limited' ? 'limited' : 'expected';
  const billingLimit = Number(room.broadcastEventPlan?.effectiveMaxParticipants) || Number(room.billingPlan?.maxParticipants) || 0;
  byId('activeRoomCapacity').max = String(billingLimit || 1000000);
  byId('activeRoomCapacityHelp').textContent = billingLimit
    ? `${room.broadcastEventPlan?.effectiveMaxParticipants ? 'Este evento permite' : 'Tu plan admite'} hasta ${billingLimit.toLocaleString('es-CO')} personas. Elige “Límite máximo” para cerrar el ingreso al alcanzar tu aforo.`
    : 'Elige “Límite máximo” para cerrar el ingreso al alcanzar el aforo que escribas.';
  byId('activeTranslationSource').value = room.translation?.sourceLanguage || 'es';
  byId('activeTranslationMode').value = room.translation?.mode === 'audio' ? 'audio' : 'subtitles';
  const accessMethods = new Set(room.accessMethods || ['link', 'code', 'qr']);
  all('[data-active-access]').forEach(input => { input.checked = accessMethods.has(input.dataset.activeAccess); });
  const targetLanguages = new Set(room.translation?.targetLanguages || ['en', 'de']);
  all('[data-active-language]').forEach(input => { input.checked = targetLanguages.has(input.dataset.activeLanguage); });
  all('[data-active-feature]').forEach(input => { input.checked = room[input.dataset.activeFeature] === true; });
  syncActiveTranslationLanguages();
  setStatus(byId('activeRoomSettingsStatus'), '');
}

function syncPublicChatPanel() {
  const selectedRoomCode = state.currentRoomCode.length === 6 ? state.currentRoomCode : '';
  const activeRoomCode = activePublicChatCode();
  const hasActiveRoom = Boolean(activeRoomCode);
  const chatAllowed = !isCdnOnlyAudience() && state.currentRoom?.allowPublicChat !== false;
  const roomName = state.currentRoom?.name || (selectedRoomCode ? 'Sesión Q Session' : 'Sin sala activa');
  byId('publicChatRoomName').textContent = roomName;
  byId('publicChatRoomMeta').textContent = hasActiveRoom
    ? (chatAllowed ? `Sala ${activeRoomCode} · este es el único chat público activo para ti.` : 'Esta sala continúa en vivo sin chat público.')
    : (selectedRoomCode ? `Sala ${selectedRoomCode} · conéctate a la transmisión para activar su chat.` : 'Entra a una sala desde En vivo para conversar con sus participantes.');
  byId('publicChatRoomStatus').hidden = !hasActiveRoom || !chatAllowed;
  byId('publicChatPresence').textContent = publicChatPresenceCopy();
  byId('chatNoRoom').hidden = hasActiveRoom;
  byId('chatDisabledRoom').hidden = !hasActiveRoom || chatAllowed;
  byId('chatConversation').hidden = !hasActiveRoom || !chatAllowed;
  byId('chatNoRoomTitle').textContent = selectedRoomCode ? 'Conéctate para activar el chat' : 'Primero entra a una sala';
  byId('chatNoRoomText').textContent = selectedRoomCode
    ? `El chat de ${selectedRoomCode} aparecerá sólo mientras estés dentro de su transmisión en vivo.`
    : 'El chat se activa únicamente mientras estás conectado a una sesión en vivo.';
  renderPublicChatDirectory();
  updatePublicChatCallControls();
  if (!hasActiveRoom) return;
  byId('activeChatCode').textContent = activeRoomCode;
  byId('activeChatName').textContent = roomName;
}

function setChatMode(mode, {load = true, userInitiated = false} = {}) {
  const previousMode = state.chatMode;
  state.chatMode = ['private', 'group', 'public'].includes(mode) ? mode : 'private';
  if (previousMode !== state.chatMode) state.privateConversationOpen = false;
  if (userInitiated) state.chatModeChosen = true;
  all('[data-chat-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.chatMode === state.chatMode));
  });
  const groupMode = state.chatMode === 'group';
  byId('chatModeCurrentLabel').textContent = state.chatMode === 'public'
    ? 'Chat de la sala'
    : groupMode ? 'Chat grupal' : 'Chat privado';
  byId('chatModeCurrentHint').textContent = state.chatMode === 'public'
    ? 'Sala general'
    : groupMode ? 'Grupos privados' : 'Uno a uno';
  byId('privateChatSectionEyebrow').textContent = groupMode ? 'GRUPOS' : 'PRIVADO';
  byId('privateChatSectionTitle').textContent = groupMode ? 'Tus grupos' : 'Tus conversaciones';
  byId('newDirectChat').hidden = groupMode;
  byId('newGroupChat').hidden = !groupMode;
  byId('privateChatPanel').hidden = state.chatMode === 'public';
  byId('publicChatPanel').hidden = state.chatMode !== 'public';
  if (state.chatMode === 'public') {
    void disconnectPrivateVoice();
    syncPublicChatPanel();
    if (load) void loadChatDirectoryContacts({quiet: true});
    if (load && activePublicChatCode()) void loadChatMessages({quiet: true});
  } else {
    const previousId = state.activePrivateConversationId;
    const visible = privateConversationsForMode();
    if (!visible.some(conversation => conversation.id === previousId)) {
      state.activePrivateConversationId = visible[0]?.id || '';
      if (previousId) void disconnectPrivateVoice();
    }
    renderPrivateConversationList();
    renderActivePrivateConversation();
    if (load) void loadPrivateConversations({quiet: true});
  }
  if (chatViewIsVisible()) startChatPolling();
}

function renderChat() {
  const signedIn = Boolean(state.account);
  const messagesAllowed = Boolean(state.profile?.social?.allowMessages);
  byId('chatIdentityGate').hidden = signedIn;
  byId('chatPermissionGate').hidden = !signedIn || messagesAllowed;
  byId('chatReady').hidden = !signedIn || !messagesAllowed;

  if (!signedIn) {
    stopChatPolling();
    void disconnectPrivateVoice();
    return;
  }

  renderProfileAvatar('chatPermissionInitial');
  if (!messagesAllowed) {
    stopChatPolling();
    void disconnectPrivateVoice();
    return;
  }

  if (!state.chatModeChosen) state.chatMode = 'private';
  syncChatContext();
  syncPublicChatPanel();
  setChatMode(state.chatMode, {load: chatViewIsVisible()});
}

function activePrivateConversation() {
  return state.privateConversations.find(conversation => conversation.id === state.activePrivateConversationId) || null;
}

function privateConversationsForMode() {
  return state.privateConversations.filter(conversation => (
    state.chatMode === 'group' ? conversation.type === 'group' : conversation.type !== 'group'
  ));
}

function privateConversationAvatar(conversation) {
  const other = conversation.type === 'direct'
    ? conversation.members?.find(member => member.id !== state.profile?.id)
    : null;
  const avatarUrl = other?.avatarUrl;
  const title = conversation.title || conversation.name || 'Chat privado';
  return avatarUrl
    ? `<span class="private-conversation-avatar"><img src="${escapeAttribute(avatarUrl)}" alt="" /></span>`
    : `<span class="private-conversation-avatar">${escapeAttribute(String(title).charAt(0).toUpperCase() || 'Q')}</span>`;
}

function renderPrivateConversationList() {
  const list = byId('privateConversationList');
  const conversations = privateConversationsForMode();
  if (!conversations.length) {
    list.innerHTML = state.chatMode === 'group'
      ? '<p>Aún no tienes grupos. Crea uno con tus contactos.</p>'
      : '<p>Aún no tienes conversaciones uno a uno.</p>';
    return;
  }
  list.innerHTML = conversations.map(conversation => {
    const lastQmoji = QMOJI_BY_TOKEN.get(conversation.lastMessage?.text);
    const description = lastQmoji
      ? `Qmoji · ${qmojiLabel(lastQmoji)}`
      : conversation.lastMessage?.text
      || (conversation.type === 'group' ? `${conversation.memberCount} personas` : 'Conversación uno a uno');
    return `<button type="button" class="private-conversation-item" data-private-conversation="${escapeAttribute(conversation.id)}" aria-current="${conversation.id === state.activePrivateConversationId}">
      ${privateConversationAvatar(conversation)}
      <span><strong>${escapeAttribute(conversation.title || 'Chat privado')}</strong><small>${escapeAttribute(description)}</small></span>
    </button>`;
  }).join('');
}

function renderActivePrivateConversation() {
  const conversation = activePrivateConversation();
  byId('privateChatPanel').classList.toggle('is-conversation-open', Boolean(conversation && state.privateConversationOpen));
  byId('privateChatEmpty').hidden = Boolean(conversation);
  byId('privateChatConversation').hidden = !conversation;
  if (!conversation) return;
  byId('activePrivateChatName').textContent = conversation.title || 'Chat privado';
  const names = conversation.members?.map(member => member.id === state.profile?.id ? 'Tú' : member.displayName).join(', ') || '';
  byId('activePrivateChatMembers').textContent = `${conversation.memberCount} ${conversation.memberCount === 1 ? 'persona' : 'personas'}${names ? ` · ${names}` : ''}`;
  const otherMember = conversation.type === 'direct'
    ? conversation.members?.find(member => member.id !== state.profile?.id)
    : null;
  const profileButton = byId('privateChatProfileButton');
  profileButton.hidden = !otherMember?.visible;
  profileButton.dataset.profileId = otherMember?.id || '';
  const history = state.privateMessageHistory.get(conversation.id);
  renderPrivateMessageCollection(history?.messages || []);
  byId('loadEarlierPrivateMessages').hidden = !history?.hasMore;
  updatePrivateVoiceControls();
}

async function loadPrivateConversations({quiet = false} = {}) {
  if (state.privateChatLoading || !state.profile?.social?.allowMessages) return;
  state.privateChatLoading = true;
  try {
    const result = await api('/api/private-conversations');
    const previousId = state.activePrivateConversationId;
    state.privateConversations = result.conversations || [];
    const requested = state.requestedPrivateConversationId
      ? state.privateConversations.find(conversation => conversation.id === state.requestedPrivateConversationId)
      : null;
    if (requested) {
      setChatMode(requested.type === 'group' ? 'group' : 'private', {load: false, userInitiated: true});
      state.activePrivateConversationId = requested.id;
      state.privateConversationOpen = true;
      state.requestedPrivateConversationId = '';
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.delete('conversation');
      nextUrl.searchParams.delete('answerCall');
      nextUrl.hash = 'chat';
      history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      showView('chat', {updateHash: false});
    }
    const visible = privateConversationsForMode();
    const desiredId = requested?.id || previousId;
    if (visible.some(conversation => conversation.id === desiredId)) {
      state.activePrivateConversationId = desiredId;
    } else {
      state.activePrivateConversationId = visible[0]?.id || '';
    }
    renderPrivateConversationList();
    renderActivePrivateConversation();
    if (state.activePrivateConversationId && (!quiet || state.activePrivateConversationId !== previousId)) {
      void loadPrivateChatMessages({quiet: true});
    }
  } catch (error) {
    byId('privateConversationList').innerHTML = `<p>${escapeAttribute(error.message)}</p>`;
  } finally {
    state.privateChatLoading = false;
  }
}

async function openPrivateConversation(conversationId) {
  const conversation = state.privateConversations.find(item => item.id === conversationId);
  if (!conversation) return;
  const targetMode = conversation.type === 'group' ? 'group' : 'private';
  if (state.chatMode !== targetMode) setChatMode(targetMode, {load: false, userInitiated: true});
  if (state.privateVoiceConversationId && state.privateVoiceConversationId !== conversationId) await disconnectPrivateVoice();
  state.activePrivateConversationId = conversationId;
  state.privateConversationOpen = true;
  renderPrivateConversationList();
  renderActivePrivateConversation();
  await loadPrivateChatMessages();
}

function mergePrivateMessageHistory(...collections) {
  const messages = [];
  const positions = new Map();
  collections.flat().forEach(message => {
    if (!message?.id) return;
    if (positions.has(message.id)) messages[positions.get(message.id)] = message;
    else {
      positions.set(message.id, messages.length);
      messages.push(message);
    }
  });
  return messages;
}

async function loadPrivateChatMessages({quiet = false, older = false} = {}) {
  const conversationId = state.activePrivateConversationId;
  if (state.chatLoading || !conversationId || !state.profile?.social?.allowMessages) return;
  const cached = state.privateMessageHistory.get(conversationId) || null;
  if (older && (!cached?.messages?.length || !cached.hasMore)) return;
  state.chatLoading = true;
  const status = byId('privateChatMessageStatus');
  if (!quiet) setStatus(status, older ? 'Buscando mensajes anteriores…' : 'Conectando con la conversación privada…');
  try {
    const before = older ? `&before=${encodeURIComponent(cached.messages[0].id)}` : '';
    const result = await api(`/api/private-conversations/${encodeURIComponent(conversationId)}/messages?limit=100${before}`);
    const position = state.privateConversations.findIndex(conversation => conversation.id === conversationId);
    if (position >= 0 && result.conversation) state.privateConversations[position] = result.conversation;
    const incoming = result.messages || [];
    const expanded = older || Boolean(cached?.expanded);
    const history = {
      messages: older
        ? mergePrivateMessageHistory(incoming, cached.messages)
        : expanded ? mergePrivateMessageHistory(cached?.messages || [], incoming) : incoming,
      hasMore: expanded && !older ? Boolean(cached?.hasMore) : Boolean(result.pagination?.hasMore),
      expanded,
    };
    state.privateMessageHistory.set(conversationId, history);
    if (state.activePrivateConversationId === conversationId) {
      renderActivePrivateConversation();
      renderPrivateMessageCollection(history.messages);
      byId('loadEarlierPrivateMessages').hidden = !history.hasMore;
    }
    connectChatRealtime(result.realtime);
    if (!quiet) setStatus(status, older ? 'Mensajes anteriores cargados.' : 'Chat privado conectado.');
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    state.chatLoading = false;
  }
}

async function sendPrivateChatMessage(text, kind = 'text') {
  const cleanText = String(text || '').trim();
  const conversationId = state.activePrivateConversationId;
  if (!cleanText || !conversationId) return;
  const status = byId('privateChatMessageStatus');
  setStatus(status, 'Enviando…');
  try {
    const result = await api(`/api/private-conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({kind, text: cleanText}),
    });
    byId('privateChatMessageInput').value = '';
    mergeRealtimePrivateMessage(conversationId, result.message);
    if (state.chatRealtimeSocket?.readyState !== WebSocket.OPEN) await loadPrivateChatMessages({quiet: true});
    void loadPrivateConversations({quiet: true});
    setStatus(status, 'Mensaje privado enviado.');
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

async function fileAsDataUrl(file, errorMessage) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(errorMessage));
    reader.readAsDataURL(file);
  });
}

async function sendPrivateChatAttachment(file) {
  const conversationId = state.activePrivateConversationId;
  if (!file || !conversationId) return;
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);
  const status = byId('privateChatMessageStatus');
  if (!supportedTypes.has(file.type)) {
    return setStatus(status, 'Adjunta una foto JPG, PNG o WebP, o un video MP4, WebM o MOV.', true);
  }
  if (file.size > 12 * 1024 * 1024) return setStatus(status, 'El archivo debe pesar como máximo 12 MB.', true);
  const input = byId('privateChatAttachmentInput');
  input.disabled = true;
  setStatus(status, file.type.startsWith('image/') ? 'Guardando la foto en esta conversación…' : 'Guardando el video en esta conversación…');
  try {
    const dataUrl = await fileAsDataUrl(file, 'No fue posible leer el archivo');
    await api(`/api/private-conversations/${encodeURIComponent(conversationId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify({dataUrl, name: file.name}),
    });
    if (state.activePrivateConversationId === conversationId) await loadPrivateChatMessages({quiet: true});
    void loadPrivateConversations({quiet: true});
    setStatus(status, file.type.startsWith('image/') ? 'Foto guardada en la conversación.' : 'Video guardado en la conversación.');
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    input.disabled = false;
  }
}

function setPrivateChatKind(kind) {
  state.privateChatKind = kind === 'group' ? 'group' : 'direct';
  all('[data-private-chat-kind]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.privateChatKind === state.privateChatKind));
  });
  const group = state.privateChatKind === 'group';
  byId('privateChatDialogTitle').textContent = group ? 'Nuevo grupo privado' : 'Chat uno a uno';
  byId('privateGroupNameField').hidden = !group;
  byId('privateContactLegend').textContent = group ? 'Elige de 2 a 9 personas · máximo 10 incluyéndote' : 'Elige una persona';
  byId('createPrivateChatButton').textContent = group ? 'Crear grupo privado' : 'Crear chat privado';
  renderPrivateContacts();
}

function renderPrivateContacts() {
  const list = byId('privateContactList');
  if (!state.privateContacts.length) {
    list.innerHTML = '<p>No hay personas activas ni contactos guardados con mensajes habilitados.</p>';
    return;
  }
  const inputType = state.privateChatKind === 'group' ? 'checkbox' : 'radio';
  list.innerHTML = state.privateContacts.map(contact => {
    const avatarUrl = contact.avatarUrl || contact.photos?.[0]?.url;
    const avatar = avatarUrl
      ? `<span class="private-conversation-avatar"><img src="${escapeAttribute(avatarUrl)}" alt="" /></span>`
      : `<span class="private-conversation-avatar">${escapeAttribute(String(contact.displayName || 'Q').charAt(0).toUpperCase())}</span>`;
    return `<label class="private-contact-option"><input type="${inputType}" name="private-contact" value="${escapeAttribute(contact.id)}" />${avatar}<span><strong>${escapeAttribute(contact.displayName || 'Oyente')}</strong><small>${escapeAttribute(personRole(contact))}</small></span></label>`;
  }).join('');
}

async function openPrivateChatCreator(kind = 'direct') {
  setChatMode(kind === 'group' ? 'group' : 'private', {load: false, userInitiated: true});
  setPrivateChatKind(kind);
  byId('privateGroupName').value = '';
  setStatus(byId('privateChatCreateStatus'), 'Buscando personas disponibles…');
  const dialog = byId('privateChatDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  try {
    const result = await api('/api/chat/contacts');
    const available = new Map((result.contacts || []).map(contact => [contact.id, contact]));
    for (const profile of activeRoomProfiles().values()) {
      if (profile.id === state.profile?.id || !profile.social?.allowMessages) continue;
      available.set(profile.id, profile);
    }
    state.privateContacts = [...available.values()].sort((left, right) => (
      String(left.displayName || '').localeCompare(String(right.displayName || ''))
    ));
    renderPrivateContacts();
    setStatus(byId('privateChatCreateStatus'), '');
  } catch (error) {
    state.privateContacts = [];
    renderPrivateContacts();
    setStatus(byId('privateChatCreateStatus'), error.message, true);
  }
}

function closePrivateChatCreator() {
  const dialog = byId('privateChatDialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function createPrivateChat() {
  const selected = all('#privateContactList input[name="private-contact"]:checked').map(input => input.value);
  const status = byId('privateChatCreateStatus');
  if (state.privateChatKind === 'direct' && selected.length !== 1) return setStatus(status, 'Elige una persona.', true);
  if (state.privateChatKind === 'group' && selected.length < 2) return setStatus(status, 'Elige al menos dos personas.', true);
  if (state.privateChatKind === 'group' && selected.length > 9) return setStatus(status, 'Cada grupo admite hasta 10 personas, incluyéndote.', true);
  setStatus(status, state.privateChatKind === 'group' ? 'Creando el grupo…' : 'Abriendo la conversación…');
  try {
    const result = await api('/api/private-conversations', {
      method: 'POST',
      body: JSON.stringify({
        type: state.privateChatKind,
        name: byId('privateGroupName').value.trim(),
        memberProfileIds: selected,
      }),
    });
    closePrivateChatCreator();
    await loadPrivateConversations({quiet: true});
    await openPrivateConversation(result.conversation.id);
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

function updatePrivateVoiceControls() {
  const connected = Boolean(state.privateVoiceRoom && state.privateVoiceConversationId === state.activePrivateConversationId);
  byId('joinPrivateVoice').disabled = connected;
  byId('joinPrivateVoice').textContent = connected ? 'Conectada' : 'Entrar';
  byId('togglePrivateCamera').disabled = !connected;
  byId('togglePrivateCamera').textContent = state.privateVoiceCameraOpen ? 'Apagar cámara' : 'Encender cámara';
  byId('togglePrivateCamera').classList.toggle('is-active', state.privateVoiceCameraOpen);
  byId('mutePrivateMic').disabled = !connected;
  byId('mutePrivateMic').classList.toggle('is-active', connected && !state.privateVoiceMicOpen && !state.privateVoicePushActive);
  byId('togglePrivateOpenMic').disabled = !connected;
  byId('togglePrivateOpenMic').textContent = 'Micrófono abierto';
  byId('togglePrivateOpenMic').classList.toggle('is-active', state.privateVoiceMicOpen);
  byId('privatePushToTalk').disabled = !connected || state.privateVoiceMicOpen;
  byId('privatePushToTalk').classList.toggle('is-talking', state.privateVoicePushActive);
  byId('leavePrivateVoice').disabled = !connected;
  byId('privateVoiceControlSummary').textContent = connected
    ? `${state.privateVoiceCameraOpen ? 'Cámara activa' : 'Cámara apagada'} · ${state.privateVoiceMicOpen ? 'Micrófono abierto' : state.privateVoicePushActive ? 'Hablando' : 'Micrófono silenciado'}`
    : 'Cámara y micrófono';
  const count = connected ? state.privateVoiceRoom.remoteParticipants.size + 1 : 0;
  byId('privateVoicePeople').textContent = connected
    ? `${count} ${count === 1 ? 'persona conectada' : 'personas conectadas'}`
    : 'Nadie conectado todavía';
}

function setPrivateVoiceStatus(message, error = false) {
  setStatus(byId('privateVoiceStatus'), message, error);
}

function removePrivateCallVideo(track) {
  detachedTrackElements(track).forEach(element => element.closest?.('.private-call-video-tile')?.remove());
  const grid = byId('privateCallVideoGrid');
  if (!grid.children.length) grid.hidden = true;
}

function attachPrivateCallVideo(track, participant, {local = false} = {}) {
  if (!track || track.kind !== 'video') return;
  removePrivateCallVideo(track);
  const grid = byId('privateCallVideoGrid');
  const figure = document.createElement('figure');
  figure.className = `private-call-video-tile${local ? ' is-local' : ''}`;
  const video = track.attach();
  video.autoplay = true;
  video.playsInline = true;
  video.muted = local;
  const orientation = local ? automaticCameraOrientation() : participantCameraOrientation(participant, track, video);
  syncVideoContainerAspect(figure, track, video, orientation, participantCameraRotation(participant));
  bindVideoAspectSync(video, () => syncVideoContainerAspect(figure, track, video, orientation, participantCameraRotation(participant)));
  const caption = document.createElement('figcaption');
  caption.textContent = local ? 'Tú' : participant?.name || 'Persona invitada';
  figure.append(video, caption);
  grid.append(figure);
  grid.hidden = false;
  void video.play?.().catch(() => undefined);
}

function attachPrivateVoiceTrack(track, publication, participant) {
  if (track.kind === 'video') {
    attachPrivateCallVideo(track, participant);
    return;
  }
  if (track.kind !== 'audio') return;
  const element = track.attach();
  element.autoplay = true;
  element.playsInline = true;
  byId('privateVoiceAudioRack').append(element);
  void element.play?.().catch(() => setPrivateVoiceStatus('Toca “Entrar a la voz” otra vez para activar el sonido.', true));
}

async function connectPrivateVoice() {
  const conversationId = state.activePrivateConversationId;
  if (!conversationId || state.privateVoiceRoom) return;
  const LiveKit = window.LivekitClient;
  if (!LiveKit?.Room) return setPrivateVoiceStatus('El motor de voz no se cargó. Actualiza la página.', true);
  setPrivateVoiceStatus('Entrando a la voz privada…');
  try {
    const credentials = await api(`/api/private-conversations/${encodeURIComponent(conversationId)}/voice-token`, {
      method: 'POST',
      body: JSON.stringify({notifyMembers: !state.answeringPrivateCall}),
    });
    state.answeringPrivateCall = false;
    const room = new LiveKit.Room({adaptiveStream: true, dynacast: true, disconnectOnPageLeave: false});
    room
      .on(LiveKit.RoomEvent.TrackSubscribed, (track, publication, participant) => attachPrivateVoiceTrack(track, publication, participant))
      .on(LiveKit.RoomEvent.TrackUnsubscribed, track => {
        if (track.kind === 'video') removePrivateCallVideo(track);
        else removeDetachedTrackElements(track);
      })
      .on(LiveKit.RoomEvent.ParticipantConnected, updatePrivateVoiceControls)
      .on(LiveKit.RoomEvent.ParticipantDisconnected, updatePrivateVoiceControls)
      .on(LiveKit.RoomEvent.Reconnecting, () => setPrivateVoiceStatus('Reconectando la voz privada…'))
      .on(LiveKit.RoomEvent.Reconnected, () => setPrivateVoiceStatus('Voz privada reconectada.'))
      .on(LiveKit.RoomEvent.Disconnected, () => {
        if (state.privateVoiceRoom !== room) return;
        state.privateVoiceFilterEngine?.stop?.();
        state.privateVoiceFilterEngine = null;
        state.privateVoiceFilterPublication = null;
        state.privateVoiceRoom = null;
        state.privateVoiceConversationId = '';
        state.privateVoiceMicOpen = false;
        state.privateVoicePushActive = false;
        state.privateVoiceCameraOpen = false;
        state.privateVoiceCameraTrack = null;
        state.privateVoiceCameraZoomRange = null;
        byId('privateVoiceAudioRack').replaceChildren();
        byId('privateCallVideoGrid').replaceChildren();
        byId('privateCallVideoGrid').hidden = true;
        byId('privateCallZoomControl').hidden = true;
        updatePrivateVoiceControls();
        setPrivateVoiceStatus('La conexión de voz terminó.');
      });
    if (typeof room.startAudio === 'function') void room.startAudio().catch(() => undefined);
    await room.connect(credentials.url, credentials.token, {autoSubscribe: true});
    state.privateVoiceRoom = room;
    state.privateVoiceConversationId = conversationId;
    state.privateVoiceMicOpen = false;
    updatePrivateVoiceControls();
    if (typeof room.startAudio === 'function') void room.startAudio().catch(() => undefined);
    setPrivateVoiceStatus('Entraste con cámara y micrófono apagados. Elige micrófono abierto o mantén el botón para hablar. Usa auriculares para evitar eco.');
  } catch (error) {
    setPrivateVoiceStatus(error.message, true);
  }
}

async function privateCallCaptureOptions() {
  const portrait = devicePrefersPortraitCamera();
  const format = portrait
    ? {width: 960, height: 1280, aspectRatio: 3 / 4, frameRate: 24}
    : {width: 1280, height: 720, aspectRatio: 16 / 9, frameRate: 24};
  let preferredDeviceId = '';
  try {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    preferredDeviceId = widestFrontCameraDevice(cameras)?.deviceId || '';
  } catch { /* La cámara frontal sigue disponible mediante facingMode. */ }
  return {
    resolution: format,
    ...(preferredDeviceId ? {deviceId: {exact: preferredDeviceId}} : {facingMode: 'user'}),
  };
}

function configurePrivateCallZoom(mediaTrack) {
  state.privateVoiceCameraTrack = mediaTrack || null;
  state.privateVoiceCameraZoomRange = cameraZoomRange(mediaTrack);
  const control = byId('privateCallZoomControl');
  const input = byId('privateCallZoom');
  const output = byId('privateCallZoomValue');
  const range = state.privateVoiceCameraZoomRange;
  control.hidden = !state.privateVoiceCameraOpen;
  input.disabled = !range || typeof mediaTrack?.applyConstraints !== 'function' || range.max <= range.min;
  if (!range) {
    input.value = '0';
    output.textContent = 'Encuadre original';
    return;
  }
  const current = Number(mediaTrack.getSettings?.().zoom);
  const position = Number.isFinite(current) && range.max > range.min
    ? Math.round((current - range.min) / (range.max - range.min) * 100)
    : 0;
  input.value = String(Math.max(0, Math.min(100, position)));
  output.textContent = position <= 2 ? 'Gran angular' : `${current.toFixed(1)}×`;
}

async function applyPrivateCallZoom(value) {
  const mediaTrack = state.privateVoiceCameraTrack;
  const range = state.privateVoiceCameraZoomRange;
  if (!mediaTrack || !range || typeof mediaTrack.applyConstraints !== 'function') return;
  const ratio = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
  const raw = range.min + (range.max - range.min) * ratio;
  const target = Math.min(range.max, Math.max(range.min, range.min + Math.round((raw - range.min) / range.step) * range.step));
  try {
    await mediaTrack.applyConstraints({advanced: [{zoom: target}]});
    byId('privateCallZoomValue').textContent = ratio <= .02 ? 'Gran angular' : `${target.toFixed(1)}×`;
  } catch {
    configurePrivateCallZoom(mediaTrack);
    setPrivateVoiceStatus('Esta cámara no pudo aplicar ese nivel de zoom.', true);
  }
}

function privateCallCameraAttributes(mediaTrack) {
  const portrait = devicePrefersPortraitCamera();
  const settings = mediaTrack?.getSettings?.() || {};
  return {
    'qsession.cameraFraming': 'far',
    'qsession.cameraOrientation': portrait ? 'portrait' : 'landscape',
    'qsession.cameraOrientationMode': 'automatic',
    'qsession.cameraDeviceClass': portrait ? 'mobile' : 'desktop',
    'qsession.cameraFrameWidth': String(settings.width || (portrait ? 960 : 1280)),
    'qsession.cameraFrameHeight': String(settings.height || (portrait ? 1280 : 720)),
    'qsession.cameraRotation': 'none',
    'qsession.cameraFormatVersion': CAMERA_FORMAT_VERSION,
  };
}

async function enablePrivateCallCamera() {
  const room = state.privateVoiceRoom;
  if (!room || state.privateVoiceCameraOpen) return;
  const captureOptions = await privateCallCaptureOptions();
  let publication = null;
  let sourceTrack = null;
  const filter = state.privateVoiceFilter;
  const useFilter = Boolean(filter.prompt && window.QSessionCameraEffects?.CameraEffectEngine && HTMLCanvasElement.prototype.captureStream);
  try {
    if (useFilter) {
      const format = captureOptions.resolution;
      const deviceConstraint = captureOptions.deviceId
        ? {deviceId: captureOptions.deviceId}
        : {facingMode: 'user'};
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: {ideal: format.width}, height: {ideal: format.height}, aspectRatio: {ideal: format.aspectRatio},
          frameRate: {ideal: format.frameRate, max: 30}, ...deviceConstraint,
        },
        audio: false,
      });
      sourceTrack = stream.getVideoTracks()[0];
      await resetCameraTrackToWidestAngle(sourceTrack);
      const engine = new window.QSessionCameraEffects.CameraEffectEngine(stream, {effect: 'custom', intensity: .78, frameRate: 24});
      engine.setCustomRecipe?.(filter);
      const processedTrack = await engine.start();
      publication = await room.localParticipant.publishTrack(processedTrack, {
        ...stableCameraPublishOptions(),
        source: window.LivekitClient.Track.Source.Camera,
        name: 'qsession-private-filter-camera',
      });
      state.privateVoiceFilterEngine = engine;
      state.privateVoiceFilterPublication = publication;
    } else {
      try {
        publication = await room.localParticipant.setCameraEnabled(true, captureOptions, stableCameraPublishOptions());
      } catch (error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw error;
        publication = await room.localParticipant.setCameraEnabled(true, {facingMode: 'user'}, stableCameraPublishOptions());
      }
      sourceTrack = publication?.track?.mediaStreamTrack || null;
      await resetCameraTrackToWidestAngle(sourceTrack);
    }
    publication = room.localParticipant.getTrackPublication?.(window.LivekitClient.Track.Source.Camera) || publication;
    const publishedTrack = publication?.track || state.privateVoiceFilterPublication?.track;
    if (!publishedTrack) throw new Error('No fue posible publicar la cámara.');
    state.privateVoiceCameraOpen = true;
    await room.localParticipant.setAttributes?.(privateCallCameraAttributes(sourceTrack)).catch(() => undefined);
    configurePrivateCallZoom(sourceTrack);
    attachPrivateCallVideo(publishedTrack, room.localParticipant, {local: true});
    updatePrivateVoiceControls();
    setPrivateVoiceStatus(`${devicePrefersPortraitCamera() ? 'Cámara vertical' : 'Cámara horizontal'} activa en gran angular${useFilter ? ' con tu efecto' : ''}.`);
  } catch (error) {
    state.privateVoiceFilterEngine?.stop?.();
    state.privateVoiceFilterEngine = null;
    state.privateVoiceFilterPublication = null;
    sourceTrack?.stop?.();
    setPrivateVoiceStatus(error?.name === 'NotAllowedError' ? 'No autorizaste la cámara.' : error.message, true);
  }
}

async function disablePrivateCallCamera() {
  const room = state.privateVoiceRoom;
  if (!room) return;
  const publication = state.privateVoiceFilterPublication
    || room.localParticipant.getTrackPublication?.(window.LivekitClient.Track.Source.Camera);
  if (state.privateVoiceFilterPublication?.track) {
    await room.localParticipant.unpublishTrack(state.privateVoiceFilterPublication.track, true).catch(() => undefined);
    state.privateVoiceFilterEngine?.stop?.();
  } else {
    await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
  }
  if (publication?.track) removePrivateCallVideo(publication.track);
  state.privateVoiceFilterEngine = null;
  state.privateVoiceFilterPublication = null;
  state.privateVoiceCameraOpen = false;
  state.privateVoiceCameraTrack = null;
  state.privateVoiceCameraZoomRange = null;
  byId('privateCallZoomControl').hidden = true;
  updatePrivateVoiceControls();
  setPrivateVoiceStatus('Cámara apagada. La llamada de audio continúa.');
}

async function togglePrivateCallCamera() {
  if (state.privateVoiceCameraOpen) await disablePrivateCallCamera();
  else await enablePrivateCallCamera();
}

async function mutePrivateMicrophone() {
  if (state.privateVoicePushActive) await stopPrivatePushToTalk();
  if (state.privateVoiceMicOpen) await setPrivateVoiceMicrophone(false);
  else {
    updatePrivateVoiceControls();
    setPrivateVoiceStatus('Micrófono silenciado. Sigues escuchando al grupo.');
  }
}

async function preparePrivateFilter() {
  const prompt = byId('privateFilterPrompt').value.trim();
  const trigger = ['always', 'movement', 'dance'].includes(byId('privateFilterTrigger').value)
    ? byId('privateFilterTrigger').value : 'always';
  if (!prompt) return setStatus(byId('privateFilterStatus'), 'Describe primero el filtro o disfraz que quieres crear.', true);
  state.privateVoiceFilter = {prompt, trigger};
  try {
    localStorage.setItem('qsession-private-filter-prompt', prompt);
    localStorage.setItem('qsession-private-filter-trigger', trigger);
  } catch { /* El filtro queda preparado durante esta visita. */ }
  setStatus(byId('privateFilterStatus'), `Efecto preparado: ${trigger === 'always' ? 'siempre visible' : trigger === 'dance' ? 'se intensifica al bailar' : 'aparece al moverte'}.`);
  if (state.privateVoiceCameraOpen) {
    await disablePrivateCallCamera();
    await enablePrivateCallCamera();
  }
}

async function clearPrivateFilter() {
  state.privateVoiceFilter = {prompt: '', trigger: 'always'};
  byId('privateFilterPrompt').value = '';
  byId('privateFilterTrigger').value = 'always';
  try {
    localStorage.removeItem('qsession-private-filter-prompt');
    localStorage.removeItem('qsession-private-filter-trigger');
  } catch { /* La cámara vuelve a natural durante esta visita. */ }
  setStatus(byId('privateFilterStatus'), 'Cámara natural preparada.');
  if (state.privateVoiceCameraOpen) {
    await disablePrivateCallCamera();
    await enablePrivateCallCamera();
  }
}

async function setPrivateVoiceMicrophone(enabled, {push = false} = {}) {
  const room = state.privateVoiceRoom;
  if (!room) return;
  try {
    await room.localParticipant.setMicrophoneEnabled(enabled, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    if (push) state.privateVoicePushActive = enabled;
    else state.privateVoiceMicOpen = enabled;
    updatePrivateVoiceControls();
    setPrivateVoiceStatus(enabled
      ? (push ? 'Estás hablando mientras mantienes presionado.' : 'Micrófono abierto: el grupo puede escucharte continuamente.')
      : 'Micrófono cerrado. Sigues escuchando al grupo.');
  } catch (error) {
    state.privateVoicePushActive = false;
    updatePrivateVoiceControls();
    setPrivateVoiceStatus(error?.name === 'NotAllowedError' ? 'No autorizaste el micrófono.' : error.message, true);
  }
}

async function togglePrivateOpenMicrophone() {
  if (state.privateVoicePushActive) await stopPrivatePushToTalk();
  await setPrivateVoiceMicrophone(!state.privateVoiceMicOpen);
}

async function startPrivatePushToTalk() {
  const room = state.privateVoiceRoom;
  if (!room || state.privateVoiceMicOpen || state.privateVoicePushActive) return;
  state.privateVoicePushActive = true;
  updatePrivateVoiceControls();
  try {
    await room.localParticipant.setMicrophoneEnabled(true, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    if (!state.privateVoicePushActive || state.privateVoiceRoom !== room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      return;
    }
    setPrivateVoiceStatus('Estás hablando mientras mantienes presionado.');
  } catch (error) {
    state.privateVoicePushActive = false;
    updatePrivateVoiceControls();
    setPrivateVoiceStatus(error?.name === 'NotAllowedError' ? 'No autorizaste el micrófono.' : error.message, true);
  }
}

async function stopPrivatePushToTalk() {
  const room = state.privateVoiceRoom;
  if (!room || !state.privateVoicePushActive || state.privateVoiceMicOpen) return;
  state.privateVoicePushActive = false;
  updatePrivateVoiceControls();
  await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
  setPrivateVoiceStatus('Micrófono cerrado. Sigues escuchando al grupo.');
}

async function disconnectPrivateVoice() {
  const room = state.privateVoiceRoom;
  if (room && state.privateVoiceCameraOpen) await disablePrivateCallCamera();
  state.privateVoiceRoom = null;
  state.privateVoiceConversationId = '';
  state.privateVoiceMicOpen = false;
  state.privateVoicePushActive = false;
  state.privateVoiceCameraOpen = false;
  state.privateVoiceCameraTrack = null;
  state.privateVoiceCameraZoomRange = null;
  state.privateVoiceFilterEngine?.stop?.();
  state.privateVoiceFilterEngine = null;
  state.privateVoiceFilterPublication = null;
  byId('privateVoiceAudioRack')?.replaceChildren();
  byId('privateCallVideoGrid')?.replaceChildren();
  if (byId('privateCallVideoGrid')) byId('privateCallVideoGrid').hidden = true;
  if (byId('privateCallZoomControl')) byId('privateCallZoomControl').hidden = true;
  if (room) await room.disconnect().catch(() => undefined);
  if (byId('privateVoicePeople')) updatePrivateVoiceControls();
}

function renderMessageCollection(container, messages, emptyText) {
  if (!messages.length) {
    container.innerHTML = `<div class="chat-message-empty">${escapeAttribute(emptyText)}</div>`;
    return;
  }
  container.innerHTML = messages.map(message => {
    const own = message.profileId && message.profileId === state.profile?.id;
    const createdAt = new Date(message.createdAt);
    const today = new Date();
    const validCreatedAt = !Number.isNaN(createdAt.getTime());
    const sameDay = validCreatedAt && createdAt.getFullYear() === today.getFullYear()
      && createdAt.getMonth() === today.getMonth()
      && createdAt.getDate() === today.getDate();
    const time = validCreatedAt ? `${sameDay ? '' : `${createdAt.toLocaleDateString([], {dateStyle: 'short'})} · `}${createdAt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '';
    const reaction = message.kind === 'reaction';
    const interaction = message.kind === 'interaction';
    const media = message.kind === 'image' || message.kind === 'video' || message.kind === 'voice';
    const qmoji = reaction ? QMOJI_BY_TOKEN.get(message.text) : null;
    const author = own ? 'Tú' : (message.author || 'Oyente');
    const avatarUrl = own ? profilePhotoUrl() : message.avatarUrl;
    const authorInitial = String(author).trim().charAt(0).toUpperCase() || 'Q';
    const avatar = avatarUrl
      ? `<span class="chat-message-avatar has-photo"><img src="${escapeAttribute(avatarUrl)}" alt="" /></span>`
      : `<span class="chat-message-avatar">${escapeAttribute(authorInitial)}</span>`;
    const body = interaction
      ? `<div class="chat-interaction-label">${message.interaction?.gift?.emoji ? `<span aria-hidden="true">${escapeAttribute(message.interaction.gift.emoji)}</span>` : ''}${escapeAttribute(message.text)}</div>`
      : media && (message.media || message.audio)
        ? `<figure class="chat-message-media">${message.kind === 'image'
          ? `<img src="${escapeAttribute(message.media.url)}" alt="Foto compartida por ${escapeAttribute(author)}" loading="lazy" />`
          : message.kind === 'video'
            ? `<video src="${escapeAttribute(message.media.url)}" controls preload="metadata" playsinline aria-label="Video compartido por ${escapeAttribute(author)}"></video>`
            : `<audio src="${escapeAttribute(message.audio?.url || message.media?.url || '')}" controls preload="metadata" aria-label="Nota de voz de ${escapeAttribute(author)}"></audio>`}${message.media?.originalName ? `<figcaption data-i18n-ignore>${escapeAttribute(message.media.originalName)}</figcaption>` : ''}</figure>`
        : qmoji
          ? `<div class="qmoji-message" title="${escapeAttribute(qmojiLabel(qmoji))}">${qmojiSvg(qmoji)}</div>`
        : `<p>${escapeAttribute(message.text)}</p>`;
    return `<article class="chat-message${own ? ' own' : ''}${reaction ? ' reaction' : ''}${interaction ? ' interaction' : ''}${media ? ' media' : ''}">
      <header><span class="chat-message-author">${avatar}<strong>${escapeAttribute(author)}</strong></span><time>${escapeAttribute(time)}</time></header>
      ${body}
    </article>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function renderChatMessages(messages) {
  renderMessageCollection(byId('chatMessages'), messages, 'Todavía no hay mensajes. Puedes ser el primero.');
}

function renderPrivateMessageCollection(messages) {
  renderMessageCollection(byId('privateChatMessages'), messages, 'Todavía no hay mensajes privados.');
}

async function loadChatMessages({quiet = false} = {}) {
  const roomCode = activePublicChatCode();
  if (state.chatLoading || !roomCode || state.currentRoom?.allowPublicChat === false || !state.profile?.social?.allowMessages) return;
  state.chatLoading = true;
  const status = byId('chatMessageStatus');
  if (!quiet) setStatus(status, 'Conectando con la conversación…');
  try {
    const result = await api(`/api/rooms/${roomCode}/messages?limit=100`, {
      headers: state.currentRoomAccessToken ? {'X-QSession-Room-Access': state.currentRoomAccessToken} : undefined,
    });
    if (roomCode !== activePublicChatCode()) return;
    state.currentRoom = result.room;
    state.roomChatParticipantCount = Math.max(1, Number(result.presence?.participantCount) || mediaParticipantCount());
    syncPublicChatPanel();
    syncChatContext();
    state.publicMessageRoomCode = roomCode;
    state.publicMessageHistory = result.messages || [];
    renderChatMessages(state.publicMessageHistory);
    connectChatRealtime(result.realtime);
    setStatus(status, '');
  } catch (error) {
    setStatus(status, error.message, true);
    if (/Inicia sesión|Activa Mensajes/.test(error.message)) {
      stopChatPolling();
      await restoreAccount();
    }
  } finally {
    state.chatLoading = false;
  }
}

async function sendChatMessage(text, kind = 'text') {
  const cleanText = String(text || '').trim();
  const roomCode = activePublicChatCode();
  if (!cleanText || !roomCode) return;
  const status = byId('chatMessageStatus');
  setStatus(status, 'Enviando…');
  try {
    const result = await api(`/api/rooms/${roomCode}/messages`, {
      method: 'POST',
      headers: state.currentRoomAccessToken ? {'X-QSession-Room-Access': state.currentRoomAccessToken} : undefined,
      body: JSON.stringify({kind, text: cleanText}),
    });
    if (roomCode !== activePublicChatCode()) return;
    state.roomChatParticipantCount = Math.max(1, Number(result.presence?.participantCount) || mediaParticipantCount());
    byId('chatMessageInput').value = '';
    mergePublicMessage(result.message);
    if (state.chatRealtimeSocket?.readyState !== WebSocket.OPEN) await loadChatMessages({quiet: true});
    setStatus(status, 'Mensaje enviado.');
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

all('button[data-view], [data-route]').forEach(control => control.addEventListener('click', event => {
  event.preventDefault();
  showView(control.dataset.view || control.dataset.route);
}));
all('[data-home-session-action]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.homeSessionAction;
  if (button.getAttribute('aria-expanded') === 'true') {
    showView('live');
    return;
  }
  let openedView = 'live';
  if (action === 'create') openedView = showView('create');
  else {
    showView('live');
    setHomeSessionAction('join');
  }
  requestAnimationFrame(() => byId(action === 'create' && openedView === 'create' ? 'roomTypeTrigger' : (action === 'join' ? 'roomCode' : ''))?.focus());
}));
byId('accountShortcut').addEventListener('click', () => {
  const dialog = byId('accountMenuDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
});
all('#accountMenuDialog [data-view]').forEach(button => button.addEventListener('click', () => byId('accountMenuDialog').close()));
byId('accountRewardsShortcut').addEventListener('click', () => {
  requestAnimationFrame(() => {
    byId('starWalletPanel').scrollIntoView({behavior: 'smooth', block: 'start'});
    void loadStars({quiet: true});
  });
});
all('[data-people-layout]').forEach(button => button.addEventListener('click', () => {
  state.peopleLayout = button.dataset.peopleLayout === 'scroll' ? 'scroll' : 'mosaic';
  applyPeopleView({render: true});
}));
byId('peopleNextGroup').addEventListener('click', () => {
  refreshPeopleCameraPage({next: true});
  renderPeople();
});
setInterval(() => {
  if (!peopleCamerasVisible() || byId('peopleNextGroup').disabled) return;
  refreshPeopleCameraPage({next: true});
  renderPeople();
}, 15000);
byId('peopleGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-person-profile]');
  if (button) void openPersonActions(button.dataset.personProfile);
});
byId('peopleActivityButton').addEventListener('click', () => void openProfileActivity());
byId('closePersonActionDialog').addEventListener('click', closePersonActions);
byId('personActionDialog').addEventListener('cancel', event => {
  event.preventDefault();
  closePersonActions();
});
byId('viewPersonProfile').addEventListener('click', () => {
  const details = byId('personProfileDetails');
  details.hidden = !details.hidden;
  byId('personGiftChoices').hidden = true;
});
byId('messagePerson').addEventListener('click', () => void messageSelectedPerson());
byId('giftPerson').addEventListener('click', () => {
  const choices = byId('personGiftChoices');
  choices.hidden = !choices.hidden;
  byId('personProfileDetails').hidden = true;
  byId('personStarChoices').hidden = true;
});
byId('tipPerson').addEventListener('click', () => {
  const choices = byId('personStarChoices');
  choices.hidden = !choices.hidden;
  byId('personGiftChoices').hidden = true;
  byId('personProfileDetails').hidden = true;
});
byId('personStarChoices').addEventListener('click', async event => {
  const button = event.target.closest('[data-send-stars]');
  const profile = selectedPersonProfile();
  if (!button || !profile) return;
  if (!state.account) { closePersonActions(); showView('profile'); return; }
  const stars = Number(button.dataset.sendStars);
  button.disabled = true;
  try {
    const result = await api('/api/stars/send', {method: 'POST', body: JSON.stringify({profileId: profile.id, stars, roomId: state.currentRoom?.id})});
    state.stars.balance = result.transfer.balance;
    renderStarWallet();
    setPersonActionStatus(`Enviaste ${stars} ★ a ${profile.displayName || 'este artista'}.`);
  } catch (error) { setPersonActionStatus(error.message, true); }
  finally { button.disabled = false; }
});
byId('personGiftChoices').addEventListener('click', event => {
  const button = event.target.closest('[data-send-flower]');
  if (button) void sendSelectedFlower(button.dataset.sendFlower);
});
byId('touchPerson').addEventListener('click', () => void sendSelectedProfileAction('touch'));
byId('savePersonProfile').addEventListener('click', () => void toggleSavedPersonProfile());
byId('sharePersonProfile').addEventListener('click', () => void shareSelectedPersonProfile());
byId('closeProfileActivityDialog').addEventListener('click', () => byId('profileActivityDialog').close());
byId('profileActivityDialog').addEventListener('cancel', event => {
  event.preventDefault();
  byId('profileActivityDialog').close();
});
byId('refreshProfileActivity').addEventListener('click', () => void loadProfileActivity());
byId('refreshSessionHistory').addEventListener('click', () => void loadSessionHistory());
byId('starPackageList').addEventListener('click', event => {
  const button = event.target.closest('[data-buy-star-package]');
  if (button) void buyStarPackage(button.dataset.buyStarPackage);
});
byId('sponsorRoomGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-watch-sponsor]');
  if (button) void watchSponsor(button.dataset.watchSponsor, button.dataset.roomCode, button);
});
byId('creatorPlanList').addEventListener('change', event => {
  const control = event.target.closest('input[name="billingPlan"]');
  if (!control) return;
  const selectedPlan = creatorBillingPlans().find(plan => plan.id === control.value);
  if (!selectedPlan) return;
  state.billingPlanMode = selectedPlan.billingInterval === 'monthly' ? 'monthly' : 'one_time';
  if (availableBillingUnits(selectedPlan.id) > 0 || !creatorBillingPlans().some(plan => availableBillingUnits(plan.id) > 0)) {
    state.selectedBillingPlanId = control.value;
    if (byId('roomCapacity')) byId('roomCapacity').value = String(selectedPlan.maxParticipants);
  }
  renderCreatorBilling();
});
byId('creatorPlanList').addEventListener('click', event => {
  const reloadButton = event.target.closest('[data-reload-billing]');
  if (reloadButton) {
    void loadBilling();
    return;
  }
  const modeButton = event.target.closest('[data-billing-plan-mode]');
  if (modeButton) {
    state.billingPlanMode = modeButton.dataset.billingPlanMode === 'monthly' ? 'monthly' : 'one_time';
    renderCreatorBilling();
    return;
  }
  const planSelector = event.target.closest('[data-select-billing-plan]');
  if (planSelector) {
    const selectedPlan = creatorBillingPlans().find(plan => plan.id === planSelector.dataset.selectBillingPlan);
    if (!selectedPlan) return;
    state.selectedBillingPlanId = selectedPlan.id;
    state.billingPlanMode = selectedPlan.billingInterval === 'monthly' ? 'monthly' : 'one_time';
    if (byId('roomCapacity')) byId('roomCapacity').value = String(selectedPlan.maxParticipants);
    renderCreatorBilling();
    return;
  }
  const button = event.target.closest('[data-purchase-plan]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  void purchaseBillingPlan(button.dataset.purchasePlan);
});
byId('customQuoteOpen').addEventListener('click', () => openCustomQuote());
byId('largeEventQuoteOpen').addEventListener('click', () => openCustomQuote(10000));
all('[data-quote-capacity]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.quoteCapacity === 'manual') {
    byId('customQuoteCapacity').focus();
    byId('customQuoteCapacity').select();
    return;
  }
  byId('customQuoteCapacity').value = button.dataset.quoteCapacity;
  scheduleCustomQuote();
}));
byId('customQuoteCopy').addEventListener('click', () => void copyCustomQuote());
byId('customQuoteDialog').addEventListener('close', () => {
  window.clearTimeout(state.customQuoteTimer);
  invalidateCustomQuote();
});
['customQuoteClose', 'customQuoteCancel'].forEach(controlId => {
  byId(controlId).addEventListener('click', () => byId('customQuoteDialog').close());
});
byId('customQuoteDialog').addEventListener('cancel', event => {
  event.preventDefault();
  byId('customQuoteDialog').close();
});
byId('customQuoteForm').addEventListener('submit', event => {
  event.preventDefault();
  void calculateCustomQuote();
});
byId('customQuoteForm').addEventListener('input', scheduleCustomQuote);
byId('customQuoteForm').addEventListener('change', scheduleCustomQuote);
byId('customQuotePurchase').addEventListener('click', () => void purchaseCustomQuote());
byId('sessionHistoryList').addEventListener('click', event => {
  const button = event.target.closest('[data-delete-hosted-session]');
  if (button) void deleteHostedSession(button.dataset.deleteHostedSession);
});
byId('profileActivityList').addEventListener('click', event => {
  const item = event.target.closest('[data-activity-profile]');
  if (!item) return;
  void openProfileActivityItem(item);
});
all('[data-chat-mode]').forEach(button => button.addEventListener('click', () => setChatMode(button.dataset.chatMode, {userInitiated: true})));
byId('privateChatMobileBack').addEventListener('click', () => {
  state.privateConversationOpen = false;
  renderActivePrivateConversation();
});
byId('publicChatPeopleSearch').addEventListener('input', event => {
  state.chatDirectoryQuery = event.currentTarget.value;
  renderPublicChatDirectory();
});
byId('refreshPublicChatPeople').addEventListener('click', () => {
  void loadChatDirectoryContacts();
  if (activePublicChatCode()) void loadChatMessages({quiet: true});
});
byId('publicChatPeopleList').addEventListener('click', event => {
  const messageButton = event.target.closest('[data-chat-directory-message]');
  if (messageButton) {
    void openChatDirectoryMessage(messageButton.dataset.chatDirectoryMessage);
    return;
  }
  const inviteButton = event.target.closest('[data-chat-directory-invite]');
  if (inviteButton) {
    void sendChatPlatformInvitation(inviteButton.dataset.chatDirectoryInvite);
    return;
  }
  const profileButton = event.target.closest('[data-chat-directory-profile]');
  if (profileButton) void openPersonActions(profileButton.dataset.chatDirectoryProfile);
});
byId('copyChatInviteLink').addEventListener('click', () => {
  const payload = chatInvitationPayload();
  if (payload.url) void copyRoomShareValue(payload.url, 'Enlace del chat copiado.');
});
byId('showChatInviteQr').addEventListener('click', openChatInviteDialog);
byId('focusChatInviteContact').addEventListener('click', () => {
  byId('publicChatPeopleSearch').focus();
  setStatus(byId('publicChatDirectoryStatus'), 'Busca un contacto y pulsa “Invitar” para avisarle dentro de Q Session.');
});
byId('closeChatInviteDialog').addEventListener('click', closeChatInviteDialog);
byId('chatInviteDialog').addEventListener('cancel', event => {
  event.preventDefault();
  closeChatInviteDialog();
});
byId('copyChatInviteDialogLink').addEventListener('click', () => {
  const payload = chatInvitationPayload();
  if (payload.url) void copyRoomShareValue(payload.url, 'Enlace del chat copiado.');
});
byId('shareChatInvite').addEventListener('click', () => void shareChatInvitation());
byId('newDirectChat').addEventListener('click', () => void openPrivateChatCreator('direct'));
byId('newGroupChat').addEventListener('click', () => void openPrivateChatCreator('group'));
byId('privateChatEmptyAction').addEventListener('click', () => void openPrivateChatCreator(state.chatMode === 'group' ? 'group' : 'direct'));
byId('privateContactInvite').addEventListener('click', () => openPrivateContactInviteDialog());
byId('closePrivateContactInvite').addEventListener('click', closePrivateContactInviteDialog);
byId('privateContactInviteDialog').addEventListener('cancel', event => {
  event.preventDefault();
  closePrivateContactInviteDialog();
});
byId('createPrivateContactInvite').addEventListener('click', () => void createPrivateContactInvitation());
byId('redeemPrivateContactInviteForm').addEventListener('submit', event => {
  event.preventDefault();
  void redeemPrivateContactInvitation(byId('privateContactInviteInput').value);
});
byId('privateContactInviteInput').addEventListener('input', event => {
  event.currentTarget.value = normalizePrivateContactInviteCode(event.currentTarget.value);
});
byId('scanPrivateContactInvite').addEventListener('click', () => void startRoomQrScanner('private-contact'));
byId('copyPrivateContactCode').addEventListener('click', () => {
  const code = state.privateContactInvitation?.code;
  if (code) void copyRoomShareValue(code, 'Código privado copiado.');
});
byId('copyPrivateContactLink').addEventListener('click', () => {
  const url = state.privateContactInvitation?.url;
  if (url) void copyRoomShareValue(url, 'Enlace privado copiado.');
});
byId('sharePrivateContactInvite').addEventListener('click', () => void sharePrivateContactInvitation());
all('[data-private-chat-kind]').forEach(button => button.addEventListener('click', () => setPrivateChatKind(button.dataset.privateChatKind)));
byId('privateConversationList').addEventListener('click', event => {
  const button = event.target.closest('[data-private-conversation]');
  if (button) void openPrivateConversation(button.dataset.privateConversation);
});
byId('closePrivateChatDialog').addEventListener('click', closePrivateChatCreator);
byId('cancelPrivateChatDialog').addEventListener('click', closePrivateChatCreator);
byId('privateChatDialog').addEventListener('cancel', event => {
  event.preventDefault();
  closePrivateChatCreator();
});
byId('createPrivateChatForm').addEventListener('submit', event => {
  event.preventDefault();
  void createPrivateChat();
});
byId('privateChatMessageForm').addEventListener('submit', event => {
  event.preventDefault();
  void sendPrivateChatMessage(byId('privateChatMessageInput').value);
});
byId('privateChatAttachmentInput').addEventListener('change', event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (file) void sendPrivateChatAttachment(file);
});
byId('privateChatProfileButton').addEventListener('click', event => {
  const profileId = event.currentTarget.dataset.profileId;
  if (profileId) void openPersonActions(profileId);
});
byId('refreshPrivateChatButton').addEventListener('click', () => void loadPrivateChatMessages());
byId('loadEarlierPrivateMessages').addEventListener('click', () => void loadPrivateChatMessages({older: true}));
byId('joinPrivateVoice').addEventListener('click', () => void connectPrivateVoice());
byId('togglePrivateCamera').addEventListener('click', () => void togglePrivateCallCamera());
byId('mutePrivateMic').addEventListener('click', () => void mutePrivateMicrophone());
byId('togglePrivateOpenMic').addEventListener('click', () => void togglePrivateOpenMicrophone());
byId('leavePrivateVoice').addEventListener('click', () => void disconnectPrivateVoice());
byId('privateCallZoom').addEventListener('input', event => void applyPrivateCallZoom(event.currentTarget.value));
byId('preparePrivateFilter').addEventListener('click', () => void preparePrivateFilter());
byId('clearPrivateFilter').addEventListener('click', () => void clearPrivateFilter());
const privatePushButton = byId('privatePushToTalk');
privatePushButton.addEventListener('pointerdown', event => {
  event.preventDefault();
  privatePushButton.setPointerCapture?.(event.pointerId);
  void startPrivatePushToTalk();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => privatePushButton.addEventListener(type, () => void stopPrivatePushToTalk()));
privatePushButton.addEventListener('keydown', event => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
    event.preventDefault();
    void startPrivatePushToTalk();
  }
});
privatePushButton.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    void stopPrivatePushToTalk();
  }
});
all('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));

byId('enableMessagesButton').addEventListener('click', async () => {
  const status = byId('chatPermissionStatus');
  setStatus(status, 'Activando tus conversaciones…');
  byId('allowMessages').checked = true;
  try {
    await saveProfile();
    setStatus(status, '');
    toast('Mensajes activados');
    void redeemRequestedPrivateContactInvite();
  } catch (error) {
    byId('allowMessages').checked = false;
    setStatus(status, error.message, true);
  }
});

byId('chatMessageForm').addEventListener('submit', event => {
  event.preventDefault();
  sendChatMessage(byId('chatMessageInput').value);
});
byId('mutePublicChatMic').addEventListener('click', () => void mutePublicChatMicrophone());
byId('openPublicChatMic').addEventListener('click', () => void setPublicChatMicrophone(true));
const publicChatPushButton = byId('publicChatPushToTalk');
publicChatPushButton.addEventListener('pointerdown', event => {
  event.preventDefault();
  publicChatPushButton.setPointerCapture?.(event.pointerId);
  void startPublicChatPushToTalk();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
  publicChatPushButton.addEventListener(type, () => void stopPublicChatPushToTalk());
});
publicChatPushButton.addEventListener('keydown', event => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
    event.preventDefault();
    void startPublicChatPushToTalk();
  }
});
publicChatPushButton.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    void stopPublicChatPushToTalk();
  }
});

renderQmojiPickers();
document.addEventListener('click', event => {
  const option = event.target.closest('[data-qmoji-token]');
  if (option) {
    sendQmoji(option.dataset.qmojiTarget, option.dataset.qmojiToken);
    return;
  }
  const trigger = event.target.closest('[data-qmoji-open]');
  if (trigger) {
    setQmojiPickerOpen(trigger.dataset.qmojiOpen, trigger.getAttribute('aria-expanded') !== 'true');
    return;
  }
  const close = event.target.closest('[data-qmoji-close]');
  if (close) {
    closeQmojiPickers();
    return;
  }
  if (!event.target.closest('.qmoji-bar')) closeQmojiPickers();
});
all('[data-qmoji-search]').forEach(input => input.addEventListener('input', event => {
  renderQmojiGrid(event.currentTarget.dataset.qmojiSearch, event.currentTarget.value);
}));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeQmojiPickers();
});
document.addEventListener('qsession:languagechange', renderQmojiPickers);

byId('refreshChatButton').addEventListener('click', () => loadChatMessages());
byId('shareGlobalCountry').addEventListener('click', () => void shareGlobalCountry());
byId('useAccountGpsCountry').addEventListener('click', () => void useAccountGpsCountry());

document.addEventListener('visibilitychange', () => {
  syncWebMediaSubscriptions();
  if (document.visibilityState === 'hidden') detachPeopleVideos();
  else {
    if (!byId('view-people').hidden) renderPeople();
    scheduleListenerAudioRecovery();
  }
  if (document.visibilityState === 'visible' && (!byId('view-live').hidden || byId('quickLiveRoomsMenu').open)) {
    void loadPublicRooms({quiet: true});
  }
  if (document.visibilityState === 'visible' && chatViewIsVisible()) {
    if (state.chatMode !== 'public') {
      loadPrivateConversations({quiet: true});
      if (state.activePrivateConversationId) loadPrivateChatMessages({quiet: true});
    } else {
      loadChatMessages({quiet: true});
    }
    startChatPolling();
  } else {
    stopChatPolling();
  }
  if (document.visibilityState === 'visible' && state.account) void loadProfileActivity({quiet: true});
  if (document.visibilityState === 'visible' && !byId('view-global').hidden) void loadGlobalRave({quiet: true});
});

window.addEventListener('qsession-native-audio-resume', () => {
  scheduleListenerAudioRecovery({requestFocus: false});
});
window.addEventListener('pageshow', () => scheduleListenerAudioRecovery());
window.addEventListener('focus', () => scheduleListenerAudioRecovery());

byId('toggleAccountPassword').addEventListener('click', () => {
  setAccountPasswordVisible(byId('accountPassword').type === 'password');
});
byId('toggleAccountPasswordConfirmation').addEventListener('click', () => {
  setPasswordVisible('accountPasswordConfirmation', 'toggleAccountPasswordConfirmation', byId('accountPasswordConfirmation').type === 'password');
});
byId('rememberAccountEmail').addEventListener('change', () => {
  if (!byId('rememberAccountEmail').checked) {
    try { localStorage.removeItem('qsession-remembered-email'); } catch { /* Sin almacenamiento. */ }
  }
});
byId('forgotAccountPassword').addEventListener('click', openAccountRecovery);
byId('closeAccountRecovery').addEventListener('click', () => byId('accountRecoveryDialog').close());
byId('toggleRecoveryPassword').addEventListener('click', () => {
  setPasswordVisible('recoveryPassword', 'toggleRecoveryPassword', byId('recoveryPassword').type === 'password');
});
byId('toggleRecoveryPasswordConfirmation').addEventListener('click', () => {
  setPasswordVisible('recoveryPasswordConfirmation', 'toggleRecoveryPasswordConfirmation', byId('recoveryPasswordConfirmation').type === 'password');
});
byId('accountRecoveryRequestForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = byId('accountRecoveryStatus');
  const email = byId('recoveryEmail').value.trim();
  setStatus(status, 'Enviando un código seguro…');
  try {
    const result = await api('/api/auth/recovery/request', {method: 'POST', body: JSON.stringify({email})});
    byId('accountRecoveryRequestForm').hidden = true;
    byId('accountRecoveryResetForm').hidden = false;
    setStatus(status, result.message || 'Revisa tu correo e ingresa el código recibido.');
    byId('recoveryCode').focus();
  } catch (error) {
    setStatus(status, error.message, true);
  }
});
byId('requestAnotherRecoveryCode').addEventListener('click', () => {
  byId('accountRecoveryRequestForm').hidden = false;
  byId('accountRecoveryResetForm').hidden = true;
  setStatus(byId('accountRecoveryStatus'), 'Puedes solicitar un código nuevo.');
  byId('recoveryEmail').focus();
});
byId('accountRecoveryResetForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = byId('accountRecoveryStatus');
  const newPassword = byId('recoveryPassword').value;
  if (newPassword !== byId('recoveryPasswordConfirmation').value) {
    return setStatus(status, 'Las contraseñas no coinciden.', true);
  }
  setStatus(status, 'Actualizando tu contraseña…');
  try {
    const result = await api('/api/auth/recovery/reset', {
      method: 'POST',
      body: JSON.stringify({
        email: byId('recoveryEmail').value.trim(),
        code: byId('recoveryCode').value.trim(),
        newPassword,
        remember: byId('rememberAccountEmail').checked,
      }),
    });
    renderRecoveredSession(result);
    byId('accountRecoveryDialog').close();
    toast('Contraseña actualizada y sesión iniciada');
  } catch (error) {
    setStatus(status, error.message, true);
  }
});
byId('downloadAccountData').addEventListener('click', () => void downloadAccountData());
byId('openDeleteAccount').addEventListener('click', openDeleteAccountDialog);
byId('closeDeleteAccount').addEventListener('click', () => byId('deleteAccountDialog').close());
byId('cancelDeleteAccount').addEventListener('click', () => byId('deleteAccountDialog').close());
byId('toggleDeleteAccountPassword').addEventListener('click', () => {
  setPasswordVisible('deleteAccountPassword', 'toggleDeleteAccountPassword', byId('deleteAccountPassword').type === 'password');
});
byId('deleteAccountForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = byId('deleteAccountStatus');
  const confirmation = byId('deleteAccountConfirmation').value.trim();
  if (confirmation.toUpperCase() !== 'ELIMINAR') return setStatus(status, 'Escribe ELIMINAR para confirmar.', true);
  setStatus(status, 'Eliminando tu cuenta y tus archivos…');
  try {
    await api('/api/account', {
      method: 'DELETE',
      body: JSON.stringify({password: byId('deleteAccountPassword').value, confirmation}),
    });
    byId('deleteAccountDialog').close();
    clearDeletedAccountState();
    toast('Tu cuenta fue eliminada');
  } catch (error) {
    setStatus(status, error.message, true);
  }
});

byId('accountForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = byId('accountStatus');
  setStatus(status, state.authMode === 'login' ? 'Verificando tu cuenta…' : 'Creando tu cuenta…');
  const payload = {
    email: byId('accountEmail').value.trim(),
    password: byId('accountPassword').value,
    remember: byId('rememberAccountEmail').checked,
  };
  if (state.authMode === 'register') {
    if (payload.password !== byId('accountPasswordConfirmation').value) {
      return setStatus(status, 'Las contraseñas no coinciden.', true);
    }
    payload.displayName = byId('accountName').value.trim();
    payload.role = document.querySelector('input[name="accountRole"]:checked')?.value || 'listener';
  }
  try {
    const result = await api(`/api/auth/${state.authMode}`, {method: 'POST', body: JSON.stringify(payload)});
    state.account = result.account;
    state.profile = result.profile;
    state.chatDirectoryContacts = [];
    state.chatDirectoryQuery = '';
    rememberAccountEmail();
    setAccountPasswordVisible(false);
    // Keep the successful form intact while hiding it so password managers
    // can recognize the submitted username/password and offer to save them.
    renderAccount();
    renderChat();
    resumeGlobalPresenceFromProfile();
    void loadBilling({quiet: true});
    void loadProfileActivity({quiet: true, notify: false});
    void loadSessionHistory({quiet: true});
    startProfileActivityPolling();
    void loadStars({quiet: true});
    requestNativeSocialNotifications();
    toast(state.authMode === 'login' ? 'Sesión iniciada' : 'Tu cuenta Q Session está lista');
    if (state.pendingRoomCreation) {
      if (roomCreatorProfileIsActive()) showView('create');
      else explainRoomCreatorAccess();
    }
    await redeemRequestedPrivateContactInvite();
  } catch (error) {
    setStatus(status, error.message, true);
  }
});

byId('logoutButton').addEventListener('click', async () => {
  byId('accountPassword').value = '';
  setAuthMode('login');
  await stopWebGlobalPresence();
  stopFlowerListeningRewards();
  if (registeredNativePushToken) {
    await api('/api/push/devices', {
      method: 'DELETE',
      body: JSON.stringify({token: registeredNativePushToken}),
    }).catch(() => {});
    registeredNativePushToken = '';
  }
  await api('/api/auth/logout', {method: 'POST'}).catch(() => {});
  state.account = null;
  state.profile = null;
  state.globalPresenceCountryCode = '';
  state.profileActions = [];
  state.profileContacts = [];
  state.chatDirectoryContacts = [];
  state.chatDirectoryQuery = '';
  state.hostedSessions = [];
  state.billing = {plans: [], credits: [], orders: [], reservations: [], enforced: false, checkoutConfigured: false, directVideoUploadsConfigured: false, error: ''};
  state.stars = {balance: 0, packages: [], checkoutConfigured: false, sponsorRewardStars: 0, sponsorMinimumViewSeconds: 15, flowers: {inventory: [], total: 0}};
  state.selectedBillingPlanId = '';
  state.billingPlanMode = '';
  state.customQuote = null;
  window.clearTimeout(state.customQuoteTimer);
  state.privateMessageHistory.clear();
  state.profileActivityUnread = 0;
  state.profileActivityInitialized = false;
  state.profileActivitySeenIds.clear();
  stopProfileActivityPolling();
  renderProfileActivityBadge();
  renderAccount();
  renderChat();
  renderCreatorBilling();
  toast('Sesión cerrada');
});

byId('profileEditor').addEventListener('submit', async event => {
  event.preventDefault();
  const status = byId('profileStatus');
  setStatus(status, 'Guardando tus decisiones…');
  try {
    await saveProfile();
    setStatus(status, 'Perfil guardado.');
    toast('Perfil actualizado');
    if (state.pendingRoomCreation && roomCreatorProfileIsActive()) showView('create');
    void redeemRequestedPrivateContactInvite();
  } catch (error) {
    setStatus(status, error.message, true);
  }
});

byId('profilePhotoInput').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const status = byId('profileStatus');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setStatus(status, 'Usa una foto JPG, PNG o WebP.', true);
  if (file.size > 2 * 1024 * 1024) return setStatus(status, 'La foto debe pesar como máximo 2 MB.', true);
  if ((state.profile?.photos || []).length >= 6) return setStatus(status, 'Puedes guardar hasta seis fotos.', true);
  setStatus(status, 'Subiendo y guardando la foto…');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No fue posible leer la foto'));
      reader.readAsDataURL(file);
    });
    const result = await api('/api/profile-media', {method: 'POST', body: JSON.stringify({dataUrl})});
    const photos = [...(state.profile?.photos || []), {id: result.media.id, url: result.media.url, caption: null}];
    await saveProfile(photos);
    setStatus(status, 'Foto agregada.');
  } catch (error) {
    setStatus(status, error.message, true);
  }
});

byId('profileGallery').addEventListener('click', async event => {
  const button = event.target.closest('[data-remove-photo]');
  if (!button) return;
  const status = byId('profileStatus');
  const photos = (state.profile?.photos || []).filter(photo => photo.id !== button.dataset.removePhoto);
  try {
    await saveProfile(photos);
    setStatus(status, 'Foto quitada del perfil.');
  } catch (error) {
    setStatus(status, error.message, true);
  }
});

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localDateValue(date) {
  return localDateTimeValue(date).slice(0, 10);
}

function localTimeValue(date) {
  return localDateTimeValue(date).slice(11, 16);
}

function defaultScheduledStart() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setSeconds(0, 0);
  start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5);
  return start;
}

function selectedScheduledDateTime() {
  const date = byId('sessionScheduledDate').value;
  const time = byId('sessionScheduledTime').value;
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function schedulePreviewText(date) {
  const locale = window.QSessionI18n?.getLocale?.() || document.documentElement.lang || 'es';
  const language = locale === 'de' ? 'de' : locale === 'en' ? 'en' : 'es';
  const formatted = new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  if (language === 'de') return `Der Raum öffnet am ${formatted}.`;
  if (language === 'en') return `The room will open on ${formatted}.`;
  return `La sala se abrirá el ${formatted}.`;
}

function syncScheduledDateTimeValue() {
  const combined = byId('sessionScheduledAt');
  const dateValue = byId('sessionScheduledDate').value;
  const timeValue = byId('sessionScheduledTime').value;
  const selected = selectedScheduledDateTime();
  combined.value = dateValue && timeValue ? `${dateValue}T${timeValue}` : '';

  all('[data-schedule-day-offset]').forEach(button => {
    const date = new Date();
    date.setDate(date.getDate() + Number(button.dataset.scheduleDayOffset || 0));
    button.setAttribute('aria-pressed', String(dateValue === localDateValue(date)));
  });

  const preview = byId('sessionSchedulePreview');
  const label = preview.querySelector('b');
  const icon = preview.querySelector('i');
  const invalid = Boolean(dateValue && timeValue && (!selected || selected.getTime() <= Date.now() + 30000));
  preview.classList.toggle('is-invalid', Boolean(invalid));
  icon.textContent = invalid ? '!' : '✓';
  if (!dateValue || !timeValue) {
    label.textContent = 'Selecciona un día y una hora.';
    window.QSessionI18n?.applyTranslations(label);
  } else if (invalid) {
    label.textContent = 'Elige una fecha y una hora futuras.';
    window.QSessionI18n?.applyTranslations(label);
  } else {
    label.textContent = schedulePreviewText(selected);
  }
}

function roomTypeMenuButtons() {
  return [...byId('roomTypeMenu').querySelectorAll('[data-room-type-value]')];
}

function setRoomTypeMenuOpen(open, {focusSelected = false} = {}) {
  const control = byId('roomTypeControl');
  const trigger = byId('roomTypeTrigger');
  const menu = byId('roomTypeMenu');
  const nextOpen = Boolean(open);
  menu.hidden = !nextOpen;
  control.classList.toggle('is-open', nextOpen);
  trigger.setAttribute('aria-expanded', String(nextOpen));
  if (nextOpen && focusSelected) {
    const selected = roomTypeMenuButtons().find(button => button.getAttribute('aria-selected') === 'true') || roomTypeMenuButtons()[0];
    selected?.focus();
  }
}

function syncRoomTypeControl() {
  const select = byId('roomType');
  const selectedOption = select.options[select.selectedIndex];
  byId('roomTypeTriggerLabel').textContent = selectedOption?.textContent || 'Personalizada';
  byId('roomTypeSummaryLabel').textContent = selectedOption?.textContent || 'Personalizada';
  roomTypeMenuButtons().forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.roomTypeValue === select.value));
  });
}

function chooseRoomType(value) {
  const select = byId('roomType');
  if (![...select.options].some(option => option.value === value)) return;
  select.value = value;
  syncRoomTypeControl();
  setRoomTypeMenuOpen(false);
  select.dispatchEvent(new Event('change', {bubbles: true}));
  byId('roomTypeTrigger').focus();
}

function syncRoomVisibilityControl() {
  const visibility = byId('roomVisibility').value === 'public' ? 'public' : 'private';
  all('input[name="roomVisibilityChoice"]').forEach(input => {
    input.checked = input.value === visibility;
  });
}

function syncRoomSocialDependencies() {
  const socialProfilesEnabled = byId('allowRoomSocialProfiles').checked;
  all('[data-room-social-dependent]').forEach(label => {
    const input = label.querySelector('input');
    input.disabled = !socialProfilesEnabled;
    if (!socialProfilesEnabled) input.checked = false;
    label.classList.toggle('is-disabled', !socialProfilesEnabled);
  });
}

function roomExperienceToolAllowed(preset, controlId) {
  return preset.allowedExperienceTools === 'all'
    || (Array.isArray(preset.allowedExperienceTools) && preset.allowedExperienceTools.includes(controlId));
}

function syncRoomExperienceDependencies() {
  const preset = ROOM_TYPE_PRESETS[byId('roomType').value] || ROOM_TYPE_PRESETS.custom;
  ROOM_EXPERIENCE_CONTROLS.forEach(([controlId]) => {
    const input = byId(controlId);
    const label = document.querySelector(`[data-room-experience-tool="${controlId}"]`);
    const needsVideoUploads = controlId === 'allowVideoSubmissions' || controlId === 'allowGreetingVideos';
    const allowed = roomExperienceToolAllowed(preset, controlId)
      && (!needsVideoUploads || state.billing.directVideoUploadsConfigured);
    input.disabled = !allowed;
    if (!allowed) input.checked = false;
    label?.classList.toggle('is-disabled', !allowed);
  });
  const videosAllowed = roomExperienceToolAllowed(preset, 'allowVideoSubmissions')
    && state.billing.directVideoUploadsConfigured;
  const videosEnabled = videosAllowed && byId('allowVideoSubmissions').checked;
  byId('roomVideoSubmissionOptions').hidden = !videosAllowed;
  ROOM_VIDEO_CONTROLS.forEach(controlId => {
    const input = byId(controlId);
    const allowed = roomExperienceToolAllowed(preset, controlId);
    input.disabled = !allowed || !videosEnabled;
    if (!allowed) input.checked = false;
    input.closest('[data-room-video-option]')?.classList.toggle('is-disabled', !allowed || !videosEnabled);
  });
}

function renderRoomExperiencePreset() {
  const preset = ROOM_TYPE_PRESETS[byId('roomType').value] || ROOM_TYPE_PRESETS.custom;
  const intro = byId('roomExperienceIntro');
  intro.querySelector(':scope > span').textContent = preset.experienceIcon || '✦';
  intro.querySelector('b').textContent = preset.experienceTitle || 'Sala personalizada';
  intro.querySelector('small').textContent = preset.experienceDescription || preset.description;
  const activeTools = ROOM_EXPERIENCE_CONTROLS.filter(([controlId]) => byId(controlId).checked).length;
  const motionLabels = {
    calm: roomConfigText('Calma', 'Calm', 'Ruhig'),
    balanced: roomConfigText('Equilibrada', 'Balanced', 'Ausgewogen'),
    immersive: roomConfigText('Inmersiva', 'Immersive', 'Immersiv'),
  };
  byId('roomExperienceSummary').textContent = roomConfigText(
    `${motionLabels[byId('roomDesignMotion').value] || motionLabels.balanced} · ${activeTools} ${activeTools === 1 ? 'herramienta' : 'herramientas'}`,
    `${motionLabels[byId('roomDesignMotion').value] || motionLabels.balanced} · ${activeTools} tool${activeTools === 1 ? '' : 's'}`,
    `${motionLabels[byId('roomDesignMotion').value] || motionLabels.balanced} · ${activeTools} Werkzeug${activeTools === 1 ? '' : 'e'}`,
  );
}

function syncConferenceTranslationLanguages() {
  const sourceLanguage = byId('conferenceSourceLanguage').value;
  all('[data-translation-language]').forEach(input => {
    const isSource = input.dataset.translationLanguage === sourceLanguage;
    input.disabled = isSource;
    if (isSource) input.checked = false;
    input.closest('.room-setting-toggle')?.classList.toggle('is-disabled', isSource);
  });
}

function roomConfigText(es, en, de) {
  const language = String(document.documentElement.lang || 'es').toLowerCase();
  if (language.startsWith('en')) return en;
  if (language.startsWith('de')) return de;
  return es;
}

function syncRoomConfigSummaries() {
  const visibility = byId('roomVisibility').value === 'public'
    ? roomConfigText('Pública', 'Public', 'Öffentlich')
    : roomConfigText('Privada', 'Private', 'Privat');
  const scheduled = document.querySelector('input[name="sessionStartMode"]:checked')?.value === 'scheduled';
  const start = scheduled
    ? roomConfigText('Programada', 'Scheduled', 'Geplant')
    : roomConfigText('Ahora', 'Now', 'Jetzt');
  const password = byId('roomPasswordEnabled').checked
    ? ` · ${roomConfigText('Con clave', 'Password', 'Mit Passwort')}`
    : '';
  byId('roomAccessSummary').textContent = `${visibility} · ${start}${password}`;

  const activeFeatures = ROOM_FEATURE_CONTROLS.filter(([controlId]) => byId(controlId).checked).length;
  byId('roomFeaturesSummary').textContent = activeFeatures === 1
    ? roomConfigText('1 activa', '1 active', '1 aktiv')
    : roomConfigText(`${activeFeatures} activas`, `${activeFeatures} active`, `${activeFeatures} aktiv`);

  renderRoomExperiencePreset();

  const activeConferenceTools = CONFERENCE_FEATURE_CONTROLS.filter(([controlId]) => byId(controlId).checked).length;
  byId('conferenceToolsSummary').textContent = roomConfigText(
    `${activeConferenceTools} activas`,
    `${activeConferenceTools} active`,
    `${activeConferenceTools} aktiv`,
  );

  const promotionCount = state.roomPromotions.length;
  byId('roomPromotionSummary').textContent = promotionCount
    ? roomConfigText(`${promotionCount} ${promotionCount === 1 ? 'promoción' : 'promociones'}`, `${promotionCount} promotion${promotionCount === 1 ? '' : 's'}`, `${promotionCount} Promotion${promotionCount === 1 ? '' : 'en'}`)
    : roomConfigText('Sin promociones', 'No promotions', 'Keine Promotionen');
}

function syncRoomTypeSpecificMenus() {
  const conferenceMenu = byId('conferenceOptionsMenu');
  const isConference = byId('roomType').value === 'conference';
  conferenceMenu.hidden = !isConference;
  if (!isConference) conferenceMenu.open = false;
}

function renderRoomTypePreset() {
  const preset = ROOM_TYPE_PRESETS[byId('roomType').value] || ROOM_TYPE_PRESETS.custom;
  const description = byId('roomTypePresetDescription');
  description.textContent = preset.description;
  const preview = byId('roomTypeFeaturePreview');
  preview.replaceChildren();

  const privacy = document.createElement('span');
  privacy.className = 'is-privacy';
  privacy.textContent = byId('roomVisibility').value === 'public' ? 'Pública' : 'Privada';
  preview.append(privacy);
  ROOM_FEATURE_CONTROLS.forEach(([controlId, , label]) => {
    const feature = document.createElement('span');
    feature.className = byId(controlId).checked ? 'is-active' : 'is-off';
    feature.textContent = label;
    preview.append(feature);
  });
  ROOM_EXPERIENCE_CONTROLS.forEach(([controlId, label]) => {
    if (!byId(controlId).checked) return;
    const feature = document.createElement('span');
    feature.className = 'is-experience';
    feature.textContent = label;
    preview.append(feature);
  });
  const activeFeatures = ROOM_FEATURE_CONTROLS.filter(([controlId]) => byId(controlId).checked).length;
  const visibility = byId('roomVisibility').value === 'public'
    ? roomConfigText('Pública', 'Public', 'Öffentlich')
    : roomConfigText('Privada', 'Private', 'Privat');
  byId('roomTypeSummaryState').textContent = roomConfigText(
    `${visibility} · ${activeFeatures} ${activeFeatures === 1 ? 'función' : 'funciones'}`,
    `${visibility} · ${activeFeatures} feature${activeFeatures === 1 ? '' : 's'}`,
    `${visibility} · ${activeFeatures} Funktion${activeFeatures === 1 ? '' : 'en'}`,
  );
  window.QSessionI18n?.applyTranslations(byId('roomTypePresetDescription'));
  window.QSessionI18n?.applyTranslations(preview);
}

function applyRoomTypePreset() {
  const preset = ROOM_TYPE_PRESETS[byId('roomType').value] || ROOM_TYPE_PRESETS.custom;
  if (preset.visibility) byId('roomVisibility').value = preset.visibility;
  ROOM_FEATURE_CONTROLS.forEach(([controlId, setting]) => {
    if (typeof preset[setting] === 'boolean') byId(controlId).checked = preset[setting];
  });
  byId('roomDesignTheme').value = preset.designTheme || 'minimal';
  byId('roomDesignMotion').value = preset.designMotion || 'balanced';
  [...ROOM_EXPERIENCE_CONTROLS.map(([controlId]) => controlId), ...ROOM_VIDEO_CONTROLS].forEach(controlId => {
    byId(controlId).checked = preset[controlId] === true;
  });
  syncRoomTypeControl();
  syncRoomVisibilityControl();
  syncRoomSocialDependencies();
  syncRoomExperienceDependencies();
  syncRoomTypeSpecificMenus();
  syncRoomConfigSummaries();
  renderRoomTypePreset();
}

function syncRoomStartFields() {
  const scheduled = document.querySelector('input[name="sessionStartMode"]:checked')?.value === 'scheduled';
  const field = byId('scheduledStartField');
  const combined = byId('sessionScheduledAt');
  const date = byId('sessionScheduledDate');
  const time = byId('sessionScheduledTime');
  field.hidden = !scheduled;
  date.required = scheduled;
  time.required = scheduled;
  date.min = localDateValue(new Date());
  combined.min = localDateTimeValue(new Date());
  if (scheduled && (!date.value || !time.value)) {
    const suggested = defaultScheduledStart();
    if (!date.value) date.value = localDateValue(suggested);
    if (!time.value) time.value = localTimeValue(suggested);
  }
  syncScheduledDateTimeValue();
  syncRoomConfigSummaries();
}

function syncRoomPasswordField() {
  const enabled = byId('roomPasswordEnabled').checked;
  byId('roomPasswordField').hidden = !enabled;
  byId('roomPassword').required = enabled;
  if (!enabled) byId('roomPassword').value = '';
  syncRoomConfigSummaries();
}

function normalizedRoomPromotionUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    const candidate = raw.startsWith('//') ? `https:${raw}` : /^[^\s/:?#]+\.[^\s/:?#]+(?::\d+)?(?:[/?#]|$)/.test(raw) ? `https://${raw}` : raw;
    parsed = new URL(candidate);
  } catch {
    throw new Error('Escribe un enlace válido para la promoción.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('El enlace debe comenzar con http:// o https://.');
  return parsed.toString();
}

function renderRoomPromotionDrafts() {
  const list = byId('roomPromotionDrafts');
  list.replaceChildren();
  state.roomPromotions.forEach(promotion => {
    const item = document.createElement('article');
    item.className = 'room-promotion-draft';
    const media = document.createElement('span');
    media.className = 'room-promotion-draft-media';
    if (promotion.media?.contentType?.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = promotion.media.url;
      image.alt = '';
      media.append(image);
    } else {
      media.textContent = promotion.media ? '▶' : '↗';
    }
    const copy = document.createElement('span');
    copy.className = 'room-promotion-draft-copy';
    const sponsor = document.createElement('strong');
    sponsor.textContent = promotion.sponsor;
    sponsor.dataset.i18nIgnore = '';
    const detail = document.createElement('span');
    detail.textContent = promotion.headline || (promotion.media ? 'Contenido promocional' : 'Patrocinador de la sala');
    detail.dataset.i18nIgnore = '';
    copy.append(sponsor, detail);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeRoomPromotion = promotion.id;
    remove.setAttribute('aria-label', `Quitar promoción de ${promotion.sponsor}`);
    remove.textContent = '×';
    item.append(media, copy, remove);
    list.append(item);
  });
  syncRoomConfigSummaries();
}

async function addRoomPromotion() {
  const status = byId('roomPromotionStatus');
  const button = byId('addRoomPromotion');
  if (state.roomPromotions.length >= 8) return setStatus(status, 'Puedes agregar hasta ocho promociones.', true);
  const sponsor = byId('promotionSponsor').value.trim();
  const headline = byId('promotionHeadline').value.trim();
  const fileInput = byId('promotionMediaInput');
  const file = fileInput.files?.[0] || null;
  if (!sponsor) return setStatus(status, 'Escribe el nombre de la marca o patrocinador.', true);

  let linkUrl;
  try {
    linkUrl = normalizedRoomPromotionUrl(byId('promotionLink').value);
  } catch (error) {
    return setStatus(status, error.message, true);
  }
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);
  if (file && !supportedTypes.has(file.type)) {
    return setStatus(status, 'Usa JPG, PNG, WebP, MP4, WebM o MOV.', true);
  }
  if (file && file.size > 20 * 1024 * 1024) return setStatus(status, 'El archivo debe pesar como máximo 20 MB.', true);

  button.disabled = true;
  fileInput.disabled = true;
  setStatus(status, file ? 'Subiendo el contenido promocional…' : 'Agregando el patrocinador…');
  try {
    let media = null;
    if (file) {
      const dataUrl = await fileAsDataUrl(file, 'No fue posible leer el archivo promocional');
      const result = await api('/api/promotion-media', {
        method: 'POST',
        body: JSON.stringify({dataUrl, name: file.name}),
      });
      media = result.media;
    }
    state.roomPromotions.push({
      id: `promotion-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sponsor,
      headline,
      linkUrl,
      media,
    });
    byId('promotionSponsor').value = '';
    byId('promotionHeadline').value = '';
    byId('promotionLink').value = '';
    fileInput.value = '';
    byId('promotionMediaName').textContent = 'JPG, PNG, WebP, MP4, WebM o MOV · máximo 20 MB';
    renderRoomPromotionDrafts();
    setStatus(status, 'Promoción preparada. Se publicará al crear la sesión.');
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    button.disabled = false;
    fileInput.disabled = false;
  }
}

function renderRoomPromotions(room) {
  const container = byId('roomPromotions');
  const promotions = Array.isArray(room?.promotions) ? room.promotions : [];
  container.replaceChildren();
  container.hidden = !promotions.length;
  promotions.forEach(promotion => {
    const card = document.createElement('article');
    card.className = 'room-promotion-card';
    const media = document.createElement('div');
    media.className = 'room-promotion-card-media';
    if (promotion.media?.contentType?.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = promotion.media.url;
      image.alt = `Promoción de ${promotion.sponsor}`;
      image.loading = 'lazy';
      media.append(image);
    } else if (promotion.media?.contentType?.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = promotion.media.url;
      video.controls = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      media.append(video);
    } else {
      media.textContent = '↗';
    }
    const copy = document.createElement('div');
    copy.className = 'room-promotion-card-copy';
    const label = document.createElement('small');
    label.textContent = 'PATROCINADO';
    const sponsor = document.createElement('strong');
    sponsor.textContent = promotion.sponsor || 'Promoción';
    sponsor.dataset.i18nIgnore = '';
    copy.append(label, sponsor);
    if (promotion.headline) {
      const headline = document.createElement('p');
      headline.textContent = promotion.headline;
      headline.dataset.i18nIgnore = '';
      copy.append(headline);
    }
    if (promotion.linkUrl) {
      const link = document.createElement('a');
      link.href = promotion.linkUrl;
      link.target = '_blank';
      link.rel = 'sponsored noopener noreferrer';
      link.textContent = 'Ver promoción ↗';
      copy.append(link);
    }
    card.append(media, copy);
    container.append(card);
  });
  window.QSessionI18n?.applyTranslations(container);
}

function scheduledRoomLabel(room) {
  if (!room?.scheduledAt) return 'La sesión está programada y todavía no ha comenzado.';
  try {
    return `La sesión comienza el ${new Intl.DateTimeFormat(document.documentElement.lang || undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(room.scheduledAt))}.`;
  } catch {
    return 'La sesión está programada y todavía no ha comenzado.';
  }
}

function stopWaitingRoomMonitor() {
  if (state.waitingRoomTimer) clearInterval(state.waitingRoomTimer);
  state.waitingRoomTimer = null;
  state.waitingRoomCheckBusy = false;
}

function startWaitingRoomMonitor(room) {
  const code = normalizeRoomCode(room?.code || state.currentRoomCode);
  stopWaitingRoomMonitor();
  if (!code) return;

  const check = async () => {
    if (state.waitingRoomCheckBusy || state.currentRoomCode !== code || state.mediaRole !== 'listener') return;
    state.waitingRoomCheckBusy = true;
    try {
      const result = await api(`/api/rooms/${encodeURIComponent(code)}`);
      setCurrentRoom(code, result.room);
      if (result.room.status === 'waiting') {
        setMediaStatus('Esperando el inicio. Te conectaremos automáticamente.');
        return;
      }
      stopWaitingRoomMonitor();
      prepareMediaConsole('listener', result.room);
      setStatus(byId('joinStatus'), 'La transmisión comenzó. Conectando automáticamente…');
      await joinBroadcast({automatic: true});
    } catch (error) {
      if (/no existe|finalizó/i.test(error.message)) {
        stopWaitingRoomMonitor();
        setMediaStatus(error.message, true);
        showListenerRetry('Volver');
      }
    } finally {
      state.waitingRoomCheckBusy = false;
    }
  };

  state.waitingRoomTimer = setInterval(() => void check(), 3000);
  void check();
}

function rememberRoomAccess(code, token) {
  state.currentRoomAccessToken = token || '';
  if (!code || !token) return;
  try { sessionStorage.setItem(`qsession-access-${code}`, token); } catch { /* La sala sigue funcionando durante esta visita. */ }
}

function rememberedRoomAccess(code) {
  try { return sessionStorage.getItem(`qsession-access-${code}`) || ''; } catch { return ''; }
}

async function enterRoomAsListener(result, accessToken = '') {
  const room = result.room;
  if (Number(room.starPrice) > 0 && state.account?.id !== room.ownerAccountId) {
    if (!state.account) {
      toast(`Esta sesión cuesta ${room.starPrice} estrellas. Inicia sesión para continuar.`);
      showView('profile');
      return;
    }
    await loadStars({quiet: true});
    if (Number(state.stars.balance) < Number(room.starPrice)) {
      toast(`Necesitas ${room.starPrice} estrellas. Puedes comprarlas en tu perfil.`);
      showView('profile');
      byId('starWalletPanel').scrollIntoView({behavior: 'smooth', block: 'center'});
      return;
    }
    const confirmed = await requestConfirmation({
      title: `¿Desbloquear por ${room.starPrice} ★?`,
      message: 'El acceso quedará guardado en tu cuenta y las estrellas se enviarán al artista u organizador.',
      context: room.name || 'Sesión Q Session',
      confirmLabel: `Pagar ${room.starPrice} ★`,
      cancelLabel: 'Cancelar',
    });
    if (!confirmed) return;
    const unlocked = await api(`/api/rooms/${encodeURIComponent(room.code)}/unlock`, {method: 'POST'});
    if (!unlocked.unlock?.alreadyUnlocked) state.stars.balance -= Number(room.starPrice);
    renderStarWallet();
  }
  setCurrentRoom(room.code, room);
  rememberRoomAccess(room.code, accessToken);
  rememberListenerRoom(room);
  setHomeSessionAction(null);
  if (room.status === 'waiting') {
    const message = scheduledRoomLabel(room);
    setStatus(byId('joinStatus'), message);
    prepareMediaConsole('listener', room);
    setMediaStatus(message);
    startWaitingRoomMonitor(room);
    return;
  }
  stopWaitingRoomMonitor();
  setStatus(byId('joinStatus'), result.mediaConfigured
    ? `${room.name || 'Sala encontrada'} · conectando automáticamente.`
    : `${room.name || 'Sala encontrada'} · el servidor multimedia aún no está conectado.`);
  if (result.mediaConfigured) {
    prepareMediaConsole('listener', room);
    await joinBroadcast({automatic: true});
  }
}

function requestRoomPassword(code, result) {
  state.pendingRoomAccess = {code, result};
  byId('roomPasswordDialogName').textContent = `${result.room.name || 'Esta sesión'} requiere una contraseña para entrar.`;
  byId('roomAccessPassword').value = '';
  setStatus(byId('roomPasswordStatus'), '');
  const dialog = byId('roomPasswordDialog');
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => byId('roomAccessPassword').focus());
}

function cancelRoomPasswordRequest() {
  state.pendingRoomAccess = null;
  byId('roomAccessPassword').value = '';
  const dialog = byId('roomPasswordDialog');
  if (dialog.open) dialog.close();
  setHomeSessionAction('join');
}

all('input[name="sessionStartMode"]').forEach(input => input.addEventListener('change', syncRoomStartFields));
['sessionScheduledDate', 'sessionScheduledTime'].forEach(controlId => {
  byId(controlId).addEventListener('input', syncScheduledDateTimeValue);
  byId(controlId).addEventListener('change', syncScheduledDateTimeValue);
});
all('[data-schedule-day-offset]').forEach(button => button.addEventListener('click', () => {
  const date = new Date();
  date.setDate(date.getDate() + Number(button.dataset.scheduleDayOffset || 0));
  byId('sessionScheduledDate').value = localDateValue(date);
  if (!byId('sessionScheduledTime').value) byId('sessionScheduledTime').value = localTimeValue(defaultScheduledStart());
  syncScheduledDateTimeValue();
}));
byId('roomPasswordEnabled').addEventListener('change', syncRoomPasswordField);
byId('promotionMediaInput').addEventListener('change', event => {
  const file = event.currentTarget.files?.[0];
  byId('promotionMediaName').textContent = file?.name || 'JPG, PNG, WebP, MP4, WebM o MOV · máximo 20 MB';
});
byId('addRoomPromotion').addEventListener('click', () => void addRoomPromotion());
byId('promotionLink').addEventListener('blur', event => {
  try { event.currentTarget.value = normalizedRoomPromotionUrl(event.currentTarget.value); } catch {}
});
byId('roomPromotionDrafts').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-room-promotion]');
  if (!button) return;
  state.roomPromotions = state.roomPromotions.filter(promotion => promotion.id !== button.dataset.removeRoomPromotion);
  renderRoomPromotionDrafts();
  setStatus(byId('roomPromotionStatus'), 'Promoción retirada de esta sala.');
});
byId('roomTypeTrigger').addEventListener('click', () => {
  setRoomTypeMenuOpen(byId('roomTypeMenu').hidden, {focusSelected: false});
});
byId('roomTypeTrigger').addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  setRoomTypeMenuOpen(true, {focusSelected: true});
});
byId('roomTypeMenu').addEventListener('click', event => {
  const option = event.target.closest('[data-room-type-value]');
  if (option) chooseRoomType(option.dataset.roomTypeValue);
});
byId('roomTypeMenu').addEventListener('keydown', event => {
  const buttons = roomTypeMenuButtons();
  const currentIndex = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    setRoomTypeMenuOpen(false);
    byId('roomTypeTrigger').focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (currentIndex + 1 + buttons.length) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
});
document.addEventListener('click', event => {
  if (!byId('roomTypeControl').contains(event.target)) setRoomTypeMenuOpen(false);
});
all('input[name="roomVisibilityChoice"]').forEach(input => input.addEventListener('change', event => {
  if (!event.currentTarget.checked) return;
  const select = byId('roomVisibility');
  select.value = event.currentTarget.value;
  select.dispatchEvent(new Event('change', {bubbles: true}));
}));
byId('roomType').addEventListener('change', applyRoomTypePreset);
byId('conferenceSourceLanguage').addEventListener('change', syncConferenceTranslationLanguages);
CONFERENCE_FEATURE_CONTROLS.forEach(([controlId]) => {
  byId(controlId).addEventListener('change', syncRoomConfigSummaries);
});
all('[data-room-config-menu]').forEach(menu => {
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    all('[data-room-config-menu]').forEach(otherMenu => {
      if (otherMenu !== menu) otherMenu.open = false;
    });
  });
});
all('[data-creator-command]').forEach(command => {
  command.addEventListener('toggle', () => {
    if (!command.open) return;
    if (command.id === 'creatorBillingPanel' && !creatorBillingPlans().length) void loadBilling();
    all('[data-creator-command]').forEach(otherCommand => {
      if (otherCommand !== command) otherCommand.open = false;
    });
  });
});
byId('activeTranslationSource').addEventListener('change', syncActiveTranslationLanguages);
byId('activeRoomSettingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = byId('activeRoomSettingsStatus');
  const accessMethods = all('[data-active-access]:checked').map(input => input.dataset.activeAccess);
  const targetLanguages = all('[data-active-language]:checked').map(input => input.dataset.activeLanguage);
  if (!accessMethods.length) return setStatus(status, 'Activa al menos una forma de ingreso.', true);
  if (!targetLanguages.length) return setStatus(status, 'Elige al menos un idioma de traducción.', true);
  setStatus(status, 'Guardando cambios…');
  try {
    const features = Object.fromEntries(all('[data-active-feature]').map(input => [input.dataset.activeFeature, input.checked]));
    const result = await api(`/api/rooms/${state.currentRoomCode}/configuration`, {
      method: 'PATCH',
      body: JSON.stringify({
        hostToken: state.hostToken,
        visibility: byId('activeRoomVisibility').value,
        capacity: Number(byId('activeRoomCapacity').value) || 0,
        capacityMode: byId('activeRoomCapacityMode').value,
        accessMethods,
        translation: {
          sourceLanguage: byId('activeTranslationSource').value,
          mode: byId('activeTranslationMode').value,
          targetLanguages,
        },
        ...features,
      }),
    });
    state.currentRoom = result.room;
    populateActiveRoomSettings(result.room);
    syncPublicChatPanel();
    setStatus(status, 'Cambios aplicados a la sala activa.');
    if (result.room.visibility === 'public') void loadPublicRooms({quiet: true});
  } catch (error) {
    setStatus(status, error.message, true);
  }
});
['roomVisibility', ...ROOM_FEATURE_CONTROLS.map(([controlId]) => controlId)].forEach(controlId => {
  byId(controlId).addEventListener('change', () => {
    if (controlId === 'roomVisibility') syncRoomVisibilityControl();
    if (controlId === 'allowRoomSocialProfiles') syncRoomSocialDependencies();
    syncRoomConfigSummaries();
    renderRoomTypePreset();
  });
});
[...ROOM_EXPERIENCE_CONTROLS.map(([controlId]) => controlId), ...ROOM_VIDEO_CONTROLS].forEach(controlId => {
  byId(controlId).addEventListener('change', () => {
    syncRoomExperienceDependencies();
    syncRoomConfigSummaries();
    renderRoomTypePreset();
  });
});
['roomDesignTheme', 'roomDesignMotion'].forEach(controlId => {
  byId(controlId).addEventListener('change', () => {
    syncRoomConfigSummaries();
    renderRoomTypePreset();
  });
});
document.addEventListener('qsession:languagechange', () => {
  syncRoomTypeControl();
  syncScheduledDateTimeValue();
  syncRoomConfigSummaries();
  syncBroadcastSourceControl();
});
syncRoomStartFields();
syncRoomPasswordField();
syncRoomTypeControl();
syncRoomVisibilityControl();
syncRoomSocialDependencies();
syncRoomExperienceDependencies();
syncConferenceTranslationLanguages();
syncRoomTypeSpecificMenus();
renderRoomPromotionDrafts();
renderRoomTypePreset();
syncRoomConfigSummaries();

function syncSessionCommerceControls() {
  const mode = document.querySelector('input[name="broadcastMode"]:checked')?.value || 'live';
  byId('recordedSessionUpload').hidden = mode !== 'recorded';
  byId('imageSessionUpload').hidden = mode !== 'image';
  byId('sessionStarPriceField').hidden = document.querySelector('input[name="sessionPriceMode"]:checked')?.value !== 'stars';
}

async function videoFileDuration(file) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('No pudimos leer la duración del video'));
      video.src = url;
    });
    return Math.ceil(Number(video.duration) || 0);
  } finally { URL.revokeObjectURL(url); }
}

async function uploadRecordedSession(file) {
  if (!state.billing.directVideoUploadsConfigured) throw new Error('Falta activar Cloudflare Stream para subir sesiones de hasta 4 horas');
  const durationSeconds = await videoFileDuration(file);
  if (!durationSeconds || durationSeconds > 4 * 60 * 60) throw new Error('La sesión grabada debe durar como máximo 4 horas');
  const prepared = await api('/api/uploads/video-intents', {method: 'POST', body: JSON.stringify({
    purpose: 'session', name: file.name, contentType: file.type, byteLength: file.size, durationSeconds,
  })});
  if (prepared.upload.protocol === 'tus') {
    const chunkSize = Number(prepared.upload.chunkSize) || 50 * 1024 * 1024;
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkSize);
      let response;
      let lastError;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          response = await fetch(prepared.upload.uploadUrl, {
            method: 'PATCH',
            headers: {
              'Tus-Resumable': '1.0.0',
              'Upload-Offset': String(offset),
              'Content-Type': 'application/offset+octet-stream',
            },
            body: file.slice(offset, end),
          });
          if (response.ok) break;
          lastError = new Error(`El proveedor respondió ${response.status}`);
        } catch (error) { lastError = error; }
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
      if (!response?.ok) throw new Error(`La subida se interrumpió cerca del ${Math.round((offset / file.size) * 100)}%. ${lastError?.message || 'Inténtalo nuevamente.'}`);
      const nextOffset = Number(response.headers.get('upload-offset'));
      offset = Number.isFinite(nextOffset) && nextOffset > offset ? nextOffset : end;
      setMediaStatus(`Subiendo sesión grabada… ${Math.min(100, Math.round((offset / file.size) * 100))}%`);
    }
    state.recordedSessionAssetId = prepared.upload.assetId;
    return prepared.upload.assetId;
  }
  const form = new FormData();
  form.append(prepared.upload.fieldName || 'file', file, file.name);
  const response = await fetch(prepared.upload.uploadUrl, {method: prepared.upload.method || 'POST', body: form});
  if (!response.ok) throw new Error('El proveedor no pudo guardar la sesión grabada');
  state.recordedSessionAssetId = prepared.upload.assetId;
  return prepared.upload.assetId;
}

function stopSessionVisual() {
  state.sessionVisualElement?.pause?.();
  state.sessionVisualElement = null;
  if (state.sessionVisualObjectUrl) URL.revokeObjectURL(state.sessionVisualObjectUrl);
  state.sessionVisualObjectUrl = '';
  state.sessionVisualPublication = null;
}

async function publishRecordedSession(room) {
  const file = state.recordedSessionFile;
  if (!file) throw new Error('Vuelve a seleccionar el video grabado para iniciar esta transmisión');
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.src = url; video.playsInline = true; video.preload = 'auto';
  await new Promise((resolve, reject) => { video.oncanplay = resolve; video.onerror = () => reject(new Error('No pudimos reproducir el video grabado')); });
  await video.play();
  const stream = video.captureStream?.() || video.mozCaptureStream?.();
  const audioTrack = stream?.getAudioTracks?.()[0];
  const videoTrack = stream?.getVideoTracks?.()[0];
  if (!audioTrack || !videoTrack) throw new Error('Este navegador no puede transmitir el audio y video del archivo. Usa Chrome actualizado.');
  state.mediaSourceKind = 'recorded';
  state.mediaCaptureStream = stream;
  state.sessionVisualElement = video;
  state.sessionVisualObjectUrl = url;
  state.mediaAudioPublication = await room.localParticipant.publishTrack(audioTrack, {name: 'qsession-recorded-audio', source: window.LivekitClient.Track.Source.ScreenShareAudio, forceStereo: true, dtx: false, red: false, audioPreset: {maxBitrate: state.broadcastAudioBitrate, priority: 'high'}});
  state.sessionVisualPublication = await room.localParticipant.publishTrack(videoTrack, {name: 'qsession-recorded-video', source: window.LivekitClient.Track.Source.ScreenShare, simulcast: true});
  video.addEventListener('ended', () => setMediaStatus('La sesión grabada terminó. Puedes finalizar la sala o reproducirla nuevamente.'), {once: true});
  byId('mediaQuality').textContent = 'Video preeditado · audio y video sincronizados';
  return audioTrack;
}

async function publishSessionImage(room) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = state.currentRoom?.sessionImageUrl || byId('sessionImageUrl').value.trim();
  await image.decode().catch(() => { throw new Error('No pudimos cargar la imagen de la sesión. Usa una URL pública con HTTPS.'); });
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d');
  context.fillStyle = '#071a33'; context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  const stream = canvas.captureStream(2);
  const videoTrack = stream.getVideoTracks()[0];
  state.sessionVisualElement = canvas;
  state.sessionVisualPublication = await room.localParticipant.publishTrack(videoTrack, {name: 'qsession-session-image', source: window.LivekitClient.Track.Source.ScreenShare});
  return videoTrack;
}

all('input[name="broadcastMode"], input[name="sessionPriceMode"]').forEach(control => control.addEventListener('change', syncSessionCommerceControls));
byId('recordedSessionFile').addEventListener('change', async event => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  byId('recordedSessionFileName').textContent = file.name;
  state.recordedSessionAssetId = '';
  state.recordedSessionFile = file;
  setStatus(byId('recordedSessionStatus'), 'Preparando subida segura…');
  try {
    await uploadRecordedSession(file);
    setStatus(byId('recordedSessionStatus'), 'Video guardado. Quedará vinculado a esta sesión y al perfil del DJ.');
  } catch (error) {
    event.currentTarget.value = '';
    setStatus(byId('recordedSessionStatus'), error.message, true);
  }
});
syncSessionCommerceControls();

byId('createRoomForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!roomCreatorProfileIsActive()) {
    showView('create');
    return;
  }
  const status = byId('createStatus');
  setStatus(status, 'Creando una sala accesible desde Internet…');
  try {
    const scheduled = document.querySelector('input[name="sessionStartMode"]:checked')?.value === 'scheduled';
    syncScheduledDateTimeValue();
    const scheduledInput = byId('sessionScheduledAt').value;
    const scheduledAt = scheduled && scheduledInput ? new Date(scheduledInput) : null;
    if (scheduled && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) throw new Error('Elige una fecha y una hora válidas.');
    if (scheduled && scheduledAt.getTime() <= Date.now() + 30000) throw new Error('Programa el inicio al menos un minuto después de ahora.');
    const passwordEnabled = byId('roomPasswordEnabled').checked;
    const accessMethods = [
      byId('allowJoinLink').checked && 'link',
      byId('allowJoinCode').checked && 'code',
      byId('allowJoinQr').checked && 'qr',
    ].filter(Boolean);
    if (!accessMethods.length) throw new Error('Activa al menos una forma de ingreso: enlace, código o QR.');
    if (byId('allowVideoSubmissions').checked && !byId('allowVideoToHost').checked && !byId('allowVideoToRoom').checked) {
      throw new Error('Elige si los videos se enviarán al anfitrión, a la sala o a ambos.');
    }
    const broadcastMode = document.querySelector('input[name="broadcastMode"]:checked')?.value || 'live';
    if (broadcastMode === 'recorded' && !state.recordedSessionAssetId) throw new Error('Sube el video grabado antes de crear la sesión.');
    if (broadcastMode === 'image' && !byId('sessionImageUrl').value.trim()) throw new Error('Agrega la imagen que acompañará el audio.');
    const paidWithStars = document.querySelector('input[name="sessionPriceMode"]:checked')?.value === 'stars';
    const translationLanguages = all('[data-translation-language]:checked').map(input => input.dataset.translationLanguage);
    if (!translationLanguages.length) throw new Error('Elige al menos un idioma para la traducción de la conferencia.');
    const result = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        billingPlanId: state.selectedBillingPlanId || undefined,
        name: byId('roomName').value.trim(),
        djName: byId('djName').value.trim(),
        roomType: byId('roomType').value,
        visibility: byId('roomVisibility').value,
        scheduledAt: scheduledAt?.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        capacity: Number(byId('roomCapacity').value) || 0,
        capacityMode: document.querySelector('input[name="roomCapacityMode"]:checked')?.value || 'expected',
        broadcastMode,
        recordedAssetId: broadcastMode === 'recorded' ? state.recordedSessionAssetId : undefined,
        sessionImageUrl: broadcastMode === 'image' ? byId('sessionImageUrl').value.trim() : undefined,
        starPrice: paidWithStars ? Number(byId('sessionStarPrice').value) || 0 : 0,
        accessMethods,
        translation: {
          sourceLanguage: byId('conferenceSourceLanguage').value,
          mode: document.querySelector('input[name="conferenceTranslationMode"]:checked')?.value || 'subtitles',
          targetLanguages: translationLanguages,
        },
        sponsors: state.roomPromotions.map(promotion => promotion.sponsor),
        promotions: state.roomPromotions.map(promotion => ({
          sponsor: promotion.sponsor,
          headline: promotion.headline,
          linkUrl: promotion.linkUrl,
          mediaId: promotion.media?.id || null,
        })),
        password: passwordEnabled ? byId('roomPassword').value : undefined,
        allowPublicChat: byId('allowRoomChat').checked,
        allowGuestCameras: byId('allowGuestCameras').checked,
        allowSocialProfiles: byId('allowRoomSocialProfiles').checked,
        allowMatchmaking: byId('allowRoomMatchmaking').checked,
        allowProfileGifts: byId('allowRoomProfileGifts').checked,
        designTheme: byId('roomDesignTheme').value,
        designMotion: byId('roomDesignMotion').value,
        allowAiCameraEffects: byId('allowAiCameraEffects').checked,
        allowVjVisuals: byId('allowVjVisuals').checked,
        allowVideoSubmissions: byId('allowVideoSubmissions').checked,
        allowGreetingVideos: byId('allowGreetingVideos').checked,
        allowVideoToHost: byId('allowVideoToHost').checked,
        allowVideoToRoom: byId('allowVideoToRoom').checked,
        allowPrivateVideoSubmissions: byId('allowPrivateVideoSubmissions').checked,
        ...Object.fromEntries(CONFERENCE_FEATURE_CONTROLS.map(([controlId, setting]) => [setting, byId(controlId).checked])),
      }),
    });
    state.hostToken = result.hostToken;
    state.roomLink = result.joinUrl || `${location.origin}/?room=${result.room.code}`;
    setCurrentRoom(result.room.code, result.room);
    rememberRoomAccess(result.room.code, result.accessToken || '');
    sessionStorage.setItem(`qsession-host-${result.room.code}`, result.hostToken);
    byId('createdRoomCode').textContent = result.room.code;
    byId('createdRoomName').textContent = result.room.name || 'Sesión Q Session';
    setRoomShareMenuOpen(false);
    byId('roomResult').hidden = false;
    renderRoomQr(state.roomLink);
    setStatus(status, result.room.status === 'waiting'
      ? scheduledRoomLabel(result.room)
      : (result.mediaConfigured ? 'Sala creada. El servidor multimedia global está listo.' : 'Sala creada. Falta conectar el servidor multimedia público para emitir.'));
    prepareMediaConsole('dj', result.room);
    state.roomPromotions = [];
    renderRoomPromotionDrafts();
    byId('roomPassword').value = '';
    if (result.room.visibility === 'public') void loadPublicRooms({quiet: true});
    if (state.account) void loadSessionHistory({quiet: true});
    if (state.account) void loadBilling({quiet: true});
  } catch (error) {
    setStatus(status, error.message, true);
  }
});

function selectPublicRoom(event) {
  const card = event.target.closest('[data-public-room-code]');
  if (!card) return;
  const code = normalizeRoomCode(card.dataset.publicRoomCode);
  if (code.length !== 6) return;
  byId('quickLiveRoomsMenu').open = false;
  setPublicRoomsPanelOpen(false);
  showView('live');
  byId('roomCode').value = code;
  setStatus(byId('joinStatus'), `Entrando a la sala pública ${code}…`);
  byId('joinRoomForm').requestSubmit();
}

function selectListenerRoom(event) {
  const item = event.target.closest('[data-listener-room-code]');
  if (!item) return;
  const code = normalizeRoomCode(item.dataset.listenerRoomCode);
  if (code.length !== 6) return;
  setListenerRoomsPanelOpen(false);
  showView('live');
  byId('roomCode').value = code;
  setStatus(byId('joinStatus'), `Volviendo a la sala ${code}…`);
  byId('joinRoomForm').requestSubmit();
}

byId('publicRoomsList').addEventListener('click', selectPublicRoom);
byId('quickLiveRoomsList').addEventListener('click', selectPublicRoom);
byId('listenerRoomsList').addEventListener('click', selectListenerRoom);

byId('publicRoomsToggle').addEventListener('click', event => {
  const shouldOpen = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  setPublicRoomsPanelOpen(shouldOpen);
  if (shouldOpen) void loadPublicRooms({quiet: state.publicRooms.length > 0});
});
byId('refreshPublicRooms').addEventListener('click', () => void loadPublicRooms());
byId('refreshQuickLiveRooms').addEventListener('click', () => void loadPublicRooms());
byId('listenerRoomsToggle').addEventListener('click', event => {
  const shouldOpen = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  setListenerRoomsPanelOpen(shouldOpen);
});
byId('quickLiveRoomsMenu').addEventListener('toggle', event => {
  if (!event.currentTarget.open) return;
  setHomeSessionAction(null);
  void loadPublicRooms({quiet: state.publicRooms.length > 0});
});
document.addEventListener('click', event => {
  const menu = byId('quickLiveRoomsMenu');
  if (menu.open && !menu.contains(event.target)) menu.open = false;
  const directory = byId('publicRoomDirectory');
  if (byId('publicRoomsToggle').getAttribute('aria-expanded') === 'true' && !directory.contains(event.target)) {
    setPublicRoomsPanelOpen(false);
  }
  const history = byId('listenerRoomHistory');
  if (byId('listenerRoomsToggle').getAttribute('aria-expanded') === 'true' && !history.contains(event.target)) {
    setListenerRoomsPanelOpen(false);
  }
});
document.addEventListener('qsession:languagechange', renderPublicRooms);
document.addEventListener('qsession:languagechange', renderListenerRoomHistory);
document.addEventListener('qsession:languagechange', renderSessionHistory);

byId('joinRoomForm').addEventListener('submit', async event => {
  event.preventDefault();
  const code = roomCodeFromSharedEntry(byId('roomCode').value);
  byId('roomCode').value = code;
  const status = byId('joinStatus');
  if (code.length !== 6) return setStatus(status, 'Escribe un código válido o pega el enlace completo de la sala.', true);
  setStatus(status, 'Buscando la sala en la red mundial…');
  try {
    const result = await api(`/api/rooms/${code}`);
    if (result.room.passwordProtected) return requestRoomPassword(code, result);
    await enterRoomAsListener(result);
  } catch (error) {
    setHomeSessionAction('join');
    setStatus(status, error.message, true);
  }
});

byId('roomPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const pending = state.pendingRoomAccess;
  if (!pending) return cancelRoomPasswordRequest();
  const status = byId('roomPasswordStatus');
  setStatus(status, 'Comprobando contraseña…');
  try {
    const access = await api(`/api/rooms/${pending.code}/access`, {
      method: 'POST',
      body: JSON.stringify({password: byId('roomAccessPassword').value}),
    });
    state.pendingRoomAccess = null;
    byId('roomAccessPassword').value = '';
    byId('roomPasswordDialog').close();
    await enterRoomAsListener(pending.result, access.accessToken);
  } catch (error) {
    setStatus(status, error.message, true);
    byId('roomAccessPassword').select();
  }
});

[byId('closeRoomPassword'), byId('cancelRoomPassword')].forEach(button => button.addEventListener('click', cancelRoomPasswordRequest));
byId('roomPasswordDialog').addEventListener('cancel', event => {
  event.preventDefault();
  cancelRoomPasswordRequest();
});

byId('roomCode').addEventListener('input', event => {
  const value = event.currentTarget.value.trim();
  if (value.length <= 6 && /^[a-z0-9]*$/i.test(value)) event.currentTarget.value = value.toUpperCase();
});

byId('roomCode').addEventListener('paste', event => {
  const pastedText = event.clipboardData?.getData('text') || '';
  const code = roomCodeFromSharedEntry(pastedText);
  if (!code) {
    event.preventDefault();
    setStatus(byId('joinStatus'), 'No encontramos una sala en ese texto. Copia el enlace completo de Q Session.', true);
    return;
  }
  event.preventDefault();
  byId('roomCode').value = code;
  setStatus(byId('joinStatus'), `Enlace reconocido. Entrando a la sala ${code}…`);
  requestAnimationFrame(() => byId('joinRoomForm').requestSubmit());
});

byId('scanRoomQr').addEventListener('click', () => void startRoomQrScanner());
[byId('closeRoomQrScanner'), byId('cancelRoomQrScanner')].forEach(button => {
  button.addEventListener('click', () => {
    state.qrScanCompleting = false;
    stopRoomQrScanner({close: true});
  });
});
byId('roomQrScannerDialog').addEventListener('cancel', event => {
  event.preventDefault();
  state.qrScanCompleting = false;
  stopRoomQrScanner({close: true});
});
byId('roomQrScannerDialog').addEventListener('close', () => stopRoomQrScanner());

function roomShareTranslation(source) {
  return window.QSessionI18n?.translateCore(source, window.QSessionI18n?.getLocale?.()) || source;
}

function roomSharePayload({listener = false} = {}) {
  const name = listener
    ? state.currentRoom?.name || byId('listenerRoomName').textContent.trim() || 'Sesión Q Session'
    : byId('createdRoomName').textContent.trim() || state.currentRoom?.name || 'Sesión Q Session';
  const code = listener
    ? normalizeRoomCode(state.currentRoomCode || byId('listenerRoomCode').textContent)
    : normalizeRoomCode(byId('createdRoomCode').textContent || state.currentRoomCode);
  const url = code ? `${location.origin}/join/${code}` : location.href;
  const accessCode = roomShareTranslation('Código de acceso');
  const joinRoom = roomShareTranslation('Entra a la sala');
  return {
    name,
    code,
    url,
    title: `${roomShareTranslation('Invitación a la sala')} · ${name}`,
    text: `${name}\n${accessCode}: ${code}\n${joinRoom}: ${url}`,
  };
}

function syncRoomShareMenu() {
  const payload = roomSharePayload();
  byId('roomShareName').textContent = payload.name;
  byId('roomShareCode').textContent = payload.code || '——';
}

function setRoomShareMenuOpen(open, {focusMenu = false} = {}) {
  const menu = byId('roomShareMenu');
  const trigger = byId('shareRoomInvite');
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (open) {
    syncRoomShareMenu();
    if (focusMenu) byId('nativeShareRoom').focus();
  }
}

async function copyRoomShareValue(value, successMessage) {
  if (!value) return;
  try {
    if (typeof window.QSessionNativeBridge?.copyText === 'function') {
      window.QSessionNativeBridge.copyText('Q Session', value);
    }
    else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.className = 'sr-only';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw new Error('Clipboard unavailable');
    }
    toast(successMessage);
  } catch {
    toast(value);
  }
}

function setListenerRoomShareMenuOpen(open, {focusMenu = false} = {}) {
  const menu = byId('listenerRoomShareMenu');
  const trigger = byId('shareListenerRoomInvite');
  const nextOpen = Boolean(open);
  menu.hidden = !nextOpen;
  trigger.setAttribute('aria-expanded', String(nextOpen));
  if (nextOpen && focusMenu) menu.querySelector('button')?.focus();
}

function openRoomShareTarget(url) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}

async function runRoomShareAction(action, {listener = false} = {}) {
  const payload = roomSharePayload({listener});
  if (!payload.code) return;
  const closeMenu = () => listener ? setListenerRoomShareMenuOpen(false) : setRoomShareMenuOpen(false);
  if (action === 'native') {
    try {
      const shareText = `${payload.name}\n${roomShareTranslation('Código de acceso')}: ${payload.code}\n${payload.url}`;
      if (typeof window.QSessionNativeBridge?.shareRoom === 'function') {
        window.QSessionNativeBridge.shareRoom(payload.title, shareText);
      }
      else if (navigator.share) {
        await navigator.share({title: payload.title, text: shareText, url: payload.url});
      }
      else await copyRoomShareValue(payload.url, 'Enlace copiado. Ya puedes compartirlo en otra aplicación.');
    } catch (error) {
      if (error?.name !== 'AbortError') toast('No fue posible abrir las aplicaciones para compartir.');
    }
    closeMenu();
    return;
  }
  if (action === 'copy-code') {
    await copyRoomShareValue(payload.code, 'Código copiado');
    return;
  }
  if (action === 'copy-link') {
    await copyRoomShareValue(payload.url, 'Enlace copiado');
    return;
  }
  const encodedText = encodeURIComponent(payload.text);
  const encodedUrl = encodeURIComponent(payload.url);
  const encodedTitle = encodeURIComponent(payload.title);
  const targets = {
    whatsapp: `https://wa.me/?text=${encodedText}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(`${payload.name}\n${roomShareTranslation('Código de acceso')}: ${payload.code}`)}`,
    email: `mailto:?subject=${encodedTitle}&body=${encodedText}`,
    sms: `sms:?&body=${encodedText}`,
  };
  if (targets[action]) openRoomShareTarget(targets[action]);
  closeMenu();
}

byId('shareRoomInvite').addEventListener('click', () => {
  setRoomShareMenuOpen(byId('roomShareMenu').hidden);
});
byId('copyRoomInvite').addEventListener('click', () => {
  const payload = roomSharePayload();
  if (payload.code) void copyRoomShareValue(payload.text, roomShareTranslation('Invitación copiada'));
});
byId('closeRoomShareMenu').addEventListener('click', () => {
  setRoomShareMenuOpen(false);
  byId('shareRoomInvite').focus();
});
byId('roomShareMenu').addEventListener('click', event => {
  const action = event.target.closest('[data-room-share]')?.dataset.roomShare;
  if (action) void runRoomShareAction(action);
});
byId('copyListenerRoomInvite').addEventListener('click', () => {
  const payload = roomSharePayload({listener: true});
  if (!payload.code) return;
  byId('listenerRoomInviteStatus').textContent = roomShareTranslation('Invitación copiada');
  void copyRoomShareValue(payload.text, roomShareTranslation('Invitación copiada'));
});
byId('shareListenerRoomInvite').addEventListener('click', () => {
  setListenerRoomShareMenuOpen(byId('listenerRoomShareMenu').hidden, {focusMenu: false});
});
byId('listenerRoomShareMenu').addEventListener('click', event => {
  const action = event.target.closest('[data-listener-room-share]')?.dataset.listenerRoomShare;
  if (action) void runRoomShareAction(action, {listener: true});
});
document.addEventListener('click', event => {
  if (!byId('roomShareControl').contains(event.target)) setRoomShareMenuOpen(false);
  if (!byId('listenerRoomInvite').contains(event.target)) setListenerRoomShareMenuOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!byId('roomShareMenu').hidden) {
    setRoomShareMenuOpen(false);
    byId('shareRoomInvite').focus();
  }
  if (!byId('listenerRoomShareMenu').hidden) {
    setListenerRoomShareMenuOpen(false);
    byId('shareListenerRoomInvite').focus();
  }
});

byId('startBroadcast').addEventListener('click', () => void startBroadcast());
// APKs before 0.1.40 injected a capturing button listener that started a
// microphone service before permission. Intercept that obsolete hook higher
// in the event path; the normal flow below starts only after source checks.
window.addEventListener('click', event => {
  if (!IS_QSESSION_ANDROID || hasTypedAndroidBroadcastService() || !event.target?.closest?.('#startBroadcast')) return;
  event.stopImmediatePropagation();
  if (!byId('startBroadcast').disabled) void startBroadcast();
}, true);
byId('toggleBroadcastAudio').addEventListener('click', () => void toggleBroadcastAudio());
byId('toggleCamera').addEventListener('click', () => void toggleLocalCamera());
byId('changeBroadcastSource').addEventListener('click', () => {const setup=byId('hostAudioSetup');if(!setup.open){setup.open=true;byId('broadcastSourceTrigger').focus();setMediaStatus('Elige una entrada y pulsa de nuevo para aplicar la fuente.');return;}void changeBroadcastSource();});
byId('toggleRecordedPlayback').addEventListener('click', () => void toggleRecordedPlayback());
byId('restartRecordedPlayback').addEventListener('click', () => void restartRecordedPlayback());
byId('stopBroadcast').addEventListener('click', () => void finishBroadcast());
byId('confirmationCancel').addEventListener('click', () => settleConfirmation(false));
byId('confirmationAccept').addEventListener('click', () => settleConfirmation(true));
byId('confirmationDialog').addEventListener('cancel', event => {
  event.preventDefault();
  settleConfirmation(false);
});
byId('confirmationDialog').addEventListener('close', () => {
  if (confirmationResolver) settleConfirmation(false);
});
byId('joinBroadcast').addEventListener('click', () => void joinBroadcast());
byId('toggleListenerSound').addEventListener('click', toggleListenerSound);
all('[data-listener-output-gain]').forEach(button => button.addEventListener('click', () => {
  setListenerOutputGain(button.dataset.listenerOutputGain);
}));
byId('toggleListenerCamera').addEventListener('click', () => void toggleLocalCamera({listener: true}));
byId('cameraDevice').addEventListener('change', event => void switchCameraDevice(event.target.value));
byId('cameraDeviceTrigger').addEventListener('click', () => {
  const menu = byId('cameraDeviceMenu');
  const opening = menu.hidden;
  menu.hidden = !opening;
  byId('cameraDeviceTrigger').setAttribute('aria-expanded', String(opening));
  if (opening) menu.querySelector('[aria-selected="true"]')?.focus();
});
byId('cameraDeviceMenu').addEventListener('click', event => {
  const option = event.target.closest('[data-camera-device-id]');
  if (!option) return;
  byId('cameraDevice').value = option.dataset.cameraDeviceId;
  void switchCameraDevice(option.dataset.cameraDeviceId);
});
document.addEventListener('click', event => {
  if (!event.target.closest('#cameraDevicePicker')) closeCameraDeviceMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !byId('cameraDeviceMenu').hidden) {
    closeCameraDeviceMenu();
    byId('cameraDeviceTrigger').focus();
  }
});
document.addEventListener('qsession:languagechange', renderCameraSettingsSummary);
document.addEventListener('qsession:languagechange', renderBroadcastAudioBitrateControl);
byId('refreshCameraDevices').addEventListener('click', () => void refreshCameraDevices());
all('button[data-camera-framing]').forEach(button => button.addEventListener('click', () => void setLocalCameraFraming(button.dataset.cameraFraming)));
all('button[data-camera-orientation]').forEach(button => button.addEventListener('click', () => void setLocalCameraOrientation(button.dataset.cameraOrientation)));
all('button[data-camera-effect]').forEach(button => button.addEventListener('click', () => applyCameraEffect(button.dataset.cameraEffect)));
byId('cameraEffectIntensity').addEventListener('input', event => applyCameraEffect(state.cameraEffect, event.target.value));
byId('cameraZoom').addEventListener('change', event => void applyCameraZoom(event.target.value));
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (state.mediaConnected) void refreshCameraDevices({quiet: true});
  void refreshAudioInputDevices({
    quiet: true,
    activeTrack: state.mediaAudioPublication?.track?.mediaStreamTrack || null,
    voiceTrack: state.voiceOverlayStream?.getAudioTracks?.()[0] || null,
  });
});
byId('sessionBackButton').addEventListener('click', () => void returnFromListenerSession());
byId('leaveBroadcast').addEventListener('click', () => void returnFromListenerSession());
byId('mediaFullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      screen.orientation?.unlock?.();
    } else {
      await byId('mediaStage').requestFullscreen();
      const format = byId('mediaStage').dataset.cameraOrientation === 'landscape' ? 'landscape' : 'portrait';
      try { await screen.orientation?.lock?.(format); } catch { /* El navegador mantiene su orientación actual. */ }
    }
  } catch {
    setMediaStatus('Este dispositivo no permitió abrir la pantalla completa.', true);
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) screen.orientation?.unlock?.();
});
byId('broadcastSourceTrigger').addEventListener('click', () => {
  setBroadcastSourceMenuOpen(byId('broadcastSourceMenu').hidden);
});
byId('broadcastSourceTrigger').addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  setBroadcastSourceMenuOpen(true, {focusSelected: true});
});
byId('broadcastSourceMenu').addEventListener('click', event => {
  const option = event.target.closest('[data-broadcast-source-value]');
  if (option) chooseBroadcastSource(option.dataset.broadcastSourceValue);
});
byId('broadcastSourceMenu').addEventListener('keydown', event => {
  const buttons = broadcastSourceMenuButtons();
  const currentIndex = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    setBroadcastSourceMenuOpen(false);
    byId('broadcastSourceTrigger').focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (currentIndex + 1 + buttons.length) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
});
document.addEventListener('click', event => {
  if (!byId('broadcastSourcePicker').contains(event.target)) setBroadcastSourceMenuOpen(false);
});
byId('broadcastSource').addEventListener('change', () => {
  const source = byId('broadcastSource').value;
  syncBroadcastSourceControl();
  if (PHYSICAL_AUDIO_SOURCES.has(source)) {
    state.audioInputDeviceId = '';
    try { localStorage.removeItem('qsession-audio-input-device'); } catch { /* La selección continúa durante esta visita. */ }
    void refreshAudioInputDevices({quiet: true});
  }
  updateBroadcastSourceHelp();
  setMediaStatus(source === 'tab'
    ? 'Al iniciar, elige una pestaña y activa “Compartir audio”.'
    : `Q Session buscará ${audioSourceName(source)} al iniciar.`);
});
byId('microphoneMode').addEventListener('change', () => {
  updateBroadcastSourceHelp();
  if (state.mediaConnected && state.mediaRole === 'dj' && PHYSICAL_AUDIO_SOURCES.has(state.mediaSourceKind)) {
    setMediaStatus('Modo preparado. Pulsa “Reconectar entrada de audio” para aplicarlo a la transmisión activa.');
  }
});
byId('audioInput').addEventListener('change', event => {
  state.audioInputDeviceId = event.currentTarget.value;
  try { localStorage.setItem('qsession-audio-input-device', state.audioInputDeviceId); } catch { /* La selección continúa durante esta visita. */ }
  const label = event.currentTarget.selectedOptions[0]?.textContent || 'Entrada automática';
  setMediaStatus(state.mediaConnected && PHYSICAL_AUDIO_SOURCES.has(state.mediaSourceKind)
    ? `${label} preparada. Pulsa “Reconectar entrada de audio” para aplicarla.`
    : `${label} preparada para la próxima transmisión.`);
});
byId('refreshAudioInputs').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  let probe = null;
  try {
    const activeTrack = PHYSICAL_AUDIO_SOURCES.has(state.mediaSourceKind) ? state.mediaAudioPublication?.track?.mediaStreamTrack : null;
    if (activeTrack?.readyState === 'live') {
      await refreshAudioInputDevices({activeTrack});
    } else {
      setMediaStatus('Solicitando permiso para buscar entradas USB, HDMI, 3,5 mm y Bluetooth…');
      probe = await captureMicrophone();
      await refreshAudioInputDevices({activeTrack: probe.track});
      setMediaStatus('Entradas de audio actualizadas.');
    }
  } catch (error) {
    setMediaStatus(error.message, true);
  } finally {
    probe?.stream?.getTracks().forEach(track => track.stop());
    button.disabled = false;
  }
});

byId('voiceOverlayInput').addEventListener('change', async event => {
  state.voiceOverlayDeviceId = event.currentTarget.value;
  try { localStorage.setItem('qsession-voice-overlay-device', state.voiceOverlayDeviceId); } catch { /* La selección continúa durante esta visita. */ }
  const label = event.currentTarget.selectedOptions[0]?.textContent || 'Micrófono automático';
  if (state.voiceOverlayPublication) {
    setStatus(byId('voiceOverlayStatus'), `Cambiando a ${label} sin detener la música…`);
    await reconnectVoiceOverlay();
  } else {
    setStatus(byId('voiceOverlayStatus'), `${label} preparado. La música no se interrumpirá al abrirlo.`);
  }
});

byId('voiceOverlayDeviceTrigger').addEventListener('click', () => {
  setVoiceOverlayDeviceMenuOpen(byId('voiceOverlayDeviceMenu').hidden);
});
byId('voiceOverlayDeviceTrigger').addEventListener('keydown', event => {
  if (!['ArrowDown', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  setVoiceOverlayDeviceMenuOpen(true, {focusSelected: true});
});
byId('voiceOverlayDeviceMenu').addEventListener('click', event => {
  const option = event.target.closest('[data-voice-overlay-device-id]');
  if (option) chooseVoiceOverlayDevice(option.dataset.voiceOverlayDeviceId);
});
byId('voiceOverlayDeviceMenu').addEventListener('keydown', event => {
  const buttons = voiceOverlayDeviceMenuButtons();
  const currentIndex = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    setVoiceOverlayDeviceMenuOpen(false);
    byId('voiceOverlayDeviceTrigger').focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (currentIndex + 1 + buttons.length) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
});
document.addEventListener('click', event => {
  if (!byId('voiceOverlayDevicePicker').contains(event.target)) setVoiceOverlayDeviceMenuOpen(false);
});
document.addEventListener('qsession:languagechange', () => renderVoiceOverlayDevicePicker());

byId('refreshVoiceOverlayInputs').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  let probe = null;
  try {
    const activeTrack = state.voiceOverlayStream?.getAudioTracks?.()[0] || null;
    if (activeTrack?.readyState === 'live') {
      await refreshAudioInputDevices({voiceTrack: activeTrack});
    } else {
      setStatus(byId('voiceOverlayStatus'), 'Solicitando permiso para buscar micrófonos Bluetooth, USB y de 3,5 mm…');
      probe = await navigator.mediaDevices.getUserMedia(voiceOverlayCaptureOptions());
      const probeTrack = probe.getAudioTracks()[0];
      await refreshAudioInputDevices({voiceTrack: probeTrack});
      setStatus(byId('voiceOverlayStatus'), 'Micrófonos actualizados. Elige uno y pulsa “Abrir micrófono”.');
    }
  } catch (error) {
    setStatus(byId('voiceOverlayStatus'), microphoneCaptureError(error).message, true);
  } finally {
    probe?.getTracks().forEach(track => track.stop());
    button.disabled = false;
  }
});

byId('toggleVoiceOverlay').addEventListener('click', () => void toggleVoiceOverlay());

byId('voiceOverlayVolume').addEventListener('input', event => {
  state.voiceOverlayVolume = Number(event.currentTarget.value);
  try { localStorage.setItem('qsession-voice-overlay-volume', String(state.voiceOverlayVolume)); } catch { /* La selección continúa durante esta visita. */ }
  applyVoiceOverlayTone();
});
byId('voiceOverlayBass').addEventListener('input', event => {
  state.voiceOverlayBass = Number(event.currentTarget.value);
  try { localStorage.setItem('qsession-voice-overlay-bass', String(state.voiceOverlayBass)); } catch { /* La selección continúa durante esta visita. */ }
  applyVoiceOverlayTone();
});
byId('voiceOverlayTreble').addEventListener('input', event => {
  state.voiceOverlayTreble = Number(event.currentTarget.value);
  try { localStorage.setItem('qsession-voice-overlay-treble', String(state.voiceOverlayTreble)); } catch { /* La selección continúa durante esta visita. */ }
  applyVoiceOverlayTone();
});

byId('installAppButton').addEventListener('click', downloadPreferredApp);
byId('installAppHeroButton').addEventListener('click', downloadWindowsApp);
byId('downloadAndroidButton').addEventListener('click', downloadAndroidApp);
byId('repeatAndroidDownload').addEventListener('click', repeatAndroidDownload);
byId('openAndroidApp').addEventListener('click', openAndroidApp);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.installPrompt = event;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  updateInstallButton();
  toast('Q Session quedó instalada.');
});

window.addEventListener('beforeunload', () => {
  // Screen lock is not a request to close the host's room.
  if (hasNativeAndroidAudio() && state.mediaRole === 'dj' && state.mediaConnected && state.androidBroadcastBackground) return;
  if (hasNativeAndroidAudio()) stopWebGlobalPresence({remove: false});
  else stopWebGlobalPresence();
  stopDesktopChromeCapture();
  // In the Android app the native listener belongs to the foreground service,
  // not to this WebView page. Android may discard/recreate the WebView after
  // the screen has been locked for a while; treating that lifecycle event as
  // an explicit leave command used to stop the native audio after a few
  // minutes. The normal "leave room" flow still calls disconnectMedia(), which
  // sends listener-stop intentionally.
  if (state.mediaRole === 'listener' && !hasNativeAndroidAudio()) {
    postNativeAudioCommand({type: 'listener-stop'});
  }
  stopRoomQrScanner();
  stopProfileActivityPolling();
  state.mediaCaptureStream?.getTracks().forEach(track => track.stop());
  state.voiceOverlayStream?.getTracks().forEach(track => track.stop());
  disposeVoiceOverlayProcessor();
  void state.mediaRoom?.disconnect();
  void state.privateVoiceRoom?.disconnect();
});

async function restoreRequestedRoom() {
  if (!state.currentRoomCode) return;
  byId('roomCode').value = state.currentRoomCode;
  try {
    const result = await api(`/api/rooms/${state.currentRoomCode}`);
    setCurrentRoom(state.currentRoomCode, result.room);
    const rememberedHostToken = sessionStorage.getItem(`qsession-host-${state.currentRoomCode}`) || '';
    const rememberedAccessToken = rememberedRoomAccess(state.currentRoomCode);
    if (rememberedHostToken) {
      state.hostToken = rememberedHostToken;
      rememberRoomAccess(state.currentRoomCode, rememberedAccessToken);
      state.roomLink = `${location.origin}/join/${result.room.code}`;
      byId('createdRoomCode').textContent = result.room.code;
      byId('createdRoomName').textContent = result.room.name || 'Sesión Q Session';
      setRoomShareMenuOpen(false);
      byId('roomResult').hidden = false;
      renderRoomQr(state.roomLink);
      prepareMediaConsole('dj', result.room);
    } else if (result.room.passwordProtected && !rememberedAccessToken) {
      requestRoomPassword(state.currentRoomCode, result);
    } else {
      await enterRoomAsListener(result, rememberedAccessToken);
    }
  } catch (error) {
    setStatus(byId('joinStatus'), error.message, true);
  }
}

const queryRoom = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
const rememberedRoom = normalizeRoomCode(sessionStorage.getItem('qsession-current-room'));
initializeHomeSessionActions();
initializeWindowsDesktopCaptureBridge();
initializeBroadcastActionButtons();
initializeListenerActionButtons();
setCurrentRoom(queryRoom || rememberedRoom);
setAuthMode(restoreRememberedAccountEmail() ? 'login' : 'register');
restoreAccount();
applyPeopleView();
applyLocalCameraOrientation(state.cameraOrientation);
renderCameraEffectControl();
byId('privateFilterPrompt').value = state.privateVoiceFilter.prompt;
byId('privateFilterTrigger').value = state.privateVoiceFilter.trigger;
configureDefaultBroadcastSource();
renderBroadcastAudioBitrateControl();
renderVoiceOverlayToneControls();
renderVoiceOverlayControl();
renderListenerOutputControl();
renderListenerRoomHistory();
renderAppVersionLabel();
renderVisionWorldMap();
renderGlobalRaveCapitals();
initializeGlobalRaveMap();
showView(location.hash.replace('#', '') || 'live', {updateHash: false});
startPublicRoomPolling();
startGlobalRavePolling();
void restoreRequestedRoom();
updateInstallButton();
void loadAppReleases();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

window.addEventListener('qsession-music-track', event => {
  if (state.mediaRole !== 'dj' || state.mediaSourceKind !== 'library') return;
  const id = event.detail?.id || '';
  void window.QSessionMusic?.showRoomTrack(id);
  void state.mediaRoom?.localParticipant?.setAttributes?.({'qsession.musicTrackId': id}).catch(() => undefined);
});
