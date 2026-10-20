const mockHandlers: Record<string, (...args: any[]) => void> = {};
const mockRemoteParticipants = new Map();
const mockApplyCameraConstraints = jest.fn(async () => undefined);
const mockLocalCameraTrack = {mediaStreamTrack: {
  id: 'local-camera-track',
  getCapabilities: () => ({zoom: {min: 0.5, max: 2}, resizeMode: ['none', 'crop-and-scale']}),
  getSettings: () => ({width: 960, height: 1280, zoom: 1, resizeMode: 'crop-and-scale'}),
  applyConstraints: mockApplyCameraConstraints,
}};
const mockLocalCameraPublication = {track: mockLocalCameraTrack};
const mockLocalParticipant = {
  identity: 'listener-mobile',
  metadata: '',
  setMicrophoneEnabled: jest.fn(async () => undefined),
  setCameraEnabled: jest.fn(async (enabled: boolean) => enabled ? mockLocalCameraPublication : undefined),
  setAttributes: jest.fn(async () => undefined),
  getTrackPublication: jest.fn(() => mockLocalCameraPublication),
  unpublishTrack: jest.fn(async () => undefined),
};
const mockRoom: any = {
  localParticipant: mockLocalParticipant,
  remoteParticipants: mockRemoteParticipants,
  numParticipants: 1,
  on: jest.fn((event: string, handler: (...args: any[]) => void) => {
    mockHandlers[event] = handler;
    return mockRoom;
  }),
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
};

jest.mock('@livekit/react-native-webrtc', () => ({
  MediaStream: jest.fn(() => ({toURL: () => 'qsession-video-stream'})),
}));
jest.mock('@livekit/react-native', () => ({
  AndroidAudioTypePresets: {
    media: {
      manageAudioFocus: true,
      audioMode: 'normal',
      audioFocusMode: 'gain',
      audioStreamType: 'music',
      audioAttributesUsageType: 'media',
      audioAttributesContentType: 'unknown',
    },
  },
  AudioSession: {
    configureAudio: jest.fn(async () => undefined),
    setDefaultRemoteAudioTrackVolume: jest.fn(async () => undefined),
    startAudioSession: jest.fn(async () => undefined),
    stopAudioSession: jest.fn(async () => undefined),
    selectAudioOutput: jest.fn(async () => undefined),
  },
}));
jest.mock('../src/platform/QSessionNativeModules', () => ({
  playback: {hasWiredOrUsbOutput: jest.fn(async () => false)},
}));
jest.mock('livekit-client', () => ({
  Room: jest.fn(() => mockRoom),
  RoomEvent: {
    TrackSubscribed: 'track-subscribed',
    TrackPublished: 'track-published',
    TrackSubscriptionFailed: 'track-subscription-failed',
    TrackUnsubscribed: 'track-unsubscribed',
    ParticipantConnected: 'participant-connected',
    ParticipantDisconnected: 'participant-disconnected',
    ParticipantMetadataChanged: 'participant-metadata-changed',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
  },
  Track: {Kind: {Audio: 'audio', Video: 'video'}, Source: {Camera: 'camera'}},
}));

import {AudioSession} from '@livekit/react-native';
import {QSessionSfuListenerClient} from '../src/QSessionSfuListener';

function officialFetch(delivery?: Record<string, unknown>) {
  return jest.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/api/rooms/ABC123')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          room: {code: 'ABC123', name: 'Sala móvil', transport: 'sfu', status: 'live'},
        }),
      } as Response;
    }
    if (url.endsWith('/api/rooms/ABC123/media-token')) {
      expect(options?.method).toBe('POST');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true, transport: 'sfu', url: 'wss://media.qsession.org', token: 'listener-token',
          ...(delivery ? {delivery} : {}),
        }),
      } as Response;
    }
    throw new Error(`Solicitud inesperada: ${url}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRemoteParticipants.clear();
  mockLocalParticipant.metadata = '';
  Object.keys(mockHandlers).forEach(key => delete mockHandlers[key]);
});

afterEach(() => jest.useRealTimers());

test('rotación cambia cámaras remotas cada 15 segundos sin repetir perfiles ni el propio', async () => {
  jest.useFakeTimers();
  const cameras:any[]=[];
  for(let i=0;i<9;i++){
    const publication={kind:'video',source:'camera',trackSid:'cam'+i,isMuted:false,setSubscribed:jest.fn()};
    cameras.push(publication);
    mockRemoteParticipants.set('listener-'+i,{identity:'listener-'+i,metadata:JSON.stringify({profileId:i===8?'p0':'p'+i,visible:true}),trackPublications:new Map([['camera',publication]])});
  }
  (globalThis as any).fetch=officialFetch({kind:'broadcast',url:'https://live.qsession.org/live/ABC123/index.m3u8'});
  const client=new QSessionSfuListenerClient({onState:jest.fn(),onListenerCount:jest.fn()});
  await client.start('https://qsession.org','ABC123');client.setPeopleVideoEnabled(true);
  expect(cameras.slice(0,4).every(p=>p.setSubscribed.mock.lastCall?.[0]===true)).toBe(true);
  expect(cameras[8].setSubscribed).toHaveBeenLastCalledWith(false);
  jest.advanceTimersByTime(15000);
  expect(cameras.slice(0,4).every(p=>p.setSubscribed.mock.lastCall?.[0]===false)).toBe(true);
  expect(cameras.slice(4,8).every(p=>p.setSubscribed.mock.lastCall?.[0]===true)).toBe(true);
  client.stop(false);
});

test('escucha la misma sala oficial de Q Session mediante LiveKit', async () => {
  const fetcher = officialFetch();
  (globalThis as any).fetch = fetcher;
  const states: string[] = [];
  const onRoom = jest.fn();
  const onRoomChatMicrophone = jest.fn();
  const client = new QSessionSfuListenerClient({
    onState: state => states.push(state),
    onListenerCount: jest.fn(),
    onRoom,
    onRoomChatMicrophone,
  });

  await client.start('https://qsession.org', 'ABC123');

  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://qsession.org/api/rooms/ABC123',
    'https://qsession.org/api/rooms/ABC123/media-token',
  ]);
  expect(mockRoom.connect).toHaveBeenCalledWith(
    'wss://media.qsession.org', 'listener-token', {autoSubscribe: false},
  );
  expect(onRoom).toHaveBeenCalledWith(expect.objectContaining({code: 'ABC123'}));
  expect(AudioSession.startAudioSession).toHaveBeenCalledTimes(1);
  await client.setRoomChatMicrophoneEnabled(true);
  expect(mockLocalParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true, {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  expect(onRoomChatMicrophone).toHaveBeenLastCalledWith(true);

  const audioTrack = {kind: 'audio', setVolume: jest.fn()};
  mockHandlers['track-subscribed'](audioTrack, {}, {identity: 'dj-studio'});
  expect(states.at(-1)).toBe('live');
  client.stop(false);
});

test('Android recibe el programa HLS y conserva WebRTC sólo como respaldo', async () => {
  const audioPublication = {kind: 'audio', track: null, setSubscribed: jest.fn()};
  const videoPublication = {kind: 'video', track: null, setSubscribed: jest.fn()};
  mockRemoteParticipants.set('dj-studio', {
    identity: 'dj-studio',
    metadata: '',
    trackPublications: new Map([['audio', audioPublication], ['video', videoPublication]]),
  });
  (globalThis as any).fetch = officialFetch({
    kind: 'broadcast',
    topology: 'cdn-one-to-many',
    url: 'https://live.qsession.org/live/ABC123-SIGNED/index.m3u8',
    fallback: {kind: 'webrtc', topology: 'interactive-sfu', url: 'wss://media.qsession.org', token: 'listener-token'},
  });
  const onBroadcastPlayback = jest.fn();
  const client = new QSessionSfuListenerClient({
    onState: jest.fn(), onListenerCount: jest.fn(), onBroadcastPlayback,
  });

  await expect(client.start('https://qsession.org', 'ABC123')).resolves.toEqual({broadcast: true});
  expect(onBroadcastPlayback).toHaveBeenCalledWith('https://live.qsession.org/live/ABC123-SIGNED/index.m3u8');
  expect(audioPublication.setSubscribed).toHaveBeenCalledWith(false);
  expect(videoPublication.setSubscribed).toHaveBeenCalledWith(false);

  client.fallbackToWebRtc();
  expect(onBroadcastPlayback).toHaveBeenLastCalledWith(null);
  expect(audioPublication.setSubscribed).toHaveBeenLastCalledWith(true);
  expect(videoPublication.setSubscribed).toHaveBeenLastCalledWith(true);
  client.stop(false);
});

test('separa el video del anfitrión de las cámaras sociales', async () => {
  (globalThis as any).fetch = officialFetch();
  const onVideoStream = jest.fn();
  const onSocialVideos = jest.fn();
  const client = new QSessionSfuListenerClient({
    onState: jest.fn(), onListenerCount: jest.fn(), onVideoStream, onSocialVideos,
  });
  await client.start('https://qsession.org', 'ABC123');

  const djVideo = {kind: 'video', mediaStreamTrack: {id: 'dj-camera'}};
  const socialVideo = {kind: 'video', mediaStreamTrack: {id: 'guest-camera'}};
  mockHandlers['track-subscribed'](djVideo, {}, {identity: 'dj-windows'});
  mockHandlers['track-subscribed'](socialVideo, {}, {identity: 'listener-friend'});

  expect(onVideoStream).toHaveBeenLastCalledWith('qsession-video-stream');
  expect(onSocialVideos).toHaveBeenLastCalledWith([
    {participantId: 'listener-friend', streamURL: 'qsession-video-stream'},
  ]);
  await expect(client.setSocialCameraEnabled(true)).resolves.toBe('qsession-video-stream');
  expect(mockLocalParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  expect(mockLocalParticipant.setCameraEnabled).toHaveBeenCalledWith(true, expect.objectContaining({
    facingMode: 'user',
    resolution: {width: 960, height: 1280, aspectRatio: 3 / 4, frameRate: 24},
  }));
  expect(mockLocalParticipant.setAttributes).toHaveBeenCalledWith({
    'qsession.cameraOrientation': 'portrait',
    'qsession.cameraOrientationMode': 'automatic',
    'qsession.cameraDeviceClass': 'mobile',
    'qsession.cameraFrameWidth': '960',
    'qsession.cameraFrameHeight': '1280',
    'qsession.cameraRotation': 'none',
    'qsession.cameraFormatVersion': '4',
    'qsession.cameraFraming': 'far',
  });
  expect(mockApplyCameraConstraints).toHaveBeenCalledWith({advanced: [{zoom: 0.5}, {resizeMode: 'none'}]});
  client.stop(false);
});

test('Personas usa un solo video por perfil y el mismo identificador público en todos los teléfonos', async () => {
  const mainCamera = {kind: 'video', source: 'camera', trackSid: 'camera-a', isMuted: false, track: null, setSubscribed: jest.fn()};
  const extraCamera = {kind: 'video', source: 'camera', trackSid: 'camera-b', isMuted: false, track: null, setSubscribed: jest.fn()};
  mockRemoteParticipants.set('listener-device-87', {
    identity: 'listener-device-87',
    metadata: JSON.stringify({profileId: 'profile-luna', visible: true, displayName: 'Luna'}),
    trackPublications: new Map([['secondary', extraCamera], ['primary', mainCamera]]),
  });
  (globalThis as any).fetch = officialFetch({
    kind: 'broadcast', url: 'https://live.qsession.org/live/ABC123/index.m3u8',
  });
  const onSocialVideos = jest.fn();
  const client = new QSessionSfuListenerClient({
    onState: jest.fn(), onListenerCount: jest.fn(), onSocialVideos,
  });

  await client.start('https://qsession.org', 'ABC123');
  client.setPeopleVideoEnabled(true);

  expect(mainCamera.setSubscribed).toHaveBeenLastCalledWith(true);
  expect(extraCamera.setSubscribed).toHaveBeenLastCalledWith(false);
  mockHandlers['track-subscribed'](
    {kind: 'video', mediaStreamTrack: {id: 'guest-camera'}},
    mainCamera,
    mockRemoteParticipants.get('listener-device-87'),
  );
  expect(onSocialVideos).toHaveBeenLastCalledWith([
    {participantId: 'profile-luna', streamURL: 'qsession-video-stream'},
  ]);
  client.stop(false);
});

test('muestra mutuamente los perfiles activos, incluido el perfil local', async () => {
  (globalThis as any).fetch = officialFetch();
  mockLocalParticipant.metadata = JSON.stringify({
    profileId: 'profile-local', visible: true, displayName: 'María',
    social: {allowMessages: true, allowMatchmaking: false},
  });
  mockRemoteParticipants.set('listener-friend', {
    identity: 'listener-friend',
    metadata: JSON.stringify({
      profileId: 'profile-friend', visible: true, displayName: 'Luna',
      social: {allowMessages: true, allowMatchmaking: true},
    }),
    trackPublications: new Map(),
  });
  const onParticipants = jest.fn();
  const client = new QSessionSfuListenerClient({
    onState: jest.fn(), onListenerCount: jest.fn(), onParticipants,
  });

  await client.start('https://qsession.org', 'ABC123');

  expect(onParticipants).toHaveBeenLastCalledWith([
    expect.objectContaining({id: 'profile-local', displayName: 'María', online: true, canMessage: true}),
    expect.objectContaining({id: 'profile-friend', displayName: 'Luna', online: true, canMessage: true}),
  ], 'listener-mobile');
  client.stop(false);
});

test('crea conversaciones uno a uno y envía mensajes privados por la API durable', async () => {
  const conversation = {
    id: 'conversation-1',
    type: 'direct',
    title: 'Luna',
    ownerProfileId: 'profile-local',
    members: [
      {id: 'profile-local', displayName: 'María', visible: true},
      {id: 'profile-friend', displayName: 'Luna', visible: true},
    ],
    memberCount: 2,
    createdAt: '2026-09-11T10:00:00.000Z',
    updatedAt: '2026-09-11T10:00:00.000Z',
  };
  const privateMessages: any[] = [];
  let conversations: any[] = [];
  const response = (payload: any, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response);
  const fetcher = jest.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method || 'GET';
    if (url.endsWith('/api/rooms/ABC123')) return response({ok: true, room: {code: 'ABC123', transport: 'sfu', status: 'live'}});
    if (url.endsWith('/api/rooms/ABC123/media-token')) return response({ok: true, transport: 'sfu', url: 'wss://media.qsession.org', token: 'listener-token'});
    if (url.includes('/api/rooms/ABC123/messages')) return response({ok: true, room: {code: 'ABC123'}, presence: {participantCount: 2}, messages: []});
    if (url.endsWith('/api/private-conversations') && method === 'POST') {
      conversations = [conversation];
      return response({ok: true, conversation}, 201);
    }
    if (url.endsWith('/api/private-conversations')) return response({ok: true, conversations});
    if (url.includes('/api/private-conversations/conversation-1/attachments') && method === 'POST') {
      const message = {
        id: 'private-voice-1', conversationId: conversation.id, profileId: 'profile-local',
        author: 'María', kind: 'voice', text: 'Nota de voz', createdAt: '2026-09-11T10:02:00.000Z',
        audio: {url: '/api/private-media/private_media_voice', mimeType: 'audio/mp4', durationMs: 1800},
      };
      privateMessages.push(message);
      return response({ok: true, message}, 201);
    }
    if (url.includes('/api/private-conversations/conversation-1/messages') && method === 'POST') {
      const message = {
        id: 'private-message-1', conversationId: conversation.id, profileId: 'profile-local',
        author: 'María', kind: 'text', text: 'Hola Luna', createdAt: '2026-09-11T10:01:00.000Z',
      };
      privateMessages.push(message);
      return response({ok: true, message}, 201);
    }
    if (url.includes('/api/private-conversations/conversation-1/messages')) {
      return response({ok: true, conversation, messages: privateMessages, pagination: {hasMore: false}});
    }
    throw new Error(`Solicitud inesperada: ${url}`);
  });
  (globalThis as any).fetch = fetcher;
  const onPrivateChatOpened = jest.fn();
  const onPrivateMessage = jest.fn();
  const onPrivateChats = jest.fn();
  const client = new QSessionSfuListenerClient({
    onState: jest.fn(), onListenerCount: jest.fn(), onPrivateChatOpened, onPrivateMessage, onPrivateChats,
  });
  client.setProfile('profile-local', 'account-token');
  await client.start('https://qsession.org', 'ABC123');
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));

  client.createPrivateChat(['profile-friend']);
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  expect(onPrivateChatOpened).toHaveBeenCalledWith('conversation-1');

  client.sendPrivateMessage('conversation-1', 'Hola Luna');
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  expect(onPrivateMessage).toHaveBeenCalledWith('conversation-1', expect.objectContaining({
    senderId: 'profile-local', text: 'Hola Luna',
  }));
  await client.sendPrivateVoiceMessage('conversation-1', {
    dataUrl: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy', mimeType: 'audio/mp4', durationMs: 1800,
  });
  expect(onPrivateMessage).toHaveBeenCalledWith('conversation-1', expect.objectContaining({
    kind: 'voice',
    audio: expect.objectContaining({url: 'https://qsession.org/api/private-media/private_media_voice', durationMs: 1800}),
  }));
  expect(onPrivateChats).toHaveBeenLastCalledWith([
    expect.objectContaining({id: 'conversation-1', kind: 'direct', status: 'accepted'}),
  ]);
  client.stop(false);
});

test('recupera la conexión multimedia después de una interrupción de Android', async () => {
  jest.useFakeTimers();
  const fetcher = officialFetch();
  (globalThis as any).fetch = fetcher;
  const states: string[] = [];
  const client = new QSessionSfuListenerClient({
    onState: state => states.push(state), onListenerCount: jest.fn(),
  });
  await client.start('https://qsession.org', 'ABC123');

  mockHandlers.disconnected();
  expect(states.at(-1)).toBe('reconnecting');
  await jest.advanceTimersByTimeAsync(1200);

  expect(mockRoom.connect).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledTimes(4);
  client.stop(false);
});
