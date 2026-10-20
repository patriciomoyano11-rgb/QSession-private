import {AudioSession} from '@livekit/react-native';
import {Room, RoomEvent, Track} from 'livekit-client';
import {qsessionMusicAudioTypeOptions} from './QSessionAudioQuality';
import {playback} from './platform/QSessionNativeModules';

type NativeAudioStart = {
  server?: string;
  roomCode?: string;
  accessToken?: string;
  gain?: number;
};

type ActiveNativeAudioSession = {
  server: string;
  roomCode: string;
  accessToken: string;
  gain: number;
};

type NativeMediaCredentials = {
  url?: string;
  token?: string;
  error?: string;
};

/**
 * Native audio-only companion for the Android web interface.
 *
 * The WebView owns presentation and navigation only. This client owns the
 * LiveKit listener, Android music route and foreground playback service. Its
 * desired session survives WebView suspension and reconnects independently
 * after a network interruption or a screen-lock transition.
 */
export class QSessionNativeAudioClient {
  private room: Room | null = null;
  private activeSession: ActiveNativeAudioSession | null = null;
  private generation = 0;
  private connecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private muted = false;
  private outputGain = 1;
  private audioTracks = new Set<Track>();
  private readyReported = false;
  private backgroundPlaybackChecked = false;

  constructor(private readonly onReady: () => void = () => undefined) {}

  async start(options: NativeAudioStart) {
    const server = String(options.server || 'https://qsession.org').replace(/\/$/, '');
    const roomCode = String(options.roomCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return;

    const nextSession: ActiveNativeAudioSession = {
      server,
      roomCode,
      accessToken: String(options.accessToken || ''),
      gain: this.normalizedOutputGain(options.gain),
    };
    const sameSession =
      this.activeSession?.server === nextSession.server &&
      this.activeSession?.roomCode === nextSession.roomCode &&
      this.activeSession?.accessToken === nextSession.accessToken;

    if (sameSession && this.activeSession) {
      this.activeSession.gain = nextSession.gain;
    } else {
      this.activeSession = nextSession;
    }
    this.outputGain = nextSession.gain;
    await playback
      ?.start(server, roomCode, nextSession.accessToken, nextSession.gain)
      .catch(() => undefined);
    if (!this.backgroundPlaybackChecked) {
      this.backgroundPlaybackChecked = true;
      await playback?.ensureBackgroundPlayback?.().catch(() => undefined);
    }

    if (sameSession && (this.room || this.connecting)) {
      this.applyOutputGain();
      return;
    }
    this.clearReconnectTimer();
    await this.connectActiveSession();
  }

  private async connectActiveSession() {
    const session = this.activeSession;
    if (!session || this.connecting) return;

    this.connecting = true;
    this.clearReconnectTimer();
    const generation = ++this.generation;
    this.readyReported = false;
    await this.disconnectCurrentRoom();

    try {
      // Acquire the foreground service and locks before any network wait. The
      // connection must remain eligible to run if the display turns off here.
      await playback
        ?.start(session.server, session.roomCode, session.accessToken, session.gain)
        .catch(() => undefined);

      // Keep the Q Session listener on Android's high-quality media route. In MODE_NORMAL Android
      // must remain in the high-bandwidth media path (A2DP for Bluetooth), while
      // an already-connected wired/USB headset needs one explicit selection on
      // some Samsung devices and USB-C adapters.
      let existingPhysicalHeadphones = false;
      try {
        existingPhysicalHeadphones = Boolean(
          await playback?.hasWiredOrUsbOutput?.(),
        );
      } catch {
        // Device enumeration is best effort. The system media route remains the
        // safe fallback when a manufacturer does not expose the endpoint.
      }
      await AudioSession.configureAudio({
        android: {
          preferredOutputList: existingPhysicalHeadphones
            ? ['headset', 'bluetooth', 'speaker', 'earpiece']
            : ['bluetooth', 'headset', 'speaker', 'earpiece'],
          audioTypeOptions: qsessionMusicAudioTypeOptions(
            existingPhysicalHeadphones,
          ),
        },
      });
      // Keep the decoder/renderer's master gain at unity. User attenuation is
      // applied once per remote track below, matching the Q Session web path.
      await AudioSession.setDefaultRemoteAudioTrackVolume(1);
      await AudioSession.startAudioSession();
      if (existingPhysicalHeadphones) {
        await AudioSession.selectAudioOutput('headset').catch(() => undefined);
      }

      const response = await fetch(
        `${session.server}/api/rooms/${encodeURIComponent(session.roomCode)}/media-token`,
        {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            role: 'listener',
            accessToken: session.accessToken || undefined,
            nativeAudio: true,
          }),
        },
      );
      const credentials = (await response.json()) as NativeMediaCredentials;
      if (!response.ok || !credentials.url || !credentials.token) {
        throw new Error(
          credentials.error || 'No fue posible abrir el audio nativo.',
        );
      }
      if (generation !== this.generation || this.activeSession !== session) return;

      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: false,
      });
      this.room = room;

      const subscribeToAudio = () => {
        if (this.room !== room) return;
        for (const participant of room.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values()) {
            publication.setSubscribed(publication.kind === Track.Kind.Audio);
          }
        }
      };

      room
        .on(RoomEvent.TrackPublished, subscribeToAudio)
        .on(RoomEvent.ParticipantConnected, subscribeToAudio)
        .on(RoomEvent.TrackSubscribed, track => {
          if (track.kind !== Track.Kind.Audio || this.room !== room) return;
          this.audioTracks.add(track);
          this.reconnectAttempt = 0;
          this.applyTrackGain(track);
          if (!this.readyReported) {
            this.readyReported = true;
            this.onReady();
          }
        })
        .on(RoomEvent.TrackUnsubscribed, track => {
          this.audioTracks.delete(track);
        })
        .on(RoomEvent.ParticipantDisconnected, subscribeToAudio)
        .on(RoomEvent.Reconnected, () => {
          this.reconnectAttempt = 0;
          subscribeToAudio();
        })
        .on(RoomEvent.Disconnected, () => {
          if (this.room !== room) return;
          this.room = null;
          this.audioTracks.clear();
          this.readyReported = false;
          this.scheduleReconnect();
        });

      await room.connect(credentials.url, credentials.token, {
        autoSubscribe: false,
      });
      if (
        generation !== this.generation ||
        this.activeSession !== session ||
        this.room !== room
      ) {
        if (this.room === room) this.room = null;
        await room.disconnect().catch(() => undefined);
        return;
      }
      this.reconnectAttempt = 0;
      subscribeToAudio();
    } catch (error) {
      if (generation === this.generation && this.activeSession === session) {
        await this.disconnectCurrentRoom();
        this.scheduleReconnect();
      }
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect() {
    if (!this.activeSession || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 12000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.activeSession) return;
      void this.connectActiveSession().catch(() => undefined);
    }, delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async resume() {
    const session = this.activeSession;
    if (!session) return;
    await playback
      ?.start(session.server, session.roomCode, session.accessToken, session.gain)
      .catch(() => undefined);
    await AudioSession.startAudioSession().catch(() => undefined);
    const connectionState = String(
      (this.room as {state?: unknown} | null)?.state || '',
    ).toLowerCase();
    const hasEndedTrack = [...this.audioTracks].some(
      track =>
        String(track.mediaStreamTrack?.readyState || '').toLowerCase() === 'ended',
    );
    if (
      (!this.room || connectionState.includes('disconnected') || hasEndedTrack) &&
      !this.connecting
    ) {
      await this.connectActiveSession();
      return;
    }
    for (const participant of this.room?.remoteParticipants.values() || []) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind === Track.Kind.Audio) publication.setSubscribed(true);
      }
    }
    for (const track of this.audioTracks) {
      if (track.mediaStreamTrack) track.mediaStreamTrack.enabled = true;
    }
    this.applyOutputGain();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyOutputGain();
  }

  setOutputGain(gain: number) {
    this.outputGain = this.normalizedOutputGain(gain);
    if (this.activeSession) this.activeSession.gain = this.outputGain;
    this.applyOutputGain();
  }

  private applyOutputGain() {
    for (const track of this.audioTracks) this.applyTrackGain(track);
  }

  private applyTrackGain(track: Track, forcedGain?: number) {
    if ('setVolume' in track && typeof track.setVolume === 'function') {
      track.setVolume(
        forcedGain === undefined
          ? this.muted
            ? 0
            : this.outputGain
          : forcedGain,
      );
    }
  }

  private normalizedOutputGain(gain: number | undefined) {
    const numeric = Number(gain);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(0.501, Math.min(1, numeric));
  }

  private async disconnectCurrentRoom() {
    const room = this.room;
    this.room = null;
    this.audioTracks.clear();
    if (room) await room.disconnect().catch(() => undefined);
  }

  async stop() {
    this.activeSession = null;
    this.generation += 1;
    this.reconnectAttempt = 0;
    this.readyReported = false;
    this.clearReconnectTimer();

    // Silence the device synchronously before waiting for LiveKit's signalling
    // disconnect. This guarantees that an explicit listener exit is audible
    // immediately, even if the network is stalled while the room closes.
    for (const track of this.audioTracks) {
      this.applyTrackGain(track, 0);
      if (track.mediaStreamTrack) track.mediaStreamTrack.enabled = false;
    }
    await this.disconnectCurrentRoom();
    await AudioSession.stopAudioSession().catch(() => undefined);
    await playback?.stop().catch(() => undefined);
  }
}
