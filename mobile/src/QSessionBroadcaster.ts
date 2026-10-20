import {AudioSession} from '@livekit/react-native';
import {Room, RoomEvent} from 'livekit-client';
import {QSessionApi} from './core/QSessionApi';
import {
  CreateRoomRequest,
  QSessionRoom,
  ROOM_EXPERIENCE_PRESETS,
  ROOM_PRESETS,
  RoomExperience,
  RoomFeatures,
  RoomKind,
  RoomVisibility,
} from './core/QSessionContracts';
import {
  QSESSION_BROADCAST_CAPTURE_OPTIONS,
  QSESSION_BROADCAST_PUBLISH_OPTIONS,
  qsessionMusicAudioTypeOptions,
} from './QSessionAudioQuality';

export type BroadcastState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export type BroadcastRoom = {
  code: string;
  joinUrl: string;
  name?: string | null;
  djName?: string | null;
  visibility: RoomVisibility;
  roomType: RoomKind;
};

type BroadcastCallbacks = {
  onState: (state: BroadcastState, detail?: string) => void;
  onRoom: (room: BroadcastRoom | null) => void;
  onListenerCount: (count: number) => void;
};

export type StartBroadcastOptions = Partial<RoomFeatures & RoomExperience> & {
  name?: string;
  djName?: string;
  description?: string;
  roomType?: RoomKind;
  visibility?: RoomVisibility;
  scheduledAt?: string | null;
  timeZone?: string;
  capacity?: number;
  sponsors?: string[];
  password?: string;
  rightsDeclaration?: CreateRoomRequest['rightsDeclaration'];
};

export class QSessionBroadcasterClient {
  private readonly callbacks: BroadcastCallbacks;
  private mediaRoom: Room | null = null;
  private api: QSessionApi | null = null;
  private shouldRun = false;
  private hostToken = '';
  private roomCode = '';

  constructor(callbacks: BroadcastCallbacks) {
    this.callbacks = callbacks;
  }

  async start(serverUrl: string, options: StartBroadcastOptions = {}): Promise<BroadcastRoom> {
    this.stop(false);
    this.shouldRun = true;
    this.api = new QSessionApi(serverUrl);
    this.callbacks.onState('connecting', 'Creando la sala en Q Session y preparando el micrófono…');

    try {
      if (!options.rightsDeclaration?.accepted) {
        throw new Error('Debes aceptar la declaración de derechos antes de crear la sala.');
      }
      const roomType = options.roomType || 'music';
      const preset = ROOM_PRESETS[roomType];
      const experiencePreset = ROOM_EXPERIENCE_PRESETS[roomType as keyof typeof ROOM_EXPERIENCE_PRESETS]
        || ROOM_EXPERIENCE_PRESETS.custom;
      const input: CreateRoomRequest = {
        name: options.name?.trim() || 'Sesión móvil',
        djName: options.djName?.trim() || 'Anfitrión móvil',
        description: options.description?.trim() || undefined,
        roomType,
        visibility: options.visibility || preset.visibility,
        scheduledAt: options.scheduledAt,
        timeZone: options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        capacity: options.capacity,
        sponsors: options.sponsors,
        password: options.password,
        rightsDeclaration: options.rightsDeclaration,
        allowPublicChat: options.allowPublicChat ?? preset.allowPublicChat,
        allowGuestCameras: options.allowGuestCameras ?? preset.allowGuestCameras,
        allowSocialProfiles: options.allowSocialProfiles ?? preset.allowSocialProfiles,
        allowMatchmaking: options.allowMatchmaking ?? preset.allowMatchmaking,
        allowProfileGifts: options.allowProfileGifts ?? preset.allowProfileGifts,
        designTheme: options.designTheme ?? experiencePreset.designTheme,
        designMotion: options.designMotion ?? experiencePreset.designMotion,
        allowAiCameraEffects: options.allowAiCameraEffects ?? experiencePreset.allowAiCameraEffects,
        allowVjVisuals: options.allowVjVisuals ?? experiencePreset.allowVjVisuals,
        allowVideoSubmissions: options.allowVideoSubmissions ?? experiencePreset.allowVideoSubmissions,
        allowGreetingVideos: options.allowGreetingVideos ?? experiencePreset.allowGreetingVideos,
        allowVideoToHost: options.allowVideoToHost ?? experiencePreset.allowVideoToHost,
        allowVideoToRoom: options.allowVideoToRoom ?? experiencePreset.allowVideoToRoom,
        allowPrivateVideoSubmissions: options.allowPrivateVideoSubmissions ?? experiencePreset.allowPrivateVideoSubmissions,
      };
      const created = await this.api.createRoom(input);
      this.roomCode = created.room.code;
      this.hostToken = created.hostToken;
      const broadcastRoom = this.publicBroadcastRoom(created.room, created.joinUrl);
      this.callbacks.onRoom(broadcastRoom);

      const media = await this.api.mediaCredentials(created.room.code, 'dj', created.hostToken);
      await this.connectMedia(media.url, media.token);
      try {
        const delivery = await this.api.startBroadcastDelivery(created.room.code, created.hostToken);
        if (delivery.configured) {
          this.callbacks.onState('live', 'Micrófono activo y señal económica distribuida para la audiencia.');
        }
      } catch {
        // LiveKit continúa al aire como respaldo. La salida de borde puede
        // recuperarse sin apagar el micrófono desde otro cliente del anfitrión.
        this.callbacks.onState('live', 'Micrófono activo. La audiencia usa temporalmente la señal directa.');
      }
      return broadcastRoom;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error('No fue posible iniciar la transmisión móvil.');
      this.fail(normalized);
      throw normalized;
    }
  }

  stop(reportIdle = true) {
    const api = this.api;
    const roomCode = this.roomCode;
    const hostToken = this.hostToken;
    this.shouldRun = false;
    this.api = null;
    this.roomCode = '';
    this.hostToken = '';

    const room = this.mediaRoom;
    this.mediaRoom = null;
    if (room) {
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      void room.disconnect();
    }
    if (api && roomCode && hostToken) void api.endRoom(roomCode, hostToken).catch(() => {});
    void AudioSession.stopAudioSession().catch(() => {});
    this.callbacks.onListenerCount(0);
    this.callbacks.onRoom(null);
    if (reportIdle) this.callbacks.onState('idle');
  }

  private async connectMedia(url: string, token: string) {
    await AudioSession.configureAudio({
      android: {
        // Prefer a physical studio input and keep Android out of its
        // telephone/VoIP path. The system still handles plug and unplug events.
        preferredOutputList: ['headset', 'bluetooth', 'speaker', 'earpiece'],
        audioTypeOptions: qsessionMusicAudioTypeOptions(false),
      },
    });
    await AudioSession.startAudioSession();
    const room = new Room({adaptiveStream: false, dynacast: false, disconnectOnPageLeave: false});
    this.mediaRoom = room;
    const updateListeners = () => {
      if (this.mediaRoom !== room) return;
      this.callbacks.onListenerCount(room.remoteParticipants.size);
    };
    room
      .on(RoomEvent.ParticipantConnected, updateListeners)
      .on(RoomEvent.ParticipantDisconnected, updateListeners)
      .on(RoomEvent.Reconnecting, () => this.callbacks.onState('reconnecting', 'Recuperando la señal de audio…'))
      .on(RoomEvent.Reconnected, () => {
        this.callbacks.onState('live', 'Transmisión móvil recuperada.');
        updateListeners();
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.shouldRun && this.mediaRoom === room) {
          this.callbacks.onState('error', 'El servidor multimedia cerró la transmisión. Abre Q Session y toca reintentar.');
        }
      });
    await room.connect(url, token, {autoSubscribe: false});
    if (!this.shouldRun || this.mediaRoom !== room) {
      await room.disconnect();
      throw new Error('La transmisión se canceló antes de abrir el micrófono.');
    }
    await room.localParticipant.setMicrophoneEnabled(
      true,
      QSESSION_BROADCAST_CAPTURE_OPTIONS,
      QSESSION_BROADCAST_PUBLISH_OPTIONS,
    );
    updateListeners();
    this.callbacks.onState('live', 'Micrófono o entrada USB transmitiendo en Q Session.');
  }

  private publicBroadcastRoom(room: QSessionRoom, joinUrl: string): BroadcastRoom {
    return {
      code: room.code,
      joinUrl,
      name: room.name,
      djName: room.djName,
      visibility: room.visibility,
      roomType: room.roomType,
    };
  }

  private fail(error: Error) {
    this.callbacks.onState('error', error.message);
  }
}
