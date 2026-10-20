export type QSessionUserProfile = {
  schemaVersion: 3;
  localId: string;
  ownerToken: string;
  displayName: string;
  city: string;
  bio: string;
  interests: string;
  photoUri: string;
  photoData: string;
  gallery: QSessionProfilePhoto[];
  isPublic: boolean;
  allowMatchmaking: boolean;
  allowMessages: boolean;
  shareApproximateLocation: boolean;
  allowDjContact: boolean;
  allowTips: boolean;
  updatedAt: number;
};

export type QSessionProfilePhoto = {
  localUri: string;
  dataUrl: string;
  mediaId: string;
  remoteUrl: string;
  caption: string;
};

function clipped(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function localProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function localOwnerToken(): string {
  return [Date.now().toString(36), ...Array.from({length: 4}, () => Math.random().toString(36).slice(2, 12))].join('_');
}

function normalizePhoto(value: unknown): QSessionProfilePhoto | null {
  const source = value && typeof value === 'object' ? value as Partial<QSessionProfilePhoto> : {};
  const photo = {
    localUri: clipped(source.localUri, 1000),
    dataUrl: clipped(source.dataUrl, 2_900_000),
    mediaId: clipped(source.mediaId, 100),
    remoteUrl: clipped(source.remoteUrl, 1000),
    caption: clipped(source.caption, 120),
  };
  return photo.localUri || photo.dataUrl || photo.mediaId || photo.remoteUrl ? photo : null;
}

export function createEmptyProfile(): QSessionUserProfile {
  return {
    schemaVersion: 3,
    localId: localProfileId(),
    ownerToken: localOwnerToken(),
    displayName: '',
    city: '',
    bio: '',
    interests: '',
    photoUri: '',
    photoData: '',
    gallery: [],
    isPublic: false,
    allowMatchmaking: false,
    allowMessages: false,
    shareApproximateLocation: false,
    allowDjContact: true,
    allowTips: true,
    updatedAt: 0,
  };
}

export function normalizeProfile(value: unknown): QSessionUserProfile {
  const source = value && typeof value === 'object' ? value as Partial<QSessionUserProfile> : {};
  const fallback = createEmptyProfile();
  const sourceGallery = Array.isArray(source.gallery)
    ? source.gallery.map(normalizePhoto).filter((photo): photo is QSessionProfilePhoto => Boolean(photo)).slice(0, 6)
    : [];
  const legacyPhoto = normalizePhoto({localUri: source.photoUri, dataUrl: source.photoData});
  const gallery = sourceGallery.length ? sourceGallery : legacyPhoto ? [legacyPhoto] : [];
  const primary = gallery[0];
  return {
    schemaVersion: 3,
    localId: clipped(source.localId, 100) || fallback.localId,
    ownerToken: clipped(source.ownerToken, 200) || fallback.ownerToken,
    displayName: clipped(source.displayName, 60),
    city: clipped(source.city, 100),
    bio: clipped(source.bio, 300),
    interests: clipped(source.interests, 240),
    photoUri: primary?.localUri || primary?.remoteUrl || clipped(source.photoUri, 1000),
    photoData: primary?.dataUrl || clipped(source.photoData, 2_900_000),
    gallery,
    isPublic: Boolean(source.isPublic),
    allowMatchmaking: Boolean(source.allowMatchmaking),
    allowMessages: Boolean(source.allowMessages),
    shareApproximateLocation: Boolean(source.shareApproximateLocation),
    allowDjContact: source.allowDjContact === undefined ? true : Boolean(source.allowDjContact),
    allowTips: source.allowTips === undefined ? true : Boolean(source.allowTips),
    updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : 0,
  };
}

export function addProfilePhoto(profile: QSessionUserProfile, photo: Partial<QSessionProfilePhoto>): QSessionUserProfile {
  const normalized = normalizePhoto(photo);
  if (!normalized) return profile;
  const signature = normalized.mediaId || normalized.localUri || normalized.remoteUrl || normalized.dataUrl.slice(0, 120);
  const gallery = [
    ...profile.gallery.filter(item => (item.mediaId || item.localUri || item.remoteUrl || item.dataUrl.slice(0, 120)) !== signature),
    normalized,
  ].slice(0, 6);
  return normalizeProfile({...profile, gallery});
}

export function removeProfilePhoto(profile: QSessionUserProfile, index: number): QSessionUserProfile {
  return normalizeProfile({...profile, gallery: profile.gallery.filter((_, photoIndex) => photoIndex !== index)});
}

export function makePrimaryProfilePhoto(profile: QSessionUserProfile, index: number): QSessionUserProfile {
  const selected = profile.gallery[index];
  if (!selected || index === 0) return profile;
  return normalizeProfile({...profile, gallery: [selected, ...profile.gallery.filter((_, photoIndex) => photoIndex !== index)]});
}

export function profileInterests(profile: QSessionUserProfile): string[] {
  return profile.interests
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map(item => item.slice(0, 40));
}

export function serverProfilePayload(profile: QSessionUserProfile) {
  return {
    id: profile.localId,
    editToken: profile.ownerToken,
    displayName: profile.displayName,
    avatarUrl: profile.photoData || profile.gallery[0]?.remoteUrl || null,
    photos: profile.gallery.map(photo => photo.dataUrl || photo.remoteUrl).filter(Boolean).slice(0, 6),
    city: profile.city || null,
    bio: profile.bio || null,
    musicGenres: profileInterests(profile),
    visible: profile.isPublic,
    social: {
      allowMatchmaking: profile.allowMatchmaking,
      allowMessages: profile.allowMessages,
      shareApproximateLocation: profile.shareApproximateLocation,
      allowDjContact: profile.allowDjContact,
      allowTips: profile.allowTips,
    },
  };
}
