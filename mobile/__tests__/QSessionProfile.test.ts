import {
  addProfilePhoto,
  createEmptyProfile,
  makePrimaryProfilePhoto,
  normalizeProfile,
  profileInterests,
  removeProfilePhoto,
  serverProfilePayload,
} from '../src/QSessionProfile';

test('normaliza y limita los datos del perfil', () => {
  const profile = normalizeProfile({
    localId: 'profile_local',
    displayName: '  María  ',
    bio: 'x'.repeat(350),
    interests: 'Salsa, House, Yoga',
    isPublic: true,
  });
  expect(profile.displayName).toBe('María');
  expect(profile.bio).toHaveLength(300);
  expect(profileInterests(profile)).toEqual(['Salsa', 'House', 'Yoga']);
});

test('un perfil privado se guarda completo pero permanece invisible', () => {
  const profile = normalizeProfile({
    ...createEmptyProfile(),
    displayName: 'Patricio',
    city: 'Medellín',
    bio: 'DJ y bailarín',
    interests: 'House',
    isPublic: false,
    allowMessages: true,
  });
  const payload = serverProfilePayload(profile);
  expect(payload.displayName).toBe('Patricio');
  expect(payload.city).toBe('Medellín');
  expect(payload.bio).toBe('DJ y bailarín');
  expect(payload.musicGenres).toEqual(['House']);
  expect(payload.social.allowMessages).toBe(true);
  expect(payload.visible).toBe(false);
  expect(payload.editToken).toBeTruthy();
});

test('la ciudad se conserva aunque solo se publique con permiso', () => {
  const base = normalizeProfile({
    ...createEmptyProfile(),
    displayName: 'María',
    city: 'Bogotá',
    isPublic: true,
  });
  expect(serverProfilePayload(base).city).toBe('Bogotá');
  expect(serverProfilePayload({...base, shareApproximateLocation: true}).city).toBe('Bogotá');
});

test('incluye la foto reducida para guardarla en QSession', () => {
  const profile = normalizeProfile({...createEmptyProfile(), displayName: 'Ana', photoData: 'data:image/jpeg;base64,AAAA'});
  expect(serverProfilePayload(profile).avatarUrl).toBe('data:image/jpeg;base64,AAAA');
});

test('migra la foto anterior y administra una galería de hasta seis imágenes', () => {
  let profile = normalizeProfile({...createEmptyProfile(), photoUri: 'content://foto-anterior', photoData: 'data:image/jpeg;base64,AAAA'});
  expect(profile.schemaVersion).toBe(3);
  expect(profile.gallery).toHaveLength(1);
  for (let index = 0; index < 7; index += 1) {
    profile = addProfilePhoto(profile, {localUri: `content://foto-${index}`, dataUrl: `data:image/jpeg;base64,${index}`});
  }
  expect(profile.gallery).toHaveLength(6);
  profile = makePrimaryProfilePhoto(profile, 4);
  expect(profile.photoUri).toBe(profile.gallery[0].localUri);
  const previousLength = profile.gallery.length;
  profile = removeProfilePhoto(profile, 0);
  expect(profile.gallery).toHaveLength(previousLength - 1);
});
