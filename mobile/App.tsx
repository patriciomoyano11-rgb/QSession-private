import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  KeyboardAvoidingView,
  Image,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Share,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { RTCView } from '@livekit/react-native-webrtc';
import Video from 'react-native-video';
import Svg, {Circle, Path as SvgPath, Rect as SvgRect} from 'react-native-svg';
import {
  QSessionLanguageProvider,
  QSessionPressable as Pressable,
  QSessionText as Text,
  QSessionTextInput as TextInput,
  qsessionTranslate,
  useQSessionLanguage,
} from './src/QSessionI18n';
import {
  QSessionServerStatus,
  verifyQSessionServer,
} from './src/QSessionListener';
import {
  ListenerState,
  QSessionChatMessage,
  QSessionListenerClient,
  QSessionParticipant,
  QSessionPrivateChat,
  QSessionPrivateMessage,
  QSessionLiveChatState,
  QSessionLiveChatVideo,
  QSessionRoomInfo,
  QSessionSocialVideo,
} from './src/QSessionMediaClient';
import { parseRoomInvitation, roomIsActiveOnServer } from './src/QSessionRoom';
import {
  BroadcastRoom,
  BroadcastState,
  QSessionBroadcasterClient,
} from './src/QSessionBroadcaster';
import { QSessionLiveVisualizer } from './src/QSessionLiveVisualizer';
import {
  addProfilePhoto,
  createEmptyProfile,
  makePrimaryProfilePhoto,
  normalizeProfile,
  profileInterests,
  QSessionUserProfile,
  removeProfilePhoto,
  serverProfilePayload,
} from './src/QSessionProfile';
import {countryCodeFromGpsCoordinates} from './src/QSessionCountry';
import {
  loginAccount,
  logoutAccount,
  normalizeAccountSession,
  profileFromServer,
  publishStory,
  QSessionAccountError,
  QSessionAccountSession,
  QSessionStory,
  refreshAccount,
  registerAccount,
  saveAccountProfile,
} from './src/QSessionAccount';
import {
  playback,
  profileStorage,
  qrScanner,
  locationService,
  preparePickedProfilePhoto,
  requestApproximateLocationPermission,
  requestNotificationPermission,
  requestMicrophonePermission,
  voiceNotes,
} from './src/platform/QSessionNativeModules';
import {
  CREATABLE_ROOM_KINDS,
  QSESSION_PRODUCTION_ORIGIN,
  QSESSION_MUSIC_RIGHTS_VERSION,
  ROOM_EXPERIENCE_PRESETS,
  ROOM_PRESETS,
  CreatableRoomKind,
  RoomDesignMotion,
  RoomDesignTheme,
  RoomExperience,
  RoomExperienceTool,
  RoomFeatures,
  QSessionRoom as PublicRoom,
} from './src/core/QSessionContracts';
import {QSessionApi} from './src/core/QSessionApi';
import {
  normalizeEngagementState,
  shouldRequestDeferredNotificationPermission,
} from './src/QSessionEngagement';

type Role = 'listener' | 'dj' | 'organizer' | null;
type EntryMethod = 'qr' | 'link' | 'code';
type MainSection = 'live' | 'people' | 'chat' | 'global';
type ListenerView = MainSection;
type ChatSection = 'room' | 'private';
type AccountMode = 'register' | 'login';
type GlobalRaveSnapshot = {
  total: number;
  visiblePresenceCount?: number;
  activeCountries: number;
  maxPointsPerCountry: number;
  countries: Array<{
    code: string;
    count: number;
    points: Array<Record<string, never>>;
    publicPeople?: string[];
    privateCount?: number;
  }>;
};
const emptyGlobalRave: GlobalRaveSnapshot = {total: 0, activeCountries: 0, maxPointsPerCountry: 25, countries: []};
const brandIcon = require('./assets/qsession-brand-master.png');
const liveBrandMark = brandIcon;
const worldNetwork = require('./assets/qsession-world-network.png');
type PoliticalCountry = {
  code: string;
  names: {es: string; en: string; de: string};
  path?: string;
  x: number;
  y: number;
  bounds?: [number, number, number, number];
};
const politicalWorld = require('./src/generated/world-countries.json') as {
  countries: PoliticalCountry[];
  microstates: PoliticalCountry[];
};
function countryCodeFromResidence(value: string): string {
  const normalize = (text: string) => text.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const source = String(value || '').trim();
  const candidates = [source, source.split(',').at(-1) || ''].map(normalize).filter(Boolean);
  const aliases: Record<string, string> = {
    'estados unidos': 'US', usa: 'US', 'reino unido': 'GB', uk: 'GB', inglaterra: 'GB',
    'corea del sur': 'KR', 'corea del norte': 'KP', 'republica dominicana': 'DO',
  };
  for (const candidate of candidates.reverse()) {
    if (aliases[candidate]) return aliases[candidate];
    const match = [...politicalWorld.countries, ...politicalWorld.microstates]
      .find(country => Object.values(country.names).some(name => normalize(name) === candidate));
    if (match) return match.code;
  }
  return '';
}
const roomFeatureOptions: Array<{key: keyof RoomFeatures; label: string; detail: string}> = [
  {key: 'allowPublicChat', label: 'Chat', detail: 'Mensajes durante la sesión.'},
  {key: 'allowGuestCameras', label: 'Cámaras de usuarios', detail: 'Cada persona decide si quiere aparecer.'},
  {key: 'allowSocialProfiles', label: 'Perfiles visibles', detail: 'Identidad y conexiones dentro de la sala.'},
  {key: 'allowMatchmaking', label: 'Matchmaking abierto', detail: 'Afinidades y toques entre perfiles.'},
  {key: 'allowProfileGifts', label: 'Detalles', detail: 'Gestos simbólicos entre personas.'},
];
function roomFeaturesFor(kind: CreatableRoomKind): RoomFeatures {
  const preset = ROOM_PRESETS[kind];
  return {
    allowPublicChat: preset.allowPublicChat,
    allowGuestCameras: preset.allowGuestCameras,
    allowSocialProfiles: preset.allowSocialProfiles,
    allowMatchmaking: preset.allowMatchmaking,
    allowProfileGifts: preset.allowProfileGifts,
  };
}
function roomExperienceFor(kind: CreatableRoomKind): RoomExperience {
  const preset = ROOM_EXPERIENCE_PRESETS[kind];
  return {
    designTheme: preset.designTheme,
    designMotion: preset.designMotion,
    allowAiCameraEffects: preset.allowAiCameraEffects,
    allowVjVisuals: preset.allowVjVisuals,
    allowVideoSubmissions: preset.allowVideoSubmissions,
    allowGreetingVideos: preset.allowGreetingVideos,
    allowVideoToHost: preset.allowVideoToHost,
    allowVideoToRoom: preset.allowVideoToRoom,
    allowPrivateVideoSubmissions: preset.allowPrivateVideoSubmissions,
  };
}
const roomExperienceOptions: Array<{key: RoomExperienceTool; label: string; detail: string}> = [
  {key: 'allowAiCameraEffects', label: 'Creador IA', detail: 'Filtros, máscaras y disfraces a partir de indicaciones.'},
  {key: 'allowVjVisuals', label: 'Visuales VJ', detail: 'Efectos visuales para acompañar la señal.'},
  {key: 'allowVideoSubmissions', label: 'Videos de participantes', detail: 'Envíos para el anfitrión o la sala.'},
  {key: 'allowGreetingVideos', label: 'Videos de saludo', detail: 'Felicitaciones y mensajes para celebraciones.'},
];
const roomVideoExperienceOptions: Array<{key: RoomExperienceTool; label: string; detail: string}> = [
  {key: 'allowVideoToHost', label: 'Al anfitrión', detail: 'Entrega privada para revisión.'},
  {key: 'allowVideoToRoom', label: 'A la sala', detail: 'Puede proponerse para el espacio público.'},
  {key: 'allowPrivateVideoSubmissions', label: 'Envío privado', detail: 'Sólo el anfitrión lo ve hasta aprobarlo.'},
];
const roomDesignThemes: Array<{value: RoomDesignTheme; label: string}> = [
  {value: 'midnight', label: 'Nocturno'}, {value: 'serenity', label: 'Serenidad'},
  {value: 'institutional', label: 'Institucional'}, {value: 'celebration', label: 'Celebración'},
  {value: 'minimal', label: 'Minimalista'},
];
const roomDesignMotions: Array<{value: RoomDesignMotion; label: string}> = [
  {value: 'calm', label: 'Calmo'}, {value: 'balanced', label: 'Equilibrado'}, {value: 'immersive', label: 'Inmersivo'},
];
const roles = [
  {
    id: 'listener' as const,
    icon: '♫',
    title: 'Escuchar',
    text: 'Entra con el código de una sala y escucha audio en vivo.',
  },
  {
    id: 'dj' as const,
    icon: '●',
    title: 'Transmitir como DJ',
    text: 'Crea una sala y transmite desde este teléfono.',
  },
  {
    id: 'organizer' as const,
    icon: '◎',
    title: 'Organizar un evento',
    text: 'Prepara el transmisor y comparte el QR con los asistentes.',
  },
];
const entryMethods: Array<{
  id: EntryMethod;
  icon: string;
  title: string;
  text: string;
}> = [
  {
    id: 'qr',
    icon: '▣',
    title: 'Escanear código QR',
    text: 'La forma más rápida de entrar.',
  },
  {
    id: 'link',
    icon: '↗',
    title: 'Pegar enlace',
    text: 'Usa la invitación del organizador.',
  },
  {
    id: 'code',
    icon: '#',
    title: 'Escribir código',
    text: 'Ingresa las seis letras o números.',
  },
];
const outputOptions = [
  { gain: 1, label: 'Normal', detail: '0 dB' },
  { gain: 0.708, label: 'Auriculares', detail: '-3 dB' },
  { gain: 0.501, label: 'Auriculares sensibles', detail: '-6 dB' },
];

function normalizePrivateContactInviteCode(value: string): string {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function privateContactInviteCodeFromValue(value: string): string {
  const source = String(value || '').trim();
  const match = source.match(/[?&]chatInvite=([a-z0-9]{8})(?=[^a-z0-9]|$)/i);
  if (match) return normalizePrivateContactInviteCode(match[1]);
  return /^[a-z0-9]{8}$/i.test(source) ? normalizePrivateContactInviteCode(source) : '';
}
const PROFILE_SERVER = QSESSION_PRODUCTION_ORIGIN;

function profileSaveSignature(profile: QSessionUserProfile) {
  return JSON.stringify(serverProfilePayload(normalizeProfile(profile)));
}

const stateLabels: Record<ListenerState, string> = {
  idle: 'Lista',
  connecting: 'Conectando',
  waiting: 'Preparando audio',
  live: 'En vivo',
  reconnecting: 'Reconectando',
  ended: 'Finalizada',
  error: 'Sin conexión',
};

function httpBaseFromServer(value: string) {
  let base = value.trim();
  if (!/^https?:\/\//i.test(base) && !/^wss?:\/\//i.test(base))
    base = `http://${base}`;
  return base
    .replace(/^ws:/i, 'http:')
    .replace(/^wss:/i, 'https:')
    .replace(/\/ws\/?$/i, '')
    .replace(/\/$/, '');
}

async function publishProfile(
  server: string,
  profile: QSessionUserProfile,
): Promise<string> {
  const response = await fetch(`${httpBaseFromServer(server)}/api/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(serverProfilePayload(profile)),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error || 'No fue posible activar el perfil en esta sala.',
    );
  return payload.profile.id;
}

const mainSections: Array<{
  id: MainSection;
  icon: string;
  label: string;
}> = [
  {id: 'live', icon: '●', label: 'En vivo'},
  {id: 'people', icon: '◎', label: 'Personas'},
  {id: 'chat', icon: '✦', label: 'Chat'},
  {id: 'global', icon: '◉', label: 'Global'},
];

function MainNavigation({
  active,
  onChange,
  unread = 0,
}: {
  active: MainSection;
  onChange: (section: MainSection) => void;
  unread?: number;
}) {
  return (
    <View style={s.listenerNav} accessibilityRole="tablist">
      {mainSections.map(item => {
        const selected = item.id === active;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={`Abrir ${item.label}`}
            accessibilityState={{selected}}
            onPress={() => onChange(item.id)}
            style={[s.listenerNavItem, selected && s.listenerNavItemActive]}
          >
            <Text
              style={[
                s.listenerNavIcon,
                selected && s.listenerNavTextActive,
              ]}
            >
              {item.icon}
            </Text>
            <Text
              style={[
                s.listenerNavText,
                selected && s.listenerNavTextActive,
              ]}
            >
              {item.label}
            </Text>
            {item.id === 'chat' && unread > 0 ? (
              <View style={s.listenerUnread}>
                <Text style={s.listenerUnreadText}>
                  {unread > 9 ? '9+' : unread}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function InactivePeopleScreen({
  onJoin,
  onActivity,
}: {
  onJoin: () => void;
  onActivity: () => void;
}) {
  const [layout, setLayout] = useState<'scroll' | 'mosaic'>('scroll');
  return (
    <View style={s.shellSection}>
      <Text style={s.shellEyebrow}>TU SALA AHORA</Text>
      <Text style={s.shellTitle}>Personas activas en{`\n`}esta sala.</Text>
      <Text style={s.shellSubtitle}>
        Sólo aparecen perfiles visibles conectados a tu sesión actual. Al salir,
        desaparecen de este espacio.
      </Text>

      <View style={s.peopleToolbarHeading}>
        <Text style={s.peopleToolbarHint}>
          ◉ Toca la imagen de una persona para conectar.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir actividad"
          onPress={onActivity}
          style={s.activityPill}
        >
          <Text style={s.activityPillText}>✦ Actividad</Text>
        </Pressable>
      </View>

      <View style={s.peopleToolbar}>
        <View style={s.peopleLayoutSwitch}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: layout === 'scroll'}}
            onPress={() => setLayout('scroll')}
            style={[
              s.peopleLayoutChoice,
              layout === 'scroll' && s.peopleLayoutChoiceActive,
            ]}
          >
            <Text
              style={[
                s.peopleLayoutChoiceText,
                layout === 'scroll' && s.peopleLayoutChoiceTextActive,
              ]}
            >
              ☰ Scroll
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: layout === 'mosaic'}}
            onPress={() => setLayout('mosaic')}
            style={[
              s.peopleLayoutChoice,
              layout === 'mosaic' && s.peopleLayoutChoiceActive,
            ]}
          >
            <Text
              style={[
                s.peopleLayoutChoiceText,
                layout === 'mosaic' && s.peopleLayoutChoiceTextActive,
              ]}
            >
              ▦ Mosaico
            </Text>
          </Pressable>
        </View>
        <View style={s.peopleSizeControl}>
          <Text style={s.peopleSizeLabel}>Mostrar</Text>
          <Text style={s.peopleSizeValue}>32 personas⌄</Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Entrar a una sala para ver personas"
        onPress={onJoin}
        style={({pressed}) => [s.peopleWaitingCard, pressed && s.pressed]}
      >
        <View style={s.peopleWaitingLogoWrap}>
          <Image source={liveBrandMark} style={s.peopleWaitingLogo} />
        </View>
        <Text style={s.peopleWaitingTitle}>
          Entra a una sala para ver quién está activo
        </Text>
        <Text style={s.peopleWaitingText}>
          Personas sólo muestra los perfiles presentes en tu sala actual.
        </Text>
      </Pressable>
    </View>
  );
}

function InactiveChatScreen({onProfile}: {onProfile: () => void}) {
  return (
    <View style={s.shellSection}>
      <Text style={s.shellEyebrow}>CONVERSACIONES</Text>
      <Text style={s.shellTitle}>Hablar cerca, aunque{`\n`}estén lejos.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Crear identidad para usar el chat"
        onPress={onProfile}
        style={({pressed}) => [s.chatIdentityCard, pressed && s.pressed]}
      >
        <View style={s.chatIdentityOrbit}>
          <View style={s.chatIdentityOrbitInner}>
            <Image source={liveBrandMark} style={s.chatIdentityLogo} />
          </View>
        </View>
        <Text style={s.chatIdentityTitle}>El chat necesita una identidad</Text>
        <Text style={s.chatGateText}>
          Inicia sesión para que tus conversaciones pertenezcan a tu cuenta Q
          Session.
        </Text>
      </Pressable>
    </View>
  );
}

function GlobalScreen({snapshot = emptyGlobalRave}: {snapshot?: GlobalRaveSnapshot}) {
  const [selectedCode, setSelectedCode] = useState('');
  const [mapScale, setMapScale] = useState(1);
  const [mapCenter, setMapCenter] = useState({x: 500, y: 250});
  const countryCatalog = [...politicalWorld.countries, ...politicalWorld.microstates];
  const activeCountries = new Map(snapshot.countries.map(country => [country.code.toUpperCase(), country]));
  const selectedCountry = countryCatalog.find(country => country.code === selectedCode);
  const selectedPresence = activeCountries.get(selectedCode);
  const publicPeople = [...new Set(selectedPresence?.publicPeople || [])].slice(0, 25);
  const privateCount = Math.max(0, selectedPresence?.privateCount ?? (selectedPresence?.count || 0) - publicPeople.length);
  const viewWidth = 1000 / mapScale;
  const viewHeight = 500 / mapScale;
  const viewX = Math.max(0, Math.min(1000 - viewWidth, mapCenter.x - viewWidth / 2));
  const viewY = Math.max(0, Math.min(500 - viewHeight, mapCenter.y - viewHeight / 2));
  const selectCountry = (country: PoliticalCountry) => {
    setSelectedCode(country.code);
    setMapCenter({x: country.x, y: country.y});
    if (!country.bounds) {
      setMapScale(6);
      return;
    }
    const width = Math.max(5, country.bounds[2] - country.bounds[0]);
    const height = Math.max(5, country.bounds[3] - country.bounds[1]);
    setMapScale(Math.max(1.35, Math.min(6, Math.min(1000 / (width * 2.4), 500 / (height * 2.4)))));
  };
  const resetMap = () => {
    setMapScale(1);
    setMapCenter({x: 500, y: 250});
  };
  return (
    <View style={[s.shellSection, s.globalSection]}>
      <View style={s.globalCard}>
        <Text style={s.globalEyebrow}>PRESENCIA REAL Y CONSENTIDA</Text>
        <Text style={s.globalTitle}>Baila, libera{`\n`}y conecta.</Text>
        <View style={s.globalSignalDot} />
        <Text style={s.globalText}>
          Usa el baile como terapia. Toca un país para conocer su presencia.
          Los países activos se iluminan sin mostrar ciudad, coordenadas ni
          ubicación exacta.
        </Text>
        <View style={s.globalMapToolbar}>
          <View>
            <Text style={s.globalMapToolbarTitle}>Planisferio político</Text>
            <Text style={s.globalMapToolbarHint}>Selecciona un país y usa el zoom.</Text>
          </View>
          <View style={s.globalMapZoomControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Alejar mapa"
              onPress={() => setMapScale(value => Math.max(1, value / 1.35))}
              style={s.globalMapZoomButton}
            ><Text style={s.globalMapZoomText}>−</Text></Pressable>
            <Text style={s.globalMapZoomValue}>{Math.round(mapScale * 100)}%</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Acercar mapa"
              onPress={() => setMapScale(value => Math.min(6, value * 1.35))}
              style={s.globalMapZoomButton}
            ><Text style={s.globalMapZoomText}>+</Text></Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Restablecer mapa"
              onPress={resetMap}
              style={[s.globalMapZoomButton, s.globalMapResetButton]}
            ><Text style={s.globalMapResetText}>Global</Text></Pressable>
          </View>
        </View>
        <View style={s.globalMap}>
          <Svg
            accessibilityLabel="Planisferio político interactivo de Rave global"
            width="100%"
            height="100%"
            viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <SvgRect x="0" y="0" width="1000" height="500" fill="#09213A" />
            {politicalWorld.countries.map((country, index) => {
              const presence = activeCountries.get(country.code);
              const selected = country.code === selectedCode;
              return (
                <SvgPath
                  key={`${country.code}-${index}`}
                  d={country.path || ''}
                  fill={presence ? '#58D6D5' : '#173B56'}
                  fillOpacity={presence ? 0.92 : 0.76}
                  stroke={selected ? '#FFFFFF' : presence ? '#B8FFF7' : '#88AFC0'}
                  strokeWidth={selected ? 2.4 : presence ? 1.35 : 0.72}
                  onPress={() => selectCountry(country)}
                />
              );
            })}
            {politicalWorld.microstates.map(country => {
              const presence = activeCountries.get(country.code);
              const selected = country.code === selectedCode;
              return (
                <Circle
                  key={country.code}
                  cx={country.x}
                  cy={country.y}
                  r={selected ? 3.8 : 2.3}
                  fill={presence ? '#8CFFF2' : '#7EA9B9'}
                  stroke={selected ? '#FFFFFF' : '#102A43'}
                  strokeWidth={selected ? 1.8 : 0.8}
                  onPress={() => selectCountry(country)}
                />
              );
            })}
            {snapshot.countries.map(country => {
              const shape = countryCatalog.find(item => item.code === country.code);
              if (!shape) return null;
              return (
                <React.Fragment key={`presence-${country.code}`}>
                  <Circle cx={shape.x} cy={shape.y} r="9" fill="#62E9DF" fillOpacity="0.24" />
                  <Circle cx={shape.x} cy={shape.y} r="3.2" fill="#DFFFFB" stroke="#FFFFFF" strokeWidth="1" />
                </React.Fragment>
              );
            })}
          </Svg>
        </View>
        <View style={s.globalCountryPanel}>
          <View style={s.globalCountryHeader}>
            <View style={s.globalCountryHeaderCopy}>
              <Text style={s.globalCountryEyebrow}>PAÍS SELECCIONADO</Text>
              <Text style={s.globalCountryName}>{selectedCountry?.names.es || 'Explora el mapa'}</Text>
            </View>
            <View style={[s.globalCountryStatus, selectedPresence && s.globalCountryStatusActive]}>
              <Text style={[s.globalCountryStatusText, selectedPresence && s.globalCountryStatusTextActive]}>
                {selectedCountry ? (selectedPresence ? 'ACTIVO' : 'SIN PRESENCIA') : '—'}
              </Text>
            </View>
          </View>
          {selectedCountry ? (
            <>
              <View style={s.globalCountryCountRow}>
                <Text style={s.globalCountryCount}>{selectedPresence?.count || 0}</Text>
                <Text style={s.globalCountryCountLabel}>personas activas</Text>
              </View>
              <Text style={s.globalCountryPeopleTitle}>Quiénes están</Text>
              {publicPeople.map((name, index) => (
                <View key={`${name}-${index}`} style={s.globalCountryPersonRow}>
                  <View style={s.globalCountryPersonDot} />
                  <Text style={s.globalCountryPersonName}>{name}</Text>
                </View>
              ))}
              {privateCount ? (
                <View style={s.globalCountryPersonRow}>
                  <View style={[s.globalCountryPersonDot, s.globalCountryPrivateDot]} />
                  <Text style={s.globalCountryPersonName}>{privateCount} {privateCount === 1 ? 'perfil privado' : 'perfiles privados'}</Text>
                </View>
              ) : null}
              {!selectedPresence ? <Text style={s.globalCountryEmpty}>Aún no hay presencia compartida desde este país.</Text> : null}
            </>
          ) : <Text style={s.globalCountryEmpty}>Selecciona cualquier país para ver su información.</Text>}
          <Text style={s.globalCountryPrivacy}>Sólo mostramos alias de perfiles visibles. Los perfiles privados se cuentan sin revelar identidad ni ubicación.</Text>
        </View>
        <View style={s.globalStats}>
          <View style={s.globalStat}>
            <Text style={s.globalStatNumber}>{snapshot.total}</Text>
            <Text style={s.globalStatLabel}>personas ahora</Text>
          </View>
          <View style={s.globalStat}>
            <Text style={s.globalStatNumber}>{snapshot.activeCountries}</Text>
            <Text style={s.globalStatLabel}>países activos</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function ActiveRoomsPanel({
  rooms,
  loading,
  onRefresh,
  onJoin,
}: {
  rooms: PublicRoom[];
  loading: boolean;
  onRefresh: () => void;
  onJoin: (room: PublicRoom) => void;
}) {
  return (
    <View style={s.activeRoomsCard}>
      <View style={s.activeRoomsHeader}>
        <View style={s.activeRoomsHeading}>
          <Text style={s.activeRoomsEyebrow}>EN VIVO AHORA</Text>
          <Text style={s.activeRoomsTitle}>Salas activas</Text>
          <Text style={s.activeRoomsSubtitle}>
            Solo mostramos salas públicas con audio y personas conectadas.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Actualizar salas activas"
          onPress={onRefresh}
          style={({pressed}) => [s.activeRoomsRefresh, pressed && s.pressed]}
        >
          <Text style={s.activeRoomsRefreshText}>{loading ? '…' : '↻'}</Text>
        </Pressable>
      </View>
      <View style={s.activeRoomsList}>
        {rooms.length ? (
          rooms.map(room => (
            <Pressable
              key={room.code}
              accessibilityRole="button"
              accessibilityLabel={`Entrar a la sala ${room.name || room.code}`}
              onPress={() => onJoin(room)}
              style={({pressed}) => [s.activeRoom, pressed && s.pressed]}
            >
              <View style={s.activeRoomTopline}>
                <Text style={s.activeRoomLive}>EN VIVO</Text>
                <Text style={s.activeRoomCode}>{room.code}</Text>
              </View>
              <Text numberOfLines={1} style={s.activeRoomName}>
                {room.name || `Sala ${room.code}`}
              </Text>
              <Text numberOfLines={1} style={s.activeRoomHost}>
                Con {room.djName || 'Q Session'}
              </Text>
              <View style={s.activeRoomFooter}>
                <Text style={s.activeRoomCount}>
                  {room.participantCount || 0}{' '}
                  {(room.participantCount || 0) === 1
                    ? 'persona dentro'
                    : 'personas dentro'}
                </Text>
                <Text style={s.activeRoomJoin}>Entrar ahora →</Text>
              </View>
            </Pressable>
          ))
        ) : (
          <View style={s.activeRoomsEmpty}>
            <Text style={s.activeRoomsEmptyTitle}>
              {loading
                ? 'Buscando salas activas…'
                : 'No hay salas transmitiendo ahora.'}
            </Text>
            <Text style={s.activeRoomsEmptyText}>
              Cuando una sala pública inicie su audio, aparecerá aquí.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function roomPromotionUrl(value: string | null | undefined, server: string) {
  if (!value) return '';
  try {
    return new URL(value, server || QSESSION_PRODUCTION_ORIGIN).toString();
  } catch {
    return '';
  }
}

function RoomPromotions({
  promotions,
  server,
}: {
  promotions?: QSessionRoomInfo['promotions'];
  server: string;
}) {
  if (!promotions?.length) return null;
  return (
    <View accessibilityLabel="Promociones de la sala" style={s.roomPromotions}>
      {promotions.map((promotion, index) => {
        const mediaUrl = roomPromotionUrl(promotion.media?.url, server);
        const salesUrl = roomPromotionUrl(promotion.linkUrl, server);
        const image = promotion.media?.contentType?.startsWith('image/');
        const video = promotion.media?.contentType?.startsWith('video/');
        return (
          <View key={promotion.id || `${promotion.sponsor}-${index}`} style={s.roomPromotionCard}>
            {image && mediaUrl ? (
              <Image
                accessibilityLabel={`Promoción de ${promotion.sponsor}`}
                source={{uri: mediaUrl}}
                style={s.roomPromotionImage}
              />
            ) : video && mediaUrl ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Reproducir video promocional de ${promotion.sponsor}`}
                onPress={() => void Linking.openURL(mediaUrl)}
                style={({pressed}) => [s.roomPromotionVideo, pressed && s.pressed]}
              >
                <Text style={s.roomPromotionVideoIcon}>▶</Text>
                <Text style={s.roomPromotionVideoText}>Ver video</Text>
              </Pressable>
            ) : null}
            <View style={s.roomPromotionCopy}>
              <Text style={s.roomPromotionLabel}>PATROCINADO</Text>
              <Text numberOfLines={1} style={s.roomPromotionSponsor}>{promotion.sponsor}</Text>
              {promotion.headline ? <Text numberOfLines={2} style={s.roomPromotionHeadline}>{promotion.headline}</Text> : null}
              {salesUrl ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Abrir promoción de ${promotion.sponsor}`}
                  onPress={() => void Linking.openURL(salesUrl)}
                  style={({pressed}) => [s.roomPromotionLink, pressed && s.pressed]}
                >
                  <Text style={s.roomPromotionLinkText}>Ver promoción ↗</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function QSessionApp() {
  const { language, toggleLanguage } = useQSessionLanguage();
  const [role, setRole] = useState<Role>(null);
  const [homeSection, setHomeSection] = useState<MainSection>('live');
  const [activeRooms, setActiveRooms] = useState<PublicRoom[]>([]);
  const [activeRoomsLoading, setActiveRoomsLoading] = useState(false);
  const [globalRave, setGlobalRave] = useState<GlobalRaveSnapshot>(emptyGlobalRave);
  const [code, setCode] = useState('');
  const [server, setServer] = useState('');
  const [invite, setInvite] = useState('');
  const [entryMethod, setEntryMethod] = useState<EntryMethod>('qr');
  const [entryMenuOpen, setEntryMenuOpen] = useState(false);
  const [createOptionsOpen, setCreateOptionsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [connection, setConnection] = useState<ListenerState>('idle');
  const [detail, setDetail] = useState('');
  const [listenerCount, setListenerCount] = useState(0);
  const [roomInfo, setRoomInfo] = useState<QSessionRoomInfo | null>(null);
  const [videoStreamURL, setVideoStreamURL] = useState<string | null>(null);
  const [broadcastPlaybackUrl, setBroadcastPlaybackUrl] = useState<string | null>(null);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [socialVideos, setSocialVideos] = useState<QSessionSocialVideo[]>([]);
  const [socialCameraEnabled, setSocialCameraEnabled] = useState(false);
  const [socialCameraStreamURL, setSocialCameraStreamURL] = useState<
    string | null
  >(null);
  const [socialCameraBusy, setSocialCameraBusy] = useState(false);
  const [socialCameraMessage, setSocialCameraMessage] = useState('');
  const [messages, setMessages] = useState<QSessionChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [listenerView, setListenerView] = useState<ListenerView>('live');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [chatSection, setChatSection] = useState<ChatSection>('room');
  const [participants, setParticipants] = useState<QSessionParticipant[]>([]);
  const [selfListenerId, setSelfListenerId] = useState('');
  const [privateChats, setPrivateChats] = useState<QSessionPrivateChat[]>([]);
  const [activePrivateChatId, setActivePrivateChatId] = useState('');
  const [privateChatText, setPrivateChatText] = useState('');
  const [privateSetupOpen, setPrivateSetupOpen] = useState(false);
  const [selectedPrivateMembers, setSelectedPrivateMembers] = useState<
    string[]
  >([]);
  const [privateGroupTitle, setPrivateGroupTitle] = useState('');
  const [privateStatus, setPrivateStatus] = useState('');
  const [privateInviteCode, setPrivateInviteCode] = useState('');
  const [privateInviteUrl, setPrivateInviteUrl] = useState('');
  const [privateInviteInput, setPrivateInviteInput] = useState('');
  const [privateInviteBusy, setPrivateInviteBusy] = useState(false);
  const [peopleContactStatus, setPeopleContactStatus] = useState('');
  const [liveChatState, setLiveChatState] = useState<QSessionLiveChatState>({
    chatId: '', status: 'idle', micEnabled: false, soundEnabled: true, cameraEnabled: false, participants: 0,
  });
  const [liveChatVideos, setLiveChatVideos] = useState<QSessionLiveChatVideo[]>([]);
  const [chatPeopleQuery, setChatPeopleQuery] = useState('');
  const [roomChatMicEnabled, setRoomChatMicEnabled] = useState(false);
  const [roomChatPushActive, setRoomChatPushActive] = useState(false);
  const [roomChatMediaStatus, setRoomChatMediaStatus] = useState('Puedes escribir o participar sólo con audio.');
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [playingVoiceMessageId, setPlayingVoiceMessageId] = useState('');
  const [profileScreenOpen, setProfileScreenOpen] = useState(false);
  const [projectVisionOpen, setProjectVisionOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<QSessionUserProfile>(() =>
    createEmptyProfile(),
  );
  const [profileDraft, setProfileDraft] = useState<QSessionUserProfile | null>(
    null,
  );
  const [profileMessage, setProfileMessage] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profilePhotoMessage, setProfilePhotoMessage] = useState('');
  const [profilePhotoPicking, setProfilePhotoPicking] = useState(false);
  const [profileSavedOnServer, setProfileSavedOnServer] = useState(false);
  const [accountSession, setAccountSession] =
    useState<QSessionAccountSession | null>(null);
  const [accountMode, setAccountMode] = useState<AccountMode>('register');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  const [storyText, setStoryText] = useState('');
  const [storyMediaId, setStoryMediaId] = useState('');
  const [currentStory, setCurrentStory] = useState<QSessionStory | null>(null);
  const [storyBusy, setStoryBusy] = useState(false);
  const [serverStatus, setServerStatus] =
    useState<QSessionServerStatus | null>(null);
  const [outputGain, setOutputGain] = useState(1);
  const [broadcastState, setBroadcastState] = useState<BroadcastState>('idle');
  const [broadcastDetail, setBroadcastDetail] = useState('');
  const [broadcastRoom, setBroadcastRoom] = useState<BroadcastRoom | null>(
    null,
  );
  const [broadcastName, setBroadcastName] = useState('');
  const [broadcastDj, setBroadcastDj] = useState('');
  const [broadcastRoomType, setBroadcastRoomType] = useState<CreatableRoomKind>('music');
  const [broadcastFeatures, setBroadcastFeatures] = useState<RoomFeatures>(() => roomFeaturesFor('music'));
  const [broadcastExperience, setBroadcastExperience] = useState<RoomExperience>(() => roomExperienceFor('music'));
  const [broadcastSetupSection, setBroadcastSetupSection] = useState<'type' | 'features' | 'experience' | 'details' | null>('type');
  const [broadcastRightsOpen, setBroadcastRightsOpen] = useState(false);
  const [broadcastRightsAccepted, setBroadcastRightsAccepted] = useState(false);
  const clientRef = useRef<QSessionListenerClient | null>(null);
  const broadcasterRef = useRef<QSessionBroadcasterClient | null>(null);
  const syncedProfileRef = useRef('');
  const listenerViewRef = useRef<ListenerView>('live');
  const chatSectionRef = useRef<ChatSection>('room');
  const activePrivateChatRef = useRef('');
  const voiceRecordingRef = useRef(false);
  const liveChatPushRef = useRef(false);
  const roomChatPushRef = useRef(false);
  const voiceRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioLevelMeter = useRef(new Animated.Value(0)).current;
  const isActive = ['connecting', 'waiting', 'live', 'reconnecting'].includes(
    connection,
  );

  useEffect(() => {
    const loadEngagementState = profileStorage?.loadEngagementState;
    const saveEngagementState = profileStorage?.saveEngagementState;
    if (
      Platform.OS !== 'android' ||
      Number(Platform.Version) < 33 ||
      !loadEngagementState ||
      !saveEngagementState
    ) return;

    let disposed = false;
    let initialized = false;
    let activeUsageMs = 0;
    let notificationPrompted = false;
    let activeSince: number | null = null;
    let requestPending = false;
    let checkpointTimer: ReturnType<typeof setInterval> | null = null;

    const saveState = () =>
      saveEngagementState(
        activeUsageMs,
        notificationPrompted,
      ).catch(() => false);

    const maybeRequestPermission = async () => {
      if (
        disposed ||
        requestPending ||
        AppState.currentState !== 'active' ||
        !shouldRequestDeferredNotificationPermission({
          activeUsageMs,
          notificationPrompted,
        })
      ) return;

      requestPending = true;
      notificationPrompted = true;
      await saveState();
      if (!disposed) await requestNotificationPermission();
      requestPending = false;
    };

    const checkpointActiveTime = (allowPrompt: boolean) => {
      if (activeSince === null) return;
      const now = Date.now();
      activeUsageMs += Math.max(0, now - activeSince);
      activeSince = now;
      void saveState();
      if (allowPrompt) void maybeRequestPermission();
    };

    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        if (!initialized) return;
        if (nextState === 'active') {
          if (activeSince === null) activeSince = Date.now();
          void maybeRequestPermission();
          return;
        }
        checkpointActiveTime(false);
        activeSince = null;
      },
    );

    void loadEngagementState()
      .then(savedState => {
        if (disposed) return;
        const saved = normalizeEngagementState(savedState);
        activeUsageMs = saved.activeUsageMs;
        notificationPrompted = saved.notificationPrompted;
        activeSince = AppState.currentState === 'active' ? Date.now() : null;
        initialized = true;
        checkpointTimer = setInterval(
          () => checkpointActiveTime(true),
          60_000,
        );
        void maybeRequestPermission();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      appStateSubscription.remove();
      if (checkpointTimer) clearInterval(checkpointTimer);
      if (initialized && activeSince !== null) {
        activeUsageMs += Math.max(0, Date.now() - activeSince);
        void saveState();
      }
    };
  }, []);

  const refreshActiveRooms = async () => {
    setActiveRoomsLoading(true);
    try {
      const rooms = await new QSessionApi().listActiveRooms();
      setActiveRooms(
        rooms.filter(
          room =>
            room.status === 'live' &&
            room.visibility === 'public' &&
            (room.participantCount || 0) > 0,
        ),
      );
    } catch {
      // La portada conserva el último resultado válido durante fallos de red.
    } finally {
      setActiveRoomsLoading(false);
    }
  };

  useEffect(() => {
    void refreshActiveRooms();
    const timer = setInterval(() => void refreshActiveRooms(), 20_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const refreshGlobalRave = async () => {
      try {
        const response = await fetch(`${PROFILE_SERVER}/api/global-rave`);
        const payload = await response.json();
        if (!response.ok || !active) return;
        setGlobalRave({
          total: Math.max(0, Number(payload.total) || 0),
          visiblePresenceCount: Math.max(0, Number(payload.visiblePresenceCount) || 0),
          activeCountries: Math.max(0, Number(payload.activeCountries) || 0),
          maxPointsPerCountry: 25,
          countries: Array.isArray(payload.countries) ? payload.countries.map((country: any) => ({
            code: String(country?.code || 'XX'),
            count: Math.max(0, Number(country?.count) || 0),
            points: Array.isArray(country?.points) ? country.points.slice(0, 25).map(() => ({})) : [],
            publicPeople: Array.isArray(country?.publicPeople)
              ? country.publicPeople.map((name: unknown) => String(name || '').trim()).filter(Boolean).slice(0, 25)
              : [],
            privateCount: Math.max(0, Number(country?.privateCount) || 0),
          })) : [],
        });
      } catch {
        // Conserva el último mapa válido durante interrupciones de red.
      }
    };
    void refreshGlobalRave();
    const timer = setInterval(() => void refreshGlobalRave(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const client = new QSessionListenerClient({
      onState: (next, message) => {
        setConnection(next);
        setDetail(message || '');
        if (next === 'error' || next === 'ended') {
          void playback?.stop().catch(() => {});
          setSocialVideos([]);
          setSocialCameraEnabled(false);
          setSocialCameraStreamURL(null);
        }
      },
      onListenerCount: setListenerCount,
      onRoom: setRoomInfo,
      onVideoStream: setVideoStreamURL,
      onBroadcastPlayback: url => {
        setBroadcastPlaybackUrl(url);
        if (url) {
          setVideoStreamURL(null);
          void playback?.stop().catch(() => {});
        }
      },
      onSocialVideos: setSocialVideos,
      onSocialCameraStream: streamURL => {
        setSocialCameraStreamURL(streamURL);
        setSocialCameraEnabled(Boolean(streamURL));
      },
      onChatHistory: setMessages,
      onRoomChatMicrophone: enabled => {
        setRoomChatMicEnabled(enabled);
        if (!enabled) {
          roomChatPushRef.current = false;
          setRoomChatPushActive(false);
        }
      },
      onChatMessage: message => {
        setMessages(current =>
          current.some(item => item.id === message.id)
            ? current
            : [...current, message].slice(-100),
        );
        if (listenerViewRef.current !== 'chat')
          setUnreadChatCount(current => Math.min(99, current + 1));
      },
      onParticipants: (nextParticipants, selfId) => {
        setParticipants(nextParticipants);
        if (selfId) setSelfListenerId(selfId);
      },
      onPrivateChats: setPrivateChats,
      onPrivateChatOpened: chatId => {
        setListenerView('chat');
        setChatSection('private');
        setActivePrivateChatId(chatId);
        setPrivateSetupOpen(false);
        setSelectedPrivateMembers([]);
        setPrivateGroupTitle('');
        setPrivateStatus('');
      },
      onPrivateChatInvite: () => {
        setPrivateStatus(
          'Recibiste una invitación a una conversación privada.',
        );
        if (
          listenerViewRef.current !== 'chat' ||
          chatSectionRef.current !== 'private'
        ) {
          setUnreadChatCount(current => Math.min(99, current + 1));
        }
      },
      onPrivateMessage: (chatId, message: QSessionPrivateMessage) => {
        setPrivateChats(current =>
          current.map(chat =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.some(item => item.id === message.id)
                    ? chat.messages
                    : [...chat.messages, message].slice(-100),
                  updatedAt: message.createdAt,
                }
              : chat,
          ),
        );
        if (
          listenerViewRef.current !== 'chat' ||
          chatSectionRef.current !== 'private' ||
          activePrivateChatRef.current !== chatId
        ) {
          setUnreadChatCount(current => Math.min(99, current + 1));
        }
      },
      onPrivateChatError: setPrivateStatus,
      onLiveChatState: setLiveChatState,
      onLiveChatVideos: setLiveChatVideos,
      onProfileSet: () => setProfileMessage('Perfil activo en esta sala.'),
      onReportReceived: () =>
        setProfileMessage('Gracias. Recibimos tu denuncia.'),
      onAudioLevel: level => {
        audioLevelMeter.stopAnimation();
        Animated.timing(audioLevelMeter, {
          toValue: Math.max(0, Math.min(1, level)),
          duration: level > 0 ? 75 : 220,
          useNativeDriver: false,
        }).start();
      },
    });
    clientRef.current = client;
    return () => {
      if (voiceRecordingTimerRef.current) clearTimeout(voiceRecordingTimerRef.current);
      void voiceNotes?.cancel().catch(() => {});
      voiceRecordingRef.current = false;
      void voiceNotes?.stopPlayback().catch(() => {});
      client.stop(false);
      void playback?.stop().catch(() => {});
    };
  }, [audioLevelMeter]);

  useEffect(() => {
    if (role !== 'listener' || !isActive || !code) return;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (liveChatState.status === 'live' && liveChatState.micEnabled) {
          void clientRef.current?.setLiveChatMicrophoneEnabled(false).catch(() => {});
        }
        if (roomChatMicEnabled) {
          void clientRef.current?.setRoomChatMicrophoneEnabled(false).catch(() => {});
          setRoomChatMediaStatus('El micrófono se apagó al salir de QSession.');
        }
        if (voiceRecording) {
          if (voiceRecordingTimerRef.current) clearTimeout(voiceRecordingTimerRef.current);
          voiceRecordingTimerRef.current = null;
          void voiceNotes?.cancel().catch(() => {});
          voiceRecordingRef.current = false;
          setVoiceRecording(false);
          setPrivateStatus('La grabación se canceló al salir de QSession.');
        }
        if (socialCameraEnabled) {
          void clientRef.current?.setSocialCameraEnabled(false).catch(() => {});
          setSocialCameraEnabled(false);
          setSocialCameraStreamURL(null);
          setSocialCameraMessage(
            'La cámara se apagó automáticamente al salir de QSession.',
          );
        }
        // Reassert the native foreground service before React Native suspends
        // its JavaScript thread as the display is turned off.
        if (!broadcastPlaybackUrl) {
          void playback
            ?.start(server || PROFILE_SERVER, code, '', outputGain)
            .catch(() => {});
        }
        return;
      }
      if (nextState === 'active') {
        if (!broadcastPlaybackUrl) {
          void playback
            ?.start(server || PROFILE_SERVER, code, '', outputGain)
            .catch(() => {});
        }
        void clientRef.current?.resume();
      }
    });
    return () => subscription.remove();
  }, [broadcastPlaybackUrl, code, isActive, liveChatState.micEnabled, liveChatState.status, outputGain, role, roomChatMicEnabled, server, socialCameraEnabled, voiceRecording]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let appStateSubscription: { remove: () => void } | null = null;

    const clearSharing = () => clientRef.current?.clearListenerLocation();
    if (
      role !== 'listener' ||
      !isActive ||
      !userProfile.shareApproximateLocation
    ) {
      clearSharing();
      return;
    }

    const refreshLocation = async () => {
      if (cancelled || !locationService) return;
      try {
        const granted = await requestApproximateLocationPermission();
        if (!granted || cancelled) {
          clearSharing();
          setProfileMessage(
            'Global Rave necesita permiso de ubicación precisa para verificar tu país por GPS. Puedes seguir escuchando sin activarlo.',
          );
          return;
        }
        const sample = await locationService.getCurrentApproximate();
        if (!cancelled) {
          const nativeCountryCode = String(sample.countryCode || '').trim().toUpperCase();
          const countryCode = /^[A-Z]{2}$/.test(nativeCountryCode)
            ? nativeCountryCode
            : countryCodeFromGpsCoordinates(politicalWorld, sample.latitude, sample.longitude);
          if (!countryCode) throw new Error('El GPS no pudo identificar el país.');
          clientRef.current?.setListenerLocation({
            ...sample,
            countryCode,
          });
        }
      } catch {
        if (!cancelled) {
          clearSharing();
          setProfileMessage(
            'No pudimos comprobar tu país mediante GPS. Seguirás en la sala sin aparecer en el mapa.',
          );
        }
      }
    };

    void refreshLocation();
    refreshTimer = setInterval(() => void refreshLocation(), 90_000);
    appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshLocation();
    });
    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      appStateSubscription?.remove();
      clearSharing();
    };
  }, [isActive, role, userProfile.shareApproximateLocation]);

  useEffect(() => {
    listenerViewRef.current = listenerView;
    clientRef.current?.setPeopleVideoEnabled(listenerView === 'people');
    if (listenerView === 'chat') setUnreadChatCount(0);
  }, [listenerView]);

  useEffect(() => {
    if (!videoStreamURL) setVideoFullscreen(false);
  }, [videoStreamURL]);

  useEffect(() => {
    chatSectionRef.current = chatSection;
    activePrivateChatRef.current = activePrivateChatId;
    if (listenerView === 'chat') setUnreadChatCount(0);
  }, [activePrivateChatId, chatSection, listenerView]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const storedProfile = await profileStorage?.load();
        let localProfile = storedProfile
          ? normalizeProfile(JSON.parse(storedProfile))
          : createEmptyProfile();
        if (active) setUserProfile(localProfile);
        const storedSession = await profileStorage?.loadAccountSession?.();
        const session = storedSession
          ? normalizeAccountSession(JSON.parse(storedSession))
          : null;
        if (!session) {
          if (storedSession) await profileStorage?.clearAccountSession?.();
          return;
        }
        if (!active) return;
        setAccountSession(session);
        setAccountEmail(session.account.email);
        try {
          const refreshed = await refreshAccount(PROFILE_SERVER, session);
          localProfile = profileFromServer(
            PROFILE_SERVER,
            refreshed.profile,
            localProfile,
          );
          if (!active) return;
          setCurrentStory(refreshed.profile.stories?.at(-1) || null);
          setUserProfile(localProfile);
          setProfileSavedOnServer(true);
          await profileStorage?.save(JSON.stringify(localProfile));
        } catch (error) {
          if (error instanceof QSessionAccountError && error.status === 401) {
            await profileStorage?.clearAccountSession?.().catch(() => {});
            if (active) {
              setAccountSession(null);
              setProfileSavedOnServer(false);
              setAccountMessage(
                'La sesión venció. Tu perfil local sigue guardado en este teléfono.',
              );
            }
          } else if (active) {
            setProfileSavedOnServer(false);
            setAccountMessage(
              'Sin conexión. Conservamos tu sesión y tu perfil local hasta recuperar Internet.',
            );
          }
        }
      } catch {
        if (active)
          setAccountMessage(
            'No pudimos leer la cuenta guardada. Tu perfil local permanece en este teléfono.',
          );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (accountSession) {
      clientRef.current?.setProfile(
        userProfile.localId,
        accountSession.token,
        userProfile.ownerToken,
      );
    }
    if (
      !server ||
      !['waiting', 'live'].includes(connection) ||
      !userProfile.updatedAt
    )
      return;
    if (
      accountSession &&
      httpBaseFromServer(server) === httpBaseFromServer(PROFILE_SERVER)
    ) {
      clientRef.current?.setProfile(
        userProfile.localId,
        accountSession.token,
        userProfile.ownerToken,
      );
      return;
    }
    const syncKey = `${httpBaseFromServer(server)}|${userProfile.localId}|${
      userProfile.updatedAt
    }`;
    if (syncedProfileRef.current === syncKey) return;
    syncedProfileRef.current = syncKey;
    void publishProfile(server, userProfile)
      .then(profileId =>
        clientRef.current?.setProfile(profileId, '', userProfile.ownerToken),
      )
      .catch(() => {
        syncedProfileRef.current = '';
      });
  }, [accountSession, connection, server, userProfile]);

  useEffect(() => {
    const broadcaster = new QSessionBroadcasterClient({
      onState: (next, message) => {
        setBroadcastState(next);
        setBroadcastDetail(message || '');
      },
      onRoom: setBroadcastRoom,
      onListenerCount: setListenerCount,
    });
    broadcasterRef.current = broadcaster;
    return () => broadcaster.stop(false);
  }, []);

  useEffect(() => {
    if (
      Platform.OS !== 'android' ||
      (role !== 'dj' && role !== 'organizer') ||
      !['connecting', 'live', 'reconnecting'].includes(broadcastState) ||
      !broadcastRoom?.code
    )
      return;
    const keepBroadcastAlive = () => {
      void playback?.startBroadcast?.(broadcastRoom.code).catch(() => {});
    };
    keepBroadcastAlive();
    const subscription = AppState.addEventListener('change', keepBroadcastAlive);
    return () => subscription.remove();
  }, [broadcastRoom?.code, broadcastState, role]);

  useEffect(() => {
    if (broadcastState === 'error') void playback?.stopBroadcast?.().catch(() => {});
  }, [broadcastState]);

  useEffect(() => {
    const applyLink = (link: string | null) => {
      if (!link) return;
      const values = parseRoomInvitation(link);
      if (!values.room) return;
      setRole('listener');
      setCode(values.room);
      setServer(values.server || '');
      setInvite(link);
      setEntryMethod('link');
      setEntryMenuOpen(false);
      setEntryError('');
    };
    void Linking.getInitialURL().then(applyLink);
    const subscription = Linking.addEventListener('url', event =>
      applyLink(event.url),
    );
    return () => subscription.remove();
  }, []);

  const isBroadcasting = ['connecting', 'live', 'reconnecting'].includes(
    broadcastState,
  );
  const canConnect = code.trim().length === 6;
  const currentStatusLabel = qsessionTranslate(
    profileScreenOpen
      ? 'Perfil'
      : role === 'listener'
      ? stateLabels[connection]
      : role && isBroadcasting
      ? broadcastState === 'live'
        ? 'En vivo'
        : broadcastState === 'connecting'
        ? 'Conectando'
        : 'Reconectando'
      : 'Lista',
    language,
  );
  const selectOutputGain = (gain: number) => {
    setOutputGain(gain);
    clientRef.current?.setOutputGain(gain);
  };

  const findServer = async (roomCode: string) => {
    setDetail(`Buscando la sala ${roomCode} en QSession…`);
    if (await roomIsActiveOnServer(PROFILE_SERVER, roomCode))
      return PROFILE_SERVER;
    throw new Error(`La sala ${roomCode} no está activa en Q Session.`);
  };

  const connectToRoom = async (roomValue: string, serverValue: string) => {
    const roomCode = roomValue.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
      setEntryError('El código debe tener seis letras o números.');
      return;
    }
    try {
      setEntryError('');
      setCode(roomCode);
      setListenerView('live');
      setUnreadChatCount(0);
      setConnection('connecting');
      let address = serverValue.trim();
      if (address) {
        const parsed = parseRoomInvitation(address);
        address = parsed.server || address;
        setDetail('Comprobando la invitación…');
        try {
          await verifyQSessionServer(address);
        } catch {
          setDetail(`La invitación cambió. Buscando ${roomCode} en Q Session…`);
          address = await findServer(roomCode);
        }
      } else {
        address = await findServer(roomCode);
      }
      setServer(address);
      const verifiedServer = await verifyQSessionServer(address);
      setServerStatus(verifiedServer);
      if (!playback)
        throw new Error(
          'La función de audio en segundo plano no está disponible en esta instalación.',
        );
      const delivery = await clientRef.current?.start(address, roomCode);
      if (!delivery?.broadcast) await playback.start(address, roomCode, '', outputGain);
      else await playback.stop().catch(() => {});
    } catch (error) {
      setServerStatus(null);
      void playback?.stop().catch(() => {});
      setConnection('error');
      setDetail(
        error instanceof Error
          ? error.message
          : 'No fue posible iniciar QSession.',
      );
    }
  };

  const fallbackBroadcastToWebRtc = () => {
    setBroadcastPlaybackUrl(null);
    clientRef.current?.fallbackToWebRtc();
    void playback?.start(server || PROFILE_SERVER, code, '', outputGain).catch(() => {});
  };

  const connect = () => void connectToRoom(code, server);

  const joinActiveRoom = (room: PublicRoom) => {
    setRole('listener');
    setHomeSection('live');
    setEntryMethod('code');
    setCode(room.code);
    setServer(PROFILE_SERVER);
    void connectToRoom(room.code, PROFILE_SERVER);
  };

  const scanQr = async () => {
    if (!qrScanner) {
      setEntryError('El escáner QR no está disponible en esta instalación.');
      return;
    }
    setScanning(true);
    setEntryError('');
    try {
      const scannedValue = await qrScanner.scan();
      if (!scannedValue) return;
      const values = parseRoomInvitation(scannedValue);
      if (!values.room)
        throw new Error('Este QR no corresponde a una sala QSession.');
      setInvite(scannedValue);
      setCode(values.room);
      setServer(values.server || '');
      await connectToRoom(values.room, values.server || '');
    } catch (error) {
      setEntryError(
        error instanceof Error
          ? error.message
          : 'No fue posible leer el código QR.',
      );
    } finally {
      setScanning(false);
    }
  };

  const updateInvite = (value: string) => {
    setInvite(value);
    const values = parseRoomInvitation(value);
    setCode(values.room || '');
    setServer(values.server || '');
    setEntryError('');
  };

  const selectEntryMethod = (method: EntryMethod) => {
    setEntryMethod(method);
    setEntryMenuOpen(false);
    setEntryError('');
    if (method === 'code') {
      setInvite('');
      setServer('');
    } else if (method === 'link') {
      const values = parseRoomInvitation(invite);
      setCode(values.room || '');
      setServer(values.server || '');
    }
  };

  const submitEntry = () => {
    if (entryMethod === 'qr') {
      void scanQr();
      return;
    }
    connect();
  };

  const disconnect = () => {
    syncedProfileRef.current = '';
    setListenerView('live');
    setUnreadChatCount(0);
    setChatSection('room');
    setParticipants([]);
    setSelfListenerId('');
    setPrivateChats([]);
    setActivePrivateChatId('');
    setPrivateSetupOpen(false);
    setSelectedPrivateMembers([]);
    setPrivateStatus('');
    setServerStatus(null);
    if (voiceRecordingTimerRef.current) clearTimeout(voiceRecordingTimerRef.current);
    voiceRecordingTimerRef.current = null;
    voiceRecordingRef.current = false;
    setVoiceRecording(false);
    setPlayingVoiceMessageId('');
    setLiveChatState({chatId: '', status: 'idle', micEnabled: false, soundEnabled: true, cameraEnabled: false, participants: 0});
    setLiveChatVideos([]);
    setChatPeopleQuery('');
    roomChatPushRef.current = false;
    setRoomChatMicEnabled(false);
    setRoomChatPushActive(false);
    setRoomChatMediaStatus('Puedes escribir o participar sólo con audio.');
    void voiceNotes?.cancel().catch(() => {});
    void voiceNotes?.stopPlayback().catch(() => {});
    setSocialVideos([]);
    setSocialCameraEnabled(false);
    setSocialCameraStreamURL(null);
    setSocialCameraBusy(false);
    setSocialCameraMessage('');
    clientRef.current?.stop();
    void playback?.stop().catch(() => {});
  };

  const sendChat = () => {
    const text = chatText.trim();
    if (!text) return;
    clientRef.current?.sendChat(
      text,
      'text',
      isProfilePublicInRoom ? userProfile.displayName : undefined,
    );
    setChatText('');
  };

  const sendReaction = (reaction: string) => {
    clientRef.current?.sendChat(
      reaction,
      'reaction',
      isProfilePublicInRoom ? userProfile.displayName : undefined,
    );
  };

  const toggleSocialCamera = async () => {
    if (socialCameraBusy) return;
    if (socialCameraEnabled) {
      setSocialCameraBusy(true);
      try {
        await clientRef.current?.setSocialCameraEnabled(false);
        setSocialCameraEnabled(false);
        setSocialCameraStreamURL(null);
        setSocialCameraMessage(
          'Tu cámara está apagada. Sigues escuchando normalmente.',
        );
      } catch (error) {
        setSocialCameraMessage(
          error instanceof Error
            ? error.message
            : 'No fue posible apagar la cámara.',
        );
      } finally {
        setSocialCameraBusy(false);
      }
      return;
    }
    if (!serverStatus?.features.socialCamera) {
      setSocialCameraMessage(
        communityUnavailableMessage ||
          'Esta sala todavía no tiene disponible el mosaico de cámaras.',
      );
      return;
    }
    if (!isProfilePublicInRoom || !userProfile.displayName.trim()) {
      setSocialCameraMessage(
        'Para aparecer en el mosaico, configura el perfil como Público y guarda los cambios.',
      );
      return;
    }
    setSocialCameraBusy(true);
    setSocialCameraMessage('Preparando tu cámara frontal…');
    try {
      if (Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Tu cámara en QSession',
            message:
              'QSession usará la cámara frontal sólo mientras decidas aparecer en el mosaico de esta sala.',
            buttonPositive: 'Activar cámara',
            buttonNegative: 'Ahora no',
          },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          setSocialCameraMessage(
            'La cámara permanece apagada. Puedes activarla cuando quieras.',
          );
          return;
        }
      }
      const streamURL = await clientRef.current?.setSocialCameraEnabled(true);
      if (!streamURL)
        throw new Error('No fue posible obtener la vista previa de tu cámara.');
      setSocialCameraStreamURL(streamURL);
      setSocialCameraEnabled(true);
      setSocialCameraMessage(
        'Estás visible en el mosaico de esta sala. Tu micrófono permanece apagado.',
      );
    } catch (error) {
      setSocialCameraEnabled(false);
      setSocialCameraStreamURL(null);
      setSocialCameraMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible activar la cámara.',
      );
    } finally {
      setSocialCameraBusy(false);
    }
  };

  const activePrivateChat =
    privateChats.find(chat => chat.id === activePrivateChatId) || null;
  const selfParticipant = participants.find(
    participant => participant.id === selfListenerId,
  );
  const isProfilePublicInRoom = isActive
    ? selfParticipant?.visible === true
    : userProfile.isPublic;
  const canMessageInRoom = isActive
    ? selfParticipant?.canMessage === true
    : userProfile.isPublic && userProfile.allowMessages;
  const communityAvailable = serverStatus
    ? serverStatus.features.profiles &&
      serverStatus.features.roomParticipants &&
      serverStatus.features.privateChats
    : true;
  const communityUnavailableMessage =
    serverStatus && !communityAvailable
      ? `Esta sala usa QSession ${serverStatus.version} y necesita actualizarse para activar Perfiles, Stories y chats privados.`
      : '';
  const pendingPrivateChats = privateChats.filter(
    chat => chat.status === 'pending',
  ).length;
  const availablePrivateParticipants = participants.filter(
    participant =>
      participant.id !== selfListenerId &&
      participant.canMessage &&
      participant.online,
  );
  const privateChatAvailabilityMessage = !communityAvailable
    ? communityUnavailableMessage
    : !isProfilePublicInRoom
    ? 'Tu perfil está privado o todavía no guardaste el cambio a Público.'
    : !canMessageInRoom
    ? 'Activa “Mensajes de asistentes” y guarda el perfil para abrir conversaciones.'
    : !availablePrivateParticipants.length
    ? 'No hay otra persona pública, conectada y disponible para mensajes en esta sala.'
    : '';
  const publicParticipants = participants.filter(
    participant => participant.visible && participant.online,
  );
  const normalizedChatPeopleQuery = chatPeopleQuery.trim().toLocaleLowerCase();
  const chatPeople = publicParticipants.filter(participant =>
    !normalizedChatPeopleQuery || participant.displayName.toLocaleLowerCase().includes(normalizedChatPeopleQuery),
  );
  const visibleParticipantIds = new Set(
    publicParticipants.map(participant => participant.id),
  );
  const peopleVideoTiles = [
    ...(broadcastPlaybackUrl || videoStreamURL
      ? [
          {
            participantId: 'dj-organizer',
            streamURL: broadcastPlaybackUrl || videoStreamURL || '',
            local: false,
            organizer: true,
            hls: Boolean(broadcastPlaybackUrl),
            displayName: roomInfo?.djName || 'DJ / Organizador',
          },
        ]
      : []),
    ...[
          {
            participantId: selfListenerId,
            streamURL: socialCameraEnabled ? socialCameraStreamURL || '' : '',
            local: true,
            organizer: false,
            hls: false,
          },
        ],
    ...socialVideos
      .filter(video => visibleParticipantIds.has(video.participantId) && video.participantId !== selfListenerId)
      .map(video => ({...video, local: false, organizer: false, hls: false})),
  ]
    .slice(0, 13)
    .map(video => ({
      ...video,
      displayName: video.organizer
        ? video.displayName
        : video.local
        ? userProfile.displayName || 'Tú'
        : publicParticipants.find(
            participant => participant.id === video.participantId,
          )?.displayName || 'Oyente QSession',
    }));
  const ownInterestKeys = new Set(
    profileInterests(userProfile).map(interest => interest.toLocaleLowerCase()),
  );
  const matchmakingProfiles = publicParticipants
    .filter(
      participant =>
        participant.id !== selfListenerId &&
        participant.canMatch &&
        isProfilePublicInRoom &&
        selfParticipant?.canMatch === true,
    )
    .map(participant => ({
      participant,
      sharedInterests: participant.interests.filter(interest =>
        ownInterestKeys.has(interest.toLocaleLowerCase()),
      ),
    }))
    .filter(match => match.sharedInterests.length > 0)
    .sort(
      (left, right) =>
        right.sharedInterests.length - left.sharedInterests.length,
    );
  const matchmakingIds = new Set(
    matchmakingProfiles.map(match => match.participant.id),
  );

  const togglePrivateMember = (listenerId: string) => {
    setSelectedPrivateMembers(current =>
      current.includes(listenerId)
        ? current.filter(id => id !== listenerId)
        : [...current, listenerId].slice(0, 11),
    );
  };

  const createPrivateChat = () => {
    if (!communityAvailable || !isProfilePublicInRoom || !canMessageInRoom) {
      setPrivateStatus(
        privateChatAvailabilityMessage,
      );
      return;
    }
    if (!selectedPrivateMembers.length) {
      setPrivateStatus('Selecciona al menos una persona.');
      return;
    }
    clientRef.current?.createPrivateChat(
      selectedPrivateMembers,
      privateGroupTitle.trim() || undefined,
    );
    setPrivateStatus('Enviando invitación…');
  };

  const createPrivateContactInvite = async () => {
    if (!accountSession || !userProfile.allowMessages) {
      setPrivateStatus('Inicia sesión y activa Mensajes para crear una invitación privada.');
      return;
    }
    setPrivateInviteBusy(true);
    setPrivateStatus('Creando invitación privada…');
    try {
      const invitation = await clientRef.current?.createPrivateContactInvitation();
      if (!invitation?.code) throw new Error('No fue posible crear la invitación.');
      const invitationUrl = /^https?:\/\//i.test(invitation.url)
        ? invitation.url
        : `${PROFILE_SERVER}${invitation.url.startsWith('/') ? '' : '/'}${invitation.url}`;
      setPrivateInviteCode(invitation.code);
      setPrivateInviteUrl(invitationUrl);
      setPrivateStatus('Comparte el enlace, el código o su QR. Se usa una sola vez.');
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'No fue posible crear la invitación.');
    } finally {
      setPrivateInviteBusy(false);
    }
  };

  const redeemPrivateContactInvite = async (rawValue = privateInviteInput) => {
    const inviteCode = privateContactInviteCodeFromValue(rawValue);
    if (!inviteCode) {
      setPrivateStatus('Escribe un código privado de ocho caracteres.');
      return;
    }
    setPrivateInviteBusy(true);
    setPrivateStatus('Verificando la invitación…');
    try {
      const conversationId = await clientRef.current?.redeemPrivateContactInvitation(inviteCode);
      if (!conversationId) throw new Error('No fue posible abrir la conversación.');
      setPrivateInviteInput('');
      setPrivateSetupOpen(false);
      setActivePrivateChatId(conversationId);
      setPrivateStatus('Contacto privado conectado.');
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'La invitación no es válida.');
    } finally {
      setPrivateInviteBusy(false);
    }
  };

  const scanPrivateContactInvite = async () => {
    if (!qrScanner) {
      setPrivateStatus('El escáner QR no está disponible en esta instalación.');
      return;
    }
    setPrivateInviteBusy(true);
    try {
      const scannedValue = await qrScanner.scan();
      if (scannedValue) await redeemPrivateContactInvite(scannedValue);
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'No fue posible leer el QR privado.');
    } finally {
      setPrivateInviteBusy(false);
    }
  };

  const sharePrivateContactInvite = () => {
    if (!privateInviteCode || !privateInviteUrl) return;
    void Share.share({
      title: 'Contacto privado · Q Session',
      message: `Conectémonos por chat privado en Q Session\nCódigo: ${privateInviteCode}\n${privateInviteUrl}`,
    });
  };

  const sendContactGesture = async (participant: QSessionParticipant, type: 'touch' | 'gift', gift?: 'flower' | 'star') => {
    setPeopleContactStatus(`Enviando ${type === 'touch' ? 'un toque' : gift === 'flower' ? 'una flor' : 'una estrella'} a ${participant.displayName}…`);
    try {
      await clientRef.current?.sendProfileAction(participant.id, type, gift);
      setPeopleContactStatus(`${participant.displayName} recibió ${type === 'touch' ? 'tu toque' : gift === 'flower' ? 'tu flor' : 'tu estrella'}.`);
    } catch (error) {
      setPeopleContactStatus(error instanceof Error ? error.message : 'No fue posible enviar el gesto.');
    }
  };

  const respondPrivateChat = (accept: boolean) => {
    if (!activePrivateChat) return;
    clientRef.current?.respondPrivateChat(activePrivateChat.id, accept);
    setPrivateStatus(
      accept ? 'Entrando a la conversación…' : 'Invitación rechazada.',
    );
    if (!accept) setActivePrivateChatId('');
  };

  const sendPrivateMessage = () => {
    const text = privateChatText.trim();
    if (!activePrivateChat || activePrivateChat.status !== 'accepted' || !text)
      return;
    clientRef.current?.sendPrivateMessage(activePrivateChat.id, text);
    setPrivateChatText('');
  };

  const stopVoiceRecording = async () => {
    if (!voiceRecordingRef.current || !voiceNotes || !activePrivateChat) return;
    voiceRecordingRef.current = false;
    if (voiceRecordingTimerRef.current) clearTimeout(voiceRecordingTimerRef.current);
    voiceRecordingTimerRef.current = null;
    try {
      const audio = await voiceNotes.stop();
      await clientRef.current?.sendPrivateVoiceMessage(activePrivateChat.id, audio);
      setPrivateStatus('Nota de voz enviada.');
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'No fue posible enviar la nota de voz.');
    } finally {
      setVoiceRecording(false);
    }
  };

  const toggleVoiceRecording = async () => {
    if (voiceRecording) return stopVoiceRecording();
    if (!activePrivateChat || activePrivateChat.status !== 'accepted') return;
    if (liveChatState.status === 'live' && liveChatState.micEnabled) {
      setPrivateStatus('Silencia el micrófono del chat en vivo antes de grabar una nota de voz.');
      return;
    }
    if (roomChatMicEnabled) {
      setPrivateStatus('Silencia el micrófono de la sala antes de grabar una nota de voz.');
      return;
    }
    if (!voiceNotes) return setPrivateStatus('Esta instalación no permite grabar notas de voz.');
    try {
      if (!(await requestMicrophonePermission())) {
        setPrivateStatus('La nota de voz necesita permiso del micrófono.');
        return;
      }
      await voiceNotes.start();
      voiceRecordingRef.current = true;
      setVoiceRecording(true);
      setPrivateStatus('Grabando… toca el botón rojo para enviar. Máximo 30 segundos.');
      voiceRecordingTimerRef.current = setTimeout(() => { void stopVoiceRecording(); }, 28000);
    } catch (error) {
      setVoiceRecording(false);
      voiceRecordingRef.current = false;
      setPrivateStatus(error instanceof Error ? error.message : 'No fue posible iniciar la grabación.');
    }
  };

  const playVoiceMessage = async (message: QSessionPrivateMessage) => {
    const source = message.audio?.dataUrl || message.audio?.url || '';
    if (!source || !voiceNotes) return setPrivateStatus('Esta instalación no permite reproducir la nota de voz.');
    try {
      if (playingVoiceMessageId) await voiceNotes.stopPlayback();
      setPlayingVoiceMessageId(message.id);
      await voiceNotes.play(source, /^https?:\/\//i.test(source) ? accountSession?.token : undefined);
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'No fue posible reproducir la nota de voz.');
    } finally {
      setPlayingVoiceMessageId('');
    }
  };

  const enterLiveChat = async () => {
    if (!activePrivateChat || activePrivateChat.status !== 'accepted') return;
    if (roomChatMicEnabled) {
      await clientRef.current?.setRoomChatMicrophoneEnabled(false).catch(() => undefined);
    }
    if (socialCameraEnabled) await toggleSocialCamera();
    clientRef.current?.requestLiveChat(activePrivateChat.id, !activePrivateChat.liveVoiceEnabled);
  };

  const setRoomChatMicrophone = async (enabled: boolean) => {
    try {
      if (enabled && !(await requestMicrophonePermission())) {
        setRoomChatMediaStatus('El micrófono permanece silenciado porque no se autorizó el permiso.');
        return;
      }
      await clientRef.current?.setRoomChatMicrophoneEnabled(enabled);
      setRoomChatMediaStatus(enabled
        ? 'Micrófono abierto para la sala y el DJ.'
        : 'Micrófono silenciado. Sigues escuchando y escribiendo.');
    } catch (error) {
      setRoomChatMicEnabled(false);
      setRoomChatMediaStatus(error instanceof Error ? error.message : 'No pudimos cambiar el micrófono de la sala.');
    }
  };

  const startRoomChatPushToTalk = async () => {
    if (roomChatMicEnabled || roomChatPushRef.current) return;
    roomChatPushRef.current = true;
    setRoomChatPushActive(true);
    if (!(await requestMicrophonePermission())) {
      roomChatPushRef.current = false;
      setRoomChatPushActive(false);
      setRoomChatMediaStatus('El micrófono permanece silenciado porque no se autorizó el permiso.');
      return;
    }
    try {
      if (roomChatPushRef.current) await clientRef.current?.setRoomChatMicrophoneEnabled(true);
      setRoomChatMediaStatus('Te escuchan mientras mantienes presionado.');
    } catch (error) {
      roomChatPushRef.current = false;
      setRoomChatPushActive(false);
      setRoomChatMediaStatus(error instanceof Error ? error.message : 'No pudimos abrir el micrófono.');
    }
  };

  const stopRoomChatPushToTalk = async () => {
    if (!roomChatPushRef.current) return;
    roomChatPushRef.current = false;
    setRoomChatPushActive(false);
    await clientRef.current?.setRoomChatMicrophoneEnabled(false).catch(() => undefined);
    setRoomChatMediaStatus('Micrófono silenciado. Sigues escuchando y escribiendo.');
  };

  const toggleLiveChatMicrophone = async () => {
    try {
      if (!liveChatState.micEnabled && !(await requestMicrophonePermission())) {
        setPrivateStatus('El micrófono permanece silenciado porque no se autorizó el permiso.');
        return;
      }
      await clientRef.current?.setLiveChatMicrophoneEnabled(!liveChatState.micEnabled);
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'No pudimos cambiar el micrófono.');
    }
  };

  const setLiveChatMicrophone = async (enabled: boolean) => {
    try {
      if (enabled && !(await requestMicrophonePermission())) {
        setPrivateStatus('El micrófono permanece silenciado porque no se autorizó el permiso.');
        return;
      }
      await clientRef.current?.setLiveChatMicrophoneEnabled(enabled);
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'No pudimos cambiar el micrófono.');
    }
  };

  const toggleLiveChatCamera = async () => {
    try {
      if (!liveChatState.cameraEnabled && Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Tu cámara en la llamada',
            message: 'QSession usará la cámara frontal sólo mientras la mantengas encendida en esta conversación.',
            buttonPositive: 'Activar cámara',
            buttonNegative: 'Ahora no',
          },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          setPrivateStatus('La cámara permanece apagada.');
          return;
        }
      }
      await clientRef.current?.setLiveChatCameraEnabled(!liveChatState.cameraEnabled);
    } catch (error) {
      setPrivateStatus(error instanceof Error ? error.message : 'No pudimos cambiar la cámara.');
    }
  };

  const startLiveChatPushToTalk = async () => {
    liveChatPushRef.current = true;
    if (!(await requestMicrophonePermission())) {
      liveChatPushRef.current = false;
      setPrivateStatus('El micrófono permanece silenciado porque no se autorizó el permiso.');
      return;
    }
    if (liveChatPushRef.current) await clientRef.current?.setLiveChatMicrophoneEnabled(true);
  };

  const stopLiveChatPushToTalk = async () => {
    liveChatPushRef.current = false;
    await clientRef.current?.setLiveChatMicrophoneEnabled(false).catch(() => undefined);
  };

  const openDirectChat = (participant: QSessionParticipant) => {
    setListenerView('chat');
    setChatSection('private');
    setPrivateSetupOpen(false);
    const existing = privateChats.find(
      chat =>
        chat.kind === 'direct' &&
        chat.members.some(member => member.id === participant.id),
    );
    if (existing) {
      setActivePrivateChatId(existing.id);
      setPrivateStatus('');
      return;
    }
    if (!communityAvailable || !isProfilePublicInRoom || !canMessageInRoom) {
      setPrivateStatus(
        privateChatAvailabilityMessage,
      );
      return;
    }
    setPrivateStatus('Enviando invitación…');
    clientRef.current?.createPrivateChat([participant.id]);
  };

  const openProfile = () => {
    setProfileDraft({ ...userProfile });
    setProfileMessage('');
    setProfilePhotoMessage('');
    setProfileScreenOpen(true);
  };

  const closeProfile = () => {
    setProfileScreenOpen(false);
    setProfileDraft(null);
    setProfileMessage('');
    setProfilePhotoMessage('');
  };

  const updateProfileDraft = (values: Partial<QSessionUserProfile>) => {
    setProfileDraft(current => ({ ...(current || userProfile), ...values }));
  };

  const authenticateQSessionAccount = async () => {
    if (!accountEmail.trim() || accountPassword.length < 10) {
      setAccountMessage(
        'Escribe tu correo y una contraseña de al menos 10 caracteres.',
      );
      return;
    }
    try {
      setAccountBusy(true);
      setAccountMessage(
        accountMode === 'register'
          ? 'Creando tu cuenta QSession…'
          : 'Ingresando a QSession…',
      );
      const result =
        accountMode === 'register'
          ? await registerAccount(
              PROFILE_SERVER,
              accountEmail,
              accountPassword,
              userProfile.displayName,
            )
          : await loginAccount(PROFILE_SERVER, accountEmail, accountPassword);
      await profileStorage?.saveAccountSession?.(
        JSON.stringify(result.session),
      );
      let restored =
        accountMode === 'register'
          ? normalizeProfile({
              ...userProfile,
              localId: result.profile.id,
              displayName:
                result.profile.displayName || userProfile.displayName,
            })
          : profileFromServer(PROFILE_SERVER, result.profile, userProfile);
      if (accountMode === 'register' && restored.displayName) {
        restored = await saveAccountProfile(
          PROFILE_SERVER,
          result.session,
          restored,
        );
      }
      await profileStorage?.save(JSON.stringify(restored));
      setAccountSession(result.session);
      setAccountEmail(result.session.account.email);
      setCurrentStory(result.profile.stories?.at(-1) || null);
      setAccountPassword('');
      setUserProfile(restored);
      setProfileDraft(restored);
      setProfileSavedOnServer(true);
      setAccountMessage(
        accountMode === 'register'
          ? 'Tu cuenta quedó creada y tu perfil está sincronizado.'
          : 'Sesión iniciada. Recuperamos tu perfil de QSession.',
      );
    } catch (error) {
      setAccountMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible ingresar a QSession.',
      );
    } finally {
      setAccountBusy(false);
    }
  };

  const closeQSessionAccount = async () => {
    try {
      if (accountSession) await logoutAccount(PROFILE_SERVER, accountSession);
    } catch {
      // La sesión local se elimina incluso si el servidor no responde.
    }
    clientRef.current?.setProfile('');
    await profileStorage?.clearAccountSession?.();
    const freshIdentity = createEmptyProfile();
    const localGallery = userProfile.gallery
      .filter(photo => photo.localUri || photo.dataUrl)
      .map(photo => ({ ...photo, mediaId: '', remoteUrl: '' }));
    const localCopy = normalizeProfile({
      ...userProfile,
      localId: freshIdentity.localId,
      ownerToken: freshIdentity.ownerToken,
      gallery: localGallery,
      isPublic: false,
      allowMatchmaking: false,
      allowMessages: false,
      updatedAt: Date.now(),
    });
    await profileStorage?.save(JSON.stringify(localCopy));
    setAccountSession(null);
    setProfileSavedOnServer(false);
    setCurrentStory(null);
    setStoryMediaId('');
    setUserProfile(localCopy);
    setProfileDraft(localCopy);
    setAccountPassword('');
    setAccountMessage(
      'Sesión cerrada. Tu identidad local permanece privada; inicia sesión para recuperar la galería completa.',
    );
  };

  const pickProfilePhoto = async () => {
    if (!profileStorage)
      return setProfilePhotoMessage(
        'El selector de fotos no está disponible en esta instalación.',
      );
    const current = normalizeProfile(profileDraft || userProfile);
    if (current.gallery.length >= 6)
      return setProfilePhotoMessage('Puedes guardar hasta seis fotos en tu perfil.');
    try {
      setProfilePhotoPicking(true);
      setProfilePhotoMessage('Abriendo tus fotos…');
      const selection = await profileStorage.pickPhoto();
      if (!selection) {
        setProfilePhotoMessage('No seleccionaste ninguna foto.');
        return;
      }
      setProfilePhotoMessage('Optimizando la foto para QSession…');
      const prepared = await preparePickedProfilePhoto(
        selection,
        profileStorage.readPhotoData,
      );
      if (!prepared) throw new Error('La foto seleccionada no se pudo leer.');
      const updated = addProfilePhoto(current, {
        localUri: prepared.uri,
        dataUrl: prepared.dataUrl,
        mediaId: '',
        remoteUrl: '',
        caption: '',
      });
      setProfileDraft(updated);
      setProfilePhotoMessage(
        `Foto lista · ${updated.gallery.length} de 6. Pulsa “Guardar mi perfil” para subirla.`,
      );
    } catch (error) {
      setProfilePhotoMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible abrir tus fotos.',
      );
    } finally {
      setProfilePhotoPicking(false);
    }
  };

  const removeGalleryPhoto = (index: number) => {
    const updated = removeProfilePhoto(
      normalizeProfile(profileDraft || userProfile),
      index,
    );
    setProfileDraft(updated);
    setProfilePhotoMessage('Foto quitada. Guarda el perfil para confirmar.');
  };

  const makeGalleryPhotoPrimary = (index: number) => {
    setProfileDraft(
      makePrimaryProfilePhoto(
        normalizeProfile(profileDraft || userProfile),
        index,
      ),
    );
    setProfilePhotoMessage('Nueva foto principal seleccionada.');
  };

  const saveProfile = async () => {
    let draft = normalizeProfile(profileDraft || userProfile);
    if (draft.displayName.length < 2) {
      setProfileMessage(
        'Escribe un nombre o apodo de al menos dos caracteres.',
      );
      return;
    }
    if (!profileStorage) {
      setProfileMessage(
        'El almacenamiento del perfil no está disponible en esta instalación.',
      );
      return;
    }
    try {
      setProfileSaving(true);
      setProfileMessage('Guardando de forma segura en QSession…');
      const preparedGallery = [];
      for (const photo of draft.gallery) {
        const dataUrl =
          !photo.mediaId &&
          !photo.dataUrl &&
          photo.localUri &&
          profileStorage.readPhotoData
            ? await profileStorage.readPhotoData(photo.localUri)
            : photo.dataUrl;
        preparedGallery.push({ ...photo, dataUrl });
      }
      let saved = normalizeProfile({
        ...draft,
        gallery: preparedGallery,
        updatedAt: Date.now(),
      });
      await profileStorage.save(JSON.stringify(saved));
      setUserProfile(saved);
      setProfileDraft(saved);
      setProfileSavedOnServer(false);
      syncedProfileRef.current = '';
      try {
        if (accountSession) {
          saved = await saveAccountProfile(
            PROFILE_SERVER,
            accountSession,
            saved,
          );
          await profileStorage.save(JSON.stringify(saved));
          setUserProfile(saved);
          setProfileDraft(saved);
          clientRef.current?.setProfile(
            saved.localId,
            accountSession.token,
            saved.ownerToken,
          );
        } else {
          const profileId = await publishProfile(PROFILE_SERVER, saved);
          clientRef.current?.setProfile(profileId, '', saved.ownerToken);
        }
        setProfileSavedOnServer(true);
        syncedProfileRef.current = `${PROFILE_SERVER}|${saved.localId}|${saved.updatedAt}`;
        setProfileMessage(
          saved.isPublic
            ? `Perfil guardado en QSession${
                accountSession ? ' y sincronizado con tu cuenta' : ''
              }. Será visible cuando participes en un evento.`
            : `Perfil guardado en QSession${
                accountSession ? ' y sincronizado con tu cuenta' : ''
              } como privado. Solo tú decides cuándo hacerlo visible.`,
        );
      } catch {
        setProfileSavedOnServer(false);
        setProfileMessage(
          'El perfil quedó guardado en este teléfono, pero falta sincronizarlo con QSession. Revisa tu conexión e inténtalo nuevamente.',
        );
      }
    } catch (error) {
      setProfileMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible guardar el perfil.',
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const publishMyStory = async () => {
    if (!accountSession)
      return setAccountMessage(
        'Crea una cuenta o inicia sesión para publicar un Story.',
      );
    const draft = normalizeProfile(profileDraft || userProfile);
    if (profileSaveSignature(draft) !== profileSaveSignature(userProfile))
      return setProfileMessage(
        'Guarda los cambios del perfil antes de publicar el Story.',
      );
    if (!profileSavedOnServer)
      return setProfileMessage(
        'Tu perfil todavía no está sincronizado con QSession. Guárdalo nuevamente antes de publicar.',
      );
    if (!userProfile.isPublic || (isActive && !isProfilePublicInRoom))
      return setProfileMessage(
        'Guarda tu perfil como Público antes de compartir un Story.',
      );
    if (isActive && serverStatus && !serverStatus.features.stories)
      return setProfileMessage(communityUnavailableMessage);
    if (!storyText.trim() && !storyMediaId)
      return setProfileMessage('Escribe un estado o elige una foto.');
    try {
      setStoryBusy(true);
      setProfileMessage('Publicando Story…');
      const story = await publishStory(
        PROFILE_SERVER,
        accountSession,
        storyText.trim(),
        storyMediaId || undefined,
      );
      setCurrentStory(story);
      setStoryText('');
      setStoryMediaId('');
      clientRef.current?.setProfile(
        userProfile.localId,
        accountSession.token,
        userProfile.ownerToken,
      );
      setProfileMessage(
        'Story publicado durante 24 horas. Sólo aparecerá cuando compartas una sala.',
      );
    } catch (error) {
      setProfileMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible publicar el Story.',
      );
    } finally {
      setStoryBusy(false);
    }
  };

  const reportMessage = (messageId: string) => {
    Alert.alert(
      qsessionTranslate('Denunciar mensaje', language),
      qsessionTranslate('¿Quieres enviar este mensaje a revisión?', language),
      [
        { text: qsessionTranslate('Cancelar', language), style: 'cancel' },
        {
          text: qsessionTranslate('Denunciar', language),
          style: 'destructive',
          onPress: () => clientRef.current?.reportMessage(messageId),
        },
      ],
    );
  };

  const startMobileBroadcast = async () => {
    try {
      if (!broadcastRightsAccepted) {
        setBroadcastRightsOpen(true);
        throw new Error(
          'Para cuidar tu obra y la de otros artistas, revisa y acepta la declaración de derechos antes de transmitir.',
        );
      }
      setBroadcastState('connecting');
      setBroadcastDetail('Conectando con Q Session…');
      if (!(await requestMicrophonePermission()))
        throw new Error(
          'Q Session necesita permiso de micrófono para transmitir esta entrada.',
        );
      if (Platform.OS === 'android') {
        if (!playback?.startBroadcast)
          throw new Error(
            'Esta instalación no incluye el servicio de transmisión en segundo plano.',
          );
        await playback.startBroadcast('PREPARANDO');
      }
      const room = await broadcasterRef.current?.start(PROFILE_SERVER, {
        name: broadcastName.trim() || undefined,
        djName: broadcastDj.trim() || undefined,
        roomType: broadcastRoomType,
        visibility: ROOM_PRESETS[broadcastRoomType].visibility,
        rightsDeclaration: {
          accepted: true,
          version: QSESSION_MUSIC_RIGHTS_VERSION,
          scope: 'host-supplied-content',
        },
        ...broadcastFeatures,
        ...broadcastExperience,
      });
      if (room && Platform.OS === 'android') await playback?.startBroadcast?.(room.code);
    } catch (error) {
      broadcasterRef.current?.stop(false);
      void playback?.stopBroadcast?.().catch(() => {});
      setBroadcastState('error');
      setBroadcastDetail(
        error instanceof Error
          ? error.message
          : 'No fue posible iniciar la transmisión móvil.',
      );
    }
  };

  const stopMobileBroadcast = () => {
    broadcasterRef.current?.stop();
    void playback?.stopBroadcast?.().catch(() => {});
    setBroadcastRightsAccepted(false);
    setBroadcastRightsOpen(false);
  };

  const shareBroadcast = () => {
    if (!broadcastRoom?.joinUrl) return;
    void Share.share({
      title: `Sala ${broadcastRoom.code} · QSession`,
      message: `Escucha mi sala QSession ${broadcastRoom.code}: ${broadcastRoom.joinUrl}`,
    });
  };

  const backHome = () => {
    disconnect();
    broadcasterRef.current?.stop();
    void playback?.stopBroadcast?.().catch(() => {});
    setRole(null);
    setHomeSection('live');
    setCreateOptionsOpen(false);
    setCode('');
    setServer('');
    setInvite('');
    setEntryMethod('qr');
    setEntryMenuOpen(false);
    setEntryError('');
    setDetail('');
    setRoomInfo(null);
    setMessages([]);
    setChatText('');
    setListenerView('live');
    setUnreadChatCount(0);
    setProfileScreenOpen(false);
    setProfileDraft(null);
    setBroadcastState('idle');
    setBroadcastDetail('');
    setBroadcastRoom(null);
    setBroadcastRightsAccepted(false);
    setBroadcastRightsOpen(false);
    syncedProfileRef.current = '';
  };

  const editableProfile = profileDraft || userProfile;
  const profileHasUnsavedChanges =
    profileSaveSignature(editableProfile) !== profileSaveSignature(userProfile);
  const profileReadyForStory = Boolean(
    accountSession &&
      editableProfile.isPublic &&
      profileSavedOnServer &&
      !profileHasUnsavedChanges &&
      (!isActive || isProfilePublicInRoom),
  );
  const profileInitial =
    editableProfile.displayName.trim().charAt(0).toUpperCase() || 'Q';
  const primaryProfilePhoto = editableProfile.gallery[0];
  const primaryProfilePhotoUri =
    primaryProfilePhoto?.localUri ||
    primaryProfilePhoto?.remoteUrl ||
    primaryProfilePhoto?.dataUrl ||
    editableProfile.photoUri;

  return (
    <>
      <StatusBar
        hidden={videoFullscreen}
        barStyle="light-content"
        backgroundColor={navy}
      />
      <Modal
        visible={projectVisionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProjectVisionOpen(false)}
      >
        <View style={s.projectVisionOverlay}>
          <View style={s.projectVisionSheet}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar visión"
              onPress={() => setProjectVisionOpen(false)}
              style={s.projectVisionClose}
            >
              <Text style={s.projectVisionCloseText}>×</Text>
            </Pressable>
            <ScrollView
              style={s.projectVisionScroll}
              contentContainerStyle={s.projectVisionContent}
              showsVerticalScrollIndicator={false}
            >
              <Image source={brandIcon} style={s.projectVisionLogo} />
              <Text style={s.projectVisionEyebrow}>NUESTRA VISIÓN</Text>
              <Text style={s.projectVisionTitle}>Bailar para volver al centro.</Text>
              <Text style={s.projectVisionLead}>
                Una rave global para abrazar a la Tierra en un solo baile.
              </Text>
              <Text style={s.projectVisionQuote}>“Usa el baile como terapia.”</Text>
              <View style={s.projectVisionWorldCard}>
                <Image source={worldNetwork} style={s.projectVisionWorldImage} />
              </View>

              <View style={s.projectVisionPrinciples}>
                {[
                  ['◎', 'Rave global', 'Personas de todo el mundo bailando juntas.'],
                  ['♡', 'Baile y liberación', 'El movimiento como terapia para una vida más plena.'],
                  ['◌', 'Energía que se comparte', 'La energía del baile nos conecta y nos transforma.'],
                  ['⌁', 'Amor a la Tierra', 'Un baile global por un planeta más consciente.'],
                ].map(([icon, title, body]) => (
                  <View key={title} style={s.projectVisionPrincipleCard}>
                    <Text style={s.projectVisionCardIcon}>{icon}</Text>
                    <Text style={s.projectVisionCardTitle}>{title}</Text>
                    <Text style={s.projectVisionCardText}>{body}</Text>
                  </View>
                ))}
              </View>

              <View style={s.projectVisionTechnology}>
                <Text style={s.projectVisionEyebrow}>TECNOLOGÍA PARA COMPARTIR PRESENCIA</Text>
                <Text style={s.projectVisionSectionTitle}>
                  Cualquier teléfono puede convertirse en una ventana al vivo.
                </Text>
                <Text style={s.projectVisionText}>
                  Q Session convierte teléfonos, computadoras y pantallas en dispositivos capaces de recibir audio y video en tiempo real, desde cualquier lugar.
                </Text>
                <View style={s.projectVisionSignal}>
                  <View style={s.projectVisionSignalSource}>
                    <Text style={s.projectVisionSignalIcon}>◉</Text>
                    <View>
                      <Text style={s.projectVisionSignalTitle}>DJ · Profesor · Anfitrión</Text>
                      <Text style={s.projectVisionSignalLive}>TRANSMITIENDO EN VIVO</Text>
                    </View>
                  </View>
                  <Text style={s.projectVisionSignalLine}>┊</Text>
                  <View style={s.projectVisionSignalCore}>
                    <Text style={s.projectVisionSignalCoreMark}>Q</Text>
                    <Text style={s.projectVisionSignalCoreText}>Q Session</Text>
                  </View>
                  <View style={s.projectVisionFeatureRow}>
                    {['Audio en vivo', 'Video en vivo', 'Sincronización', 'Acceso global'].map(item => (
                      <View key={item} style={s.projectVisionFeatureChip}>
                        <Text style={s.projectVisionFeatureDot}>•</Text>
                        <Text style={s.projectVisionFeatureText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              <View style={s.projectVisionUses}>
                <Text style={s.projectVisionEyebrow}>MUCHO MÁS QUE UNA FIESTA</Text>
                <Text style={s.projectVisionSectionTitle}>
                  Una plataforma para encuentros que necesitan sentirse presentes.
                </Text>
                {[
                  ['Sesiones privadas', 'Comparte una experiencia íntima en tiempo real.'],
                  ['Grupos y comunidades', 'Reúne personas alrededor de un propósito común.'],
                  ['Yoga y meditación', 'Guía prácticas audiovisuales desde cualquier lugar.'],
                  ['Bodas y celebraciones', 'Conecta a quienes no pueden estar físicamente.'],
                  ['Conferencias', 'Transmite ideas con participación en vivo.'],
                  ['Rave global', 'Un mismo baile conectando países y culturas.'],
                ].map(([title, body], index) => (
                  <View key={title} style={s.projectVisionUseCard}>
                    <Text style={s.projectVisionUseNumber}>{String(index + 1).padStart(2, '0')}</Text>
                    <View style={s.projectVisionUseCopy}>
                      <Text style={s.projectVisionUseTitle}>{title}</Text>
                      <Text style={s.projectVisionUseText}>{body}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={s.projectVisionManifesto}>
                <Text style={s.projectVisionManifestoTitle}>
                  Q Session es infraestructura para compartir presencia.
                </Text>
                <Text style={s.projectVisionManifestoText}>
                  No es solamente una fiesta. Es una herramienta para que las personas escuchen, vean y vivan juntas una experiencia en tiempo real.
                </Text>
                <Text style={s.projectVisionManifestoTagline}>
                  Tecnología al servicio de la conexión humana.
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      {broadcastPlaybackUrl || videoStreamURL ? (
        <Modal
          visible={videoFullscreen}
          animationType="fade"
          presentationStyle="fullScreen"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setVideoFullscreen(false)}
        >
          <View style={s.videoFullscreenSurface}>
            {broadcastPlaybackUrl ? (
              <Video
                source={{uri: broadcastPlaybackUrl, type: 'm3u8', minLoadRetryCount: 10}}
                resizeMode="contain"
                volume={outputGain}
                playInBackground
                playWhenInactive
                onLoad={() => {
                  setConnection('live');
                  setDetail('Señal distribuida recibida por la red de borde.');
                }}
                onError={fallbackBroadcastToWebRtc}
                style={s.videoFullscreenMedia}
              />
            ) : (
              <RTCView
                streamURL={videoStreamURL!}
                objectFit="contain"
                mirror={false}
                style={s.videoFullscreenMedia}
              />
            )}
            <View style={s.videoFullscreenHeader}>
              <View style={s.videoFullscreenLive}>
                <View style={s.videoFullscreenDot} />
                <Text style={s.videoFullscreenLiveText}>VIDEO EN VIVO</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Salir de pantalla completa"
              onPress={() => setVideoFullscreen(false)}
              style={({ pressed }) => [
                s.videoFullscreenClose,
                pressed && s.videoFullscreenClosePressed,
              ]}
            >
              <Text style={s.videoFullscreenCloseIcon}>×</Text>
              <Text style={s.videoFullscreenCloseText}>
                Salir de pantalla completa
              </Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}
      <View style={s.safe}>
        <KeyboardAvoidingView
          style={s.safe}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              s.page,
              !profileScreenOpen && !role && s.pageWithMainNav,
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.header}>
              {profileScreenOpen || role ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Volver al inicio"
                  onPress={() => {
                    if (profileScreenOpen) closeProfile();
                    else backHome();
                  }}
                  style={({pressed}) => [s.headerBackButton, pressed && s.pressed]}
                >
                  <Text style={s.headerBackText}>← Atrás</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setHomeSection('live')}
                  style={s.brand}
                >
                  <Image source={brandIcon} style={s.logoImage} />
                  <View style={s.brandCopy}>
                    <Text style={s.logoText}>Q Session</Text>
                  </View>
                </Pressable>
              )}
              <View style={s.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${activeRooms.length} salas en vivo · ${currentStatusLabel}`}
                  onPress={() => {
                    if (role) backHome();
                    setHomeSection('live');
                  }}
                  style={s.headerLiveButton}
                >
                  <View style={s.headerLiveDot} />
                  {activeRooms.length > 0 ? (
                    <View style={s.headerLiveCount}>
                      <Text style={s.headerLiveCountText}>
                        {activeRooms.length > 9 ? '9+' : activeRooms.length}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    language === 'es'
                      ? 'Cambiar idioma a inglés'
                      : 'Switch language to Spanish'
                  }
                  onPress={toggleLanguage}
                  style={s.languageButton}
                >
                  <Text style={s.languageButtonText}>
                    {language === 'es' ? 'ES' : 'EN'}
                  </Text>
                  <Text style={s.languageButtonChevron}>⌄</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Crear o editar mi perfil"
                  onPress={openProfile}
                  style={s.profileShortcut}
                >
                  <View style={s.profileShortcutAvatar}>
                    {userProfile.photoUri ? (
                      <Image
                        source={{ uri: userProfile.photoUri }}
                        style={s.profileShortcutImage}
                      />
                    ) : (
                      <Text style={s.profileShortcutInitial}>
                        {userProfile.displayName
                          .trim()
                          .charAt(0)
                          .toUpperCase() || 'Q'}
                      </Text>
                    )}
                  </View>
                </Pressable>
              </View>
            </View>

            {profileScreenOpen && (
              <View style={s.profileScreen}>
                <View style={s.sectionTitle}>
                  <Text style={s.eyebrow}>TU IDENTIDAD EN QSESSION</Text>
                  <Text style={s.titleSmall}>Mi perfil</Text>
                  <Text style={s.subtitle}>
                    Tú decides qué mostrar y cómo podrán conectar contigo en los
                    eventos.
                  </Text>
                </View>

                <View style={[s.profileEditorCard, s.accountCard]}>
                  {accountSession ? (
                    <>
                      <View style={s.accountActiveHeader}>
                        <View style={s.accountShield}>
                          <Text style={s.accountShieldText}>✓</Text>
                        </View>
                        <View style={s.accountActiveCopy}>
                          <Text style={s.profileSectionTitle}>
                            Cuenta QSession activa
                          </Text>
                          <Text style={s.profileSectionText}>
                            {accountSession.account.email}
                          </Text>
                        </View>
                      </View>
                      <Text style={s.accountBenefit}>
                        Tu perfil, galería y preferencias pueden recuperarse en
                        otro dispositivo cuando inicies sesión.
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void closeQSessionAccount()}
                        style={s.accountLogout}
                      >
                        <Text style={s.accountLogoutText}>Cerrar sesión</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Text style={s.profileSectionTitle}>
                        Guarda tu identidad QSession
                      </Text>
                      <Text style={s.profileSectionText}>
                        Crea una cuenta para recuperar tu perfil, tus fotos y
                        tus preferencias en cualquier dispositivo.
                      </Text>
                      <View style={s.accountModes}>
                        <Pressable
                          accessibilityRole="tab"
                          accessibilityState={{
                            selected: accountMode === 'register',
                          }}
                          onPress={() => {
                            setAccountMode('register');
                            setAccountMessage('');
                          }}
                          style={[
                            s.accountMode,
                            accountMode === 'register' && s.accountModeActive,
                          ]}
                        >
                          <Text
                            style={[
                              s.accountModeText,
                              accountMode === 'register' &&
                                s.accountModeTextActive,
                            ]}
                          >
                            Crear cuenta
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="tab"
                          accessibilityState={{
                            selected: accountMode === 'login',
                          }}
                          onPress={() => {
                            setAccountMode('login');
                            setAccountMessage('');
                          }}
                          style={[
                            s.accountMode,
                            accountMode === 'login' && s.accountModeActive,
                          ]}
                        >
                          <Text
                            style={[
                              s.accountModeText,
                              accountMode === 'login' &&
                                s.accountModeTextActive,
                            ]}
                          >
                            Iniciar sesión
                          </Text>
                        </Pressable>
                      </View>
                      <Text style={s.label}>CORREO ELECTRÓNICO</Text>
                      <TextInput
                        accessibilityLabel="Correo electrónico"
                        value={accountEmail}
                        onChangeText={setAccountEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="tu@correo.com"
                        placeholderTextColor="#9AA3AF"
                        style={s.profileField}
                      />
                      <Text style={s.label}>CONTRASEÑA</Text>
                      <TextInput
                        accessibilityLabel="Contraseña"
                        value={accountPassword}
                        onChangeText={setAccountPassword}
                        secureTextEntry
                        maxLength={128}
                        placeholder="Mínimo 10 caracteres"
                        placeholderTextColor="#9AA3AF"
                        style={s.profileField}
                      />
                      <Pressable
                        accessibilityRole="button"
                        disabled={accountBusy}
                        onPress={() => void authenticateQSessionAccount()}
                        style={[s.accountSubmit, accountBusy && s.disabled]}
                      >
                        <Text style={s.accountSubmitText}>
                          {accountBusy
                            ? 'Procesando…'
                            : accountMode === 'register'
                            ? 'Crear mi cuenta'
                            : 'Ingresar a QSession'}
                        </Text>
                      </Pressable>
                    </>
                  )}
                  {accountMessage ? (
                    <Text style={s.accountMessage}>{accountMessage}</Text>
                  ) : null}
                </View>

                <View style={s.profileEditorCard}>
                  <View style={s.profileIdentity}>
                    <View style={s.profileAvatarLarge}>
                      {primaryProfilePhotoUri ? (
                        <Image
                          source={{ uri: primaryProfilePhotoUri }}
                          style={s.profileAvatarImage}
                        />
                      ) : (
                        <Text style={s.profileAvatarInitial}>
                          {profileInitial}
                        </Text>
                      )}
                    </View>
                    <View style={s.profileIdentityCopy}>
                      <Text style={s.profileIdentityTitle}>
                        {editableProfile.displayName || 'Tu nombre o apodo'}
                      </Text>
                      <Text style={s.profileIdentityText}>
                        Puedes agregar hasta seis fotos. JPG, PNG y WebP se
                        optimizan antes de guardarse.
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      s.profilePhotoActions,
                      Boolean(profilePhotoMessage) && s.profilePhotoActionsWithMessage,
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      disabled={
                        profilePhotoPicking || editableProfile.gallery.length >= 6
                      }
                      onPress={() => void pickProfilePhoto()}
                      style={[
                        s.profilePhotoButton,
                        (profilePhotoPicking || editableProfile.gallery.length >= 6) &&
                          s.disabled,
                      ]}
                    >
                      <Text style={s.profilePhotoButtonText}>
                        {profilePhotoPicking ? 'Preparando…' : '+ Agregar foto'}
                      </Text>
                    </Pressable>
                    <Text style={s.galleryCounter}>
                      {editableProfile.gallery.length}/6
                    </Text>
                  </View>
                  {profilePhotoMessage ? (
                    <View style={s.profilePhotoStatus}>
                      <Text style={s.profilePhotoStatusText}>
                        {profilePhotoMessage}
                      </Text>
                    </View>
                  ) : null}
                  {editableProfile.gallery.length ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={s.galleryStrip}
                    >
                      {editableProfile.gallery.map((photo, index) => {
                        const uri =
                          photo.localUri || photo.remoteUrl || photo.dataUrl;
                        return (
                          <View
                            key={
                              photo.mediaId ||
                              photo.localUri ||
                              `${index}-${photo.remoteUrl}`
                            }
                            style={[
                              s.galleryItem,
                              index === 0 && s.galleryItemPrimary,
                            ]}
                          >
                            <Image source={{ uri }} style={s.galleryImage} />
                            {index === 0 ? (
                              <Text style={s.galleryPrimaryBadge}>
                                PRINCIPAL
                              </Text>
                            ) : (
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => makeGalleryPhotoPrimary(index)}
                                style={s.galleryPrimaryButton}
                              >
                                <Text style={s.galleryPrimaryButtonText}>
                                  Hacer principal
                                </Text>
                              </Pressable>
                            )}
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Quitar foto ${index + 1}`}
                              onPress={() => removeGalleryPhoto(index)}
                              style={s.galleryRemove}
                            >
                              <Text style={s.galleryRemoveText}>×</Text>
                            </Pressable>
                          </View>
                        );
                      })}
                    </ScrollView>
                  ) : null}

                  <Text style={s.label}>NOMBRE O APODO</Text>
                  <TextInput
                    accessibilityLabel="Nombre o apodo"
                    value={editableProfile.displayName}
                    onChangeText={displayName =>
                      updateProfileDraft({ displayName })
                    }
                    maxLength={60}
                    placeholder="Cómo quieres que te llamen"
                    placeholderTextColor="#9AA3AF"
                    style={s.profileField}
                  />
                  <Text style={s.label}>CIUDAD O REGIÓN · OPCIONAL</Text>
                  <TextInput
                    accessibilityLabel="Ciudad o región"
                    value={editableProfile.city}
                    onChangeText={city => updateProfileDraft({ city })}
                    maxLength={100}
                    placeholder="Ej. Medellín, Colombia"
                    placeholderTextColor="#9AA3AF"
                    style={s.profileField}
                  />
                  <Text style={s.profileHint}>
                    Este dato pertenece a tu perfil y no determina el mapa de
                    Rave global.
                  </Text>
                  <Text style={s.label}>INTERESES · OPCIONAL</Text>
                  <TextInput
                    accessibilityLabel="Intereses"
                    value={editableProfile.interests}
                    onChangeText={interests =>
                      updateProfileDraft({ interests })
                    }
                    maxLength={240}
                    placeholder="Música electrónica, yoga, baile…"
                    placeholderTextColor="#9AA3AF"
                    style={s.profileField}
                  />
                  <Text style={s.profileHint}>
                    Sepáralos con comas. Servirán para encontrar afinidades
                    cuando habilitemos Matchmaking.
                  </Text>
                  <Text style={s.label}>SOBRE MÍ · OPCIONAL</Text>
                  <TextInput
                    accessibilityLabel="Sobre mí"
                    value={editableProfile.bio}
                    onChangeText={bio => updateProfileDraft({ bio })}
                    maxLength={300}
                    multiline
                    textAlignVertical="top"
                    placeholder="Cuéntale a la comunidad lo que quieras sobre ti."
                    placeholderTextColor="#9AA3AF"
                    style={[s.profileField, s.profileBio]}
                  />
                  <Text style={s.profileCounter}>
                    {editableProfile.bio.length}/300
                  </Text>
                </View>

                <View style={s.profileEditorCard}>
                  <Text style={s.profileSectionTitle}>
                    Visibilidad del perfil
                  </Text>
                  <Text style={s.profileSectionText}>
                    Puedes cambiarla cuando quieras. Escuchar seguirá
                    funcionando sin publicar tus datos.
                  </Text>
                  <View style={s.privacyChoices}>
                    <Pressable
                      onPress={() => updateProfileDraft({ isPublic: false })}
                      style={[
                        s.privacyChoice,
                        !editableProfile.isPublic && s.privacyChoiceActive,
                      ]}
                    >
                      <Text
                        style={[
                          s.privacyChoiceTitle,
                          !editableProfile.isPublic &&
                            s.privacyChoiceTitleActive,
                        ]}
                      >
                        Privado
                      </Text>
                      <Text
                        style={[
                          s.privacyChoiceText,
                          !editableProfile.isPublic &&
                            s.privacyChoiceTextActive,
                        ]}
                      >
                        Solo tú lo ves
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => updateProfileDraft({ isPublic: true })}
                      style={[
                        s.privacyChoice,
                        editableProfile.isPublic && s.privacyChoiceActive,
                      ]}
                    >
                      <Text
                        style={[
                          s.privacyChoiceTitle,
                          editableProfile.isPublic &&
                            s.privacyChoiceTitleActive,
                        ]}
                      >
                        Público
                      </Text>
                      <Text
                        style={[
                          s.privacyChoiceText,
                          editableProfile.isPublic && s.privacyChoiceTextActive,
                        ]}
                      >
                        Visible al participar
                      </Text>
                    </Pressable>
                  </View>
                  <View style={s.privacyNote}>
                    <Text style={s.privacyNoteTitle}>
                      {editableProfile.isPublic
                        ? 'Perfil público con control'
                        : 'Perfil privado'}
                    </Text>
                    <Text style={s.privacyNoteText}>
                      {editableProfile.isPublic
                        ? 'Tu foto, alias, biografía e intereses podrán mostrarse en los eventos. Rave global usa un permiso independiente y nunca publica tu punto exacto.'
                        : 'Tus datos no se muestran a otros usuarios. Rave global puede contar una zona aproximada sin publicar tu perfil.'}
                    </Text>
                  </View>
                </View>

                <View style={s.profileEditorCard}>
                  <Text style={s.profileSectionTitle}>
                    Cómo quieres conectar
                  </Text>
                  <Text style={s.profileSectionText}>
                    Elige cómo pueden encontrarte y conectar contigo únicamente
                    mientras compartes una sala.
                  </Text>
                  <View style={s.socialPreference}>
                    <View style={s.socialPreferenceCopy}>
                      <Text style={s.socialPreferenceTitle}>
                        Matchmaking en eventos
                      </Text>
                      <Text style={s.socialPreferenceText}>
                        Aparecer ante personas con intereses afines.
                      </Text>
                    </View>
                    <Switch
                      disabled={!editableProfile.isPublic}
                      value={editableProfile.allowMatchmaking}
                      onValueChange={allowMatchmaking =>
                        updateProfileDraft({ allowMatchmaking })
                      }
                      trackColor={{ false: '#CBD3D4', true: '#69CBD2' }}
                      thumbColor={
                        editableProfile.allowMatchmaking ? navy : '#F4F4F2'
                      }
                    />
                  </View>
                  <View style={s.socialPreference}>
                    <View style={s.socialPreferenceCopy}>
                      <Text style={s.socialPreferenceTitle}>
                        Mensajes de asistentes
                      </Text>
                      <Text style={s.socialPreferenceText}>
                        Permitir invitaciones a chats privados y grupos durante
                        el evento.
                      </Text>
                    </View>
                    <Switch
                      disabled={!editableProfile.isPublic}
                      value={editableProfile.allowMessages}
                      onValueChange={allowMessages =>
                        updateProfileDraft({ allowMessages })
                      }
                      trackColor={{ false: '#CBD3D4', true: '#69CBD2' }}
                      thumbColor={
                        editableProfile.allowMessages ? navy : '#F4F4F2'
                      }
                    />
                  </View>
                  <View style={s.socialPreference}>
                    <View style={s.socialPreferenceCopy}>
                      <Text style={s.socialPreferenceTitle}>
                        Aparecer en Rave global
                      </Text>
                      <Text style={s.socialPreferenceText}>
                        Usa la ubicación aproximada de este dispositivo mientras
                        estás en la sala. Nunca muestra tu punto exacto, nombre
                        ni perfil.
                      </Text>
                    </View>
                    <Switch
                      value={editableProfile.shareApproximateLocation}
                      onValueChange={shareApproximateLocation =>
                        updateProfileDraft({ shareApproximateLocation })
                      }
                      trackColor={{ false: '#CBD3D4', true: '#69CBD2' }}
                      thumbColor={
                        editableProfile.shareApproximateLocation
                          ? navy
                          : '#F4F4F2'
                      }
                    />
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Guardar mi perfil"
                  disabled={profileSaving}
                  onPress={() => void saveProfile()}
                  style={({ pressed }) => [
                    s.primary,
                    profileSaving && s.disabled,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={s.primaryText}>
                    {profileSaving ? 'Guardando…' : 'Guardar mi perfil'}
                  </Text>
                </Pressable>
                {profileMessage ? (
                  <View style={s.profileStatus}>
                    <Text style={s.profileStatusText}>{profileMessage}</Text>
                  </View>
                ) : null}

                <View
                  style={[
                    s.profileEditorCard,
                    !profileReadyForStory && s.socialDisabled,
                  ]}
                >
                  <View style={s.storyHeading}>
                    <View style={s.storyIcon}>
                      <Text style={s.storyIconText}>◉</Text>
                    </View>
                    <View style={s.storyHeadingCopy}>
                      <Text style={s.profileSectionTitle}>Mi Story</Text>
                      <Text style={s.profileSectionText}>
                        Comparte un estado durante 24 horas con las personas de
                        tu sala.
                      </Text>
                    </View>
                  </View>
                  {currentStory ? (
                    <View style={s.currentStory}>
                      {currentStory.mediaUrl ? (
                        <Image
                          source={{ uri: currentStory.mediaUrl }}
                          style={s.currentStoryImage}
                        />
                      ) : null}
                      <Text style={s.currentStoryLabel}>ACTIVO POR 24 H</Text>
                      {currentStory.text ? (
                        <Text style={s.currentStoryText}>
                          {currentStory.text}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  {profileReadyForStory &&
                  userProfile.gallery.some(photo => photo.mediaId) ? (
                    <>
                      <Text style={s.storyPhotoLabel}>FOTO · OPCIONAL</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={s.storyPhotoChoices}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Publicar Story sin foto"
                          onPress={() => setStoryMediaId('')}
                          style={[
                            s.storyPhotoNone,
                            !storyMediaId && s.storyPhotoSelected,
                          ]}
                        >
                          <Text style={s.storyPhotoNoneText}>Sin foto</Text>
                        </Pressable>
                        {userProfile.gallery
                          .filter(photo => photo.mediaId)
                          .map((photo, index) => (
                            <Pressable
                              key={photo.mediaId}
                              accessibilityRole="button"
                              accessibilityLabel={`Usar foto ${index + 1} en el Story`}
                              onPress={() => setStoryMediaId(photo.mediaId)}
                              style={[
                                s.storyPhotoChoice,
                                storyMediaId === photo.mediaId &&
                                  s.storyPhotoSelected,
                              ]}
                            >
                              <Image
                                source={{
                                  uri:
                                    photo.localUri ||
                                    photo.remoteUrl ||
                                    photo.dataUrl,
                                }}
                                style={s.storyPhotoImage}
                              />
                            </Pressable>
                          ))}
                      </ScrollView>
                    </>
                  ) : null}
                  <TextInput
                    accessibilityLabel="Texto del Story"
                    editable={profileReadyForStory}
                    value={storyText}
                    onChangeText={setStoryText}
                    maxLength={180}
                    multiline
                    textAlignVertical="top"
                    placeholder="¿Qué energía traes hoy?"
                    placeholderTextColor="#9AA3AF"
                    style={[s.profileField, s.storyInput]}
                  />
                  <Text style={s.profileCounter}>{storyText.length}/180</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!profileReadyForStory || storyBusy}
                    onPress={() => void publishMyStory()}
                    style={[
                      s.storyButton,
                      (!profileReadyForStory || storyBusy) && s.disabled,
                    ]}
                  >
                    <Text style={s.storyButtonText}>
                      {storyBusy ? 'Publicando…' : 'Publicar por 24 horas'}
                    </Text>
                  </Pressable>
                  {!accountSession ? (
                    <Text style={s.storyRequirement}>
                      Inicia sesión para publicar Stories.
                    </Text>
                  ) : !editableProfile.isPublic ? (
                    <Text style={s.storyRequirement}>
                      Activa el perfil público para compartirlo en una sala.
                    </Text>
                  ) : profileHasUnsavedChanges ? (
                    <Text style={s.storyRequirement}>
                      Guarda los cambios del perfil para activar el Story.
                    </Text>
                  ) : !profileSavedOnServer ? (
                    <Text style={s.storyRequirement}>
                      El perfil todavía no está sincronizado. Guárdalo
                      nuevamente con conexión a Internet.
                    </Text>
                  ) : isActive && !isProfilePublicInRoom ? (
                    <Text style={s.storyRequirement}>
                      Esperando que la sala confirme tu perfil público…
                    </Text>
                  ) : null}
                </View>

                <View style={s.profileFutureCard}>
                  <Text style={s.eyebrow}>COMUNIDAD QSESSION</Text>
                  <Text style={s.profileFutureTitle}>
                    Conectar con consentimiento
                  </Text>
                  <View style={s.profileFutureGrid}>
                    <View style={s.futureItem}>
                      <Text style={s.futureIcon}>◎</Text>
                      <Text style={s.futureText}>Afinidades</Text>
                    </View>
                    <View style={s.futureItem}>
                      <Text style={s.futureIcon}>✦</Text>
                      <Text style={s.futureText}>Conversaciones</Text>
                    </View>
                    <View style={s.futureItem}>
                      <Text style={s.futureIcon}>◉</Text>
                      <Text style={s.futureText}>Stories 24 h</Text>
                    </View>
                    <View style={s.futureItem}>
                      <Text style={s.futureIcon}>♥</Text>
                      <Text style={s.futureText}>Privacidad</Text>
                    </View>
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Abrir visión de Q Session"
                  onPress={() => setProjectVisionOpen(true)}
                  style={({pressed}) => [
                    s.projectVisionButton,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={s.projectVisionButtonMark}>
                    <Text style={s.projectVisionButtonMarkText}>◇</Text>
                  </View>
                  <View style={s.projectVisionButtonCopy}>
                    <Text style={s.projectVisionButtonLabel}>VISIÓN</Text>
                    <Text style={s.projectVisionButtonTitle}>
                      Hacer bailar al mundo entero
                    </Text>
                  </View>
                  <Text style={s.projectVisionButtonArrow}>›</Text>
                </Pressable>

                <Pressable onPress={closeProfile} style={s.profileBack}>
                  <Text style={s.profileBackText}>Volver</Text>
                </Pressable>
              </View>
            )}

            {!profileScreenOpen && !role && homeSection === 'live' && (
              <View style={s.homeStage}>
                <Image
                  source={worldNetwork}
                  style={s.homeStageWorldNetwork}
                  accessibilityIgnoresInvertColors
                />
                <View style={s.intro}>
                  <Text style={s.title}>
                    Tu sesión,{`\n`}
                    <Text style={s.titleAccent}>todos conectados.</Text>
                  </Text>
                  <Text style={s.subtitle}>
                    Q Session convierte cada teléfono en un receptor audiovisual en vivo.
                  </Text>
                </View>

                <View style={s.homeActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Entrar a una sala"
                    onPress={() => setRole('listener')}
                    style={({ pressed }) => [
                      s.homeAction,
                      s.homeActionPrimary,
                      pressed && s.pressed,
                    ]}
                  >
                    <View style={[s.homeActionIcon, s.homeActionIconPrimary]}>
                      <Text style={s.homeActionIconPrimaryText}>→</Text>
                    </View>
                    <View style={s.homeActionCopy}>
                      <Text style={[s.homeActionTitle, s.homeActionTitlePrimary]}>
                        Entrar a una sala
                      </Text>
                    </View>
                    <Text style={s.homeActionChevron}>⌄</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Crear una sala"
                    accessibilityState={{ expanded: createOptionsOpen }}
                    onPress={() => setCreateOptionsOpen(open => !open)}
                    style={({ pressed }) => [
                      s.homeAction,
                      s.homeActionSecondary,
                      createOptionsOpen && s.homeActionSecondaryOpen,
                      pressed && s.pressed,
                    ]}
                  >
                    <View style={[s.homeActionIcon, s.homeActionIconSecondary]}>
                      <Text style={s.homeActionIconSecondaryText}>+</Text>
                    </View>
                    <View style={s.homeActionCopy}>
                      <Text style={s.homeActionTitle}>Crear una sala</Text>
                    </View>
                    <Text style={s.homeActionChevronSecondary}>
                      {createOptionsOpen ? '⌃' : '⌄'}
                    </Text>
                  </Pressable>
                </View>

                {createOptionsOpen ? (
                  <View style={s.createOptionsCard}>
                    <View style={s.createOptionsHeading}>
                      <Text style={s.createOptionsEyebrow}>CREAR SESIÓN</Text>
                      <Text style={s.createOptionsTitle}>
                        ¿Cómo quieres transmitir?
                      </Text>
                    </View>
                    {roles
                      .filter(item => item.id !== 'listener')
                      .map(item => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={item.title}
                          key={item.id}
                          onPress={() => setRole(item.id)}
                          style={({ pressed }) => [
                            s.createOption,
                            pressed && s.pressed,
                          ]}
                        >
                          <View style={s.createOptionIcon}>
                            <Text style={s.createOptionIconText}>{item.icon}</Text>
                          </View>
                          <View style={s.copy}>
                            <Text style={s.cardTitle}>{item.title}</Text>
                            <Text style={s.cardText}>{item.text}</Text>
                          </View>
                          <Text style={s.arrow}>›</Text>
                        </Pressable>
                      ))}
                  </View>
                ) : null}

                <ActiveRoomsPanel
                  rooms={activeRooms}
                  loading={activeRoomsLoading}
                  onRefresh={() => void refreshActiveRooms()}
                  onJoin={joinActiveRoom}
                />
              </View>
            )}

            {!profileScreenOpen && !role && homeSection === 'people' ? (
              <InactivePeopleScreen
                onJoin={() => setRole('listener')}
                onActivity={openProfile}
              />
            ) : null}

            {!profileScreenOpen && !role && homeSection === 'chat' ? (
              <InactiveChatScreen onProfile={openProfile} />
            ) : null}

            {!profileScreenOpen && !role && homeSection === 'global' ? (
              <GlobalScreen snapshot={globalRave} />
            ) : null}

            {!profileScreenOpen && role === 'listener' && !isActive && (
              <>
                <View style={s.sectionTitle}>
                  <Text style={s.eyebrow}>MODO OYENTE</Text>
                  <Text style={s.titleSmall}>Entrar a una sala</Text>
                  <Text style={s.subtitle}>
                    Elige una forma de ingreso. QSession se encargará de localizar
                    la transmisión.
                  </Text>
                </View>
                <View style={s.entryCard}>
                  <Text style={s.label}>FORMA DE INGRESO</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Elegir forma de ingreso"
                    onPress={() => setEntryMenuOpen(open => !open)}
                    style={({ pressed }) => [
                      s.entrySelector,
                      entryMenuOpen && s.entrySelectorOpen,
                      pressed && s.pressed,
                    ]}
                  >
                    <View style={s.methodIcon}>
                      <Text style={s.methodIconText}>
                        {
                          entryMethods.find(item => item.id === entryMethod)
                            ?.icon
                        }
                      </Text>
                    </View>
                    <View style={s.methodCopy}>
                      <Text style={s.methodCaption}>SELECCIONADO</Text>
                      <Text style={s.methodTitle}>
                        {
                          entryMethods.find(item => item.id === entryMethod)
                            ?.title
                        }
                      </Text>
                    </View>
                    <Text style={s.chevron}>{entryMenuOpen ? '⌃' : '⌄'}</Text>
                  </Pressable>
                  {entryMenuOpen ? (
                    <View style={s.entryMenu}>
                      {entryMethods.map(item => (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={item.title}
                          onPress={() => selectEntryMethod(item.id)}
                          style={({ pressed }) => [
                            s.menuOption,
                            item.id === entryMethod && s.menuOptionActive,
                            pressed && s.pressed,
                          ]}
                        >
                          <View
                            style={[
                              s.menuIcon,
                              item.id === entryMethod && s.menuIconActive,
                            ]}
                          >
                            <Text style={s.menuIconText}>{item.icon}</Text>
                          </View>
                          <View style={s.menuCopy}>
                            <Text style={s.menuTitle}>{item.title}</Text>
                            <Text style={s.menuText}>{item.text}</Text>
                          </View>
                          {item.id === entryMethod ? (
                            <Text style={s.check}>✓</Text>
                          ) : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  <View style={s.methodPanel}>
                    {entryMethod === 'qr' ? (
                      <View style={s.qrIntro}>
                        <View style={s.qrMark}>
                          <Text style={s.qrMarkText}>▣</Text>
                        </View>
                        <Text style={s.methodPanelTitle}>
                          Escanea la invitación
                        </Text>
                        <Text style={s.methodPanelText}>
                          Apunta la cámara al QR que aparece en la pantalla del
                          organizador.
                        </Text>
                      </View>
                    ) : null}
                    {entryMethod === 'link' ? (
                      <>
                        <Text style={s.label}>ENLACE DE INVITACIÓN</Text>
                        <TextInput
                          accessibilityLabel="Enlace de invitación"
                          value={invite}
                          onChangeText={updateInvite}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          placeholder="https://qsession…/join/ABC123"
                          placeholderTextColor="#9AA3AF"
                          style={s.serverInput}
                        />
                        <Text style={s.hint}>
                          Pega el enlace completo; QSession obtendrá
                          automáticamente la sala.
                        </Text>
                      </>
                    ) : null}
                    {entryMethod === 'code' ? (
                      <>
                        <Text style={s.label}>CÓDIGO DE LA SALA</Text>
                        <TextInput
                          accessibilityLabel="Código de la sala"
                          value={code}
                          onChangeText={value =>
                            setCode(
                              value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                            )
                          }
                          maxLength={6}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          placeholder="ABC123"
                          placeholderTextColor="#9AA3AF"
                          style={s.codeInput}
                        />
                        <Text style={s.hint}>
                          Buscaremos primero la sala mundial en QSession y, si no
                          está allí, en tu red Wi-Fi.
                        </Text>
                      </>
                    ) : null}
                  </View>
                </View>
                {entryError ? (
                  <View style={s.errorBox}>
                    <Text style={s.errorText}>{entryError}</Text>
                  </View>
                ) : null}
                {connection === 'error' || connection === 'ended' ? (
                  <View style={s.errorBox}>
                    <Text style={s.errorText}>{detail}</Text>
                  </View>
                ) : null}
                {entryMethod !== 'qr' && !canConnect ? (
                  <Text style={s.missingText}>
                    {entryMethod === 'link'
                      ? 'Pega un enlace válido para continuar.'
                      : 'Escribe el código de seis caracteres para continuar.'}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    entryMethod === 'qr'
                      ? 'Escanear y conectar'
                      : 'Conectar y escuchar'
                  }
                  disabled={entryMethod === 'qr' ? scanning : !canConnect}
                  onPress={submitEntry}
                  style={({ pressed }) => [
                    s.primary,
                    (scanning || (entryMethod !== 'qr' && !canConnect)) &&
                      s.disabled,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={s.primaryText}>
                    {entryMethod === 'qr'
                      ? scanning
                        ? 'Abriendo cámara…'
                        : 'Escanear y conectar'
                      : 'Conectar y escuchar'}
                  </Text>
                </Pressable>
              </>
            )}

            {!profileScreenOpen && role === 'listener' && isActive && (
              <View style={s.liveScreen}>
                <MainNavigation
                  active={listenerView}
                  onChange={setListenerView}
                  unread={unreadChatCount}
                />

                {broadcastPlaybackUrl && listenerView !== 'live' && listenerView !== 'people' ? (
                  <Video
                    source={{uri: broadcastPlaybackUrl, type: 'm3u8', minLoadRetryCount: 10}}
                    resizeMode="contain"
                    volume={outputGain}
                    playInBackground
                    playWhenInactive
                    onLoad={() => {
                      setConnection('live');
                      setDetail('Señal distribuida recibida por la red de borde.');
                    }}
                    onError={fallbackBroadcastToWebRtc}
                    style={s.broadcastAudioOnly}
                  />
                ) : null}

                {listenerView === 'live' ? (
                  <>
                    <View style={s.liveCard}>
                      {broadcastPlaybackUrl || videoStreamURL ? (
                        <>
                          <View style={s.liveVideoFrame}>
                            {!videoFullscreen ? (
                              broadcastPlaybackUrl ? (
                                <Video
                                  source={{uri: broadcastPlaybackUrl, type: 'm3u8', minLoadRetryCount: 10}}
                                  resizeMode="cover"
                                  volume={outputGain}
                                  playInBackground
                                  playWhenInactive
                                  onLoad={() => {
                                    setConnection('live');
                                    setDetail('Señal distribuida recibida por la red de borde.');
                                  }}
                                  onError={fallbackBroadcastToWebRtc}
                                  style={s.liveVideo}
                                />
                              ) : (
                                <RTCView
                                  streamURL={videoStreamURL!}
                                  objectFit="cover"
                                  mirror={false}
                                  style={s.liveVideo}
                                />
                              )
                            ) : null}
                            <View style={s.liveVideoBadge}>
                              <Text style={s.liveVideoBadgeText}>
                                VIDEO EN VIVO
                              </Text>
                            </View>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Ver al DJ en pantalla completa"
                              hitSlop={8}
                              onPress={() => setVideoFullscreen(true)}
                              style={({ pressed }) => [
                                s.liveVideoFullscreenButton,
                                pressed && s.liveVideoFullscreenButtonPressed,
                              ]}
                            >
                              <Text style={s.liveVideoFullscreenIcon}>⛶</Text>
                            </Pressable>
                          </View>
                          <Text style={[s.eyebrow, s.liveVideoEyebrow]}>
                            SALA {code}
                          </Text>
                          <Text style={s.liveTitle}>
                            {roomInfo?.name || stateLabels[connection]}
                          </Text>
                          {roomInfo?.djName ? (
                            <Text style={s.liveDj}>Con {roomInfo.djName}</Text>
                          ) : null}
                        </>
                      ) : (
                        <QSessionLiveVisualizer
                          active={connection === 'live'}
                          brandIcon={liveBrandMark}
                          level={audioLevelMeter}
                        >
                          <Text style={s.eyebrow}>SALA {code}</Text>
                          <Text style={s.liveTitle}>
                            {roomInfo?.name || stateLabels[connection]}
                          </Text>
                          {roomInfo?.djName ? (
                            <Text style={s.liveDj}>Con {roomInfo.djName}</Text>
                          ) : null}
                        </QSessionLiveVisualizer>
                      )}
                      <RoomPromotions promotions={roomInfo?.promotions} server={server} />
                      <Text accessibilityLiveRegion="polite" style={s.detail}>
                        {detail}
                      </Text>
                      <View style={s.audioRoute}>
                        <Text style={s.audioRouteTitle}>Salida de audio</Text>
                        <Text style={s.audioRouteText}>
                          Normal conserva la señal original. Si tus auriculares
                          saturan, prueba primero -3 dB.
                        </Text>
                        <View style={s.outputOptions}>
                          {outputOptions.map(option => (
                            <Pressable
                              key={option.gain}
                              accessibilityRole="button"
                              accessibilityState={{
                                selected: outputGain === option.gain,
                              }}
                              accessibilityLabel={`${option.label} ${option.detail}`}
                              onPress={() => selectOutputGain(option.gain)}
                              style={({ pressed }) => [
                                s.outputOption,
                                outputGain === option.gain &&
                                  s.outputOptionActive,
                                pressed && s.pressed,
                              ]}
                            >
                              <Text
                                style={[
                                  s.outputOptionLabel,
                                  outputGain === option.gain &&
                                    s.outputOptionLabelActive,
                                ]}
                              >
                                {option.label}
                              </Text>
                              <Text
                                style={[
                                  s.outputOptionDetail,
                                  outputGain === option.gain &&
                                    s.outputOptionLabelActive,
                                ]}
                              >
                                {option.detail}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        {outputGain < 1 ? (
                          <Text style={s.outputWarning}>
                            Protección activa solo en este teléfono. La señal
                            original no se procesa ni se comprime.
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={s.liveFooter}>
                      <View>
                        <Text style={s.footerNumber}>{listenerCount}</Text>
                        <Text style={s.footerLabel}>oyentes en la sala</Text>
                      </View>
                      <View style={s.footerRight}>
                        <Text style={s.footerQuality}>Audio HD</Text>
                        <Text style={s.footerLabel}>
                          Distribución QSession · Opus estéreo
                        </Text>
                      </View>
                    </View>
                  </>
                ) : listenerView === 'people' ? (
                  <View style={s.peopleCard}>
                    <View style={s.peopleHeader}>
                      <View style={s.peopleHeaderCopy}>
                        <Text style={s.eyebrow}>PERSONAS EN ESTA SALA</Text>
                        <Text style={s.peopleTitle}>
                          Conecta durante el evento
                        </Text>
                        <Text style={s.peopleSubtitle}>
                          Aquí sólo aparecen quienes decidieron publicar su
                          perfil mientras están conectados.
                        </Text>
                      </View>
                      <View style={s.peopleCount}>
                        <Text style={s.peopleCountNumber}>
                          {publicParticipants.length}
                        </Text>
                        <Text style={s.peopleCountLabel}>visibles</Text>
                      </View>
                    </View>

                    <View style={s.socialCameraPanel}>
                      {communityUnavailableMessage ? (
                        <Text style={s.privateStatus}>
                          {communityUnavailableMessage}
                        </Text>
                      ) : null}
                      <View style={s.socialCameraHeader}>
                        <View style={s.socialCameraHeading}>
                          <Text style={s.socialCameraEyebrow}>
                            MODO SOCIAL · EN VIVO
                          </Text>
                          <Text style={s.socialCameraTitle}>
                            Baila con la sala
                          </Text>
                          <Text style={s.socialCameraText}>
                            Activa tu cámara frontal sólo cuando quieras
                            aparecer. El micrófono permanece apagado.
                          </Text>
                        </View>
                        <View
                          style={[
                            s.socialCameraState,
                            socialCameraEnabled && s.socialCameraStateLive,
                          ]}
                        >
                          <View
                            style={[
                              s.socialCameraStateDot,
                              socialCameraEnabled && s.socialCameraStateDotLive,
                            ]}
                          />
                          <Text
                            style={[
                              s.socialCameraStateText,
                              socialCameraEnabled &&
                                s.socialCameraStateTextLive,
                            ]}
                          >
                            {socialCameraEnabled ? 'VISIBLE' : 'PRIVADO'}
                          </Text>
                        </View>
                      </View>

                      {peopleVideoTiles.length ? (
                        <View style={s.socialVideoStrip}>
                          {peopleVideoTiles.map(video => (
                            <View
                              key={`${video.organizer ? 'organizer' : video.local ? 'self' : 'remote'}-${
                                video.participantId
                              }`}
                              style={[
                                s.socialVideoTile,
                                video.organizer && s.socialVideoOrganizerTile,
                              ]}
                            >
                              {!video.streamURL ? (
                                primaryProfilePhotoUri ? <Image source={{uri: primaryProfilePhotoUri}} style={s.socialVideoMedia} resizeMode="contain" />
                                : <View style={[s.socialVideoMedia, {alignItems:'center',justifyContent:'center'}]}><Text style={s.profileAvatarInitial}>{profileInitial}</Text></View>
                              ) : video.hls ? (
                                <Video
                                  source={{uri: video.streamURL, type: 'm3u8', minLoadRetryCount: 10}}
                                  resizeMode="contain"
                                  volume={outputGain}
                                  playInBackground
                                  playWhenInactive
                                  onLoad={() => {
                                    setConnection('live');
                                    setDetail('Señal distribuida recibida por la red de borde.');
                                  }}
                                  onError={fallbackBroadcastToWebRtc}
                                  style={s.socialVideoMedia}
                                />
                              ) : (
                                <RTCView
                                  streamURL={video.streamURL}
                                  objectFit="contain"
                                  mirror={video.local}
                                  style={s.socialVideoMedia}
                                />
                              )}
                              <View style={s.socialVideoShade} />
                              <View style={s.socialVideoLive}>
                                <View style={s.socialVideoLiveDot} />
                                <Text style={s.socialVideoLiveText}>
                                  {video.organizer ? 'DJ · EN VIVO' : video.local ? 'TÚ' : 'EN VIVO'}
                                </Text>
                              </View>
                              <Text numberOfLines={1} style={s.socialVideoName}>
                                {video.displayName}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <View style={s.socialVideoEmpty}>
                          <View style={s.socialVideoEmptyOrbit}>
                            <Image
                              source={liveBrandMark}
                              style={s.socialVideoEmptyLogo}
                            />
                          </View>
                          <View style={s.socialVideoEmptyCopy}>
                            <Text style={s.socialVideoEmptyTitle}>
                              El mosaico espera a la comunidad
                            </Text>
                            <Text style={s.socialVideoEmptyText}>
                              Las cámaras aparecerán aquí únicamente por
                              decisión de cada oyente.
                            </Text>
                          </View>
                        </View>
                      )}

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          socialCameraEnabled
                            ? 'Apagar mi cámara social'
                            : 'Activar mi cámara frontal'
                        }
                        disabled={socialCameraBusy}
                        onPress={() => void toggleSocialCamera()}
                        style={({ pressed }) => [
                          s.socialCameraButton,
                          socialCameraEnabled && s.socialCameraButtonStop,
                          socialCameraBusy && s.disabled,
                          pressed && s.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            s.socialCameraButtonIcon,
                            socialCameraEnabled && s.socialCameraButtonIconStop,
                          ]}
                        >
                          {socialCameraEnabled ? '■' : '◉'}
                        </Text>
                        <Text
                          style={[
                            s.socialCameraButtonText,
                            socialCameraEnabled && s.socialCameraButtonTextStop,
                          ]}
                        >
                          {socialCameraBusy
                            ? 'Preparando…'
                            : socialCameraEnabled
                            ? 'Apagar mi cámara'
                            : 'Activar mi cámara frontal'}
                        </Text>
                      </Pressable>
                      {socialCameraMessage ? (
                        <Text style={s.socialCameraMessage}>
                          {socialCameraMessage}
                        </Text>
                      ) : null}
                      <Text style={s.socialCameraPrivacy}>
                        Sólo personas dentro de esta sala pueden recibir el
                        mosaico. QSession la apaga al salir de la app.
                      </Text>
                    </View>

                    {isProfilePublicInRoom &&
                    selfParticipant?.canMatch === true &&
                    matchmakingProfiles.length ? (
                      <View style={s.matchmakingPanel}>
                        <View style={s.matchmakingHeading}>
                          <Text style={s.matchmakingEyebrow}>MATCHMAKING</Text>
                          <Text style={s.matchmakingTitle}>
                            Posibles conexiones
                          </Text>
                          <Text style={s.matchmakingText}>
                            Sugerencias privadas basadas únicamente en intereses
                            compartidos.
                          </Text>
                        </View>
                        <View style={s.matchmakingList}>
                          {matchmakingProfiles.slice(0, 4).map(match => (
                            <Pressable
                              key={match.participant.id}
                              accessibilityRole="button"
                              onPress={() => openDirectChat(match.participant)}
                              style={s.matchmakingRow}
                            >
                              <View style={s.matchmakingAvatar}>
                                {match.participant.avatarUrl ? (
                                  <Image
                                    source={{
                                      uri: match.participant.avatarUrl,
                                    }}
                                    style={s.matchmakingAvatarImage}
                                  />
                                ) : (
                                  <Text style={s.matchmakingAvatarText}>
                                    {match.participant.displayName
                                      .slice(0, 1)
                                      .toUpperCase()}
                                  </Text>
                                )}
                              </View>
                              <View style={s.matchmakingCopy}>
                                <Text style={s.matchmakingName}>
                                  {match.participant.displayName}
                                </Text>
                                <Text
                                  numberOfLines={1}
                                  style={s.matchmakingShared}
                                >
                                  {match.sharedInterests.join(' · ')}
                                </Text>
                              </View>
                              <View style={s.matchmakingScore}>
                                <Text style={s.matchmakingScoreNumber}>
                                  {match.sharedInterests.length}
                                </Text>
                                <Text style={s.matchmakingScoreLabel}>
                                  afinidades
                                </Text>
                              </View>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={openProfile}
                        style={s.matchmakingNotice}
                      >
                        <Text style={s.matchmakingNoticeIcon}>✦</Text>
                        <View style={s.matchmakingNoticeCopy}>
                          <Text style={s.matchmakingNoticeTitle}>
                            Encuentra personas afines
                          </Text>
                          <Text style={s.matchmakingNoticeText}>
                            {isProfilePublicInRoom &&
                            selfParticipant?.canMatch === true
                              ? 'Agrega intereses a tu perfil para descubrir coincidencias.'
                              : profileHasUnsavedChanges
                              ? 'Guarda los cambios de tu perfil para activar Matchmaking en esta sala.'
                              : 'Publica tu perfil y activa Matchmaking para recibir sugerencias dentro de la sala.'}
                          </Text>
                        </View>
                        <Text style={s.matchmakingNoticeArrow}>›</Text>
                      </Pressable>
                    )}

                    <View style={s.peopleDirectoryHeader}>
                      <Text style={s.peopleDirectoryTitle}>
                        Perfiles publicados
                      </Text>
                      <Text style={s.peopleDirectoryCount}>
                        {publicParticipants.length}
                      </Text>
                    </View>
                    {peopleContactStatus ? (
                      <Text style={s.peopleContactStatus}>{peopleContactStatus}</Text>
                    ) : null}
                    <View style={s.peopleList}>
                      {!publicParticipants.length ? (
                        <View style={s.peopleEmpty}>
                          <Text style={s.peopleEmptyIcon}>◎</Text>
                          <Text style={s.peopleEmptyTitle}>
                            Todavía no hay perfiles públicos
                          </Text>
                          <Text style={s.peopleEmptyText}>
                            Los oyentes privados no aparecen aquí. Puedes
                            publicar el tuyo desde Perfil cuando quieras.
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            onPress={openProfile}
                            style={s.peopleEmptyButton}
                          >
                            <Text style={s.peopleEmptyButtonText}>
                              Revisar mi perfil
                            </Text>
                          </Pressable>
                        </View>
                      ) : (
                        publicParticipants.map(participant => {
                          const isSelf = participant.id === selfListenerId;
                          const isSuggested = matchmakingIds.has(
                            participant.id,
                          );
                          const story = participant.stories?.at(-1);
                          return (
                            <View
                              key={participant.id}
                              style={[
                                s.personCard,
                                isSuggested && s.personCardSuggested,
                              ]}
                            >
                              <View style={s.personTop}>
                                <View
                                  style={[
                                    s.personAvatar,
                                    story && s.personAvatarStory,
                                  ]}
                                >
                                  {participant.avatarUrl ? (
                                    <Image
                                      source={{ uri: participant.avatarUrl }}
                                      style={s.personAvatarImage}
                                    />
                                  ) : (
                                    <Text style={s.personAvatarText}>
                                      {participant.displayName
                                        .slice(0, 1)
                                        .toUpperCase()}
                                    </Text>
                                  )}
                                </View>
                                <View style={s.personIdentity}>
                                  <View style={s.personNameLine}>
                                    <Text
                                      numberOfLines={1}
                                      style={s.personName}
                                    >
                                      {participant.displayName}
                                    </Text>
                                    {isSelf ? (
                                      <Text style={s.personSelf}>TÚ</Text>
                                    ) : null}
                                    {isSuggested ? (
                                      <Text style={s.personMatch}>
                                        AFINIDAD
                                      </Text>
                                    ) : null}
                                    {story ? (
                                      <Text style={s.personStoryBadge}>
                                        STORY
                                      </Text>
                                    ) : null}
                                  </View>
                                  {participant.city ? (
                                    <Text style={s.personCity}>
                                      ⌖ {participant.city}
                                    </Text>
                                  ) : (
                                    <Text style={s.personCity}>
                                      En esta sala ahora
                                    </Text>
                                  )}
                                </View>
                              </View>
                              {participant.bio ? (
                                <Text style={s.personBio}>
                                  {participant.bio}
                                </Text>
                              ) : null}
                              {story ? (
                                <View style={s.personStory}>
                                  {story.mediaUrl ? (
                                    <Image
                                      source={{ uri: story.mediaUrl }}
                                      style={s.personStoryImage}
                                    />
                                  ) : null}
                                  <View style={s.personStoryCopy}>
                                    <Text style={s.personStoryLabel}>
                                      AHORA
                                    </Text>
                                    {story.text ? (
                                      <Text style={s.personStoryText}>
                                        {story.text}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                              ) : null}
                              {(participant.photos || []).length > 1 ? (
                                <ScrollView
                                  horizontal
                                  showsHorizontalScrollIndicator={false}
                                  contentContainerStyle={s.personGallery}
                                >
                                  {(participant.photos || [])
                                    .slice(0, 6)
                                    .map((photo, photoIndex) => (
                                      <Image
                                        key={photo.id || photo.url}
                                        accessibilityLabel={`Foto ${
                                          photoIndex + 1
                                        } de ${participant.displayName}`}
                                        source={{ uri: photo.url }}
                                        style={s.personGalleryImage}
                                      />
                                    ))}
                                </ScrollView>
                              ) : null}
                              {participant.interests.length ? (
                                <View style={s.personInterests}>
                                  {participant.interests.map(interest => (
                                    <View
                                      key={`${participant.id}-${interest}`}
                                      style={[
                                        s.personInterest,
                                        ownInterestKeys.has(
                                          interest.toLocaleLowerCase(),
                                        ) &&
                                          participant.canMatch &&
                                          s.personInterestShared,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          s.personInterestText,
                                          ownInterestKeys.has(
                                            interest.toLocaleLowerCase(),
                                          ) &&
                                            participant.canMatch &&
                                            s.personInterestTextShared,
                                        ]}
                                      >
                                        {interest}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                              {!isSelf && isProfilePublicInRoom ? (
                                <View style={s.personContactActions}>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Enviar un toque a ${participant.displayName}`}
                                    disabled={!participant.canMatch}
                                    onPress={() => void sendContactGesture(participant, 'touch')}
                                    style={[s.personContactAction, !participant.canMatch && s.disabled]}
                                  ><Text style={s.personContactActionText}>◎ Toque</Text></Pressable>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Enviar una flor a ${participant.displayName}`}
                                    onPress={() => void sendContactGesture(participant, 'gift', 'flower')}
                                    style={s.personContactAction}
                                  ><Text style={s.personContactActionText}>🌸 Flor</Text></Pressable>
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Enviar una estrella a ${participant.displayName}`}
                                    onPress={() => void sendContactGesture(participant, 'gift', 'star')}
                                    style={s.personContactAction}
                                  ><Text style={s.personContactActionText}>⭐ Estrella</Text></Pressable>
                                </View>
                              ) : null}
                              {!isSelf && participant.canMessage ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Abrir chat con ${participant.displayName}`}
                                  onPress={() => openDirectChat(participant)}
                                  style={s.personChatButton}
                                >
                                  <Text style={s.personChatButtonText}>
                                    Abrir chat privado
                                  </Text>
                                  <Text style={s.personChatArrow}>›</Text>
                                </Pressable>
                              ) : null}
                            </View>
                          );
                        })
                      )}
                    </View>
                  </View>
                ) : listenerView === 'global' ? (
                  <GlobalScreen snapshot={globalRave} />
                ) : (
                  <View style={s.communityCard}>
                    <View style={s.communityHeader}>
                      <View style={s.communityHeaderCopy}>
                        <Text style={s.eyebrow}>COMUNIDAD</Text>
                        <Text style={s.communityTitle}>Chat</Text>
                        <Text style={s.communitySubtitle}>
                          Texto, notas de voz y Chat en vivo con las personas
                          que elijas.
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={openProfile}
                        style={s.profileButton}
                      >
                        <Text style={s.profileButtonText}>
                          {userProfile.displayName
                            ? 'Editar perfil'
                            : 'Crear perfil'}
                        </Text>
                      </Pressable>
                    </View>
                    <View style={s.chatSections} accessibilityRole="tablist">
                      <Pressable
                        accessibilityRole="tab"
                        accessibilityState={{
                          selected: chatSection === 'room',
                        }}
                        onPress={() => {
                          setChatSection('room');
                          setActivePrivateChatId('');
                          setPrivateStatus('');
                        }}
                        style={[
                          s.chatSectionButton,
                          chatSection === 'room' && s.chatSectionButtonActive,
                        ]}
                      >
                        <Text
                          style={[
                            s.chatSectionText,
                            chatSection === 'room' && s.chatSectionTextActive,
                          ]}
                        >
                          Sala
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="tab"
                        accessibilityState={{
                          selected: chatSection === 'private',
                        }}
                        onPress={() => setChatSection('private')}
                        style={[
                          s.chatSectionButton,
                          chatSection === 'private' &&
                            s.chatSectionButtonActive,
                        ]}
                      >
                        <Text
                          style={[
                            s.chatSectionText,
                            chatSection === 'private' &&
                              s.chatSectionTextActive,
                          ]}
                        >
                          Privados
                        </Text>
                        {pendingPrivateChats > 0 ? (
                          <View style={s.pendingBadge}>
                            <Text style={s.pendingBadgeText}>
                              {pendingPrivateChats}
                            </Text>
                          </View>
                        ) : null}
                      </Pressable>
                    </View>

                    {chatSection === 'room' ? (
                      <>
                        <View style={s.roomChatIntro}>
                          <Text style={s.roomChatTitle}>Chat de la sala</Text>
                          <Text style={s.roomChatText}>
                            Todos los oyentes pueden leer y participar.
                          </Text>
                        </View>
                        <View style={s.roomAudioPanel}>
                          <View style={s.roomAudioHeading}>
                            <View style={s.roomAudioMark}><Text style={s.roomAudioMarkText}>Q</Text></View>
                            <View style={s.roomAudioCopy}>
                              <Text style={s.roomAudioTitle}>Hablar con la sala y el DJ</Text>
                              <Text style={s.roomAudioText}>Sólo audio: la cámara no está disponible en el chat general.</Text>
                            </View>
                          </View>
                          <View style={s.roomAudioActions}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{selected: !roomChatMicEnabled && !roomChatPushActive}}
                              onPress={() => void setRoomChatMicrophone(false)}
                              style={[s.roomAudioButton, !roomChatMicEnabled && !roomChatPushActive && s.roomAudioButtonActive]}
                            >
                              <Text style={s.roomAudioButtonText}>Silenciado</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{selected: roomChatMicEnabled && !roomChatPushActive}}
                              onPress={() => void setRoomChatMicrophone(true)}
                              style={[s.roomAudioButton, roomChatMicEnabled && !roomChatPushActive && s.roomAudioButtonActive]}
                            >
                              <Text style={s.roomAudioButtonText}>Micro abierto</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              onPressIn={() => void startRoomChatPushToTalk()}
                              onPressOut={() => void stopRoomChatPushToTalk()}
                              style={[s.roomAudioButton, roomChatPushActive && s.roomAudioButtonActive]}
                            >
                              <Text style={s.roomAudioButtonText}>Mantén para hablar</Text>
                            </Pressable>
                          </View>
                          <Text style={s.roomAudioStatus}>{roomChatMediaStatus}</Text>
                        </View>
                        <View style={s.chatPeoplePanel}>
                          <View style={s.chatPeopleHeading}>
                            <View style={s.chatPeopleSignal} />
                            <Text style={s.chatPeopleTitle}>
                              {publicParticipants.length} {publicParticipants.length === 1 ? 'persona activa' : 'personas activas'}
                            </Text>
                          </View>
                          <TextInput
                            accessibilityLabel="Buscar persona activa"
                            value={chatPeopleQuery}
                            onChangeText={setChatPeopleQuery}
                            placeholder="Buscar nombre o contacto"
                            placeholderTextColor="#78909C"
                            style={s.chatPeopleSearch}
                          />
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chatPeopleList}>
                            {chatPeople.length ? chatPeople.map(participant => (
                              <Pressable
                                key={participant.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Abrir chat con ${participant.displayName}`}
                                disabled={participant.id === selfListenerId || !participant.canMessage}
                                onPress={() => openDirectChat(participant)}
                                style={[s.chatPerson, participant.id === selfListenerId && s.chatPersonSelf]}
                              >
                                <View style={s.chatPersonAvatar}><Text style={s.chatPersonAvatarText}>{participant.displayName.slice(0, 1).toUpperCase()}</Text></View>
                                <Text numberOfLines={1} style={s.chatPersonName}>{participant.id === selfListenerId ? 'Tú' : participant.displayName}</Text>
                                <Text style={s.chatPersonAction}>{participant.id === selfListenerId ? 'Activo' : participant.canMessage ? 'Mensaje' : 'Disponible'}</Text>
                              </Pressable>
                            )) : <Text style={s.chatPeopleEmpty}>No encontramos ese nombre entre las personas activas.</Text>}
                          </ScrollView>
                        </View>
                        <View style={s.reactionRow}>
                          {['🔥', '👏', '💙', '🎶'].map(reaction => (
                            <Pressable
                              key={reaction}
                              accessibilityRole="button"
                              accessibilityLabel={`Reaccionar ${reaction}`}
                              onPress={() => sendReaction(reaction)}
                              style={s.reactionButton}
                            >
                              <Text style={s.reactionText}>{reaction}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <View style={s.chatIdentity}>
                          <View
                            style={[
                              s.chatIdentityDot,
                              isProfilePublicInRoom &&
                                s.chatIdentityDotPublic,
                            ]}
                          />
                          <Text style={s.chatIdentityText}>
                            {isProfilePublicInRoom && userProfile.displayName
                              ? `Participas como ${userProfile.displayName}`
                              : 'Participas de forma privada como Oyente'}
                          </Text>
                        </View>
                        <View style={s.messages}>
                          {!messages.length ? (
                            <Text style={s.emptyChat}>
                              Aún no hay mensajes. Puedes ser el primero.
                            </Text>
                          ) : (
                            messages.slice(-30).map(message => (
                              <View
                                key={message.id}
                                style={[
                                  s.message,
                                  message.kind === 'reaction' &&
                                    s.reactionMessage,
                                ]}
                              >
                                <View style={s.messageCopy}>
                                  <Text style={s.messageAuthor}>
                                    {message.author || 'Oyente'}
                                  </Text>
                                  <Text style={s.messageText}>
                                    {message.text}
                                  </Text>
                                </View>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Denunciar mensaje de ${
                                    message.author || 'oyente'
                                  }`}
                                  onPress={() => reportMessage(message.id)}
                                  hitSlop={8}
                                >
                                  <Text style={s.reportIcon}>⚑</Text>
                                </Pressable>
                              </View>
                            ))
                          )}
                        </View>
                        <View style={s.chatComposer}>
                          <TextInput
                            accessibilityLabel="Mensaje"
                            value={chatText}
                            onChangeText={setChatText}
                            onSubmitEditing={sendChat}
                            returnKeyType="send"
                            maxLength={600}
                            placeholder="Escribe un mensaje…"
                            placeholderTextColor="#9AA3AF"
                            style={s.chatInput}
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Enviar mensaje"
                            onPress={sendChat}
                            style={s.chatSend}
                          >
                            <Text style={s.chatSendText}>Enviar</Text>
                          </Pressable>
                        </View>
                      </>
                    ) : activePrivateChat ? (
                      <>
                        <View style={s.privateConversationHeader}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Volver a conversaciones privadas"
                            onPress={() => {
                              setActivePrivateChatId('');
                              setPrivateStatus('');
                            }}
                            style={s.privateBackButton}
                          >
                            <Text style={s.privateBackText}>‹</Text>
                          </Pressable>
                          <View style={s.privateConversationCopy}>
                            <Text style={s.privateConversationTitle}>
                              {activePrivateChat.title}
                            </Text>
                            <Text style={s.privateConversationMembers}>
                              {activePrivateChat.kind === 'group'
                                ? `${activePrivateChat.members.length} integrantes`
                                : 'Conversación privada'}
                            </Text>
                          </View>
                        </View>
                        {activePrivateChat.status === 'pending' ? (
                          <View style={s.privateInvitation}>
                            <Text style={s.privateInvitationEyebrow}>
                              INVITACIÓN PRIVADA
                            </Text>
                            <Text style={s.privateInvitationTitle}>
                              Te invitaron a{' '}
                              {activePrivateChat.kind === 'group'
                                ? 'un grupo'
                                : 'conversar'}
                              .
                            </Text>
                            <Text style={s.privateInvitationText}>
                              Sólo quienes acepten podrán leer y escribir en
                              esta conversación.
                            </Text>
                            <View style={s.privateActions}>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => respondPrivateChat(false)}
                                style={s.privateDecline}
                              >
                                <Text style={s.privateDeclineText}>
                                  Rechazar
                                </Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => respondPrivateChat(true)}
                                style={s.privateAccept}
                              >
                                <Text style={s.privateAcceptText}>Aceptar</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <>
                            <View style={s.privateMemberStrip}>
                              {activePrivateChat.members
                                .filter(member => member.status === 'accepted')
                                .map(member => (
                                  <View
                                    key={member.id}
                                    style={s.privateMemberChip}
                                  >
                                    <View
                                      style={[
                                        s.privateMemberDot,
                                        member.online &&
                                          s.privateMemberDotOnline,
                                      ]}
                                    />
                                    <Text
                                      numberOfLines={1}
                                      style={s.privateMemberName}
                                    >
                                      {member.id === selfListenerId
                                        ? 'Tú'
                                        : member.displayName}
                                    </Text>
                                  </View>
                                ))}
                            </View>
                            <View style={s.liveChatPanel}>
                              <View style={s.liveChatHeading}>
                                <View style={s.liveChatMark}><Text style={s.liveChatMarkText}>Q</Text></View>
                                <View style={s.liveChatCopy}>
                                  <Text style={s.liveChatEyebrow}>VIDEOLLAMADA PRIVADA</Text>
                                  <Text style={s.liveChatTitle}>Véanse y hablen como si estuvieran cerca</Text>
                                  <Text style={s.liveChatDetail}>
                                    {liveChatState.chatId === activePrivateChat.id && liveChatState.status === 'live'
                                      ? `${liveChatState.micEnabled ? 'Micrófono abierto' : 'Micrófono silenciado'} · ${liveChatState.participants} conectados`
                                      : activePrivateChat.liveVoiceEnabled
                                        ? 'El grupo ya está conversando. Entra cuando quieras.'
                                        : 'Sólo entran quienes aceptaron esta conversación.'}
                                  </Text>
                                </View>
                              </View>
                              {liveChatState.chatId === activePrivateChat.id && liveChatState.status === 'live' ? (
                                <>
                                  {liveChatVideos.length ? (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.liveChatVideos}>
                                      {liveChatVideos.map(video => (
                                        <View key={video.participantId} style={s.liveChatVideoTile}>
                                          <RTCView streamURL={video.streamURL} mirror={Boolean(video.local)} objectFit="contain" style={s.liveChatVideo} />
                                          <Text style={s.liveChatVideoName}>{video.displayName}</Text>
                                        </View>
                                      ))}
                                    </ScrollView>
                                  ) : null}
                                  <View style={s.liveChatControls}>
                                    <Pressable accessibilityRole="button" onPress={() => void toggleLiveChatCamera()} style={[s.liveChatControlSecondary, liveChatState.cameraEnabled && s.liveChatControlActive]}>
                                      <Text style={s.liveChatControlSecondaryText}>{liveChatState.cameraEnabled ? 'Apagar cámara' : 'Cámara'}</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" onPress={() => void setLiveChatMicrophone(false)} style={[s.liveChatControlSecondary, !liveChatState.micEnabled && s.liveChatControlActive]}>
                                      <Text style={s.liveChatControlSecondaryText}>Silenciado</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" onPress={() => void setLiveChatMicrophone(true)} style={[s.liveChatControlPrimary, liveChatState.micEnabled && s.liveChatControlActive]}>
                                      <Text style={s.liveChatControlPrimaryText}>Micro abierto</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" onPressIn={() => void startLiveChatPushToTalk()} onPressOut={() => void stopLiveChatPushToTalk()} style={s.liveChatControlSecondary}>
                                      <Text style={s.liveChatControlSecondaryText}>Mantén para hablar</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" onPress={() => clientRef.current?.setLiveChatSoundEnabled(!liveChatState.soundEnabled)} style={s.liveChatControlSecondary}>
                                      <Text style={s.liveChatControlSecondaryText}>{liveChatState.soundEnabled ? 'Silenciar audio' : 'Escuchar audio'}</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" onPress={() => clientRef.current?.leaveLiveChat()} style={s.liveChatLeave}>
                                      <Text style={s.liveChatLeaveText}>Salir</Text>
                                    </Pressable>
                                  </View>
                                </>
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  disabled={liveChatState.chatId === activePrivateChat.id && liveChatState.status === 'connecting'}
                                  onPress={() => void enterLiveChat()}
                                  style={s.liveChatEnter}
                                >
                                  <Text style={s.liveChatEnterText}>
                                    {liveChatState.chatId === activePrivateChat.id && liveChatState.status === 'connecting'
                                      ? 'Conectando…'
                                      : activePrivateChat.liveVoiceEnabled ? 'Entrar al chat en vivo' : 'Iniciar chat en vivo'}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                            <View style={s.messages}>
                              {!activePrivateChat.messages.length ? (
                                <Text style={s.emptyChat}>
                                  Esta conversación es privada. Escribe el
                                  primer mensaje.
                                </Text>
                              ) : (
                                activePrivateChat.messages
                                  .slice(-50)
                                  .map(message => (
                                    <View
                                      key={message.id}
                                      style={[
                                        s.message,
                                        message.senderId === selfListenerId &&
                                          s.privateMessageOwn,
                                      ]}
                                    >
                                      <View style={s.messageCopy}>
                                        <Text style={s.messageAuthor}>
                                          {message.senderId === selfListenerId
                                            ? 'Tú'
                                            : message.author}
                                        </Text>
                                        {message.kind === 'voice' && message.audio ? (
                                          <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Reproducir nota de voz"
                                            onPress={() => void playVoiceMessage(message)}
                                            style={s.voiceMessageButton}
                                          >
                                            <Text style={s.voiceMessageIcon}>{playingVoiceMessageId === message.id ? '■' : '▶'}</Text>
                                            <View style={s.voiceMessageCopy}>
                                              <Text style={[s.voiceMessageTitle, message.senderId === selfListenerId && s.voiceMessageTitleOwn]}>
                                                {playingVoiceMessageId === message.id ? 'Reproduciendo…' : 'Nota de voz'}
                                              </Text>
                                              <Text style={[s.voiceMessageDuration, message.senderId === selfListenerId && s.voiceMessageDurationOwn]}>
                                                {Math.max(1, Math.round(message.audio.durationMs / 1000))} s
                                              </Text>
                                            </View>
                                          </Pressable>
                                        ) : (
                                          <Text style={s.messageText}>{message.text}</Text>
                                        )}
                                      </View>
                                    </View>
                                  ))
                              )}
                            </View>
                            <View style={s.chatComposer}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={voiceRecording ? 'Detener y enviar nota de voz' : 'Grabar nota de voz'}
                                onPress={() => void toggleVoiceRecording()}
                                style={[s.voiceRecordButton, voiceRecording && s.voiceRecordButtonActive]}
                              >
                                <Text style={[s.voiceRecordButtonText, voiceRecording && s.voiceRecordButtonTextActive]}>{voiceRecording ? '■' : '●'}</Text>
                              </Pressable>
                              <TextInput
                                accessibilityLabel="Mensaje privado"
                                value={privateChatText}
                                onChangeText={setPrivateChatText}
                                onSubmitEditing={sendPrivateMessage}
                                returnKeyType="send"
                                maxLength={600}
                                placeholder="Escribe en privado…"
                                placeholderTextColor="#9AA3AF"
                                style={s.chatInput}
                              />
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Enviar mensaje privado"
                                onPress={sendPrivateMessage}
                                style={s.chatSend}
                              >
                                <Text style={s.chatSendText}>Enviar</Text>
                              </Pressable>
                            </View>
                          </>
                        )}
                        {privateStatus ? (
                          <Text style={s.privateStatus}>{privateStatus}</Text>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <View style={s.privateLandingHeader}>
                          <View style={s.privateLandingCopy}>
                            <Text style={s.roomChatTitle}>
                              Audio chat privado
                            </Text>
                            <Text style={s.roomChatText}>
                              Envía notas de voz o conversa en vivo con una
                              persona o con el grupo que elijas.
                            </Text>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              setPrivateSetupOpen(current => !current);
                              setPrivateStatus('');
                            }}
                            style={s.privateNewButton}
                          >
                            <Text style={s.privateNewText}>
                              {privateSetupOpen ? 'Cerrar' : '+ Nuevo'}
                            </Text>
                          </Pressable>
                        </View>
                        {privateSetupOpen ? (
                          <View style={s.privateSetup}>
                            <Text style={s.privateSetupTitle}>
                              Nuevo chat privado
                            </Text>
                            <Text style={s.privateSetupText}>
                              Selecciona una persona para un chat directo o
                              varias para crear un grupo.
                            </Text>
                            <View style={s.privateInviteBox}>
                              <Text style={s.privateInviteEyebrow}>CONTACTO PRIVADO</Text>
                              <Text style={s.privateInviteTitle}>Enlace, código o QR</Text>
                              <Text style={s.privateInviteText}>Un perfil privado no aparece en la lista. El primer contacto se autoriza con una invitación de un solo uso.</Text>
                              <View style={s.privateInviteActions}>
                                <Pressable accessibilityRole="button" disabled={privateInviteBusy} onPress={() => void createPrivateContactInvite()} style={s.privateInvitePrimary}>
                                  <Text style={s.privateInvitePrimaryText}>{privateInviteBusy ? 'Espera…' : 'Generar invitación'}</Text>
                                </Pressable>
                                {privateInviteCode ? (
                                  <Pressable accessibilityRole="button" onPress={sharePrivateContactInvite} style={s.privateInviteSecondary}>
                                    <Text style={s.privateInviteSecondaryText}>Compartir</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                              {privateInviteCode ? (
                                <View style={s.privateInviteResult}>
                                  <Text style={s.privateInviteCode}>{privateInviteCode}</Text>
                                  <Text numberOfLines={1} style={s.privateInviteLink}>{privateInviteUrl}</Text>
                                </View>
                              ) : null}
                              <TextInput
                                accessibilityLabel="Código de contacto privado"
                                value={privateInviteInput}
                                onChangeText={value => setPrivateInviteInput(normalizePrivateContactInviteCode(value))}
                                autoCapitalize="characters"
                                maxLength={8}
                                placeholder="Código de 8 caracteres"
                                placeholderTextColor="#78909C"
                                style={s.privateInviteInput}
                              />
                              <View style={s.privateInviteActions}>
                                <Pressable accessibilityRole="button" disabled={privateInviteBusy} onPress={() => void redeemPrivateContactInvite()} style={s.privateInvitePrimary}>
                                  <Text style={s.privateInvitePrimaryText}>Conectar</Text>
                                </Pressable>
                                <Pressable accessibilityRole="button" disabled={privateInviteBusy} onPress={() => void scanPrivateContactInvite()} style={s.privateInviteSecondary}>
                                  <Text style={s.privateInviteSecondaryText}>Escanear QR</Text>
                                </Pressable>
                              </View>
                            </View>
                            {availablePrivateParticipants.length ? (
                              <>
                                <View style={s.participantChoices}>
                                  {availablePrivateParticipants.map(
                                    participant => {
                                      const selected =
                                        selectedPrivateMembers.includes(
                                          participant.id,
                                        );
                                      return (
                                        <Pressable
                                          key={participant.id}
                                          accessibilityRole="checkbox"
                                          accessibilityState={{
                                            checked: selected,
                                          }}
                                          onPress={() =>
                                            togglePrivateMember(participant.id)
                                          }
                                          style={[
                                            s.participantChoice,
                                            selected &&
                                              s.participantChoiceSelected,
                                          ]}
                                        >
                                          <View
                                            style={[
                                              s.participantAvatar,
                                              selected &&
                                                s.participantAvatarSelected,
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                s.participantAvatarText,
                                                selected &&
                                                  s.participantAvatarTextSelected,
                                              ]}
                                            >
                                              {participant.displayName
                                                .slice(0, 1)
                                                .toUpperCase()}
                                            </Text>
                                          </View>
                                          <Text
                                            numberOfLines={1}
                                            style={[
                                              s.participantChoiceText,
                                              selected &&
                                                s.participantChoiceTextSelected,
                                            ]}
                                          >
                                            {participant.displayName}
                                          </Text>
                                          <Text
                                            style={[
                                              s.participantCheck,
                                              selected &&
                                                s.participantCheckSelected,
                                            ]}
                                          >
                                            {selected ? '✓' : '+'}
                                          </Text>
                                        </Pressable>
                                      );
                                    },
                                  )}
                                </View>
                                {selectedPrivateMembers.length > 1 ? (
                                  <TextInput
                                    accessibilityLabel="Nombre del grupo"
                                    value={privateGroupTitle}
                                    onChangeText={setPrivateGroupTitle}
                                    maxLength={60}
                                    placeholder="Nombre del grupo · opcional"
                                    placeholderTextColor="#9AA3AF"
                                    style={s.privateGroupInput}
                                  />
                                ) : null}
                                <Pressable
                                  accessibilityRole="button"
                                  onPress={createPrivateChat}
                                  style={[
                                    s.privateCreateButton,
                                    !selectedPrivateMembers.length &&
                                      s.disabled,
                                  ]}
                                  disabled={!selectedPrivateMembers.length}
                                >
                                  <Text style={s.privateCreateText}>
                                    {selectedPrivateMembers.length > 1
                                      ? `Crear grupo (${
                                          selectedPrivateMembers.length + 1
                                        })`
                                      : 'Abrir chat'}
                                  </Text>
                                </Pressable>
                              </>
                            ) : (
                              <Text style={s.privateEmptyText}>
                                {privateChatAvailabilityMessage ||
                                  'No hay personas disponibles. Cada participante decide si acepta invitaciones desde su perfil.'}
                              </Text>
                            )}
                            {!isProfilePublicInRoom || !canMessageInRoom ? (
                              <Pressable
                                accessibilityRole="button"
                                onPress={openProfile}
                                style={s.privateProfileNotice}
                              >
                                <Text style={s.privateProfileNoticeText}>
                                  {privateChatAvailabilityMessage}
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                        <View style={s.privateList}>
                          {!privateChats.length ? (
                            <View style={s.privateEmpty}>
                              <Text style={s.privateEmptyIcon}>◎</Text>
                              <Text style={s.privateEmptyTitle}>
                                Tus chats aparecerán aquí
                              </Text>
                              <Text style={s.privateEmptyText}>
                                Son cerrados y sólo participan las personas que
                                aceptan la invitación.
                              </Text>
                            </View>
                          ) : (
                            privateChats.map(chat => (
                              <Pressable
                                key={chat.id}
                                accessibilityRole="button"
                                onPress={() => {
                                  setActivePrivateChatId(chat.id);
                                  setPrivateStatus('');
                                }}
                                style={[
                                  s.privateChatRow,
                                  chat.status === 'pending' &&
                                    s.privateChatRowPending,
                                ]}
                              >
                                <View style={s.privateChatIcon}>
                                  <Text style={s.privateChatIconText}>
                                    {chat.kind === 'group' ? '●●' : '●'}
                                  </Text>
                                </View>
                                <View style={s.privateChatCopy}>
                                  <Text
                                    numberOfLines={1}
                                    style={s.privateChatTitle}
                                  >
                                    {chat.title}
                                  </Text>
                                  <Text
                                    numberOfLines={1}
                                    style={s.privateChatPreview}
                                  >
                                    {chat.status === 'pending'
                                      ? 'Invitación pendiente'
                                      : (chat.messages.at(-1)?.kind === 'voice' ? 'Nota de voz' : chat.messages.at(-1)?.text) ||
                                        'Conversación lista'}
                                  </Text>
                                </View>
                                {chat.status === 'pending' ? (
                                  <View style={s.privatePendingPill}>
                                    <Text style={s.privatePendingPillText}>
                                      NUEVA
                                    </Text>
                                  </View>
                                ) : (
                                  <Text style={s.privateChatArrow}>›</Text>
                                )}
                              </Pressable>
                            ))
                          )}
                        </View>
                        {privateStatus ? (
                          <Text style={s.privateStatus}>{privateStatus}</Text>
                        ) : null}
                      </>
                    )}
                  </View>
                )}
                <Pressable
                  onPress={disconnect}
                  style={({ pressed }) => [s.stopButton, pressed && s.pressed]}
                >
                  <Text style={s.stopText}>Salir de la sala</Text>
                </Pressable>
              </View>
            )}

            {!profileScreenOpen &&
              (role === 'dj' || role === 'organizer') &&
              !isBroadcasting && (
                <>
                  <View style={s.sectionTitle}>
                    <Text style={s.eyebrow}>
                      {role === 'dj' ? 'MODO DJ' : 'MODO ORGANIZADOR'}
                    </Text>
                    <Text style={s.titleSmall}>Transmitir desde Android</Text>
                    <Text style={s.subtitle}>
                      Usa el micrófono o una interfaz USB reconocida por
                      Android. Para aplicaciones o archivos del computador,
                      utiliza el panel web del PC.
                    </Text>
                  </View>
                  <View style={s.hostCard}>
                    <View style={s.mobileSource}>
                      <View style={s.mobileSourceIcon}>
                        <Text style={s.mobileSourceIconText}>●</Text>
                      </View>
                      <View style={s.mobileSourceCopy}>
                        <Text style={s.mobileSourceTitle}>
                          Micrófono o entrada USB
                        </Text>
                        <Text style={s.mobileSourceText}>
                          Audio HD sin cancelación de voz
                        </Text>
                      </View>
                    </View>
                    <View style={s.broadcastSetupStack}>
                      <View style={s.broadcastDisclosure}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{expanded: broadcastSetupSection === 'type'}}
                          onPress={() => setBroadcastSetupSection(current => current === 'type' ? null : 'type')}
                          style={({pressed}) => [s.broadcastDisclosureHeader, pressed && s.pressed]}
                        >
                          <View style={s.broadcastDisclosureIcon}><Text style={s.broadcastDisclosureIconText}>✦</Text></View>
                          <View style={s.broadcastDisclosureCopy}>
                            <Text style={s.broadcastDisclosureTitle}>Tipo de sesión</Text>
                            <Text style={s.broadcastDisclosureState}>{ROOM_PRESETS[broadcastRoomType].label}</Text>
                          </View>
                          <Text style={s.broadcastDisclosureChevron}>{broadcastSetupSection === 'type' ? '⌃' : '⌄'}</Text>
                        </Pressable>
                        {broadcastSetupSection === 'type' ? (
                          <View style={s.broadcastDisclosureBody}>
                            <View style={s.broadcastRoomTypes}>
                              {CREATABLE_ROOM_KINDS.map(kind => {
                                const selected = broadcastRoomType === kind;
                                return (
                                  <Pressable
                                    key={kind}
                                    accessibilityRole="button"
                                    accessibilityState={{selected}}
                                    onPress={() => {
                                      setBroadcastRoomType(kind);
                                      setBroadcastFeatures(roomFeaturesFor(kind));
                                      setBroadcastExperience(roomExperienceFor(kind));
                                    }}
                                    style={({pressed}) => [s.broadcastRoomType, selected && s.broadcastRoomTypeActive, pressed && s.pressed]}
                                  >
                                    <Text style={[s.broadcastRoomTypeText, selected && s.broadcastRoomTypeTextActive]}>{ROOM_PRESETS[kind].label}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                            <Text style={s.broadcastRoomTypeDescription}>{ROOM_PRESETS[broadcastRoomType].description}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={s.broadcastDisclosure}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{expanded: broadcastSetupSection === 'experience'}}
                          onPress={() => setBroadcastSetupSection(current => current === 'experience' ? null : 'experience')}
                          style={({pressed}) => [s.broadcastDisclosureHeader, pressed && s.pressed]}
                        >
                          <View style={s.broadcastDisclosureIcon}><Text style={s.broadcastDisclosureIconText}>◈</Text></View>
                          <View style={s.broadcastDisclosureCopy}>
                            <Text style={s.broadcastDisclosureTitle}>Experiencia y diseño</Text>
                            <Text style={s.broadcastDisclosureState}>{roomExperienceOptions.filter(option => broadcastExperience[option.key]).length} herramientas</Text>
                          </View>
                          <Text style={s.broadcastDisclosureChevron}>{broadcastSetupSection === 'experience' ? '⌃' : '⌄'}</Text>
                        </Pressable>
                        {broadcastSetupSection === 'experience' ? (
                          <View style={s.broadcastDisclosureBody}>
                            <Text style={s.broadcastExperienceTitle}>{ROOM_EXPERIENCE_PRESETS[broadcastRoomType].title}</Text>
                            <Text style={s.broadcastRoomTypeDescription}>{ROOM_EXPERIENCE_PRESETS[broadcastRoomType].detail}</Text>
                            <Text style={s.label}>ESTILO VISUAL</Text>
                            <View style={s.broadcastRoomTypes}>
                              {roomDesignThemes.map(theme => {
                                const selected = broadcastExperience.designTheme === theme.value;
                                return <Pressable key={theme.value} onPress={() => setBroadcastExperience(current => ({...current, designTheme: theme.value}))} style={({pressed}) => [s.broadcastRoomType, selected && s.broadcastRoomTypeActive, pressed && s.pressed]}><Text style={[s.broadcastRoomTypeText, selected && s.broadcastRoomTypeTextActive]}>{theme.label}</Text></Pressable>;
                              })}
                            </View>
                            <Text style={s.label}>MOVIMIENTO VISUAL</Text>
                            <View style={s.broadcastRoomTypes}>
                              {roomDesignMotions.map(motion => {
                                const selected = broadcastExperience.designMotion === motion.value;
                                return <Pressable key={motion.value} onPress={() => setBroadcastExperience(current => ({...current, designMotion: motion.value}))} style={({pressed}) => [s.broadcastRoomType, selected && s.broadcastRoomTypeActive, pressed && s.pressed]}><Text style={[s.broadcastRoomTypeText, selected && s.broadcastRoomTypeTextActive]}>{motion.label}</Text></Pressable>;
                              })}
                            </View>
                            <View style={s.broadcastFeaturePanel}>
                              {roomExperienceOptions.map(option => {
                                const enabled = ROOM_EXPERIENCE_PRESETS[broadcastRoomType].allowedTools.includes(option.key);
                                return (
                                  <View key={option.key} style={[s.broadcastFeatureRow, !enabled && s.broadcastFeatureRowDisabled]}>
                                    <View style={s.broadcastFeatureCopy}><Text style={s.broadcastFeatureLabel}>{option.label}</Text><Text style={s.broadcastFeatureDetail}>{option.detail}</Text></View>
                                    <Switch disabled={!enabled} value={enabled && broadcastExperience[option.key] === true} onValueChange={value => setBroadcastExperience(current => ({...current, [option.key]: value}))} trackColor={{false: '#CCD9DA', true: aqua}} thumbColor={broadcastExperience[option.key] ? navy : '#F4F6F6'} />
                                  </View>
                                );
                              })}
                              {broadcastExperience.allowVideoSubmissions ? roomVideoExperienceOptions.map(option => (
                                <View key={option.key} style={s.broadcastFeatureRow}>
                                  <View style={s.broadcastFeatureCopy}><Text style={s.broadcastFeatureLabel}>{option.label}</Text><Text style={s.broadcastFeatureDetail}>{option.detail}</Text></View>
                                  <Switch value={broadcastExperience[option.key] === true} onValueChange={value => setBroadcastExperience(current => ({...current, [option.key]: value}))} trackColor={{false: '#CCD9DA', true: aqua}} thumbColor={broadcastExperience[option.key] ? navy : '#F4F6F6'} />
                                </View>
                              )) : null}
                            </View>
                          </View>
                        ) : null}
                      </View>

                      <View style={s.broadcastDisclosure}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{expanded: broadcastSetupSection === 'features'}}
                          onPress={() => setBroadcastSetupSection(current => current === 'features' ? null : 'features')}
                          style={({pressed}) => [s.broadcastDisclosureHeader, pressed && s.pressed]}
                        >
                          <View style={s.broadcastDisclosureIcon}><Text style={s.broadcastDisclosureIconText}>◎</Text></View>
                          <View style={s.broadcastDisclosureCopy}>
                            <Text style={s.broadcastDisclosureTitle}>Funciones de la sala</Text>
                            <Text style={s.broadcastDisclosureState}>{Object.values(broadcastFeatures).filter(Boolean).length} activas</Text>
                          </View>
                          <Text style={s.broadcastDisclosureChevron}>{broadcastSetupSection === 'features' ? '⌃' : '⌄'}</Text>
                        </Pressable>
                        {broadcastSetupSection === 'features' ? (
                          <View style={s.broadcastDisclosureBody}>
                            <View style={s.broadcastFeaturePanel}>
                              {roomFeatureOptions.map(option => (
                                <View key={option.key} style={s.broadcastFeatureRow}>
                                  <View style={s.broadcastFeatureCopy}>
                                    <Text style={s.broadcastFeatureLabel}>{option.label}</Text>
                                    <Text style={s.broadcastFeatureDetail}>{option.detail}</Text>
                                  </View>
                                  <Switch
                                    value={broadcastFeatures[option.key]}
                                    onValueChange={value => setBroadcastFeatures(current => ({...current, [option.key]: value}))}
                                    trackColor={{false: '#CCD9DA', true: aqua}}
                                    thumbColor={broadcastFeatures[option.key] ? navy : '#F4F6F6'}
                                  />
                                </View>
                              ))}
                            </View>
                          </View>
                        ) : null}
                      </View>

                      <View style={s.broadcastDisclosure}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{expanded: broadcastSetupSection === 'details'}}
                          onPress={() => setBroadcastSetupSection(current => current === 'details' ? null : 'details')}
                          style={({pressed}) => [s.broadcastDisclosureHeader, pressed && s.pressed]}
                        >
                          <View style={s.broadcastDisclosureIcon}><Text style={s.broadcastDisclosureIconText}>＋</Text></View>
                          <View style={s.broadcastDisclosureCopy}>
                            <Text style={s.broadcastDisclosureTitle}>Datos del evento</Text>
                            <Text numberOfLines={1} style={s.broadcastDisclosureState}>{broadcastName.trim() || 'Opcional'}</Text>
                          </View>
                          <Text style={s.broadcastDisclosureChevron}>{broadcastSetupSection === 'details' ? '⌃' : '⌄'}</Text>
                        </Pressable>
                        {broadcastSetupSection === 'details' ? (
                          <View style={s.broadcastDisclosureBody}>
                            <Text style={s.label}>NOMBRE DEL EVENTO · OPCIONAL</Text>
                            <TextInput value={broadcastName} onChangeText={setBroadcastName} maxLength={80} placeholder="Ej. Noche en la terraza" placeholderTextColor="#9AA3AF" style={s.hostInput} />
                            <Text style={s.label}>DJ O ANFITRIÓN · OPCIONAL</Text>
                            <TextInput value={broadcastDj} onChangeText={setBroadcastDj} maxLength={60} placeholder="Ej. DJ Patricio" placeholderTextColor="#9AA3AF" style={s.hostInput} />
                            <Text style={s.broadcastRoomTypeDescription}>El código y el enlace se crean automáticamente para web, celular y computador.</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                  <View style={s.broadcastRightsCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{expanded: broadcastRightsOpen}}
                      onPress={() => setBroadcastRightsOpen(current => !current)}
                      style={({pressed}) => [s.broadcastRightsHeader, pressed && s.pressed]}
                    >
                      <View style={s.broadcastRightsIcon}><Text style={s.broadcastRightsIconText}>♪</Text></View>
                      <View style={s.broadcastRightsHeading}>
                        <Text style={s.broadcastRightsEyebrow}>ANTES DE SALIR AL AIRE</Text>
                        <Text style={s.broadcastRightsTitle}>Tu música, tus derechos</Text>
                        <Text style={[s.broadcastRightsState, broadcastRightsAccepted && s.broadcastRightsStateAccepted]}>
                          {broadcastRightsAccepted ? 'Aceptado' : 'Revisar y aceptar'}
                        </Text>
                      </View>
                      <Text style={s.broadcastDisclosureChevron}>{broadcastRightsOpen ? '⌃' : '⌄'}</Text>
                    </Pressable>
                    {broadcastRightsOpen ? (
                      <View style={s.broadcastRightsBody}>
                        <Text style={s.broadcastRightsWelcome}>
                          <Text style={s.broadcastRightsWelcomeStrong}>Queremos cuidar tu obra y la de otros artistas. </Text>
                          Lee esta declaración y confirma que puedes compartir el contenido de tu sesión.
                        </Text>
                        <Text style={s.broadcastRightsLegal}>
                          El anfitrión reconoce que la señal puede implicar captura, reproducción temporal, codificación, transcodificación, sincronización, comunicación y transmisión digital. Antes de iniciar deberá contar con los derechos, licencias, permisos, cesiones y autorizaciones aplicables sobre composiciones, letras, fonogramas o másteres, interpretaciones, arreglos, remixes, samples, imágenes, videos y demás contenidos, para el territorio, duración, audiencia y modalidad elegidos. QSession provee infraestructura tecnológica y no concede licencias musicales al anfitrión ni adquiere la titularidad de sus contenidos.
                        </Text>
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{checked: broadcastRightsAccepted}}
                          onPress={() => setBroadcastRightsAccepted(current => !current)}
                          style={({pressed}) => [s.broadcastRightsCheck, broadcastRightsAccepted && s.broadcastRightsCheckAccepted, pressed && s.pressed]}
                        >
                          <View style={[s.broadcastRightsCheckbox, broadcastRightsAccepted && s.broadcastRightsCheckboxAccepted]}>
                            <Text style={s.broadcastRightsCheckboxText}>{broadcastRightsAccepted ? '✓' : ''}</Text>
                          </View>
                          <Text style={s.broadcastRightsCheckText}>
                            <Text style={s.broadcastRightsCheckStrong}>Declaro y acepto expresamente que la música proyectada, transmitida, reproducida o incorporada a esta sesión es de mi propiedad, o que dispongo de las licencias y autorizaciones suficientes para utilizarla en QSession. </Text>
                            Confirmo que esta información es veraz y autorizo el registro de la fecha, la cuenta y la versión de mi aceptación.
                          </Text>
                        </Pressable>
                        <Text style={s.broadcastRightsFootnote}>Esta declaración no reemplaza asesoría jurídica.</Text>
                      </View>
                    ) : null}
                  </View>
                  {broadcastState === 'error' ? (
                    <View style={s.errorBox}>
                      <Text style={s.errorText}>{broadcastDetail}</Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => void startMobileBroadcast()}
                    style={({ pressed }) => [s.primary, pressed && s.pressed]}
                  >
                    <Text style={s.primaryText}>Iniciar transmisión móvil</Text>
                  </Pressable>
                  <View style={s.version}>
                    <Text style={s.versionTitle}>
                      ¿Quieres transmitir música del PC?
                    </Text>
                    <Text style={s.versionText}>
                      Abre QSession Studio en tu computador y utiliza el selector
                      de fuente, el control de nivel o un archivo autorizado.
                    </Text>
                  </View>
                </>
              )}

            {!profileScreenOpen &&
              (role === 'dj' || role === 'organizer') &&
              isBroadcasting && (
                <View style={s.liveScreen}>
                  <View style={s.liveCard}>
                    <View style={s.pulse}>
                      <Image source={brandIcon} style={s.pulseLogo} />
                    </View>
                    <Text style={s.eyebrow}>
                      {broadcastRoom
                        ? `SALA ${broadcastRoom.code}`
                        : 'PREPARANDO SALA'}
                    </Text>
                    <Text style={s.liveTitle}>
                      {broadcastRoom?.name ||
                        (broadcastState === 'live'
                          ? 'En vivo'
                          : 'Preparando señal')}
                    </Text>
                    <View style={s.wave}>
                      {[13, 27, 38, 23, 35, 26, 13].map((height, index) => (
                        <View key={index} style={[s.waveBar, { height }]} />
                      ))}
                    </View>
                    <Text style={s.detail}>{broadcastDetail}</Text>
                    {broadcastRoom?.joinUrl ? (
                      <>
                        <Image
                          source={{
                            uri: `${httpBaseFromServer(
                              PROFILE_SERVER,
                            )}/api/rooms/${
                              broadcastRoom.code
                            }/qr.png?url=${encodeURIComponent(
                              broadcastRoom.joinUrl,
                            )}`,
                          }}
                          style={s.hostQr}
                        />
                        <Text style={s.hostRoomCode}>{broadcastRoom.code}</Text>
                        <Pressable
                          onPress={shareBroadcast}
                          style={s.shareButton}
                        >
                          <Text style={s.shareButtonText}>
                            Compartir invitación
                          </Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                  <View style={s.liveFooter}>
                    <View>
                      <Text style={s.footerNumber}>{listenerCount}</Text>
                      <Text style={s.footerLabel}>oyentes conectados</Text>
                    </View>
                    <View>
                      <Text style={s.footerQuality}>Audio HD</Text>
                      <Text style={s.footerLabel}>
                        Micrófono / USB · Distribución QSession
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={stopMobileBroadcast}
                    style={({ pressed }) => [
                      s.stopButton,
                      pressed && s.pressed,
                    ]}
                  >
                    <Text style={s.stopText}>Finalizar transmisión</Text>
                  </Pressable>
                </View>
              )}
            <Text style={s.appVersionLabel}>
              Q Session Android · v{playback?.appVersion || '0.1.39'}
            </Text>
          </ScrollView>
          {!profileScreenOpen && !role ? (
            <View style={s.mainNavDock}>
              <MainNavigation
                active={homeSection}
                onChange={setHomeSection}
                unread={unreadChatCount}
              />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

function App() {
  return (
    <QSessionLanguageProvider>
      <QSessionApp />
    </QSessionLanguageProvider>
  );
}

// Estos son los mismos tokens visuales definidos en platform/public/styles.css.
// Android e iOS comparten este archivo y, por tanto, la misma identidad de la web.
const navy = '#102746',
  navy2 = '#173B5D',
  aqua = '#67CDD1',
  aquaSoft = '#E4F5F3',
  cream = '#F7F4EE',
  white = '#FFFEFD',
  gray = '#7899A9',
  border = '#D6E2E2';
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: cream },
  appVersionLabel: {
    marginTop: 28,
    marginBottom: 8,
    color: 'rgba(49,90,112,.42)',
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: .7,
    textAlign: 'center',
  },
  projectVisionOverlay: {flex: 1, padding: 12, justifyContent: 'center', backgroundColor: 'rgba(8,31,55,.64)'},
  projectVisionSheet: {position: 'relative', width: '100%', maxHeight: '94%', overflow: 'hidden', borderWidth: 1, borderColor: '#CFE0E0', borderRadius: 28, backgroundColor: white},
  projectVisionClose: {position: 'absolute', zIndex: 2, top: 14, right: 14, width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#365F77', borderRadius: 19, backgroundColor: '#1B3D5B'},
  projectVisionCloseText: {color: white, fontSize: 25, lineHeight: 27},
  projectVisionScroll: {width: '100%'},
  projectVisionContent: {padding: 24, paddingTop: 28, paddingBottom: 30},
  projectVisionLogo: {width: 52, height: 52, marginBottom: 20, borderRadius: 15},
  projectVisionEyebrow: {color: '#318895', fontSize: 9, fontWeight: '900', letterSpacing: 1.7},
  projectVisionTitle: {maxWidth: 330, marginTop: 9, marginBottom: 12, color: navy, fontSize: 38, fontWeight: '900', letterSpacing: -1.5, lineHeight: 39},
  projectVisionLead: {maxWidth: 330, color: '#244766', fontSize: 18, fontWeight: '600', lineHeight: 24},
  projectVisionQuote: {marginTop: 17, color: '#4D7890', fontSize: 13, fontStyle: 'italic'},
  projectVisionWorldCard: {height: 155, marginTop: 22, overflow: 'hidden', borderWidth: 1, borderColor: '#E1EAE9', borderRadius: 20, backgroundColor: cream},
  projectVisionWorldImage: {width: '100%', height: '100%', resizeMode: 'cover'},
  projectVisionPrinciples: {marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
  projectVisionPrincipleCard: {width: '48.5%', minHeight: 148, marginTop: 10, padding: 13, borderWidth: 1, borderColor: '#D9E7E6', borderRadius: 18, backgroundColor: '#FBFDFC'},
  projectVisionCardIcon: {width: 38, height: 38, borderRadius: 19, color: '#13527A', backgroundColor: '#EAF4F4', fontSize: 19, lineHeight: 38, textAlign: 'center'},
  projectVisionCardTitle: {marginTop: 10, color: navy, fontSize: 13, fontWeight: '900', lineHeight: 16},
  projectVisionCardText: {marginTop: 5, color: '#607D8E', fontSize: 11, lineHeight: 16},
  projectVisionTechnology: {marginTop: 26, marginHorizontal: -24, padding: 24, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E1EAE9', backgroundColor: '#F2F8F7'},
  projectVisionSectionTitle: {marginTop: 8, marginBottom: 10, color: navy, fontSize: 27, fontWeight: '900', letterSpacing: -1, lineHeight: 29},
  projectVisionText: {color: '#4D6F81', fontSize: 13, lineHeight: 20},
  projectVisionSignal: {marginTop: 20, alignItems: 'center'},
  projectVisionSignalSource: {width: '100%', padding: 12, borderWidth: 1, borderColor: '#CAE0E2', borderRadius: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: white},
  projectVisionSignalIcon: {width: 46, height: 46, marginRight: 10, borderRadius: 23, color: aqua, backgroundColor: navy, fontSize: 20, lineHeight: 46, textAlign: 'center'},
  projectVisionSignalTitle: {color: '#315A70', fontSize: 11, fontWeight: '900'},
  projectVisionSignalLive: {alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', color: navy, backgroundColor: aqua, fontSize: 7, fontWeight: '900'},
  projectVisionSignalLine: {height: 29, color: '#31B2C2', fontSize: 25, lineHeight: 29},
  projectVisionSignalCore: {width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: white, shadowColor: navy, shadowOpacity: .12, shadowRadius: 15, elevation: 3},
  projectVisionSignalCoreMark: {color: '#24AEC1', fontSize: 27, fontWeight: '900', lineHeight: 29},
  projectVisionSignalCoreText: {color: navy, fontSize: 9, fontWeight: '900'},
  projectVisionFeatureRow: {width: '100%', marginTop: 15, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
  projectVisionFeatureChip: {width: '48.5%', minHeight: 38, marginTop: 7, paddingHorizontal: 9, borderRadius: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: '#E5F3F3'},
  projectVisionFeatureDot: {marginRight: 6, color: '#24AEC1', fontSize: 20},
  projectVisionFeatureText: {flex: 1, color: '#315D73', fontSize: 10, fontWeight: '800'},
  projectVisionUses: {paddingTop: 28},
  projectVisionUseCard: {minHeight: 72, marginTop: 8, padding: 12, borderWidth: 1, borderColor: '#D9E7E6', borderRadius: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FBFDFC'},
  projectVisionUseNumber: {width: 38, height: 38, marginRight: 11, borderRadius: 19, color: '#1D647D', backgroundColor: '#EAF4F4', fontSize: 10, fontWeight: '900', lineHeight: 38, textAlign: 'center'},
  projectVisionUseCopy: {flex: 1},
  projectVisionUseTitle: {color: navy, fontSize: 13, fontWeight: '900'},
  projectVisionUseText: {marginTop: 3, color: '#607D8E', fontSize: 11, lineHeight: 16},
  projectVisionManifesto: {marginTop: 26, padding: 20, borderRadius: 22, backgroundColor: navy},
  projectVisionManifestoTitle: {color: white, fontSize: 24, fontWeight: '900', letterSpacing: -.8, lineHeight: 27},
  projectVisionManifestoText: {marginTop: 11, color: '#D1E1E6', fontSize: 12, lineHeight: 19},
  projectVisionManifestoTagline: {marginTop: 18, color: aqua, fontSize: 9, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase'},
  page: {
    flexGrow: 1,
    paddingHorizontal: 16,
    // The root view already begins below Android's opaque status bar. Adding
    // StatusBar.currentHeight here created a second inset that the web UI does
    // not have.
    paddingTop: Platform.OS === 'android' ? 7 : 9,
    paddingBottom: 24,
  },
  pageWithMainNav: {paddingBottom: 14},
  header: {minHeight: 58, flexDirection: 'row', alignItems: 'center'},
  brand: { flexDirection: 'row', alignItems: 'center' },
  brandCopy: { marginLeft: 9 },
  headerBackButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16,39,70,.11)',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,.78)',
  },
  headerBackText: {color: '#315A70', fontSize: 11, fontWeight: '800'},
  headerActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  languageButton: {
    minWidth: 48,
    height: 40,
    paddingHorizontal: 10,
    flexDirection: 'row',
    gap: 5,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(16, 39, 70, 0.1)',
    backgroundColor: white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageButtonChevron: {color: '#3B929A', fontSize: 11, fontWeight: '900'},
  languageButtonText: {
    color: navy,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  logoImage: {width: 39, height: 39, borderRadius: 11, resizeMode: 'cover'},
  logoText: {color: navy, fontSize: 15, lineHeight: 18, fontWeight: '800'},
  headerLiveButton: {
    position: 'relative',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: navy,
    borderWidth: 3,
    borderColor: white,
    shadowColor: navy,
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  headerLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: aqua,
  },
  headerLiveCount: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#3A8E98',
  },
  headerLiveCountText: {
    color: white,
    fontSize: 7,
    fontWeight: '900',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#EEE8E2',
  },
  badgeLive: { backgroundColor: '#E2F5F1' },
  badgeError: { backgroundColor: '#FDE9E7' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#69CBD2',
    marginRight: 6,
  },
  badgeText: { fontSize: 9, letterSpacing: 1, color: navy, fontWeight: '800' },
  profileShortcut: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: white,
    borderWidth: 2,
    borderColor: '#D7E4E3',
  },
  profileShortcutAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileShortcutImage: {width: 34, height: 34, resizeMode: 'cover'},
  profileShortcutInitial: { color: white, fontSize: 13, fontWeight: '800' },
  profileShortcutText: {
    color: navy,
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 7,
  },
  homeStage: {
    position: 'relative',
    overflow: 'hidden',
    marginTop: 13,
    marginHorizontal: 6,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 39, 70, 0.08)',
    borderRadius: 27,
    backgroundColor: 'rgba(255, 254, 253, 0.92)',
    shadowColor: navy,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.1,
    shadowRadius: 30,
    elevation: 4,
  },
  homeStageWorldNetwork: {
    position: 'absolute',
    left: -62,
    top: -10,
    width: 430,
    height: 270,
    resizeMode: 'contain',
    opacity: 0.43,
  },
  intro: {
    position: 'relative',
    paddingHorizontal: 1,
    paddingTop: 6,
  },
  heroSignal: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(228, 245, 243, 0.94)',
  },
  heroSignalDot: {
    width: 8,
    height: 8,
    marginRight: 7,
    borderRadius: 4,
    backgroundColor: aqua,
  },
  heroSignalText: {
    color: '#347784',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.25,
  },
  eyebrow: {
    color: '#7690A7',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '800',
  },
  title: {
    color: navy,
    fontSize: 42,
    lineHeight: 41,
    fontWeight: '800',
    letterSpacing: -1.7,
    marginTop: 0,
    textAlign: 'center',
  },
  titleAccent: {color: gray, fontWeight: '500'},
  titleSmall: {
    color: navy,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    marginTop: 10,
  },
  subtitle: {
    color: gray,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 14,
    alignSelf: 'center',
    textAlign: 'center',
    maxWidth: 280,
  },
  homeActions: {
    zIndex: 2,
    flexDirection: 'row',
    gap: 8,
    marginTop: 11,
  },
  homeAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 55,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: 15,
    shadowColor: navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 3,
  },
  homeActionPrimary: {
    borderColor: 'rgba(103, 205, 209, 0.38)',
    backgroundColor: navy2,
  },
  homeActionSecondary: {
    borderColor: 'rgba(53, 143, 151, 0.3)',
    backgroundColor: '#F8FCFB',
  },
  homeActionSecondaryOpen: { borderColor: aqua, backgroundColor: aquaSoft },
  homeActionIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  homeActionIconPrimary: { backgroundColor: aqua },
  homeActionIconSecondary: { backgroundColor: navy },
  homeActionIconPrimaryText: { color: navy, fontSize: 17, fontWeight: '800' },
  homeActionIconSecondaryText: { color: white, fontSize: 20, fontWeight: '700' },
  homeActionCopy: { flex: 1, minWidth: 0, marginHorizontal: 7 },
  homeActionTitle: { color: navy, fontSize: 11.5, lineHeight: 14, fontWeight: '800' },
  homeActionTitlePrimary: { color: white },
  homeActionText: { color: '#648294', fontSize: 11, marginTop: 3 },
  homeActionTextPrimary: { color: '#C7DCE3' },
  homeActionChevron: { color: aqua, fontSize: 13, fontWeight: '800' },
  homeActionChevronSecondary: { color: '#35818B', fontSize: 13, fontWeight: '800' },
  createOptionsCard: {
    marginTop: 10,
    marginHorizontal: 0,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 22,
    backgroundColor: white,
    shadowColor: navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  createOptionsHeading: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 3 },
  createOptionsEyebrow: {
    color: '#35818B',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  createOptionsTitle: { color: navy, fontSize: 17, fontWeight: '800', marginTop: 4 },
  createOption: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: '#E1EBEA',
    borderRadius: 16,
    backgroundColor: '#F8FCFB',
  },
  createOptionIcon: {
    width: 43,
    height: 43,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: navy,
  },
  createOptionIconText: { color: aqua, fontSize: 18, fontWeight: '900' },
  activeRoomsCard: {
    marginTop: 16,
    marginHorizontal: 0,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 39, 70, 0.08)',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,.82)',
    shadowColor: navy,
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 2,
  },
  activeRoomsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  activeRoomsHeading: {flex: 1},
  activeRoomsEyebrow: {
    color: '#35818B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  activeRoomsTitle: {
    color: navy,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '800',
    marginTop: 3,
  },
  activeRoomsSubtitle: {
    color: gray,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },
  activeRoomsRefresh: {
    width: 37,
    height: 37,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CDE3E2',
    borderRadius: 19,
    backgroundColor: aquaSoft,
  },
  activeRoomsRefreshText: {color: '#34838B', fontSize: 15, fontWeight: '700'},
  activeRoomsList: {gap: 9, marginTop: 13},
  activeRoom: {
    padding: 13,
    borderWidth: 1,
    borderColor: '#DCE8E7',
    borderRadius: 17,
    backgroundColor: '#F8FCFB',
  },
  activeRoomTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeRoomLive: {
    color: '#287F87',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  activeRoomCode: {
    color: '#708A99',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  activeRoomName: {color: navy, fontSize: 15, fontWeight: '800', marginTop: 8},
  activeRoomHost: {color: '#5E7B8B', fontSize: 10.5, marginTop: 5},
  activeRoomFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  activeRoomCount: {color: '#6F8794', fontSize: 9.5},
  activeRoomJoin: {color: '#267680', fontSize: 9.5, fontWeight: '800'},
  activeRoomsEmpty: {
    minHeight: 85,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D8E5E4',
    borderRadius: 16,
  },
  activeRoomsEmptyTitle: {color: navy, fontSize: 11, fontWeight: '800'},
  activeRoomsEmptyText: {
    color: gray,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 5,
  },
  shellSection: {
    flex: 1,
    minHeight: 520,
    paddingTop: 14,
    paddingHorizontal: 5,
  },
  shellEyebrow: {
    color: '#34818B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  shellTitle: {
    color: navy,
    fontSize: 34,
    lineHeight: 34,
    letterSpacing: -1.1,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 10,
  },
  shellSubtitle: {
    maxWidth: 330,
    alignSelf: 'center',
    color: '#6A8596',
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 16,
  },
  peopleToolbarHeading: {
    minHeight: 35,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 23,
  },
  peopleToolbarHint: {flex: 1, color: '#678594', fontSize: 8, lineHeight: 11},
  activityPill: {
    height: 31,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D8E3E2',
    borderRadius: 16,
    backgroundColor: white,
  },
  activityPillText: {color: navy, fontSize: 9, fontWeight: '800'},
  peopleToolbar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
  },
  peopleLayoutSwitch: {
    flex: 1,
    minWidth: 0,
    height: 46,
    flexDirection: 'row',
    padding: 3,
    borderWidth: 1,
    borderColor: '#D7E2E1',
    borderRadius: 14,
    backgroundColor: white,
  },
  peopleLayoutChoice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  peopleLayoutChoiceActive: {backgroundColor: navy},
  peopleLayoutChoiceText: {color: '#537483', fontSize: 9.5, fontWeight: '800'},
  peopleLayoutChoiceTextActive: {color: white},
  peopleSizeControl: {
    width: 132,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#CDE0DF',
    borderRadius: 14,
    backgroundColor: white,
  },
  peopleSizeLabel: {color: '#607C8A', fontSize: 8.5, fontWeight: '700'},
  peopleSizeValue: {
    flex: 1,
    color: navy,
    fontSize: 9.5,
    fontWeight: '800',
    textAlign: 'right',
  },
  peopleWaitingCard: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 35,
    padding: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CFDFDE',
    borderRadius: 28,
    backgroundColor: 'rgba(255, 254, 253, 0.82)',
  },
  peopleWaitingLogoWrap: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peopleWaitingLogo: {width: 64, height: 64, resizeMode: 'contain'},
  peopleWaitingTitle: {
    color: navy,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },
  peopleWaitingText: {
    color: gray,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 7,
  },
  chatIdentityCard: {
    minHeight: 370,
    alignItems: 'center',
    marginTop: 29,
    paddingHorizontal: 25,
    paddingTop: 35,
    paddingBottom: 26,
    borderRadius: 29,
    backgroundColor: navy,
    overflow: 'hidden',
  },
  chatIdentityOrbit: {
    width: 150,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 18,
    borderColor: 'rgba(103, 205, 209, 0.035)',
    borderRadius: 75,
    backgroundColor: 'rgba(103, 205, 209, 0.035)',
  },
  chatIdentityOrbitInner: {
    width: 98,
    height: 98,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(103, 205, 209, 0.35)',
    borderRadius: 49,
  },
  chatIdentityLogo: {width: 66, height: 66, resizeMode: 'contain'},
  chatIdentityTitle: {
    maxWidth: 240,
    color: white,
    fontSize: 23,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 27,
  },
  chatGateText: {
    maxWidth: 260,
    color: '#C5D5DF',
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 20,
  },
  globalSection: {paddingTop: 20},
  globalCard: {
    minHeight: 660,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 38,
    paddingBottom: 38,
    borderRadius: 31,
    backgroundColor: '#425977',
  },
  globalEyebrow: {
    color: '#68BCC2',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  globalTitle: {
    color: white,
    fontSize: 33,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 12,
  },
  globalSignalDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#176776',
    marginTop: 12,
  },
  globalText: {
    maxWidth: 320,
    color: '#CCD7E0',
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  globalMapToolbar: {
    width: '100%',
    marginTop: 22,
    paddingHorizontal: 3,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  globalMapToolbarTitle: {color: white, fontSize: 12, fontWeight: '800'},
  globalMapToolbarHint: {color: '#9CB6C4', fontSize: 9, marginTop: 2},
  globalMapZoomControls: {flexDirection: 'row', alignItems: 'center', gap: 4},
  globalMapZoomButton: {
    minWidth: 31,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(154, 243, 232, 0.3)',
    borderRadius: 9,
    backgroundColor: 'rgba(10, 42, 67, 0.82)',
  },
  globalMapZoomText: {color: white, fontSize: 17, fontWeight: '700'},
  globalMapZoomValue: {minWidth: 39, color: '#CFF7F5', fontSize: 9, fontWeight: '800', textAlign: 'center'},
  globalMapResetButton: {minWidth: 47, paddingHorizontal: 5},
  globalMapResetText: {color: '#DDF7F6', fontSize: 8, fontWeight: '800'},
  globalMap: {
    width: '100%',
    aspectRatio: 1.48,
    position: 'relative',
    overflow: 'hidden',
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(103, 205, 209, 0.2)',
    borderRadius: 17,
    backgroundColor: 'rgba(8, 29, 53, 0.34)',
  },
  globalCountryPanel: {
    width: '100%',
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(144, 216, 224, 0.2)',
    borderRadius: 17,
    backgroundColor: 'rgba(8, 32, 54, 0.58)',
  },
  globalCountryHeader: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8},
  globalCountryHeaderCopy: {minWidth: 0, flex: 1},
  globalCountryEyebrow: {color: '#67CDD1', fontSize: 8, fontWeight: '900', letterSpacing: 1.2},
  globalCountryName: {color: white, fontSize: 21, lineHeight: 23, fontWeight: '800', marginTop: 4},
  globalCountryStatus: {paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(196, 222, 229, 0.2)', borderRadius: 999},
  globalCountryStatusActive: {borderColor: 'rgba(120, 235, 226, 0.48)', backgroundColor: 'rgba(69, 188, 183, 0.14)'},
  globalCountryStatusText: {color: '#9EB3BE', fontSize: 7, fontWeight: '900'},
  globalCountryStatusTextActive: {color: '#B9FFF7'},
  globalCountryCountRow: {marginTop: 13, flexDirection: 'row', alignItems: 'baseline', gap: 7},
  globalCountryCount: {color: '#A6FFF4', fontSize: 28, fontWeight: '800'},
  globalCountryCountLabel: {color: '#BCD0DA', fontSize: 10},
  globalCountryPeopleTitle: {color: '#E7F8FC', fontSize: 10, fontWeight: '800', marginTop: 10, marginBottom: 5},
  globalCountryPersonRow: {minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, marginTop: 4, borderWidth: 1, borderColor: 'rgba(147, 211, 221, 0.13)', borderRadius: 10, backgroundColor: 'rgba(5, 24, 43, 0.35)'},
  globalCountryPersonDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: '#70E3DC'},
  globalCountryPrivateDot: {borderWidth: 1, borderColor: '#83AAB8', backgroundColor: 'transparent'},
  globalCountryPersonName: {minWidth: 0, flex: 1, color: '#D7EAF0', fontSize: 10.5},
  globalCountryEmpty: {color: '#9FB6C2', fontSize: 10, lineHeight: 15, marginTop: 11},
  globalCountryPrivacy: {color: '#829EAB', fontSize: 8.5, lineHeight: 13, marginTop: 11},
  globalStats: {width: '100%', maxWidth: 390, flexDirection: 'row', gap: 11, marginTop: 20},
  globalStat: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(103, 205, 209, 0.2)',
    borderRadius: 18,
    backgroundColor: 'rgba(103, 205, 209, 0.08)',
  },
  globalStatNumber: {color: aqua, fontSize: 22, fontWeight: '800'},
  globalStatLabel: {color: white, fontSize: 11.5, marginTop: 2},
  homeIdentitySection: { gap: 9, marginTop: 22, marginBottom: 8 },
  homeSectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  homeSectionEyebrow: {
    color: '#35818B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  homeSectionHint: { color: gray, fontSize: 9.5 },
  list: { gap: 10 },
  card: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: border,
    borderRadius: 20,
    backgroundColor: white,
    padding: 13,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#EEF1F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 23, color: navy, fontWeight: '700' },
  copy: { flex: 1, marginHorizontal: 13 },
  cardTitle: { fontSize: 16, color: navy, fontWeight: '700' },
  cardText: { fontSize: 12.5, lineHeight: 17, color: gray, marginTop: 3 },
  arrow: { fontSize: 28, color: '#91A0AD' },
  profileHomeCard: { borderColor: '#BBDADB', backgroundColor: '#F5FBFA' },
  profileHomeAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileHomeImage: { width: 48, height: 48, resizeMode: 'cover' },
  profileHomeInitial: { color: white, fontSize: 21, fontWeight: '800' },
  profileScreen: { marginTop: 2 },
  profileEditorCard: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 24,
    backgroundColor: white,
    padding: 18,
    marginBottom: 12,
  },
  profileIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  profileAvatarLarge: {
    width: 84,
    height: 84,
    borderRadius: 28,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImage: { width: 84, height: 84, resizeMode: 'cover' },
  profileAvatarInitial: { color: white, fontSize: 34, fontWeight: '800' },
  profileIdentityCopy: { flex: 1, marginLeft: 15 },
  profileIdentityTitle: { color: navy, fontSize: 19, fontWeight: '800' },
  profileIdentityText: {
    color: gray,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  profilePhotoActions: { flexDirection: 'row', gap: 8, marginBottom: 21 },
  profilePhotoActionsWithMessage: { marginBottom: 8 },
  profilePhotoButton: {
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E7F5F3',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  profilePhotoButtonText: { color: navy, fontSize: 12, fontWeight: '800' },
  profilePhotoStatus: {
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 13,
    backgroundColor: '#EDF8F7',
  },
  profilePhotoStatusText: {
    color: '#315F66',
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
  },
  profilePhotoRemove: {
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D7DBD7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 17,
  },
  profilePhotoRemoveText: { color: gray, fontSize: 12, fontWeight: '700' },
  profileField: {
    minHeight: 51,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 15,
    backgroundColor: '#FBFBF9',
    paddingHorizontal: 14,
    color: navy,
    fontSize: 14,
    marginBottom: 16,
  },
  profileBio: { height: 112, paddingTop: 14, paddingBottom: 14 },
  profileHint: {
    color: '#758394',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: -10,
    marginBottom: 17,
  },
  profileCounter: {
    color: '#8A95A0',
    fontSize: 10,
    textAlign: 'right',
    marginTop: -12,
  },
  profileSectionTitle: { color: navy, fontSize: 19, fontWeight: '800' },
  profileSectionText: {
    color: gray,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  privacyChoices: { flexDirection: 'row', gap: 8, marginTop: 17 },
  privacyChoice: {
    flex: 1,
    minHeight: 72,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 17,
    backgroundColor: '#FAFAF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyChoiceActive: { backgroundColor: navy, borderColor: navy },
  privacyChoiceTitle: { color: navy, fontSize: 14, fontWeight: '800' },
  privacyChoiceTitleActive: { color: white },
  privacyChoiceText: { color: gray, fontSize: 10, marginTop: 4 },
  privacyChoiceTextActive: { color: '#C7D4E1' },
  privacyNote: {
    marginTop: 13,
    padding: 13,
    borderRadius: 15,
    backgroundColor: '#F0F7F6',
  },
  privacyNoteTitle: { color: navy, fontSize: 12, fontWeight: '800' },
  privacyNoteText: { color: gray, fontSize: 11, lineHeight: 16, marginTop: 4 },
  socialDisabled: { opacity: 0.66 },
  socialPreference: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEAE5',
  },
  socialPreferenceLast: { borderBottomWidth: 0, paddingBottom: 2 },
  socialPreferenceCopy: { flex: 1, paddingRight: 12 },
  socialPreferenceTitle: { color: navy, fontSize: 13, fontWeight: '800' },
  socialPreferenceText: {
    color: gray,
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 3,
  },
  profileFutureCard: {
    borderRadius: 24,
    backgroundColor: navy,
    padding: 19,
    marginBottom: 3,
  },
  projectVisionButton: {marginTop: 14, minHeight: 72, padding: 11, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#BBDADB', borderRadius: 22, backgroundColor: '#E4F5F3'},
  projectVisionButtonMark: {width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: navy},
  projectVisionButtonMarkText: {color: aqua, fontSize: 20, fontWeight: '900'},
  projectVisionButtonCopy: {flex: 1, marginLeft: 13},
  projectVisionButtonLabel: {color: '#3B8790', fontSize: 9, fontWeight: '900', letterSpacing: 1.4},
  projectVisionButtonTitle: {marginTop: 3, color: navy, fontSize: 15, fontWeight: '900'},
  projectVisionButtonArrow: {color: '#397E89', fontSize: 28, fontWeight: '500'},
  profileFutureTitle: {
    color: white,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 7,
  },
  profileFutureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 15,
  },
  futureItem: {
    width: '48%',
    minHeight: 58,
    borderRadius: 15,
    backgroundColor: '#18375E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  futureIcon: { color: '#69CBD2', fontSize: 18, fontWeight: '800' },
  futureText: { color: white, fontSize: 10.5, fontWeight: '800', marginTop: 3 },
  profileStatus: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#E7F5F3',
  },
  profileStatusText: {
    color: '#315F66',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  profileBack: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
  },
  profileBackText: { color: gray, fontSize: 13, fontWeight: '800' },
  accountCard: { borderColor: '#B8D9D9', backgroundColor: '#F7FCFB' },
  accountActiveHeader: { flexDirection: 'row', alignItems: 'center' },
  accountShield: {
    width: 43,
    height: 43,
    borderRadius: 15,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountShieldText: { color: '#71D4D8', fontSize: 20, fontWeight: '900' },
  accountActiveCopy: { flex: 1, marginLeft: 12 },
  accountBenefit: {
    color: '#4F6677',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 14,
  },
  accountLogout: {
    alignSelf: 'flex-start',
    height: 38,
    borderWidth: 1,
    borderColor: '#CDDAD9',
    borderRadius: 19,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  accountLogoutText: { color: navy, fontSize: 11, fontWeight: '800' },
  accountModes: {
    height: 46,
    flexDirection: 'row',
    gap: 5,
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#EAF2F1',
    marginVertical: 16,
  },
  accountMode: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  accountModeActive: { backgroundColor: navy },
  accountModeText: { color: '#5E7182', fontSize: 11.5, fontWeight: '800' },
  accountModeTextActive: { color: white },
  accountSubmit: {
    height: 50,
    borderRadius: 25,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountSubmitText: { color: white, fontSize: 13, fontWeight: '800' },
  accountMessage: {
    color: '#397078',
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 11,
  },
  galleryCounter: {
    color: '#5A7481',
    fontSize: 11,
    fontWeight: '800',
    textAlignVertical: 'center',
    marginLeft: 'auto',
  },
  galleryStrip: { gap: 9, paddingBottom: 18 },
  galleryItem: {
    position: 'relative',
    width: 112,
    height: 139,
    borderWidth: 1,
    borderColor: '#D8DFDC',
    borderRadius: 18,
    backgroundColor: '#F3F4F2',
    overflow: 'hidden',
  },
  galleryItemPrimary: { borderColor: '#65C8CC', borderWidth: 2 },
  galleryImage: { width: '100%', height: 100, resizeMode: 'cover' },
  galleryPrimaryBadge: {
    height: 37,
    color: '#287B82',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  galleryPrimaryButton: {
    height: 37,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  galleryPrimaryButtonText: {
    color: navy,
    fontSize: 8.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  galleryRemove: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: 'rgba(16,39,70,.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryRemoveText: {
    color: white,
    fontSize: 19,
    lineHeight: 20,
    fontWeight: '500',
  },
  storyHeading: { flexDirection: 'row', alignItems: 'center' },
  storyIcon: {
    width: 43,
    height: 43,
    borderRadius: 15,
    backgroundColor: '#DFF3F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyIconText: { color: '#318C93', fontSize: 20, fontWeight: '900' },
  storyHeadingCopy: { flex: 1, marginLeft: 12 },
  storyInput: { height: 92, paddingTop: 13, paddingBottom: 13, marginTop: 17 },
  storyButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  storyButtonText: { color: white, fontSize: 12, fontWeight: '800' },
  storyRequirement: {
    color: '#7E6C54',
    fontSize: 10.5,
    textAlign: 'center',
    marginTop: 9,
  },
  currentStory: {
    marginTop: 15,
    padding: 13,
    borderRadius: 15,
    backgroundColor: '#E5F5F2',
  },
  currentStoryImage: {
    width: '100%',
    height: 132,
    borderRadius: 12,
    marginBottom: 11,
    resizeMode: 'cover',
  },
  storyPhotoLabel: {
    color: '#4B7E84',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 17,
    marginBottom: 8,
  },
  storyPhotoChoices: { gap: 8, paddingRight: 8 },
  storyPhotoChoice: {
    width: 58,
    height: 58,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 2,
  },
  storyPhotoImage: { width: '100%', height: '100%', borderRadius: 11 },
  storyPhotoNone: {
    width: 66,
    height: 58,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#CAD9D7',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7FAF8',
  },
  storyPhotoNoneText: { color: gray, fontSize: 9, fontWeight: '800' },
  storyPhotoSelected: { borderColor: '#58C4CA', backgroundColor: '#E2F5F2' },
  currentStoryLabel: {
    color: '#37868C',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  currentStoryText: {
    color: navy,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 5,
  },
  version: {
    marginTop: 18,
    padding: 17,
    borderRadius: 18,
    backgroundColor: '#E7F5F3',
  },
  versionTitle: { color: navy, fontSize: 13, fontWeight: '800' },
  versionText: { color: gray, fontSize: 12, marginTop: 5 },
  sectionTitle: { marginTop: 34, marginBottom: 22 },
  entryCard: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 26,
    backgroundColor: white,
    padding: 17,
    shadowColor: navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 2,
  },
  label: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: gray,
    fontWeight: '800',
    marginBottom: 8,
  },
  entrySelector: {
    minHeight: 68,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 18,
    backgroundColor: '#FAFAF9',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  entrySelectorOpen: { borderColor: '#A7C8CB', backgroundColor: '#F5FAF9' },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#E7F5F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodIconText: { color: navy, fontSize: 21, fontWeight: '800' },
  methodCopy: { flex: 1, marginHorizontal: 12 },
  methodCaption: {
    color: '#7B8B9B',
    fontSize: 8,
    letterSpacing: 1.25,
    fontWeight: '800',
  },
  methodTitle: { color: navy, fontSize: 15, fontWeight: '800', marginTop: 3 },
  chevron: { color: navy, fontSize: 22, fontWeight: '700', marginRight: 4 },
  entryMenu: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 18,
    backgroundColor: white,
    padding: 6,
  },
  menuOption: {
    minHeight: 62,
    borderRadius: 14,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuOptionActive: { backgroundColor: '#EFF8F6' },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#F0F1F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconActive: { backgroundColor: '#DCEFED' },
  menuIconText: { color: navy, fontSize: 18, fontWeight: '800' },
  menuCopy: { flex: 1, marginHorizontal: 11 },
  menuTitle: { color: navy, fontSize: 14, fontWeight: '800' },
  menuText: { color: gray, fontSize: 11.5, marginTop: 3 },
  check: { color: '#3E9EA5', fontSize: 18, fontWeight: '900', marginRight: 5 },
  methodPanel: {
    marginTop: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#F5F7F6',
  },
  qrIntro: { alignItems: 'center', paddingVertical: 5 },
  qrMark: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#E2F3F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrMarkText: { color: navy, fontSize: 27, fontWeight: '800' },
  methodPanelTitle: {
    color: navy,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 11,
  },
  methodPanelText: {
    color: gray,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 5,
    maxWidth: 270,
  },
  codeInput: {
    height: 58,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 16,
    backgroundColor: white,
    color: navy,
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: 5,
    textAlign: 'center',
  },
  serverInput: {
    height: 54,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 16,
    backgroundColor: white,
    paddingHorizontal: 15,
    color: navy,
    fontSize: 15,
  },
  hint: { color: gray, fontSize: 12, lineHeight: 17, marginTop: 9 },
  errorBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FDE9E7',
  },
  errorText: { color: '#9D3931', fontSize: 13, lineHeight: 18 },
  missingText: {
    color: gray,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 13,
  },
  primary: {
    height: 54,
    marginTop: 18,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: navy,
  },
  disabled: { backgroundColor: '#A8B0BA' },
  primaryText: { fontSize: 16, color: white, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  liveScreen: { flex: 1, marginTop: 24 },
  broadcastAudioOnly: {position: 'absolute', width: 1, height: 1, opacity: 0},
  mainNavDock: {
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: Platform.OS === 'ios' ? 9 : 7,
    backgroundColor: 'rgba(247, 244, 238, 0.96)',
  },
  listenerNav: {
    height: 64,
    flexDirection: 'row',
    gap: 5,
    padding: 5,
    borderWidth: 1,
    borderColor: '#D4DDDC',
    borderRadius: 22,
    backgroundColor: white,
    shadowColor: navy,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4,
  },
  listenerNavItem: {
    position: 'relative',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    gap: 2,
  },
  listenerNavItemActive: { backgroundColor: navy },
  listenerNavIcon: { color: '#43A5AD', fontSize: 10, fontWeight: '800' },
  listenerNavText: { color: '#45677A', fontSize: 8.5, fontWeight: '800' },
  listenerNavTextActive: { color: white },
  listenerUnread: {
    position: 'absolute',
    right: 7,
    top: 5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#D85E53',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenerUnreadText: { color: white, fontSize: 8.5, fontWeight: '900' },
  liveCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: border,
    borderRadius: 28,
    backgroundColor: white,
    padding: 26,
  },
  liveVideoFrame: {
    position: 'relative',
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: navy,
    marginBottom: 18,
  },
  liveVideo: { width: '100%', height: '100%' },
  liveVideoBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(16,39,70,.82)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveVideoBadgeText: {
    color: '#71D4D8',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
  liveVideoFullscreenButton: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.34)',
    backgroundColor: 'rgba(16,39,70,.78)',
  },
  liveVideoFullscreenButtonPressed: {
    backgroundColor: 'rgba(28,67,103,.96)',
    transform: [{ scale: 0.94 }],
  },
  liveVideoFullscreenIcon: {
    color: '#8CE1E2',
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '800',
  },
  liveVideoEyebrow: { marginTop: 2 },
  pulse: {
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: '#E6F4F1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 25,
  },
  pulseLogo: { width: 96, height: 96, resizeMode: 'contain' },
  liveTitle: {
    fontSize: 31,
    color: navy,
    fontWeight: '700',
    marginTop: 9,
    textAlign: 'center',
  },
  liveDj: { fontSize: 13, color: gray, marginTop: 5 },
  roomPromotions: {
    width: '100%',
    marginTop: 18,
    gap: 9,
  },
  roomPromotionCard: {
    width: '100%',
    minHeight: 92,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#CFE5DC',
    borderRadius: 16,
    backgroundColor: '#F7FCF9',
  },
  roomPromotionImage: {
    width: 96,
    minHeight: 92,
    resizeMode: 'cover',
    backgroundColor: navy,
  },
  roomPromotionVideo: {
    width: 96,
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#12324A',
  },
  roomPromotionVideoIcon: {color: '#83DEC1', fontSize: 21},
  roomPromotionVideoText: {color: white, fontSize: 9, fontWeight: '800'},
  roomPromotionCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roomPromotionLabel: {
    color: '#278054',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  roomPromotionSponsor: {color: navy, fontSize: 14, fontWeight: '800', marginTop: 2},
  roomPromotionHeadline: {color: gray, fontSize: 11, lineHeight: 15, marginTop: 2},
  roomPromotionLink: {alignSelf: 'flex-start', marginTop: 6},
  roomPromotionLinkText: {color: '#19744A', fontSize: 11, fontWeight: '800'},
  wave: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginVertical: 12,
  },
  waveBar: { width: 5, borderRadius: 4, backgroundColor: '#69CBD2' },
  detail: { color: gray, fontSize: 13, textAlign: 'center', minHeight: 20 },
  audioRoute: {
    width: '100%',
    marginTop: 22,
    padding: 15,
    borderRadius: 16,
    backgroundColor: '#F1F7F6',
  },
  audioRouteTitle: { color: navy, fontSize: 13, fontWeight: '800' },
  audioRouteText: { color: gray, fontSize: 12, lineHeight: 17, marginTop: 4 },
  outputOptions: { flexDirection: 'row', gap: 7, marginTop: 12 },
  outputOption: {
    flex: 1,
    minHeight: 54,
    borderWidth: 1,
    borderColor: '#CCD9DB',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    backgroundColor: white,
  },
  outputOptionActive: { backgroundColor: navy, borderColor: navy },
  outputOptionLabel: {
    color: navy,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  outputOptionLabelActive: { color: white },
  outputOptionDetail: { color: gray, fontSize: 10, marginTop: 2 },
  outputWarning: {
    color: '#47717A',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 9,
  },
  videoFullscreenSurface: {
    flex: 1,
    backgroundColor: '#071A32',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  videoFullscreenMedia: { width: '100%', height: '100%' },
  videoFullscreenHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'android' ? 18 : 48,
    paddingHorizontal: 18,
    alignItems: 'flex-start',
  },
  videoFullscreenLive: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(16,39,70,.82)',
  },
  videoFullscreenDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#71D4D8',
    marginRight: 7,
  },
  videoFullscreenLiveText: {
    color: '#B8F0EF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  videoFullscreenClose: {
    position: 'absolute',
    right: 18,
    bottom: Platform.OS === 'android' ? 24 : 38,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 17,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.38)',
    backgroundColor: 'rgba(16,39,70,.92)',
  },
  videoFullscreenClosePressed: {
    backgroundColor: 'rgba(28,67,103,.98)',
    transform: [{ scale: 0.98 }],
  },
  videoFullscreenCloseIcon: {
    color: '#71D4D8',
    fontSize: 25,
    lineHeight: 27,
    marginRight: 8,
  },
  videoFullscreenCloseText: { color: white, fontSize: 12, fontWeight: '800' },
  liveFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: navy,
    borderRadius: 22,
    padding: 20,
    marginTop: 12,
  },
  footerRight: { flex: 1, alignItems: 'flex-end', paddingLeft: 14 },
  footerNumber: { fontSize: 25, color: white, fontWeight: '800' },
  footerQuality: { fontSize: 20, color: white, fontWeight: '800' },
  footerLabel: {
    fontSize: 11,
    color: '#B9C9DA',
    marginTop: 3,
    textAlign: 'right',
  },
  stopButton: {
    height: 50,
    borderWidth: 1.5,
    borderColor: '#C55A52',
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  stopText: { color: '#B64239', fontSize: 15, fontWeight: '800' },
  peopleCard: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 24,
    backgroundColor: white,
    padding: 18,
  },
  peopleHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  peopleHeaderCopy: { flex: 1, paddingRight: 13 },
  peopleTitle: { color: navy, fontSize: 21, fontWeight: '800', marginTop: 6 },
  peopleSubtitle: { color: gray, fontSize: 11.5, lineHeight: 16, marginTop: 5 },
  peopleCount: {
    minWidth: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: '#E5F4F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  peopleCountNumber: { color: navy, fontSize: 18, fontWeight: '900' },
  peopleCountLabel: { color: '#568087', fontSize: 8.5, fontWeight: '800' },
  socialCameraPanel: {
    marginTop: 18,
    padding: 15,
    borderRadius: 22,
    backgroundColor: '#102746',
  },
  socialCameraHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  socialCameraHeading: { flex: 1, paddingRight: 10 },
  socialCameraEyebrow: {
    color: '#68D1D5',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  socialCameraTitle: {
    color: white,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 5,
  },
  socialCameraText: {
    color: '#B9CAD8',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 4,
  },
  socialCameraState: {
    height: 27,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: '#233D5B',
  },
  socialCameraStateLive: { backgroundColor: '#DDF3F0' },
  socialCameraStateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7D8DA0',
    marginRight: 5,
  },
  socialCameraStateDotLive: { backgroundColor: '#42A9B0' },
  socialCameraStateText: {
    color: '#B9C6D3',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  socialCameraStateTextLive: { color: '#27777E' },
  socialVideoStrip: { gap: 12, paddingTop: 15, paddingBottom: 3 },
  socialVideoTile: {
    position: 'relative',
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#071A32',
  },
  socialVideoOrganizerTile: {
    width: '100%',
    borderWidth: 2,
    borderColor: '#66D5D8',
  },
  socialVideoMedia: { width: '100%', height: '100%' },
  socialVideoShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 66,
    backgroundColor: 'rgba(7,26,50,.36)',
  },
  socialVideoLive: {
    position: 'absolute',
    top: 9,
    left: 9,
    height: 23,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(16,39,70,.8)',
  },
  socialVideoLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#6ED5D8',
    marginRight: 5,
  },
  socialVideoLiveText: {
    color: '#C6F4F2',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  socialVideoName: {
    position: 'absolute',
    left: 11,
    right: 11,
    bottom: 10,
    color: white,
    fontSize: 12,
    fontWeight: '800',
  },
  socialVideoEmpty: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 13,
    borderRadius: 17,
    backgroundColor: '#183A5C',
  },
  socialVideoEmptyOrbit: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DFF2EF',
  },
  socialVideoEmptyLogo: { width: 52, height: 52, resizeMode: 'contain' },
  socialVideoEmptyCopy: { flex: 1, marginLeft: 13 },
  socialVideoEmptyTitle: { color: white, fontSize: 13, fontWeight: '800' },
  socialVideoEmptyText: {
    color: '#B6C9D7',
    fontSize: 9.5,
    lineHeight: 14,
    marginTop: 4,
  },
  socialCameraButton: {
    height: 48,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#67CDD1',
  },
  socialCameraButtonStop: { backgroundColor: '#F5E7E4' },
  socialCameraButtonIcon: {
    color: navy,
    fontSize: 13,
    fontWeight: '900',
    marginRight: 8,
  },
  socialCameraButtonIconStop: { color: '#AC443E' },
  socialCameraButtonText: { color: navy, fontSize: 12, fontWeight: '900' },
  socialCameraButtonTextStop: { color: '#A7433D' },
  socialCameraMessage: {
    color: '#9FE4E4',
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 10,
  },
  socialCameraPrivacy: {
    color: '#92A8B9',
    fontSize: 8.5,
    lineHeight: 12,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  matchmakingPanel: {
    marginTop: 17,
    borderRadius: 20,
    backgroundColor: navy,
    padding: 15,
  },
  matchmakingHeading: { paddingHorizontal: 2 },
  matchmakingEyebrow: {
    color: '#62CFD5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  matchmakingTitle: {
    color: white,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 5,
  },
  matchmakingText: {
    color: '#B8C9D9',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 4,
  },
  matchmakingList: { gap: 7, marginTop: 12 },
  matchmakingRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 15,
    backgroundColor: '#193A60',
    padding: 8,
  },
  matchmakingAvatar: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#DDF2EF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  matchmakingAvatarImage: { width: 40, height: 40, resizeMode: 'cover' },
  matchmakingAvatarText: { color: navy, fontSize: 14, fontWeight: '900' },
  matchmakingCopy: { flex: 1, marginHorizontal: 9 },
  matchmakingName: { color: white, fontSize: 12.5, fontWeight: '800' },
  matchmakingShared: { color: '#8EDDE0', fontSize: 9.5, marginTop: 3 },
  matchmakingScore: { minWidth: 45, alignItems: 'center' },
  matchmakingScoreNumber: { color: '#65D1D5', fontSize: 16, fontWeight: '900' },
  matchmakingScoreLabel: { color: '#B8C9D9', fontSize: 7.5 },
  matchmakingNotice: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 13,
    borderRadius: 18,
    backgroundColor: '#EFF7F5',
  },
  matchmakingNoticeIcon: { color: '#3BA0A7', fontSize: 21, fontWeight: '900' },
  matchmakingNoticeCopy: { flex: 1, marginHorizontal: 11 },
  matchmakingNoticeTitle: { color: navy, fontSize: 13, fontWeight: '800' },
  matchmakingNoticeText: {
    color: gray,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  matchmakingNoticeArrow: { color: navy, fontSize: 24 },
  peopleDirectoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 21,
    marginBottom: 10,
  },
  peopleDirectoryTitle: { color: navy, fontSize: 15, fontWeight: '800' },
  peopleDirectoryCount: {
    minWidth: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#E8F3F2',
    color: '#3A7B82',
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  peopleList: { gap: 10 },
  peopleContactStatus: {marginBottom: 10, paddingHorizontal: 4, color: '#2D7580', fontSize: 10.5, lineHeight: 15, fontWeight: '700'},
  peopleEmpty: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: '#E5E4DF',
    borderRadius: 19,
    backgroundColor: '#FBFBF9',
  },
  peopleEmptyIcon: { color: '#55B6BC', fontSize: 28, fontWeight: '800' },
  peopleEmptyTitle: {
    color: navy,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 7,
  },
  peopleEmptyText: {
    color: gray,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 5,
  },
  peopleEmptyButton: {
    height: 42,
    borderRadius: 21,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 14,
  },
  peopleEmptyButtonText: { color: white, fontSize: 11, fontWeight: '800' },
  personCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#E0E2DE',
    borderRadius: 19,
    backgroundColor: '#FBFBF9',
  },
  personCardSuggested: { borderColor: '#9DCDCF', backgroundColor: '#F7FCFB' },
  personTop: { flexDirection: 'row', alignItems: 'center' },
  personAvatar: {
    width: 58,
    height: 58,
    borderRadius: 19,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  personAvatarStory: { borderWidth: 3, borderColor: '#62C9CE' },
  personAvatarImage: { width: 58, height: 58, resizeMode: 'cover' },
  personAvatarText: { color: '#68D1D5', fontSize: 22, fontWeight: '900' },
  personIdentity: { flex: 1, marginLeft: 12 },
  personNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  personName: { maxWidth: '72%', color: navy, fontSize: 16, fontWeight: '800' },
  personSelf: {
    color: '#587784',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.8,
    backgroundColor: '#E5EFEE',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  personMatch: {
    color: '#287E84',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.7,
    backgroundColor: '#DDF3F0',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  personStoryBadge: {
    color: '#854D89',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.7,
    backgroundColor: '#F0E4F1',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  personCity: { color: '#718091', fontSize: 10.5, marginTop: 5 },
  personBio: {
    color: '#46576A',
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 12,
  },
  personStory: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 11,
    borderRadius: 15,
    backgroundColor: '#EDF7F5',
    overflow: 'hidden',
  },
  personStoryImage: { width: 58, height: 58, resizeMode: 'cover' },
  personStoryCopy: { flex: 1, paddingHorizontal: 12, paddingVertical: 9 },
  personStoryLabel: {
    color: '#3B8E94',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
  personStoryText: {
    color: navy,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 3,
  },
  personGallery: { gap: 7, paddingTop: 11, paddingBottom: 4 },
  personGalleryImage: {
    width: 82,
    height: 98,
    borderWidth: 1,
    borderColor: '#DCE3E1',
    borderRadius: 14,
    backgroundColor: '#EDF3F2',
    resizeMode: 'cover',
  },
  personInterests: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 11,
  },
  personInterest: {
    borderRadius: 12,
    backgroundColor: '#ECEFEE',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  personInterestShared: { backgroundColor: '#DDF3F0' },
  personInterestText: { color: '#5D6F7E', fontSize: 9.5, fontWeight: '700' },
  personInterestTextShared: { color: '#27747B' },
  personContactActions: {flexDirection: 'row', gap: 6, marginTop: 12},
  personContactAction: {flex: 1, minHeight: 38, paddingHorizontal: 5, borderWidth: 1, borderColor: '#BFDADB', borderRadius: 19, backgroundColor: '#ECF7F5', alignItems: 'center', justifyContent: 'center'},
  personContactActionText: {color: navy, fontSize: 9.5, fontWeight: '800'},
  personChatButton: {
    height: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: navy,
    marginTop: 13,
  },
  personChatButtonText: { color: white, fontSize: 11.5, fontWeight: '800' },
  personChatArrow: { color: '#70D2D6', fontSize: 20, marginLeft: 7 },
  communityCard: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 24,
    backgroundColor: white,
    padding: 18,
  },
  communityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  communityHeaderCopy: { flex: 1, paddingRight: 12 },
  communityTitle: {
    color: navy,
    fontSize: 21,
    fontWeight: '800',
    marginTop: 5,
  },
  communitySubtitle: {
    color: gray,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 4,
  },
  profileButton: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  profileButtonText: { color: navy, fontSize: 10.5, fontWeight: '800' },
  chatSections: {
    height: 48,
    flexDirection: 'row',
    gap: 5,
    padding: 4,
    borderRadius: 17,
    backgroundColor: '#EEF3F2',
    marginTop: 17,
  },
  chatSectionButton: {
    position: 'relative',
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  chatSectionButtonActive: { backgroundColor: navy },
  chatSectionText: { color: '#5E7182', fontSize: 12, fontWeight: '800' },
  chatSectionTextActive: { color: white },
  pendingBadge: {
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: '#D95E54',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 7,
    paddingHorizontal: 5,
  },
  pendingBadgeText: { color: white, fontSize: 9, fontWeight: '900' },
  roomChatIntro: { marginTop: 17 },
  roomChatTitle: { color: navy, fontSize: 16, fontWeight: '800' },
  roomChatText: { color: gray, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  roomAudioPanel: {marginTop: 13, padding: 12, borderWidth: 1, borderColor: '#C9DDE7', borderRadius: 18, backgroundColor: '#EEF6FA'},
  roomAudioHeading: {flexDirection: 'row', alignItems: 'center'},
  roomAudioMark: {width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: navy},
  roomAudioMarkText: {color: aqua, fontSize: 15, fontWeight: '900'},
  roomAudioCopy: {flex: 1, marginLeft: 10},
  roomAudioTitle: {color: navy, fontSize: 12.5, fontWeight: '900'},
  roomAudioText: {marginTop: 3, color: '#5B7483', fontSize: 9.5, lineHeight: 13},
  roomAudioActions: {marginTop: 11, flexDirection: 'row', gap: 6},
  roomAudioButton: {flex: 1, minHeight: 42, paddingHorizontal: 6, borderWidth: 1, borderColor: '#BCD3DE', borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: white},
  roomAudioButtonActive: {borderColor: navy, backgroundColor: aqua},
  roomAudioButtonText: {color: navy, fontSize: 8.8, fontWeight: '900', textAlign: 'center'},
  roomAudioStatus: {marginTop: 8, color: '#54717E', fontSize: 9.5, lineHeight: 13},
  chatPeoplePanel: { marginTop: 13, padding: 11, borderWidth: 1, borderColor: '#C5DCDD', borderRadius: 17, backgroundColor: '#F4FAF9' },
  chatPeopleHeading: { flexDirection: 'row', alignItems: 'center' },
  chatPeopleSignal: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#4AB2B8', marginRight: 7 },
  chatPeopleTitle: { color: navy, fontSize: 11, fontWeight: '800' },
  chatPeopleSearch: { height: 42, marginTop: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: '#BCD7D8', borderRadius: 13, color: navy, backgroundColor: white, fontSize: 12 },
  chatPeopleList: { gap: 8, paddingTop: 9, paddingRight: 6 },
  chatPerson: { width: 92, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: '#C7DDDE', borderRadius: 14, backgroundColor: white },
  chatPersonSelf: { backgroundColor: '#E7F4F3' },
  chatPersonAvatar: { width: 31, height: 31, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: navy },
  chatPersonAvatarText: { color: '#70D2D6', fontSize: 12, fontWeight: '900' },
  chatPersonName: { maxWidth: 76, marginTop: 5, color: navy, fontSize: 9.5, fontWeight: '800' },
  chatPersonAction: { marginTop: 2, color: '#3D8790', fontSize: 8, fontWeight: '700' },
  chatPeopleEmpty: { color: gray, fontSize: 10, paddingVertical: 8 },
  reactionRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  reactionButton: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 14,
    backgroundColor: '#FAFAF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionText: { fontSize: 21 },
  chatIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 11,
    padding: 11,
    borderRadius: 14,
    backgroundColor: '#F2F6F5',
  },
  chatIdentityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9AA4AD',
    marginRight: 8,
  },
  chatIdentityDotPublic: { backgroundColor: '#47A8AF' },
  chatIdentityText: { flex: 1, color: gray, fontSize: 11, lineHeight: 16 },
  messages: { gap: 8, marginTop: 14 },
  emptyChat: {
    color: '#748391',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 22,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 15,
    backgroundColor: '#F5F6F4',
  },
  reactionMessage: { backgroundColor: '#EFF8F6' },
  privateMessageOwn: { backgroundColor: '#E9F5F3', marginLeft: 28 },
  liveChatPanel: {
    borderWidth: 1,
    borderColor: '#B9DFE0',
    borderRadius: 20,
    backgroundColor: '#EDF8F6',
    padding: 13,
    marginTop: 12,
  },
  liveChatHeading: { flexDirection: 'row', alignItems: 'center' },
  liveChatMark: { width: 43, height: 43, borderRadius: 22, backgroundColor: navy, alignItems: 'center', justifyContent: 'center' },
  liveChatMarkText: { color: '#69CDD2', fontSize: 18, fontWeight: '900' },
  liveChatCopy: { flex: 1, marginLeft: 11 },
  liveChatEyebrow: { color: '#30868B', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  liveChatTitle: { color: navy, fontSize: 13, fontWeight: '800', marginTop: 2 },
  liveChatDetail: { color: '#607584', fontSize: 9.5, lineHeight: 14, marginTop: 3 },
  liveChatEnter: { minHeight: 43, borderRadius: 22, backgroundColor: navy, alignItems: 'center', justifyContent: 'center', marginTop: 11 },
  liveChatEnterText: { color: white, fontSize: 11, fontWeight: '800' },
  liveChatVideos: { gap: 8, paddingTop: 11, paddingRight: 6 },
  liveChatVideoTile: { width: 148, height: 198, overflow: 'hidden', borderRadius: 16, backgroundColor: '#071D37' },
  liveChatVideo: { width: '100%', height: '100%' },
  liveChatVideoName: { position: 'absolute', left: 8, bottom: 8, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10, color: white, backgroundColor: 'rgba(5,24,45,.72)', fontSize: 9, fontWeight: '800' },
  liveChatControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 },
  liveChatControlPrimary: { width: '31%', minHeight: 41, borderRadius: 21, backgroundColor: navy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  liveChatControlPrimaryText: { color: white, fontSize: 9, fontWeight: '800' },
  liveChatControlSecondary: { width: '31%', minHeight: 41, borderWidth: 1, borderColor: '#A9D5D6', borderRadius: 21, backgroundColor: white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  liveChatControlActive: { borderColor: '#4AAEB3', backgroundColor: '#CDEBEC' },
  liveChatControlSecondaryText: { color: navy, fontSize: 9, fontWeight: '800' },
  liveChatLeave: { minWidth: 51, minHeight: 41, borderRadius: 21, backgroundColor: '#DDE9E8', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  liveChatLeaveText: { color: '#526B77', fontSize: 9, fontWeight: '800' },
  messageCopy: { flex: 1 },
  messageAuthor: { color: navy, fontSize: 11.5, fontWeight: '800' },
  messageText: {
    color: '#435269',
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 2,
  },
  voiceMessageButton: { flexDirection: 'row', alignItems: 'center', minHeight: 42, marginTop: 3 },
  voiceMessageIcon: { width: 35, height: 35, borderRadius: 18, backgroundColor: navy, color: '#70D2D6', fontSize: 11, fontWeight: '900', textAlign: 'center', textAlignVertical: 'center' },
  voiceMessageCopy: { marginLeft: 9 },
  voiceMessageTitle: { color: navy, fontSize: 11.5, fontWeight: '800' },
  voiceMessageTitleOwn: { color: navy },
  voiceMessageDuration: { color: '#768692', fontSize: 9, marginTop: 2 },
  voiceMessageDurationOwn: { color: '#5F7B82' },
  reportIcon: { color: '#8895A0', fontSize: 16, paddingLeft: 10 },
  chatComposer: { flexDirection: 'row', gap: 8, marginTop: 14 },
  voiceRecordButton: { width: 50, height: 50, borderWidth: 1, borderColor: '#ACDFE0', borderRadius: 25, backgroundColor: '#E8F7F5', alignItems: 'center', justifyContent: 'center' },
  voiceRecordButtonActive: { borderColor: '#D85E53', backgroundColor: '#D85E53' },
  voiceRecordButtonText: { color: navy, fontSize: 14, fontWeight: '900' },
  voiceRecordButtonTextActive: { color: white },
  chatInput: {
    flex: 1,
    minWidth: 0,
    height: 50,
    borderWidth: 1,
    borderColor: '#D6D6D1',
    borderRadius: 25,
    backgroundColor: '#FBFBF9',
    paddingHorizontal: 15,
    color: navy,
  },
  chatSend: {
    height: 50,
    borderRadius: 25,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 17,
  },
  chatSendText: { color: white, fontSize: 12, fontWeight: '800' },
  privateLandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  privateLandingCopy: { flex: 1, paddingRight: 10 },
  privateNewButton: {
    height: 39,
    borderRadius: 20,
    backgroundColor: '#DFF2EF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  privateNewText: { color: navy, fontSize: 11, fontWeight: '800' },
  privateSetup: {
    marginTop: 14,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#F1F7F6',
  },
  privateSetupTitle: { color: navy, fontSize: 15, fontWeight: '800' },
  privateSetupText: { color: gray, fontSize: 11, lineHeight: 16, marginTop: 4 },
  privateInviteBox: {marginTop: 13, padding: 12, borderWidth: 1, borderColor: '#BFDADB', borderRadius: 16, backgroundColor: white},
  privateInviteEyebrow: {color: '#358692', fontSize: 8, fontWeight: '900', letterSpacing: 1},
  privateInviteTitle: {marginTop: 3, color: navy, fontSize: 13.5, fontWeight: '900'},
  privateInviteText: {marginTop: 4, color: gray, fontSize: 10, lineHeight: 15},
  privateInviteActions: {flexDirection: 'row', gap: 7, marginTop: 10},
  privateInvitePrimary: {flex: 1, minHeight: 42, paddingHorizontal: 9, borderRadius: 21, backgroundColor: navy, alignItems: 'center', justifyContent: 'center'},
  privateInvitePrimaryText: {color: white, fontSize: 10, fontWeight: '900'},
  privateInviteSecondary: {flex: 1, minHeight: 42, paddingHorizontal: 9, borderWidth: 1, borderColor: '#BFDADB', borderRadius: 21, backgroundColor: '#F4FAF9', alignItems: 'center', justifyContent: 'center'},
  privateInviteSecondaryText: {color: navy, fontSize: 10, fontWeight: '900'},
  privateInviteResult: {marginTop: 10, padding: 10, borderRadius: 13, backgroundColor: '#ECF7F5', alignItems: 'center'},
  privateInviteCode: {color: navy, fontSize: 19, fontWeight: '900', letterSpacing: 2.5},
  privateInviteLink: {maxWidth: '100%', marginTop: 4, color: '#557685', fontSize: 8.5},
  privateInviteInput: {height: 45, marginTop: 10, paddingHorizontal: 13, borderWidth: 1, borderColor: '#BFDADB', borderRadius: 14, color: navy, backgroundColor: white, fontSize: 12, fontWeight: '800', letterSpacing: 1.2},
  participantChoices: { gap: 7, marginTop: 13 },
  participantChoice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D6E1E0',
    borderRadius: 15,
    backgroundColor: white,
    paddingHorizontal: 9,
  },
  participantChoiceSelected: { backgroundColor: navy, borderColor: navy },
  participantAvatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#E0F1EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantAvatarSelected: { backgroundColor: '#284664' },
  participantAvatarText: { color: navy, fontSize: 12, fontWeight: '900' },
  participantAvatarTextSelected: { color: '#78D9DD' },
  participantChoiceText: {
    flex: 1,
    color: navy,
    fontSize: 12.5,
    fontWeight: '800',
    marginHorizontal: 9,
  },
  participantChoiceTextSelected: { color: white },
  participantCheck: { color: '#5C8E94', fontSize: 18, fontWeight: '800' },
  participantCheckSelected: { color: '#78D9DD' },
  privateGroupInput: {
    height: 48,
    borderWidth: 1,
    borderColor: '#CEDCDA',
    borderRadius: 14,
    backgroundColor: white,
    paddingHorizontal: 13,
    color: navy,
    marginTop: 11,
  },
  privateCreateButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  privateCreateText: { color: white, fontSize: 12.5, fontWeight: '800' },
  privateProfileNotice: {
    padding: 11,
    borderRadius: 13,
    backgroundColor: '#FFF5E8',
    marginTop: 10,
  },
  privateProfileNoticeText: {
    color: '#855D27',
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
    fontWeight: '700',
  },
  privateList: { gap: 8, marginTop: 14 },
  privateChatRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DFE3E0',
    borderRadius: 17,
    backgroundColor: '#FBFBF9',
    padding: 10,
  },
  privateChatRowPending: { borderColor: '#9ECFD0', backgroundColor: '#F0FAF8' },
  privateChatIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateChatIconText: { color: '#65CFD4', fontSize: 10, fontWeight: '900' },
  privateChatCopy: { flex: 1, marginLeft: 11 },
  privateChatTitle: { color: navy, fontSize: 13.5, fontWeight: '800' },
  privateChatPreview: { color: gray, fontSize: 10.5, marginTop: 4 },
  privateChatArrow: { color: '#82909C', fontSize: 26 },
  privatePendingPill: {
    height: 25,
    borderRadius: 13,
    backgroundColor: '#D8F0ED',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  privatePendingPillText: {
    color: '#287A81',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  privateEmpty: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 27,
  },
  privateEmptyIcon: { color: '#5DBBC0', fontSize: 27, fontWeight: '800' },
  privateEmptyTitle: {
    color: navy,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 6,
  },
  privateEmptyText: {
    color: gray,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 5,
  },
  privateConversationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 17,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEAE5',
  },
  privateBackButton: {
    width: 39,
    height: 39,
    borderRadius: 20,
    backgroundColor: '#EDF5F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateBackText: { color: navy, fontSize: 28, lineHeight: 29 },
  privateConversationCopy: { flex: 1, marginLeft: 11 },
  privateConversationTitle: { color: navy, fontSize: 16, fontWeight: '800' },
  privateConversationMembers: { color: gray, fontSize: 10.5, marginTop: 3 },
  privateInvitation: {
    marginTop: 15,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#EEF8F6',
  },
  privateInvitationEyebrow: {
    color: '#3F9399',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  privateInvitationTitle: {
    color: navy,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 7,
  },
  privateInvitationText: {
    color: gray,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 5,
  },
  privateActions: { flexDirection: 'row', gap: 8, marginTop: 15 },
  privateDecline: {
    flex: 1,
    height: 45,
    borderWidth: 1,
    borderColor: '#D5C9C5',
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: white,
  },
  privateDeclineText: { color: '#9D4C43', fontSize: 12, fontWeight: '800' },
  privateAccept: {
    flex: 1,
    height: 45,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: navy,
  },
  privateAcceptText: { color: white, fontSize: 12, fontWeight: '800' },
  privateMemberStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 13,
  },
  privateMemberChip: {
    maxWidth: '48%',
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 15,
    backgroundColor: '#F0F4F3',
    paddingHorizontal: 9,
  },
  privateMemberDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#A7AFB5',
    marginRight: 6,
  },
  privateMemberDotOnline: { backgroundColor: '#54BFC4' },
  privateMemberName: { color: '#526475', fontSize: 9.5, fontWeight: '700' },
  privateStatus: {
    color: '#3D7780',
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 11,
  },
  hostCard: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 24,
    backgroundColor: white,
    padding: 18,
  },
  mobileSource: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    borderRadius: 17,
    backgroundColor: '#F1F7F6',
    marginBottom: 19,
  },
  mobileSourceIcon: {
    width: 45,
    height: 45,
    borderRadius: 14,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileSourceIconText: { color: white, fontSize: 20 },
  mobileSourceCopy: { flex: 1, marginLeft: 12 },
  mobileSourceTitle: { color: navy, fontSize: 14, fontWeight: '800' },
  mobileSourceText: { color: gray, fontSize: 11, marginTop: 3 },
  broadcastSetupStack: {marginTop: 2, marginBottom: 5},
  broadcastDisclosure: {marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#D9E7E6', borderRadius: 17, backgroundColor: '#F8FBFA'},
  broadcastDisclosureHeader: {minHeight: 66, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center'},
  broadcastDisclosureIcon: {width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDF2F0'},
  broadcastDisclosureIconText: {color: navy, fontSize: 15, fontWeight: '900'},
  broadcastDisclosureCopy: {flex: 1, minWidth: 0, marginHorizontal: 11},
  broadcastDisclosureTitle: {color: navy, fontSize: 12.5, fontWeight: '900'},
  broadcastDisclosureState: {marginTop: 3, color: '#3D818A', fontSize: 10.5, fontWeight: '700'},
  broadcastDisclosureChevron: {width: 27, color: '#3D818A', fontSize: 18, fontWeight: '700', textAlign: 'center'},
  broadcastDisclosureBody: {padding: 11, borderTopWidth: 1, borderTopColor: '#E1ECEB', backgroundColor: white},
  broadcastRoomTypes: {marginBottom: 4, flexDirection: 'row', flexWrap: 'wrap'},
  broadcastRoomType: {minHeight: 36, marginRight: 6, marginBottom: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: border, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FBFA'},
  broadcastRoomTypeActive: {borderColor: navy, backgroundColor: navy},
  broadcastRoomTypeText: {color: '#45697A', fontSize: 10.5, fontWeight: '800'},
  broadcastRoomTypeTextActive: {color: white},
  broadcastExperienceTitle: {marginBottom: 4, color: navy, fontSize: 14, fontWeight: '900'},
  broadcastRoomTypeDescription: {marginBottom: 15, color: '#607D8E', fontSize: 11, lineHeight: 16},
  broadcastFeaturePanel: {overflow: 'hidden', borderWidth: 1, borderColor: '#D9E7E6', borderRadius: 15, backgroundColor: '#F5FAF9'},
  broadcastFeatureHeading: {padding: 12, borderBottomWidth: 1, borderBottomColor: '#DDEAE9'},
  broadcastFeatureTitle: {color: '#318895', fontSize: 9, fontWeight: '900', letterSpacing: 1.2},
  broadcastFeatureHelp: {marginTop: 3, color: '#607D8E', fontSize: 10.5},
  broadcastFeatureRow: {minHeight: 60, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E2ECEB', flexDirection: 'row', alignItems: 'center'},
  broadcastFeatureRowDisabled: {opacity: 0.45, backgroundColor: '#EDF1F1'},
  broadcastFeatureCopy: {flex: 1, paddingVertical: 9, paddingRight: 10},
  broadcastFeatureLabel: {color: navy, fontSize: 12, fontWeight: '900'},
  broadcastFeatureDetail: {marginTop: 3, color: '#6A8490', fontSize: 9.5, lineHeight: 13},
  broadcastRightsCard: {marginTop: 8, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#AFC2C3', borderRadius: 17, backgroundColor: '#F8FAF9'},
  broadcastRightsHeader: {minHeight: 72, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center'},
  broadcastRightsIcon: {width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: navy},
  broadcastRightsIconText: {color: white, fontSize: 18, fontWeight: '900'},
  broadcastRightsHeading: {flex: 1, minWidth: 0, marginHorizontal: 11},
  broadcastRightsEyebrow: {color: '#5B747E', fontSize: 8, fontWeight: '900', letterSpacing: 1.1},
  broadcastRightsTitle: {marginTop: 2, color: navy, fontSize: 13, fontWeight: '900'},
  broadcastRightsState: {marginTop: 3, color: '#697D85', fontSize: 9.5, fontWeight: '700'},
  broadcastRightsStateAccepted: {color: '#1E6B5B'},
  broadcastRightsBody: {padding: 12, borderTopWidth: 1, borderTopColor: '#DCE7E6', backgroundColor: white},
  broadcastRightsWelcome: {padding: 10, borderRadius: 12, color: '#536D78', backgroundColor: '#EEF5F3', fontSize: 10.5, lineHeight: 16},
  broadcastRightsWelcomeStrong: {color: navy, fontWeight: '900'},
  broadcastRightsLegal: {marginTop: 10, color: '#596F79', fontSize: 9.5, lineHeight: 15, textAlign: 'justify'},
  broadcastRightsCheck: {marginTop: 11, padding: 11, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1.5, borderColor: '#80979B', borderRadius: 13, backgroundColor: '#FFFFFF'},
  broadcastRightsCheckAccepted: {borderColor: '#37786C', backgroundColor: '#F3F9F6'},
  broadcastRightsCheckbox: {width: 21, height: 21, marginTop: 1, marginRight: 10, borderWidth: 1.5, borderColor: '#71898E', borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: white},
  broadcastRightsCheckboxAccepted: {borderColor: navy, backgroundColor: navy},
  broadcastRightsCheckboxText: {color: white, fontSize: 13, fontWeight: '900'},
  broadcastRightsCheckText: {flex: 1, color: '#405963', fontSize: 10, lineHeight: 15},
  broadcastRightsCheckStrong: {color: navy, fontWeight: '900'},
  broadcastRightsFootnote: {marginTop: 8, color: '#788A91', fontSize: 8.5},
  hostInput: {
    height: 50,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 14,
    backgroundColor: '#FBFBF9',
    paddingHorizontal: 14,
    color: navy,
    marginBottom: 15,
  },
  hostCodeInput: {
    height: 55,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 14,
    backgroundColor: '#FBFBF9',
    color: navy,
    textAlign: 'center',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 5,
    marginBottom: 15,
  },
  hostQr: { width: 210, height: 210, marginTop: 22 },
  hostRoomCode: {
    color: navy,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 7,
    marginTop: 11,
  },
  shareButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 25,
    marginTop: 13,
  },
  shareButtonText: { color: white, fontSize: 13, fontWeight: '800' },
  instructions: {
    borderWidth: 1,
    borderColor: border,
    borderRadius: 24,
    backgroundColor: white,
    padding: 20,
    gap: 17,
  },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: '#E7F5F3',
    color: navy,
    fontWeight: '800',
  },
  stepText: {
    flex: 1,
    color: gray,
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 12,
  },
  strong: { color: navy, fontWeight: '800' },
});

export default App;
