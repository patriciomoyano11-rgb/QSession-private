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
}));

import {
  QSESSION_BROADCAST_CAPTURE_OPTIONS,
  QSESSION_BROADCAST_PUBLISH_OPTIONS,
  qsessionMusicAudioTypeOptions,
} from '../src/QSessionAudioQuality';

test('mantiene Android en la ruta musical y fuera del modo llamada', () => {
  expect(qsessionMusicAudioTypeOptions()).toEqual(expect.objectContaining({
    audioMode: 'normal',
    audioStreamType: 'music',
    audioAttributesUsageType: 'media',
    audioAttributesContentType: 'music',
    forceHandleAudioRouting: false,
  }));
});

test('publica el audio móvil original a 48 kHz y Opus estéreo', () => {
  expect(QSESSION_BROADCAST_CAPTURE_OPTIONS).toEqual({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
    sampleRate: 48000,
  });
  expect(QSESSION_BROADCAST_PUBLISH_OPTIONS).toEqual(expect.objectContaining({
    forceStereo: true,
    dtx: false,
    red: true,
    audioPreset: {maxBitrate: 192000, priority: 'high'},
  }));
});
