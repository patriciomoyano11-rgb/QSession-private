import {AndroidAudioTypePresets} from '@livekit/react-native';

/**
 * Q Session carries music and ambient sound, not a telephone call. Android's
 * communication preset can move the whole session to the voice-call stream
 * and, with classic Bluetooth, to the lower-bandwidth hands-free profile.
 */
export function qsessionMusicAudioTypeOptions(forceHandleAudioRouting = false) {
  return {
    ...AndroidAudioTypePresets.media,
    audioAttributesContentType: 'music' as const,
    forceHandleAudioRouting,
  };
}

export const QSESSION_BROADCAST_CAPTURE_OPTIONS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
  sampleRate: 48000,
};

export const QSESSION_BROADCAST_PUBLISH_OPTIONS = {
  name: 'qsession-mobile-audio',
  forceStereo: true,
  dtx: false,
  red: true,
  audioPreset: {maxBitrate: 192000, priority: 'high' as const},
};
