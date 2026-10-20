jest.mock('react-native', () => ({
  NativeModules: {
    QSessionPlayback: {
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
    },
    QSessionQrScanner: {
      scan: jest.fn(async () => null),
      getLocalIpv4: jest.fn(async () => '192.168.1.10'),
    },
    QSessionProfile: {
      load: jest.fn(async () => null),
      save: jest.fn(async () => true),
      pickPhoto: jest.fn(async () => null),
    },
    QSessionLocation: {
      getCurrentApproximate: jest.fn(async () => ({latitude: 4.7, longitude: -74.1, accuracy: 10000, capturedAt: 1})),
    },
    QSessionVoiceNote: {
      start: jest.fn(async () => true),
      stop: jest.fn(async () => ({dataUrl: 'data:audio/mp4;base64,AA==', mimeType: 'audio/mp4', durationMs: 1000, byteLength: 1})),
      cancel: jest.fn(async () => true),
      play: jest.fn(async () => true),
      stopPlayback: jest.fn(async () => true),
    },
  },
  PermissionsAndroid: {
    PERMISSIONS: {POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS', ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION', ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION', RECORD_AUDIO: 'android.permission.RECORD_AUDIO'},
    RESULTS: {GRANTED: 'granted'},
    request: jest.fn(async () => 'granted'),
    requestMultiple: jest.fn(async () => ({
      'android.permission.ACCESS_FINE_LOCATION': 'granted',
      'android.permission.ACCESS_COARSE_LOCATION': 'granted',
    })),
  },
  Platform: {OS: 'android', Version: 33},
}));

import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import {
  playback,
  locationService,
  profileStorage,
  preparePickedProfilePhoto,
  qrScanner,
  requestApproximateLocationPermission,
  requestNotificationPermission,
  requestMicrophonePermission,
  voiceNotes,
} from '../src/platform/QSessionNativeModules';

const notificationRequest = PermissionsAndroid.request as jest.MockedFunction<typeof PermissionsAndroid.request>;
const permissionRequests = PermissionsAndroid.requestMultiple as jest.MockedFunction<typeof PermissionsAndroid.requestMultiple>;
const mutablePlatform = Platform as {OS: string; Version: number};

beforeEach(() => {
  notificationRequest.mockClear();
  permissionRequests.mockClear();
  mutablePlatform.OS = 'android';
  mutablePlatform.Version = 33;
});

test('expone los módulos nativos mediante una frontera tipada', () => {
  expect(playback).toBe(NativeModules.QSessionPlayback);
  expect(qrScanner).toBe(NativeModules.QSessionQrScanner);
  expect(profileStorage).toBe(NativeModules.QSessionProfile);
  expect(locationService).toBe(NativeModules.QSessionLocation);
  expect(voiceNotes).toBe(NativeModules.QSessionVoiceNote);
});

test('acepta la foto ya optimizada por el selector nativo', async () => {
  const readPhotoData = jest.fn(async () => 'data:image/jpeg;base64,OLD');
  await expect(preparePickedProfilePhoto({
    uri: 'content://foto/1',
    dataUrl: 'data:image/jpeg;base64,NEW',
  }, readPhotoData)).resolves.toEqual({
    uri: 'content://foto/1',
    dataUrl: 'data:image/jpeg;base64,NEW',
  });
  expect(readPhotoData).not.toHaveBeenCalled();
});

test('mantiene compatibilidad con el selector anterior', async () => {
  const readPhotoData = jest.fn(async () => 'data:image/jpeg;base64,LEGACY');
  await expect(preparePickedProfilePhoto('content://foto/2', readPhotoData)).resolves.toEqual({
    uri: 'content://foto/2',
    dataUrl: 'data:image/jpeg;base64,LEGACY',
  });
  expect(readPhotoData).toHaveBeenCalledWith('content://foto/2');
});

test('solicita micrófono sólo al iniciar una función de voz', async () => {
  await expect(requestMicrophonePermission()).resolves.toBe(true);
  expect(notificationRequest).toHaveBeenCalledWith('android.permission.RECORD_AUDIO', expect.objectContaining({buttonPositive: 'Permitir'}));
});

test('solicita ubicación precisa y aproximada juntas para verificar el país por GPS', async () => {
  await expect(requestApproximateLocationPermission()).resolves.toBe(true);
  expect(permissionRequests).toHaveBeenCalledWith([
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
  ]);
});

test('solicita permiso de notificaciones desde Android 13', async () => {
  await requestNotificationPermission();

  expect(notificationRequest).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
});

test('no solicita permiso en versiones anteriores de Android', async () => {
  mutablePlatform.Version = 32;

  await requestNotificationPermission();

  expect(notificationRequest).not.toHaveBeenCalled();
});

test('no solicita permiso en iOS', async () => {
  mutablePlatform.OS = 'ios';

  await requestNotificationPermission();

  expect(notificationRequest).not.toHaveBeenCalled();
});
