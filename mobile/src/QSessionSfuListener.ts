import {AudioSession} from '@livekit/react-native';
import {MediaStream, mediaDevices} from '@livekit/react-native-webrtc';
import {Room, RoomEvent, Track} from 'livekit-client';
import type {ListenerCallbacks, QSessionApproximateLocation, QSessionLiveChatVideo, QSessionParticipant, QSessionPrivateChat, QSessionPrivateMessage} from './QSessionListener';
import {visualAudioLevel} from './QSessionAudioMeter';
import {playback} from './platform/QSessionNativeModules';
import {QSessionApi} from './core/QSessionApi';
import {qsessionMusicAudioTypeOptions} from './QSessionAudioQuality';

function httpBaseFromServer(serverUrl: string): string {
  let value = serverUrl.trim();
  if (!/^https?:\/\//i.test(value) && !/^wss?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/ws\/?$/i, '');
  return value.replace(/\/$/, '');
}

type NativeVideoDevice = {
  deviceId?: string;
  facing?: string;
  kind?: string;
  label?: string;
};

function isFrontVideoDevice(device: NativeVideoDevice): boolean {
  const description = `${device.facing || ''} ${device.label || ''}`.toLowerCase();
  return /front|frontal|user|selfie/.test(description);
}

function isWideAngleVideoDevice(device: NativeVideoDevice): boolean {
  const label = String(device.label || '');
  return /ultra[\s-]?wide|ultrawide|wide[\s-]?angle|0[.,]5\s*[x×]|gran\s+angular|grand[\s-]?angle/i.test(label);
}

async function preferredWideFrontCameraId(): Promise<string> {
  try {
    const devices = await mediaDevices.enumerateDevices() as NativeVideoDevice[];
    return devices.find(device => (
      device.kind === 'videoinput'
      && isFrontVideoDevice(device)
      && isWideAngleVideoDevice(device)
      && device.deviceId
    ))?.deviceId || '';
  } catch {
    return '';
  }
}

async function forceWidestCameraView(mediaTrack: any): Promise<void> {
  if (!mediaTrack) return;
  try { mediaTrack.contentHint = 'motion'; } catch { /* Android puede fijarlo internamente. */ }
  try {
    const capabilities = mediaTrack.getCapabilities?.() || {};
    const settings = mediaTrack.getSettings?.() || {};
    const minimumZoom = Number(capabilities?.zoom?.min);
    const advanced: Record<string, unknown>[] = [];
    if (Number.isFinite(minimumZoom)) advanced.push({zoom: minimumZoom});
    if (capabilities?.resizeMode?.includes?.('none') && settings.resizeMode !== 'none') advanced.push({resizeMode: 'none'});
    if (advanced.length) await mediaTrack.applyConstraints?.({advanced});
  } catch {
    // Algunos fabricantes exponen la cámara completa pero rechazan constraints avanzados.
  }
}

const SOCIAL_VIDEO_LIMIT = 4;

function isDjParticipant(participant: any): boolean {
  return String(participant?.identity || '').startsWith('dj-');
}

function selectedSocialVideoPublications(room: Room | null, enabled: boolean, page = 0): Set<any> {
  const selected = new Set<any>();
  if (!room || !enabled) return selected;
  const participants = [...room.remoteParticipants.values()]
    .filter(participant => !isDjParticipant(participant))
    .sort((left, right) => String(left.identity || '').localeCompare(String(right.identity || '')));
  const available: any[] = [];
  const seenProfiles = new Set<string>();
  let localProfile = '';
  try { localProfile = JSON.parse(room.localParticipant.metadata || 'null')?.profileId || ''; } catch {}
  for (const participant of participants) {
    let profile: any;
    try { profile = JSON.parse(participant.metadata || 'null'); } catch { continue; }
    const id = String(profile?.profileId || participant.identity);
    if (!profile?.visible || id === localProfile || seenProfiles.has(id)) continue;
    const publications = [...participant.trackPublications.entries()]
      .filter(([, publication]: any) => publication.kind === Track.Kind.Video
        && !publication.isMuted
        && (!publication.source || publication.source === Track.Source.Camera))
      .sort(([leftKey, left]: any, [rightKey, right]: any) => String(
        left.trackSid || left.sid || left.trackName || leftKey,
      ).localeCompare(String(right.trackSid || right.sid || right.trackName || rightKey)));
    if (publications[0]) { available.push(publications[0][1]); seenProfiles.add(id); }
  }
  const start = (page % Math.max(1, Math.ceil(available.length / SOCIAL_VIDEO_LIMIT))) * SOCIAL_VIDEO_LIMIT;
  for (const publication of available.slice(start, start + SOCIAL_VIDEO_LIMIT)) selected.add(publication);
  return selected;
}

export class QSessionSfuListenerClient {
  private callbacks: ListenerCallbacks;
  private room: Room | null = null;
  private liveChatRoom: Room | null = null;
  private liveChatId = '';
  private liveChatMicEnabled = false;
  private liveChatSoundEnabled = true;
  private liveChatCameraEnabled = false;
  private liveChatVideoStreams = new Map<string, QSessionLiveChatVideo>();
  private roomChatMicEnabled = false;
  private roomChatTimer: ReturnType<typeof setInterval> | null = null;
  private privateChatTimer: ReturnType<typeof setInterval> | null = null;
  private roomChatSocket: WebSocket | null = null;
  private privateChatSocket: WebSocket | null = null;
  private privateChatLoading = false;
  private privateChatsInitialized = false;
  private knownPrivateChatIds = new Set<string>();
  private onlineProfileIds = new Set<string>();
  private mediaReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private audioLevelTimer: ReturnType<typeof setInterval> | null = null;
  private mediaReconnectAttempt = 0;
  private shouldRun = false;
  private hasLiveAudio = false;
  private videoStream: MediaStream | null = null;
  private broadcastPlaybackUrl = '';
  private peopleVideoEnabled = false;
  private peopleVideoPage = 0;
  private peopleVideoTimer: ReturnType<typeof setInterval> | null = null;
  private socialVideoStreams = new Map<string, MediaStream>();
  private sourceServerUrl = '';
  private roomCode = '';
  private profileId: string | null = null;
  private accountToken = '';
  private profileEditToken = '';
  private presenceLocation: QSessionApproximateLocation | null = null;
  private presenceTicket = '';
  private outputGain = 1;
  private api: QSessionApi | null = null;
  private readonly listenerId = `android-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

  constructor(callbacks: ListenerCallbacks) {
    this.callbacks = callbacks;
  }

  async start(serverUrl: string, roomCode: string): Promise<{broadcast: boolean}> {
    this.stop(false);
    this.shouldRun = true;
    this.sourceServerUrl = serverUrl.trim();
    this.roomCode = roomCode.trim().toUpperCase();
    this.callbacks.onState('connecting', 'Solicitando acceso seguro a QSession…');
    const api = new QSessionApi(httpBaseFromServer(serverUrl), fetch, this.accountToken);
    this.api = api;
    const roomInfo = await api.getRoom(this.roomCode);
    this.callbacks.onRoom?.(roomInfo);
    const connection = await api.mediaCredentials(this.roomCode, 'listener');
    this.presenceTicket = String(connection.presenceTicket || '');
    this.broadcastPlaybackUrl = connection.delivery?.kind === 'broadcast'
      ? String(connection.delivery.url || '')
      : '';
    this.callbacks.onBroadcastPlayback?.(this.broadcastPlaybackUrl || null);
    if (!this.shouldRun) return {broadcast: Boolean(this.broadcastPlaybackUrl)};
    this.startRoomChatPolling();
    this.startPrivateChatPolling();

    // Detect a physical route that existed before QSession entered the room.
    // Android dispatches later plug events correctly, but some devices do not
    // activate an already-connected USB-C or wired headset for WebRTC media.
    let existingPhysicalHeadphones = false;
    try {
      existingPhysicalHeadphones = Boolean(await playback?.hasWiredOrUsbOutput?.());
    } catch {
      // Device enumeration is an enhancement; playback must still start when a
      // manufacturer does not expose its USB audio endpoint normally.
    }

    // Listener playback must use Android's media path. Without this explicit
    // per-session configuration LiveKit's AudioSwitchManager starts with its
    // communication defaults, which can route Bluetooth headphones through
    // the narrow-band call (HFP/SCO) profile instead of high-quality A2DP.
    await AudioSession.configureAudio({
      android: {
        preferredOutputList: existingPhysicalHeadphones
          ? ['headset', 'bluetooth', 'speaker', 'earpiece']
          : ['bluetooth', 'headset', 'speaker', 'earpiece'],
        // Keep normal high-quality media routing for Bluetooth. Force manual
        // routing only when Android confirms that a USB/wired output was
        // already connected before the audio session started.
        audioTypeOptions: qsessionMusicAudioTypeOptions(existingPhysicalHeadphones),
      },
    });
    await AudioSession.setDefaultRemoteAudioTrackVolume(1);
    // Start a real media session before connecting. The media preset keeps
    // MODE_NORMAL and the music stream (A2DP for Bluetooth), while giving the
    // native playout engine a lifecycle that survives React Native pausing its
    // JavaScript thread when Android locks the screen.
    await AudioSession.startAudioSession();
    if (existingPhysicalHeadphones) {
      // AudioSwitch starts on the main thread; this selection is queued after
      // its initial device scan and activates the existing headset immediately.
      await AudioSession.selectAudioOutput('headset').catch(() => {});
    }
    const room = new Room({adaptiveStream: false, dynacast: false, disconnectOnPageLeave: false});
    this.room = room;
    this.startAudioLevelMeter(room);

    const updateCount = () => {
      if (this.room !== room) return;
      this.callbacks.onListenerCount(room.remoteParticipants.size);
      this.notifyParticipants(room);
    };
    const activateMediaTrack = (track: Track, participantIdentity = '') => {
      if (this.room !== room) return;
      if (track.kind === Track.Kind.Video) {
        const stream = new MediaStream([track.mediaStreamTrack]);
        if (participantIdentity.startsWith('dj-')) {
          this.videoStream = stream;
          this.callbacks.onVideoStream?.(stream.toURL());
        } else if (participantIdentity && participantIdentity !== this.listenerId) {
          this.socialVideoStreams.set(participantIdentity, stream);
          this.notifySocialVideos();
        }
        return;
      }
      if (track.kind === Track.Kind.Audio) {
        if ('setVolume' in track && typeof track.setVolume === 'function') track.setVolume(this.outputGain);
        this.hasLiveAudio = true;
        this.callbacks.onState('live', 'Audio HD mediante QSession');
      }
    };
    const subscribeToAvailableMedia = () => {
      const selectedSocialVideos = selectedSocialVideoPublications(room, this.peopleVideoEnabled, this.peopleVideoPage);
      if (this.broadcastPlaybackUrl) {
        for (const participant of room.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values()) {
            publication.setSubscribed(selectedSocialVideos.has(publication));
          }
        }
        this.hasLiveAudio = false;
        return true;
      }
      let audioReady = false;
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind !== Track.Kind.Audio && publication.kind !== Track.Kind.Video) continue;
          const isDjVideo = publication.kind === Track.Kind.Video && isDjParticipant(participant);
          const shouldSubscribe = publication.kind === Track.Kind.Audio || isDjVideo || selectedSocialVideos.has(publication);
          publication.setSubscribed(shouldSubscribe);
          if (shouldSubscribe && publication.track) {
            if (publication.kind === Track.Kind.Audio) audioReady = true;
            activateMediaTrack(publication.track, participant.identity);
          }
        }
      }
      this.hasLiveAudio = audioReady;
      return audioReady;
    };
    const reportCurrentAudio = (waitingDetail: string) => {
      if (this.room !== room) return;
      if (this.hasLiveAudio) this.callbacks.onState('live', 'Audio HD mediante QSession');
      else this.callbacks.onState('waiting', waitingDetail);
    };
    room
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => activateMediaTrack(track, participant.identity))
      .on(RoomEvent.TrackPublished, () => subscribeToAvailableMedia())
      .on(RoomEvent.TrackSubscriptionFailed, () => {
        if (this.room === room && !this.broadcastPlaybackUrl) this.callbacks.onState('error', 'QSession no pudo recibir la pista de audio del DJ.');
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Video) {
          if (participant.identity.startsWith('dj-')) {
            this.videoStream = null;
            this.callbacks.onVideoStream?.(null);
          } else {
            this.socialVideoStreams.delete(participant.identity);
            this.notifySocialVideos();
          }
          return;
        }
        if (track.kind === Track.Kind.Audio) {
          subscribeToAvailableMedia();
          reportCurrentAudio('La pista del DJ se pausó. Esperando audio…');
        }
      })
      .on(RoomEvent.ParticipantConnected, () => {
        updateCount();
        subscribeToAvailableMedia();
      })
      .on(RoomEvent.ParticipantMetadataChanged, () => {
        this.notifyParticipants(room);
        this.notifySocialVideos();
        subscribeToAvailableMedia();
      })
      .on(RoomEvent.ParticipantDisconnected, participant => {
        if (this.socialVideoStreams.delete(participant.identity)) this.notifySocialVideos();
        updateCount();
        subscribeToAvailableMedia();
        reportCurrentAudio('Esperando la señal del DJ…');
      })
      .on(RoomEvent.Reconnecting, () => {
        if (this.room === room) this.callbacks.onState('reconnecting', 'La red cambió. QSession está recuperando el audio…');
      })
      .on(RoomEvent.Reconnected, () => {
        this.mediaReconnectAttempt = 0;
        subscribeToAvailableMedia();
        reportCurrentAudio('Reconectado. Esperando la señal del DJ…');
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.room !== room || !this.shouldRun) return;
        this.hasLiveAudio = false;
        this.videoStream = null;
        this.socialVideoStreams.clear();
        this.callbacks.onVideoStream?.(null);
        this.callbacks.onSocialVideos?.([]);
        this.callbacks.onSocialCameraStream?.(null);
        this.scheduleMediaReconnect('La señal se interrumpió con la pantalla bloqueada.');
      });

    this.callbacks.onState('waiting', 'Conectando con el servidor multimedia…');
    await room.connect(connection.url, connection.token, {autoSubscribe: false});
    if (!this.shouldRun || this.room !== room) {
      await room.disconnect();
      return {broadcast: Boolean(this.broadcastPlaybackUrl)};
    }
    this.mediaReconnectAttempt = 0;
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    this.roomChatMicEnabled = false;
    this.callbacks.onRoomChatMicrophone?.(false);
    const audioReady = subscribeToAvailableMedia();
    updateCount();
    if (this.presenceLocation) this.sendListenerLocation();
    if (this.broadcastPlaybackUrl) {
      this.callbacks.onState('waiting', 'Sala encontrada. Preparando la señal distribuida…');
    } else if (!audioReady) {
      this.callbacks.onState('waiting', 'Sala encontrada. Esperando la señal del DJ…');
    }
    return {broadcast: Boolean(this.broadcastPlaybackUrl)};
  }

  fallbackToWebRtc() {
    if (!this.broadcastPlaybackUrl || !this.room) return;
    this.broadcastPlaybackUrl = '';
    this.presenceTicket = '';
    this.callbacks.onBroadcastPlayback?.(null);
    this.callbacks.onState('reconnecting', 'La distribución HLS no respondió. Recuperando la señal directa…');
    const selectedSocialVideos = selectedSocialVideoPublications(this.room, this.peopleVideoEnabled, this.peopleVideoPage);
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const isAudio = publication.kind === Track.Kind.Audio;
        const isDjVideo = publication.kind === Track.Kind.Video && isDjParticipant(participant);
        const subscribe = isAudio || isDjVideo || selectedSocialVideos.has(publication);
        publication.setSubscribed(subscribe);
      }
    }
  }

  setPeopleVideoEnabled(enabled: boolean) {
    if (this.peopleVideoTimer) clearInterval(this.peopleVideoTimer);
    this.peopleVideoTimer = enabled ? setInterval(() => {
      this.peopleVideoPage++;
      this.setPeopleVideoEnabled(true);
    }, 15000) : null;
    this.peopleVideoEnabled = enabled;
    if (!this.room) return;
    const selectedSocialVideos = selectedSocialVideoPublications(this.room, enabled, this.peopleVideoPage);
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const keepDirectProgram = !this.broadcastPlaybackUrl && (
          publication.kind === Track.Kind.Audio
          || (publication.kind === Track.Kind.Video && isDjParticipant(participant))
        );
        const subscribe = keepDirectProgram || selectedSocialVideos.has(publication);
        publication.setSubscribed(subscribe);
      }
    }
  }

  stop(reportIdle = true) {
    if (this.peopleVideoTimer) clearInterval(this.peopleVideoTimer);
    this.peopleVideoTimer = null;
    this.peopleVideoPage = 0;
    this.shouldRun = false;
    this.hasLiveAudio = false;
    this.videoStream = null;
    this.peopleVideoEnabled = false;
    this.broadcastPlaybackUrl = '';
    this.callbacks.onBroadcastPlayback?.(null);
    this.socialVideoStreams.clear();
    this.callbacks.onVideoStream?.(null);
    this.callbacks.onSocialVideos?.([]);
    this.callbacks.onSocialCameraStream?.(null);
    if (this.mediaReconnectTimer) clearTimeout(this.mediaReconnectTimer);
    this.mediaReconnectTimer = null;
    if (this.roomChatTimer) clearInterval(this.roomChatTimer);
    this.roomChatTimer = null;
    if (this.privateChatTimer) clearInterval(this.privateChatTimer);
    this.privateChatTimer = null;
    this.roomChatSocket?.close();
    this.roomChatSocket = null;
    this.privateChatSocket?.close();
    this.privateChatSocket = null;
    this.privateChatLoading = false;
    this.privateChatsInitialized = false;
    this.knownPrivateChatIds.clear();
    this.onlineProfileIds.clear();
    if (this.audioLevelTimer) clearInterval(this.audioLevelTimer);
    this.audioLevelTimer = null;
    this.callbacks.onAudioLevel?.(0);
    this.roomChatMicEnabled = false;
    this.callbacks.onRoomChatMicrophone?.(false);
    this.leaveLiveChat();
    this.api = null;
    const room = this.room;
    this.room = null;
    if (room) void room.disconnect();
    void AudioSession.stopAudioSession().catch(() => {});
    this.callbacks.onListenerCount(0);
    if (reportIdle) this.callbacks.onState('idle');
  }

  async resume() {
    if (!this.shouldRun) return;
    try {
      await AudioSession.startAudioSession();
    } catch {
      // A reconnect below can rebuild the complete native audio session.
    }
    const connectionState = String((this.room as any)?.state || '').toLowerCase();
    if (!this.room || connectionState.includes('disconnected')) {
      this.scheduleMediaReconnect('QSession está recuperando el audio al volver a la aplicación.', true);
      return;
    }
    let audioReady = Boolean(this.broadcastPlaybackUrl);
    const selectedSocialVideos = selectedSocialVideoPublications(this.room, this.peopleVideoEnabled, this.peopleVideoPage);
    this.socialVideoStreams.clear();
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind !== Track.Kind.Audio && publication.kind !== Track.Kind.Video) continue;
        const directProgram = !this.broadcastPlaybackUrl && (
          publication.kind === Track.Kind.Audio
          || (publication.kind === Track.Kind.Video && isDjParticipant(participant))
        );
        const shouldSubscribe = directProgram || selectedSocialVideos.has(publication);
        publication.setSubscribed(shouldSubscribe);
        if (shouldSubscribe && publication.track) {
          const track = publication.track;
          if (publication.kind === Track.Kind.Video) {
            const stream = new MediaStream([track.mediaStreamTrack]);
            if (isDjParticipant(participant)) {
              this.videoStream = stream;
              this.callbacks.onVideoStream?.(stream.toURL());
            } else {
              this.socialVideoStreams.set(participant.identity, stream);
            }
          } else {
            audioReady = true;
          }
          if (publication.kind === Track.Kind.Audio && 'setVolume' in track && typeof track.setVolume === 'function') {
            track.setVolume(this.outputGain);
          }
        }
      }
    }
    this.notifySocialVideos();
    this.hasLiveAudio = audioReady;
    this.callbacks.onState(
      audioReady ? 'live' : 'waiting',
      audioReady
        ? (this.broadcastPlaybackUrl ? 'Señal distribuida mediante QSession' : 'Audio HD mediante QSession')
        : 'Sala recuperada. Esperando la señal del DJ…',
    );
  }

  sendChat(text: string, kind: 'text' | 'reaction' = 'text', author?: string) {
    const cleanText = text.trim();
    if (!cleanText || !this.api || !this.accountToken) return;
    void fetch(`${this.api.origin}/api/rooms/${this.roomCode}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accountToken}`,
        'content-type': 'application/json',
        'x-qsession-client': 'mobile',
      },
      body: JSON.stringify({text: cleanText, kind, author}),
    })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || 'No fue posible enviar el mensaje.');
        if (payload?.message) this.callbacks.onChatMessage?.(payload.message);
      })
      .catch(error => this.callbacks.onPrivateChatError?.(
        error instanceof Error ? error.message : 'No fue posible enviar el mensaje.',
      ));
  }

  async setRoomChatMicrophoneEnabled(enabled: boolean) {
    const room = this.room;
    if (!room || !this.shouldRun) throw new Error('Entra a la sala antes de activar el micrófono.');
    await AudioSession.startAudioSession();
    await room.localParticipant.setMicrophoneEnabled(enabled, enabled ? {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    } : undefined);
    this.roomChatMicEnabled = enabled;
    this.callbacks.onRoomChatMicrophone?.(enabled);
  }

  createPrivateChat(memberIds: string[], title?: string) {
    const cleanMemberIds = [...new Set(memberIds.map(value => String(value || '').trim()).filter(Boolean))];
    if (!cleanMemberIds.length || !this.api || !this.accountToken) return;
    const type = cleanMemberIds.length > 1 ? 'group' : 'direct';
    void this.authenticatedRequest('/api/private-conversations', {
      method: 'POST',
      body: JSON.stringify({type, name: title, memberProfileIds: cleanMemberIds}),
    })
      .then(async payload => {
        await this.loadPrivateChats();
        if (payload?.conversation?.id) this.callbacks.onPrivateChatOpened?.(payload.conversation.id);
      })
      .catch(error => this.reportPrivateChatError(error, 'No fue posible crear la conversación.'));
  }

  async createPrivateContactInvitation(): Promise<{code: string; url: string; expiresAt: string}> {
    if (!this.api || !this.accountToken) throw new Error('Entra a una sala con tu cuenta para crear la invitación.');
    const payload = await this.authenticatedRequest('/api/private-chat-invitations', {
      method: 'POST',
      body: '{}',
    });
    return {
      code: String(payload?.invitation?.code || ''),
      url: String(payload?.invitation?.url || ''),
      expiresAt: String(payload?.invitation?.expiresAt || ''),
    };
  }

  async redeemPrivateContactInvitation(code: string): Promise<string> {
    if (!this.api || !this.accountToken) throw new Error('Entra a una sala con tu cuenta para aceptar la invitación.');
    const payload = await this.authenticatedRequest('/api/private-chat-invitations/redeem', {
      method: 'POST',
      body: JSON.stringify({code}),
    });
    await this.loadPrivateChats();
    const conversationId = String(payload?.conversation?.id || '');
    if (conversationId) this.callbacks.onPrivateChatOpened?.(conversationId);
    return conversationId;
  }

  async sendProfileAction(profileId: string, type: 'touch' | 'gift', gift?: 'flower' | 'star'): Promise<void> {
    if (!this.api || !this.accountToken) throw new Error('Entra con tu cuenta para conectar con esta persona.');
    await this.authenticatedRequest(`/api/profiles/${encodeURIComponent(profileId)}/actions`, {
      method: 'POST',
      body: JSON.stringify({type, gift, roomCode: this.roomCode || undefined}),
    });
  }

  respondPrivateChat(chatId: string, accept: boolean) {
    // Las conversaciones durables de Q Session ya aparecen únicamente para sus
    // integrantes. Este método conserva compatibilidad con invitaciones creadas
    // por versiones anteriores de la app.
    if (accept) this.callbacks.onPrivateChatOpened?.(chatId);
    else this.callbacks.onPrivateChatError?.('La conversación se conserva cerrada en este dispositivo.');
  }

  sendPrivateMessage(chatId: string, text: string) {
    const cleanText = String(text || '').trim();
    if (!chatId || !cleanText || !this.api || !this.accountToken) return;
    void this.authenticatedRequest(`/api/private-conversations/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({kind: 'text', text: cleanText}),
    })
      .then(async payload => {
        if (payload?.message) {
          this.callbacks.onPrivateMessage?.(chatId, this.normalizePrivateMessage(payload.message, chatId));
        }
        await this.loadPrivateChats();
      })
      .catch(error => this.reportPrivateChatError(error, 'No fue posible enviar el mensaje privado.'));
  }

  async sendPrivateVoiceMessage(chatId: string, audio: {dataUrl: string; mimeType: string; durationMs: number}) {
    if (!chatId || !audio?.dataUrl || !this.api || !this.accountToken) {
      throw new Error('No hay una conversación privada activa para enviar la nota de voz.');
    }
    try {
      const payload = await this.authenticatedRequest(`/api/private-conversations/${encodeURIComponent(chatId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify({
        dataUrl: audio.dataUrl,
        name: `nota-qsession-${Date.now()}.m4a`,
        durationMs: audio.durationMs,
      }),
      });
      if (payload?.message) this.callbacks.onPrivateMessage?.(chatId, this.normalizePrivateMessage(payload.message, chatId));
      await this.loadPrivateChats();
    } catch (error) {
      this.reportPrivateChatError(error, 'No fue posible enviar la nota de voz.');
      throw error;
    }
  }

  requestLiveChat(chatId: string, start: boolean) {
    this.callbacks.onLiveChatState?.({chatId, status: 'connecting', micEnabled: false, soundEnabled: this.liveChatSoundEnabled, cameraEnabled: false, participants: 0, message: 'Conectando el grupo…'});
    if (!this.api || !this.accountToken) return;
    void this.authenticatedRequest(`/api/private-conversations/${encodeURIComponent(chatId)}/voice-token`, {
      method: 'POST',
      body: JSON.stringify({start}),
    })
      .then(payload => this.connectLiveChat(chatId, payload))
      .catch(error => {
        this.callbacks.onLiveChatState?.({
          chatId,
          status: 'error',
          micEnabled: false,
          soundEnabled: this.liveChatSoundEnabled,
          cameraEnabled: false,
          participants: 0,
          message: error instanceof Error ? error.message : 'No fue posible abrir el chat en vivo.',
        });
      });
  }

  async setLiveChatMicrophoneEnabled(enabled: boolean) {
    if (!this.liveChatRoom) throw new Error('Primero entra al chat en vivo.');
    await this.liveChatRoom.localParticipant.setMicrophoneEnabled(enabled, enabled ? {echoCancellation: true, noiseSuppression: true, autoGainControl: true} : undefined);
    this.liveChatMicEnabled = enabled;
    this.notifyLiveChat();
  }

  async setLiveChatCameraEnabled(enabled: boolean): Promise<string | null> {
    const room = this.liveChatRoom;
    if (!room) throw new Error('Primero entra a la llamada.');
    if (!enabled) {
      await room.localParticipant.setCameraEnabled(false).catch(async () => {
        const camera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (camera) await room.localParticipant.unpublishTrack(camera, true);
      });
      this.liveChatCameraEnabled = false;
      this.liveChatVideoStreams.delete(room.localParticipant.identity);
      this.callbacks.onLiveChatVideos?.([...this.liveChatVideoStreams.values()]);
      this.notifyLiveChat('Cámara apagada. La llamada de audio continúa.');
      return null;
    }
    const wideFrontCameraId = await preferredWideFrontCameraId();
    const captureOptions = {
      facingMode: 'user',
      frameRate: 24,
      resolution: {width: 960, height: 1280, aspectRatio: 3 / 4, frameRate: 24},
      ...(wideFrontCameraId ? {deviceId: {exact: wideFrontCameraId}} : {}),
    } as const;
    let publication;
    try {
      publication = await room.localParticipant.setCameraEnabled(true, captureOptions);
    } catch (error) {
      if (!wideFrontCameraId) throw error;
      publication = await room.localParticipant.setCameraEnabled(true, {
        facingMode: 'user', frameRate: 24,
        resolution: {width: 960, height: 1280, aspectRatio: 3 / 4, frameRate: 24},
      });
    }
    const mediaTrack = publication?.track?.mediaStreamTrack;
    if (!mediaTrack) throw new Error('No fue posible abrir la cámara frontal.');
    await forceWidestCameraView(mediaTrack);
    await room.localParticipant.setAttributes({
      'qsession.cameraOrientation': 'portrait',
      'qsession.cameraOrientationMode': 'automatic',
      'qsession.cameraDeviceClass': 'mobile',
      'qsession.cameraFrameWidth': String((mediaTrack as any).getSettings?.().width || 960),
      'qsession.cameraFrameHeight': String((mediaTrack as any).getSettings?.().height || 1280),
      'qsession.cameraRotation': 'none',
      'qsession.cameraFormatVersion': '4',
      'qsession.cameraFraming': 'far',
    }).catch(() => {});
    const streamURL = new MediaStream([mediaTrack]).toURL();
    this.liveChatCameraEnabled = true;
    this.liveChatVideoStreams.set(room.localParticipant.identity, {
      participantId: room.localParticipant.identity,
      displayName: 'Tú',
      streamURL,
      local: true,
    });
    this.callbacks.onLiveChatVideos?.([...this.liveChatVideoStreams.values()]);
    this.notifyLiveChat('Cámara vertical activa en gran angular.');
    return streamURL;
  }

  setLiveChatSoundEnabled(enabled: boolean) {
    this.liveChatSoundEnabled = enabled;
    for (const participant of this.liveChatRoom?.remoteParticipants.values() || []) {
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (track?.kind === Track.Kind.Audio && 'setVolume' in track && typeof track.setVolume === 'function') track.setVolume(enabled ? 1 : 0);
      }
    }
    this.notifyLiveChat();
  }

  leaveLiveChat() {
    const room = this.liveChatRoom;
    const chatId = this.liveChatId;
    this.liveChatRoom = null;
    this.liveChatId = '';
    this.liveChatMicEnabled = false;
    this.liveChatCameraEnabled = false;
    this.liveChatVideoStreams.clear();
    this.callbacks.onLiveChatVideos?.([]);
    if (room) {
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      void room.disconnect();
    }
    if (chatId) this.callbacks.onLiveChatState?.({chatId, status: 'idle', micEnabled: false, soundEnabled: this.liveChatSoundEnabled, cameraEnabled: false, participants: 0});
  }

  private notifyLiveChat(message?: string) {
    const room = this.liveChatRoom;
    if (!room || !this.liveChatId) return;
    this.callbacks.onLiveChatState?.({
      chatId: this.liveChatId,
      status: 'live',
      micEnabled: this.liveChatMicEnabled,
      soundEnabled: this.liveChatSoundEnabled,
      cameraEnabled: this.liveChatCameraEnabled,
      participants: Math.max(1, room.numParticipants),
      message,
    });
  }

  private async connectLiveChat(chatId: string, media: {url: string; token: string}) {
    this.leaveLiveChat();
    this.liveChatId = chatId;
    const room = new Room({adaptiveStream: false, dynacast: false, disconnectOnPageLeave: false});
    this.liveChatRoom = room;
    room
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio && 'setVolume' in track && typeof track.setVolume === 'function') track.setVolume(this.liveChatSoundEnabled ? 1 : 0);
        if (track.kind === Track.Kind.Video) {
          this.liveChatVideoStreams.set(participant.identity, {
            participantId: participant.identity,
            displayName: participant.name || 'Persona invitada',
            streamURL: new MediaStream([track.mediaStreamTrack]).toURL(),
          });
          this.callbacks.onLiveChatVideos?.([...this.liveChatVideoStreams.values()]);
        }
        this.notifyLiveChat();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Video) {
          this.liveChatVideoStreams.delete(participant.identity);
          this.callbacks.onLiveChatVideos?.([...this.liveChatVideoStreams.values()]);
        }
      })
      .on(RoomEvent.ParticipantConnected, () => this.notifyLiveChat())
      .on(RoomEvent.ParticipantDisconnected, () => this.notifyLiveChat())
      .on(RoomEvent.Reconnecting, () => this.callbacks.onLiveChatState?.({chatId, status: 'connecting', micEnabled: this.liveChatMicEnabled, soundEnabled: this.liveChatSoundEnabled, participants: Math.max(1, room.numParticipants), message: 'Recuperando la conversación…'}))
      .on(RoomEvent.Disconnected, () => {
        if (this.liveChatRoom !== room) return;
        this.liveChatRoom = null;
        this.liveChatId = '';
        this.liveChatMicEnabled = false;
        this.liveChatCameraEnabled = false;
        this.liveChatVideoStreams.clear();
        this.callbacks.onLiveChatVideos?.([]);
        this.callbacks.onLiveChatState?.({chatId, status: 'idle', micEnabled: false, soundEnabled: this.liveChatSoundEnabled, cameraEnabled: false, participants: 0});
      });
    await room.connect(media.url, media.token, {autoSubscribe: true});
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    this.liveChatMicEnabled = false;
    this.liveChatCameraEnabled = false;
    this.notifyLiveChat('Entraste con cámara y micrófono apagados.');
  }

  setProfile(profileId: string, accountToken = '', profileEditToken = '') {
    this.profileId = profileId || null;
    this.accountToken = accountToken;
    this.profileEditToken = profileEditToken;
    if (this.sourceServerUrl) {
      this.api = new QSessionApi(httpBaseFromServer(this.sourceServerUrl), fetch, accountToken);
      this.startRoomChatPolling();
      this.startPrivateChatPolling();
      void this.syncLocalParticipantProfile();
    }
  }

  setListenerLocation(location: QSessionApproximateLocation) {
    this.presenceLocation = location;
    this.sendListenerLocation();
  }

  clearListenerLocation() {
    this.presenceLocation = null;
    if (this.api && this.accountToken) {
      void this.authenticatedRequest('/api/global-rave/presence', {method: 'DELETE'}).catch(() => {});
    }
  }

  private sendListenerLocation() {
    const location = this.presenceLocation;
    if (!location || !this.api || !this.accountToken || !this.roomCode || !this.room || !this.shouldRun) return;
    void this.authenticatedRequest('/api/global-rave/presence', {
      method: 'POST',
      body: JSON.stringify({
        roomCode: this.roomCode,
        countryCode: location.countryCode,
        presenceTicket: this.presenceTicket,
      }),
    }).catch(() => {
      // La transmisión debe continuar aunque el mapa global no pueda actualizarse.
    });
  }

  setOutputGain(gain: number) {
    this.outputGain = Math.max(0.501, Math.min(1, Number(gain) || 1));
    for (const participant of this.room?.remoteParticipants.values() || []) {
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (track?.kind === Track.Kind.Audio && 'setVolume' in track && typeof track.setVolume === 'function') {
          track.setVolume(this.outputGain);
        }
      }
    }
  }

  async setSocialCameraEnabled(enabled: boolean): Promise<string | null> {
    const room = this.room;
    if (!room || !this.shouldRun) throw new Error('Entra a una sala antes de activar tu cámara.');
    if (!enabled) {
      const camera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (camera) await room.localParticipant.unpublishTrack(camera, true);
      this.callbacks.onSocialCameraStream?.(null);
      return null;
    }
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    this.roomChatMicEnabled = false;
    this.callbacks.onRoomChatMicrophone?.(false);
    const wideFrontCameraId = await preferredWideFrontCameraId();
    const captureOptions = {
      facingMode: 'user',
      frameRate: 24,
      // 3:4 retains the full width of a typical phone sensor. A 9:16 request
      // can crop the sides and make a face appear much closer than it is.
      resolution: {width: 960, height: 1280, aspectRatio: 3 / 4, frameRate: 24},
      ...(wideFrontCameraId ? {deviceId: {exact: wideFrontCameraId}} : {}),
    } as const;
    let publication;
    try {
      publication = await room.localParticipant.setCameraEnabled(true, captureOptions);
    } catch (error) {
      if (!wideFrontCameraId) throw error;
      publication = await room.localParticipant.setCameraEnabled(true, {
        facingMode: 'user',
        frameRate: 24,
        resolution: {width: 960, height: 1280, aspectRatio: 3 / 4, frameRate: 24},
      });
    }
    const mediaTrack = publication?.track?.mediaStreamTrack;
    if (!mediaTrack) throw new Error('No fue posible abrir la cámara frontal.');
    await forceWidestCameraView(mediaTrack);
    await room.localParticipant.setAttributes({
      'qsession.cameraOrientation': 'portrait',
      'qsession.cameraOrientationMode': 'automatic',
      'qsession.cameraDeviceClass': 'mobile',
      'qsession.cameraFrameWidth': String(mediaTrack.getSettings?.().width || 960),
      'qsession.cameraFrameHeight': String(mediaTrack.getSettings?.().height || 1280),
      'qsession.cameraRotation': 'none',
      'qsession.cameraFormatVersion': '4',
      'qsession.cameraFraming': 'far',
    }).catch(() => {});
    const streamURL = new MediaStream([mediaTrack]).toURL();
    this.callbacks.onSocialCameraStream?.(streamURL);
    return streamURL;
  }

  reportMessage(messageId: string) {
    void messageId;
    this.callbacks.onPrivateChatError?.('La denuncia no pudo enviarse porque el API de moderación todavía no está disponible.');
  }

  private notifySocialVideos() {
    this.callbacks.onSocialVideos?.([...this.socialVideoStreams.entries()].map(([participantId, stream]) => ({
      participantId: (() => {
        try {
          const participant = this.room?.remoteParticipants.get(participantId);
          const profile = JSON.parse(participant?.metadata || 'null');
          return String(profile?.profileId || participantId);
        } catch {
          return participantId;
        }
      })(),
      streamURL: stream.toURL(),
    })));
  }

  private notifyParticipants(room: Room) {
    if (this.room !== room) return;
    const participants: QSessionParticipant[] = [];
    const appendParticipant = (participant: any) => {
      try {
        const profile = JSON.parse(participant.metadata || 'null');
        if (!profile?.visible || !profile?.profileId) return;
        participants.push({
          id: String(profile.profileId),
          displayName: String(profile.displayName || participant.name || 'Persona Q Session'),
          avatarUrl: profile.avatarUrl || null,
          city: profile.city || null,
          interests: [],
          visible: true,
          canMessage: Boolean(profile.social?.allowMessages),
          canMatch: Boolean(profile.social?.allowMatchmaking),
          online: true,
        });
      } catch {
        // Un participante sin perfil público puede escuchar sin aparecer en Personas.
      }
    };
    appendParticipant(room.localParticipant);
    for (const participant of room.remoteParticipants.values()) appendParticipant(participant);
    this.onlineProfileIds = new Set(participants.map(participant => participant.id));
    this.callbacks.onParticipants?.(participants, this.profileId || room.localParticipant.identity);
  }

  private async syncLocalParticipantProfile() {
    const room = this.room;
    const localParticipant = room?.localParticipant as any;
    if (!room || !localParticipant?.setMetadata) return;
    if (!this.profileId || !this.accountToken || !this.api) {
      await localParticipant.setMetadata('').catch(() => {});
      if (this.room === room) this.notifyParticipants(room);
      return;
    }
    try {
      const account = await this.authenticatedRequest('/api/account');
      if (this.room !== room || !account?.profile) return;
      const profile = account.profile;
      const metadata = profile.visible ? {
        profileId: profile.id,
        visible: true,
        displayName: profile.displayName || 'Persona Q Session',
        role: profile.role === 'dj' ? 'dj' : 'listener',
        avatarUrl: profile.avatarUrl || profile.photos?.[0]?.url || null,
        city: profile.social?.showResidence ? profile.city || null : null,
        country: profile.social?.showResidence ? profile.country || null : null,
        social: {
          allowMatchmaking: Boolean(profile.social?.allowMatchmaking),
          allowMessages: Boolean(profile.social?.allowMessages),
          allowTips: Boolean(profile.social?.allowTips),
        },
      } : null;
      await localParticipant.setMetadata(metadata ? JSON.stringify(metadata) : '');
      if (this.room === room) this.notifyParticipants(room);
    } catch {
      // La sesión multimedia continúa aunque el perfil tarde en sincronizarse.
    }
  }

  private authorizationHeaders(extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${this.accountToken}`,
      'content-type': 'application/json',
      'x-qsession-client': 'mobile',
      ...extra,
    };
  }

  private async authenticatedRequest(path: string, init: RequestInit = {}) {
    if (!this.api || !this.accountToken) throw new Error('Inicia sesión para usar el chat.');
    const response = await fetch(`${this.api.origin}${path}`, {
      ...init,
      headers: this.authorizationHeaders((init.headers || {}) as Record<string, string>),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Q Session no pudo completar la solicitud.');
    return payload;
  }

  private reportPrivateChatError(error: unknown, fallback: string) {
    this.callbacks.onPrivateChatError?.(error instanceof Error ? error.message : fallback);
  }

  private normalizePrivateMessage(message: any, chatId: string): QSessionPrivateMessage {
    const kind: QSessionPrivateMessage['kind'] = ['voice', 'image', 'video'].includes(message?.kind) ? message.kind : 'text';
    const audio = kind === 'voice' ? (message?.audio || message?.media || {}) : null;
    const audioUrl = String(audio?.url || '');
    return {
      id: String(message?.id || ''),
      chatId: String(message?.conversationId || chatId),
      senderId: String(message?.profileId || ''),
      author: String(message?.author || 'Oyente'),
      kind,
      text: String(message?.text || ''),
      ...(audio ? {audio: {
        dataUrl: String(audio?.dataUrl || ''),
        mimeType: String(audio?.mimeType || audio?.contentType || 'audio/mp4'),
        durationMs: Math.max(0, Number(audio?.durationMs) || 0),
        ...(audioUrl ? {url: /^https?:\/\//i.test(audioUrl) ? audioUrl : `${this.api?.origin || ''}${audioUrl}`} : {}),
      }} : {}),
      createdAt: String(message?.createdAt || new Date().toISOString()),
    };
  }

  private normalizePrivateChat(conversation: any, messages: any[] = []): QSessionPrivateChat {
    return {
      id: String(conversation?.id || ''),
      kind: conversation?.type === 'group' ? 'group' : 'direct',
      title: String(conversation?.title || conversation?.name || 'Chat privado'),
      createdBy: String(conversation?.ownerProfileId || ''),
      status: conversation?.status === 'pending' ? 'pending' : 'accepted',
      members: Array.isArray(conversation?.members) ? conversation.members.map((member: any) => ({
        id: String(member?.id || ''),
        displayName: String(member?.displayName || 'Oyente'),
        avatarUrl: member?.avatarUrl || null,
        interests: [],
        visible: member?.visible !== false,
        canMessage: true,
        canMatch: false,
        online: this.onlineProfileIds.has(String(member?.id || '')),
        ...(member?.status ? {status: member.status} : {}),
      })) : [],
      messages: messages.map(message => this.normalizePrivateMessage(message, conversation.id)),
      liveVoiceEnabled: Boolean(conversation?.liveVoiceEnabled),
      createdAt: String(conversation?.createdAt || new Date().toISOString()),
      updatedAt: String(conversation?.updatedAt || conversation?.createdAt || new Date().toISOString()),
    };
  }

  private startPrivateChatPolling() {
    if (this.privateChatTimer) clearInterval(this.privateChatTimer);
    this.privateChatTimer = null;
    if (!this.shouldRun || !this.accountToken || !this.profileId || !this.api) return;
    void this.loadPrivateChats();
    this.privateChatTimer = setInterval(() => {
      if (!this.privateChatSocket || this.privateChatSocket.readyState !== WebSocket.OPEN) void this.loadPrivateChats();
    }, 15000);
  }

  private async loadPrivateChats() {
    if (this.privateChatLoading || !this.shouldRun || !this.accountToken || !this.profileId || !this.api) return;
    this.privateChatLoading = true;
    try {
      const payload = await this.authenticatedRequest('/api/private-conversations');
      const conversations = Array.isArray(payload?.conversations) ? payload.conversations : [];
      const chats = await Promise.all(conversations.map(async (conversation: any) => {
        if (conversation?.status === 'pending') return this.normalizePrivateChat(conversation);
        try {
          const history = await this.authenticatedRequest(
            `/api/private-conversations/${encodeURIComponent(conversation.id)}/messages?limit=100`,
          );
          return this.normalizePrivateChat(history?.conversation || conversation, history?.messages || []);
        } catch {
          return this.normalizePrivateChat(conversation);
        }
      }));
      const nextIds = new Set(chats.map(chat => chat.id));
      if (this.privateChatsInitialized) {
        for (const chat of chats) {
          if (!this.knownPrivateChatIds.has(chat.id) && chat.createdBy !== this.profileId) {
            this.callbacks.onPrivateChatInvite?.(chat.id);
          }
        }
      }
      this.privateChatsInitialized = true;
      this.knownPrivateChatIds = nextIds;
      this.callbacks.onPrivateChats?.(chats);
      this.connectRealtimeSocket('private', payload?.realtime);
    } catch (error) {
      this.reportPrivateChatError(error, 'No fue posible actualizar las conversaciones privadas.');
    } finally {
      this.privateChatLoading = false;
    }
  }

  private startRoomChatPolling() {
    if (this.roomChatTimer) clearInterval(this.roomChatTimer);
    this.roomChatTimer = null;
    if (!this.shouldRun || !this.accountToken || !this.roomCode) return;
    void this.loadRoomChat();
    this.roomChatTimer = setInterval(() => {
      if (!this.roomChatSocket || this.roomChatSocket.readyState !== WebSocket.OPEN) void this.loadRoomChat();
    }, 15000);
  }

  private async loadRoomChat() {
    const api = this.api;
    if (!api || !this.shouldRun || !this.accountToken || !this.roomCode) return;
    try {
      const response = await fetch(`${api.origin}/api/rooms/${this.roomCode}/messages?limit=100`, {
        headers: {
          authorization: `Bearer ${this.accountToken}`,
          'x-qsession-client': 'mobile',
        },
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status !== 401 && response.status !== 403 && response.status !== 409) {
          throw new Error(payload?.error || 'No fue posible actualizar el chat.');
        }
        return;
      }
      if (Array.isArray(payload.messages)) this.callbacks.onChatHistory?.(payload.messages);
      this.connectRealtimeSocket('room', payload?.realtime);
      if (payload.room) this.callbacks.onRoom?.(payload.room);
      if (payload.presence?.participantCount) {
        this.callbacks.onListenerCount(Math.max(0, Number(payload.presence.participantCount) - 1));
      }
    } catch {
      // La señal multimedia sigue activa aunque falle una actualización del chat.
    }
  }

  private connectRealtimeSocket(kind: 'room' | 'private', realtime: any) {
    if (!this.shouldRun || !this.api || !realtime?.channel || !realtime?.token) return;
    const current = kind === 'room' ? this.roomChatSocket : this.privateChatSocket;
    const tagged = current as (WebSocket & {qsessionChannel?: string}) | null;
    if (tagged && tagged.qsessionChannel === realtime.channel && tagged.readyState <= WebSocket.OPEN) return;
    current?.close();
    const base = this.api.origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    const socket = new WebSocket(`${base}/api/realtime?channel=${encodeURIComponent(realtime.channel)}&token=${encodeURIComponent(realtime.token)}`) as WebSocket & {qsessionChannel?: string};
    socket.qsessionChannel = realtime.channel;
    if (kind === 'room') this.roomChatSocket = socket;
    else this.privateChatSocket = socket;
    socket.onmessage = event => {
      let payload: any;
      try { payload = JSON.parse(String(event.data || '')); } catch { return; }
      if (kind === 'room' && payload?.type === 'room-message' && payload?.message) {
        this.callbacks.onChatMessage?.(payload.message);
      }
      if (kind === 'private' && (payload?.type === 'private-message' || payload?.type === 'private-conversation')) {
        void this.loadPrivateChats();
      }
    };
    socket.onclose = () => {
      if (kind === 'room' && this.roomChatSocket === socket) this.roomChatSocket = null;
      if (kind === 'private' && this.privateChatSocket === socket) this.privateChatSocket = null;
    };
    socket.onerror = () => {
      // El temporizador de respaldo recupera el historial y solicita un token nuevo.
    };
  }

  private startAudioLevelMeter(room: Room) {
    if (this.audioLevelTimer) clearInterval(this.audioLevelTimer);
    this.audioLevelTimer = setInterval(() => {
      if (this.room !== room) return;
      let level = 0;
      for (const participant of room.remoteParticipants.values()) {
        level = Math.max(level, Number((participant as any).audioLevel) || 0);
        for (const publication of participant.trackPublications.values()) {
          level = Math.max(level, Number((publication.track as any)?.audioLevel) || 0);
        }
      }
      this.callbacks.onAudioLevel?.(this.hasLiveAudio ? visualAudioLevel(level) : 0);
    }, 90);
  }

  private scheduleMediaReconnect(detail: string, immediate = false) {
    if (!this.shouldRun || this.mediaReconnectTimer) return;
    this.callbacks.onState('reconnecting', `${detail} Reconectando…`);
    const delay = immediate ? 0 : Math.min(15000, 1200 * 2 ** this.mediaReconnectAttempt);
    this.mediaReconnectAttempt += 1;
    this.mediaReconnectTimer = setTimeout(() => {
      this.mediaReconnectTimer = null;
      if (!this.shouldRun) return;
      const serverUrl = this.sourceServerUrl;
      const roomCode = this.roomCode;
      void this.start(serverUrl, roomCode).catch(error => {
        if (!this.shouldRun) return;
        const message = error instanceof Error ? error.message : 'La red todavía no responde.';
        this.scheduleMediaReconnect(message);
      });
    }, delay);
  }

}
