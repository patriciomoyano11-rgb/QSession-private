import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import type {QSessionEngagementState} from '../QSessionEngagement';

export type PlaybackModule = {
  appVersion?: string;
  nativeRuntime?: boolean;
  start: (
    server: string,
    room: string,
    accessToken?: string,
    gain?: number,
  ) => Promise<void>;
  startBroadcast?: (room: string) => Promise<void>;
  stop: () => Promise<void>;
  stopBroadcast?: () => Promise<void>;
  ensureBackgroundPlayback?: () => Promise<boolean>;
  hasWiredOrUsbOutput?: () => Promise<boolean>;
};

export type QrScannerModule = {
  scan: () => Promise<string | null>;
  getLocalIpv4: () => Promise<string>;
};

export type ProfileStorageModule = {
  load: () => Promise<string | null>;
  save: (profileJson: string) => Promise<boolean>;
  loadAccountSession?: () => Promise<string | null>;
  saveAccountSession?: (sessionJson: string) => Promise<boolean>;
  clearAccountSession?: () => Promise<boolean>;
  pickPhoto: () => Promise<
    | string
    | {uri: string; dataUrl: string}
    | null
  >;
  readPhotoData?: (uri: string) => Promise<string>;
  loadLanguage?: () => Promise<'es' | 'en' | null>;
  saveLanguage?: (language: 'es' | 'en') => Promise<boolean>;
  loadEngagementState?: () => Promise<QSessionEngagementState>;
  saveEngagementState?: (
    activeUsageMs: number,
    notificationPrompted: boolean,
  ) => Promise<boolean>;
};

export type PickedProfilePhoto = {uri: string; dataUrl: string};

export async function preparePickedProfilePhoto(
  selection: string | PickedProfilePhoto | null,
  readPhotoData?: (uri: string) => Promise<string>,
): Promise<PickedProfilePhoto | null> {
  if (!selection) return null;
  const uri = (typeof selection === 'string' ? selection : selection.uri || '').trim();
  let dataUrl = (typeof selection === 'string' ? '' : selection.dataUrl || '').trim();
  if (!dataUrl && uri && readPhotoData) dataUrl = (await readPhotoData(uri)).trim();
  if (!uri && !dataUrl) return null;
  return {uri, dataUrl};
}

export type ApproximateLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
  countryCode?: string;
};

export type LocationModule = {
  getCurrentApproximate: () => Promise<ApproximateLocation>;
};

export type VoiceNotePayload = {
  dataUrl: string;
  mimeType: string;
  durationMs: number;
  byteLength: number;
};

export type VoiceNoteModule = {
  start: () => Promise<boolean>;
  stop: () => Promise<VoiceNotePayload>;
  cancel: () => Promise<boolean>;
  play: (source: string, authorization?: string) => Promise<boolean>;
  stopPlayback: () => Promise<boolean>;
};

export const playback = NativeModules.QSessionPlayback as PlaybackModule | undefined;
export const qrScanner = NativeModules.QSessionQrScanner as QrScannerModule | undefined;
export const profileStorage = NativeModules.QSessionProfile as ProfileStorageModule | undefined;
export const locationService = NativeModules.QSessionLocation as LocationModule | undefined;
export const voiceNotes = NativeModules.QSessionVoiceNote as VoiceNoteModule | undefined;

export async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
}

export async function requestApproximateLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);
  return results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
}

export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Micrófono de Q Session',
    message: 'Q Session usa el micrófono sólo cuando transmites, grabas una nota de voz o entras a un chat en vivo.',
    buttonPositive: 'Permitir',
    buttonNegative: 'Ahora no',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}
