import {normalizeProfile, profileInterests, QSessionProfilePhoto, QSessionUserProfile} from './QSessionProfile';

export type QSessionAccount = {
  id: string;
  email: string;
  emailVerified: boolean;
  status: 'active';
};

export type QSessionAccountSession = {
  schemaVersion: 1;
  token: string;
  expiresAt: string;
  account: QSessionAccount;
};

export type QSessionStory = {
  id: string;
  text?: string | null;
  mediaId?: string | null;
  mediaUrl?: string | null;
  createdAt: string;
  expiresAt: string;
};

type ServerPhoto = {id: string; url: string; caption?: string | null};
type ServerProfile = {
  id: string;
  displayName?: string | null;
  city?: string | null;
  bio?: string | null;
  musicGenres?: string[];
  photos?: ServerPhoto[];
  stories?: QSessionStory[];
  visible?: boolean;
  social?: {
    allowMatchmaking?: boolean;
    allowMessages?: boolean;
    shareApproximateLocation?: boolean;
    allowDjContact?: boolean;
    allowTips?: boolean;
  };
};

type AuthResponse = {
  token: string;
  expiresAt: string;
  account: QSessionAccount;
  profile: ServerProfile;
};

export class QSessionAccountError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'QSessionAccountError';
    this.status = status;
  }
}

function baseUrl(value: string): string {
  return value.trim().replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/ws\/?$/i, '').replace(/\/$/, '');
}

function absoluteUrl(server: string, value?: string | null): string {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  return `${baseUrl(server)}${value.startsWith('/') ? '' : '/'}${value}`;
}

async function responseJson(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new QSessionAccountError(payload.error || 'QSession no pudo completar la solicitud.', response.status);
  return payload;
}

function mobileHeaders(extra: Record<string, string> = {}) {
  return {'content-type': 'application/json', 'x-qsession-client': 'mobile', ...extra};
}

function authHeaders(session: QSessionAccountSession, extra: Record<string, string> = {}) {
  return mobileHeaders({authorization: `Bearer ${session.token}`, ...extra});
}

function sessionFromResponse(response: AuthResponse): QSessionAccountSession {
  return {
    schemaVersion: 1,
    token: String(response.token || ''),
    expiresAt: String(response.expiresAt || ''),
    account: response.account,
  };
}

export function normalizeAccountSession(value: unknown): QSessionAccountSession | null {
  const source = value && typeof value === 'object' ? value as Partial<QSessionAccountSession> : {};
  if (!source.token || !source.account?.id || !source.account.email || !source.expiresAt) return null;
  if (new Date(source.expiresAt).getTime() <= Date.now()) return null;
  return {
    schemaVersion: 1,
    token: String(source.token),
    expiresAt: String(source.expiresAt),
    account: source.account,
  };
}

export function profileFromServer(server: string, value: ServerProfile, current: QSessionUserProfile): QSessionUserProfile {
  const existingById = new Map(current.gallery.filter(photo => photo.mediaId).map(photo => [photo.mediaId, photo]));
  const gallery: QSessionProfilePhoto[] = (value.photos || []).slice(0, 6).map(photo => {
    const existing = existingById.get(photo.id);
    return {
      localUri: existing?.localUri || '',
      dataUrl: '',
      mediaId: photo.id,
      remoteUrl: absoluteUrl(server, photo.url),
      caption: photo.caption || '',
    };
  });
  const social = value.social || {};
  return normalizeProfile({
    ...current,
    localId: value.id || current.localId,
    displayName: value.displayName || '',
    city: value.city || '',
    bio: value.bio || '',
    interests: (value.musicGenres || []).join(', '),
    gallery,
    isPublic: Boolean(value.visible),
    allowMatchmaking: Boolean(social.allowMatchmaking),
    allowMessages: Boolean(social.allowMessages),
    shareApproximateLocation: Boolean(social.shareApproximateLocation),
    allowDjContact: social.allowDjContact === undefined ? true : Boolean(social.allowDjContact),
    allowTips: social.allowTips === undefined ? true : Boolean(social.allowTips),
    updatedAt: Date.now(),
  });
}

export async function registerAccount(server: string, email: string, password: string, displayName: string) {
  const response = await fetch(`${baseUrl(server)}/api/auth/register`, {
    method: 'POST',
    headers: mobileHeaders(),
    body: JSON.stringify({email, password, displayName}),
  });
  const payload = await responseJson(response) as AuthResponse;
  return {session: sessionFromResponse(payload), profile: payload.profile};
}

export async function loginAccount(server: string, email: string, password: string) {
  const response = await fetch(`${baseUrl(server)}/api/auth/login`, {
    method: 'POST',
    headers: mobileHeaders(),
    body: JSON.stringify({email, password}),
  });
  const payload = await responseJson(response) as AuthResponse;
  return {session: sessionFromResponse(payload), profile: payload.profile};
}

export async function refreshAccount(server: string, session: QSessionAccountSession) {
  const response = await fetch(`${baseUrl(server)}/api/account`, {headers: authHeaders(session)});
  return responseJson(response) as Promise<{expiresAt: string; account: QSessionAccount; profile: ServerProfile}>;
}

export async function logoutAccount(server: string, session: QSessionAccountSession) {
  const response = await fetch(`${baseUrl(server)}/api/auth/logout`, {method: 'POST', headers: authHeaders(session)});
  await responseJson(response);
}

async function uploadPhoto(server: string, session: QSessionAccountSession, photo: QSessionProfilePhoto): Promise<QSessionProfilePhoto> {
  if (photo.mediaId) return photo;
  if (!photo.dataUrl) throw new Error('QSession necesita preparar la foto antes de subirla.');
  const response = await fetch(`${baseUrl(server)}/api/profile-media`, {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({dataUrl: photo.dataUrl}),
  });
  const payload = await responseJson(response) as {media: {id: string; url: string}};
  return {...photo, dataUrl: '', mediaId: payload.media.id, remoteUrl: absoluteUrl(server, payload.media.url)};
}

export async function saveAccountProfile(server: string, session: QSessionAccountSession, profile: QSessionUserProfile) {
  const gallery: QSessionProfilePhoto[] = [];
  for (const photo of profile.gallery.slice(0, 6)) gallery.push(await uploadPhoto(server, session, photo));
  const response = await fetch(`${baseUrl(server)}/api/account/profile`, {
    method: 'PUT',
    headers: authHeaders(session),
    body: JSON.stringify({
      displayName: profile.displayName,
      city: profile.city || null,
      bio: profile.bio || null,
      musicGenres: profileInterests(profile),
      photos: gallery.map(photo => ({id: photo.mediaId, caption: photo.caption || null})),
      visible: profile.isPublic,
      social: {
        allowMatchmaking: profile.allowMatchmaking,
        allowMessages: profile.allowMessages,
        shareApproximateLocation: profile.shareApproximateLocation,
        allowDjContact: profile.allowDjContact,
        allowTips: profile.allowTips,
      },
    }),
  });
  const payload = await responseJson(response) as {profile: ServerProfile};
  return profileFromServer(server, payload.profile, normalizeProfile({...profile, gallery}));
}

export async function publishStory(server: string, session: QSessionAccountSession, text: string, mediaId?: string) {
  const response = await fetch(`${baseUrl(server)}/api/stories`, {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({text, mediaId: mediaId || null}),
  });
  const payload = await responseJson(response) as {story: QSessionStory};
  return {...payload.story, mediaUrl: absoluteUrl(server, payload.story.mediaUrl)};
}
