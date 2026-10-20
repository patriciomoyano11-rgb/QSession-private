export const QSESSION_PRODUCTION_ORIGIN = 'https://qsession.org';

export type RoomVisibility = 'public' | 'private';

export type RoomKind =
  | 'music'
  | 'yoga-meditation'
  | 'wedding'
  | 'birthday'
  | 'baby-shower'
  | 'party'
  | 'conference'
  | 'class'
  | 'professional'
  | 'networking'
  | 'private-experience'
  | 'custom';

export const CREATABLE_ROOM_KINDS = [
  'music',
  'yoga-meditation',
  'conference',
  'wedding',
  'birthday',
  'baby-shower',
  'custom',
] as const;

export type CreatableRoomKind = (typeof CREATABLE_ROOM_KINDS)[number];

export type RoomFeatures = {
  allowPublicChat: boolean;
  allowGuestCameras: boolean;
  allowSocialProfiles: boolean;
  allowMatchmaking: boolean;
  allowProfileGifts: boolean;
};

export type RoomDesignTheme = 'midnight' | 'serenity' | 'institutional' | 'celebration' | 'minimal';
export type RoomDesignMotion = 'calm' | 'balanced' | 'immersive';

export type RoomExperience = {
  designTheme: RoomDesignTheme;
  designMotion: RoomDesignMotion;
  allowAiCameraEffects: boolean;
  allowVjVisuals: boolean;
  allowVideoSubmissions: boolean;
  allowGreetingVideos: boolean;
  allowVideoToHost: boolean;
  allowVideoToRoom: boolean;
  allowPrivateVideoSubmissions: boolean;
};

export type RoomExperienceTool = Exclude<keyof RoomExperience, 'designTheme' | 'designMotion'>;

export type RoomExperiencePreset = RoomExperience & {
  title: string;
  detail: string;
  allowedTools: RoomExperienceTool[];
};

export type RoomPreset = RoomFeatures & {
  label: string;
  description: string;
  visibility: RoomVisibility;
};

export const ROOM_PRESETS: Record<RoomKind, RoomPreset> = {
  music: {
    label: 'Música',
    description: 'Música en vivo, cámaras y comunidad alrededor de una misma señal.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: true,
    allowProfileGifts: true,
  },
  'yoga-meditation': {
    label: 'Yoga y meditación',
    description: 'Prácticas de yoga, respiración y meditación con participación tranquila.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: false,
    allowSocialProfiles: true,
    allowMatchmaking: false,
    allowProfileGifts: false,
  },
  wedding: {
    label: 'Boda',
    description: 'Una celebración íntima para acompañar a la pareja desde cualquier lugar.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: false,
    allowProfileGifts: true,
  },
  birthday: {
    label: 'Cumpleaños',
    description: 'Invitados, saludos y momentos compartidos en una celebración en vivo.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: false,
    allowProfileGifts: true,
  },
  'baby-shower': {
    label: 'Baby shower',
    description: 'Familia y amistades reunidas para compartir el momento y sus detalles.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: false,
    allowProfileGifts: true,
  },
  // Formatos históricos: se mantienen para leer salas creadas por versiones anteriores.
  party: {
    label: 'Fiesta o música',
    description: 'Música, cámaras y herramientas para compartir el momento.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: true,
    allowProfileGifts: true,
  },
  conference: {
    label: 'Conferencia',
    description: 'Presentación central y conexiones profesionales opcionales.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: false,
    allowProfileGifts: false,
  },
  class: {
    label: 'Clase o taller',
    description: 'Yoga, baile, idiomas y aprendizaje con participación controlada.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: false,
    allowMatchmaking: false,
    allowProfileGifts: false,
  },
  professional: {
    label: 'Reunión profesional',
    description: 'Trabajo privado sin funciones sociales innecesarias.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: false,
    allowMatchmaking: false,
    allowProfileGifts: false,
  },
  networking: {
    label: 'Networking',
    description: 'Perfiles visibles, conversación y nuevas conexiones.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: true,
    allowProfileGifts: false,
  },
  'private-experience': {
    label: 'Experiencia privada',
    description: 'Hoteles, empresas o clientes con acceso reservado.',
    visibility: 'private',
    allowPublicChat: false,
    allowGuestCameras: false,
    allowSocialProfiles: false,
    allowMatchmaking: false,
    allowProfileGifts: false,
  },
  custom: {
    label: 'Personalizada',
    description: 'Configura libremente la privacidad y la participación.',
    visibility: 'private',
    allowPublicChat: true,
    allowGuestCameras: true,
    allowSocialProfiles: true,
    allowMatchmaking: false,
    allowProfileGifts: true,
  },
};

const videoTools: RoomExperienceTool[] = ['allowVideoSubmissions', 'allowVideoToHost', 'allowVideoToRoom', 'allowPrivateVideoSubmissions'];
const greetingTools: RoomExperienceTool[] = [...videoTools, 'allowGreetingVideos'];

export const ROOM_EXPERIENCE_PRESETS: Record<CreatableRoomKind, RoomExperiencePreset> = {
  music: {
    title: 'Música QSession',
    detail: 'Escena moderna y sobria con creador IA, visuales VJ y videos del público.',
    designTheme: 'midnight', designMotion: 'immersive',
    allowAiCameraEffects: true, allowVjVisuals: true, allowVideoSubmissions: true,
    allowGreetingVideos: false, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    allowedTools: ['allowAiCameraEffects', 'allowVjVisuals', ...videoTools],
  },
  'yoga-meditation': {
    title: 'Yoga y meditación',
    detail: 'Atmósfera de paz y equilibrio, sin filtros ni disfraces; permite videos públicos o privados.',
    designTheme: 'serenity', designMotion: 'calm',
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: false, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    allowedTools: videoTools,
  },
  conference: {
    title: 'Conferencia',
    detail: 'Diseño institucional QSession para ponentes, cámaras y conversación profesional.',
    designTheme: 'institutional', designMotion: 'balanced',
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: false,
    allowGreetingVideos: false, allowVideoToHost: false, allowVideoToRoom: false, allowPrivateVideoSubmissions: false,
    allowedTools: [],
  },
  wedding: {
    title: 'Boda', detail: 'Celebración armónica con videos de saludo de los invitados.',
    designTheme: 'celebration', designMotion: 'balanced',
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    allowedTools: greetingTools,
  },
  birthday: {
    title: 'Cumpleaños', detail: 'Celebración elegante con videos de felicitación para el anfitrión o la sala.',
    designTheme: 'celebration', designMotion: 'balanced',
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    allowedTools: greetingTools,
  },
  'baby-shower': {
    title: 'Baby shower', detail: 'Una experiencia suave y cercana con saludos de familia y amistades.',
    designTheme: 'celebration', designMotion: 'calm',
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: true,
    allowGreetingVideos: true, allowVideoToHost: true, allowVideoToRoom: true, allowPrivateVideoSubmissions: true,
    allowedTools: greetingTools,
  },
  custom: {
    title: 'Sala personalizada', detail: 'Todos los controles quedan disponibles para construir una experiencia propia.',
    designTheme: 'minimal', designMotion: 'balanced',
    allowAiCameraEffects: false, allowVjVisuals: false, allowVideoSubmissions: false,
    allowGreetingVideos: false, allowVideoToHost: false, allowVideoToRoom: false, allowPrivateVideoSubmissions: false,
    allowedTools: ['allowAiCameraEffects', 'allowVjVisuals', ...greetingTools],
  },
};

export const QSESSION_MUSIC_RIGHTS_VERSION = 'music-rights-v1-2026-09-29';

export type MusicRightsDeclaration = {
  accepted: true;
  version: string;
  scope: 'host-supplied-content';
};

export type CreateRoomRequest = Partial<RoomFeatures & RoomExperience> & {
  name: string;
  djName?: string;
  description?: string;
  roomType?: RoomKind;
  visibility?: RoomVisibility;
  scheduledAt?: string | null;
  timeZone?: string;
  capacity?: number;
  sponsors?: string[];
  promotions?: QSessionRoomPromotion[];
  password?: string;
  rightsDeclaration: MusicRightsDeclaration;
};

export type QSessionRoomPromotion = {
  id?: string;
  sponsor: string;
  headline?: string | null;
  linkUrl?: string | null;
  mediaId?: string | null;
  media?: {
    id: string;
    url: string;
    contentType: string;
  } | null;
};

export type QSessionRoom = RoomFeatures & RoomExperience & {
  code: string;
  name: string | null;
  djName: string | null;
  description?: string | null;
  roomType: RoomKind;
  visibility: RoomVisibility;
  status: 'waiting' | 'live' | 'archived';
  transport: 'sfu';
  scheduledAt?: string | null;
  startedAt?: string | null;
  timeZone?: string;
  capacity?: number;
  sponsors?: string[];
  promotions?: QSessionRoomPromotion[];
  passwordProtected?: boolean;
  participantCount?: number;
};

export type CreatedRoom = {
  room: QSessionRoom;
  hostToken: string;
  joinUrl: string;
  mediaConfigured: boolean;
};

export type MediaDelivery = {
  kind: 'webrtc' | 'broadcast';
  topology: 'interactive-sfu' | 'cdn-one-to-many';
  url: string;
  token?: string;
  fallback?: {
    kind: 'webrtc';
    topology: 'interactive-sfu';
    url: string;
    token: string;
  };
};

export type MediaCredentials = {
  transport: 'sfu';
  url: string;
  token: string;
  presenceTicket?: string;
  permissions?: string[];
  delivery?: MediaDelivery;
  limits?: {djCameras?: number; targetParticipants?: number};
};

export type ActiveHostSession = {
  room: QSessionRoom;
  hostToken: string;
  joinUrl: string;
};
