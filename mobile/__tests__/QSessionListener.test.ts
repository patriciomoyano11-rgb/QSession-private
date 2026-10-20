jest.mock('@livekit/react-native-webrtc', () => ({
  MediaStream: jest.fn(),
  RTCIceCandidate: jest.fn(),
  RTCPeerConnection: jest.fn(),
  RTCSessionDescription: jest.fn(),
}));

import {verifyQSessionServer} from '../src/QSessionListener';

afterEach(() => jest.restoreAllMocks());

test('lee las funciones sociales confirmadas por el servidor', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      version: '1.12.0',
      media: {transport: 'sfu'},
      features: {
        accounts: true,
        profiles: true,
        stories: true,
        roomParticipants: true,
        privateChats: true,
        voiceNotes: true,
        liveChat: true,
        socialCamera: true,
      },
    }),
  } as Response);

  await expect(verifyQSessionServer('https://www.qsession.org')).resolves.toMatchObject({
    version: '1.12.0',
    transport: 'sfu',
    features: {profiles: true, privateChats: true, socialCamera: true},
  });
});

test('marca como incompatibles las funciones que un servidor anterior no anuncia', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ok: true, version: '1.10.0', media: {transport: 'sfu'}}),
  } as Response);

  const status = await verifyQSessionServer('https://www.qsession.org');
  expect(status.features.profiles).toBe(false);
  expect(status.features.privateChats).toBe(false);
  expect(status.features.socialCamera).toBe(false);
});
