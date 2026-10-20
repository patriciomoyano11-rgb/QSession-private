import {
  loginAccount,
  normalizeAccountSession,
  profileFromServer,
  publishStory,
  saveAccountProfile,
} from '../src/QSessionAccount';
import {addProfilePhoto, createEmptyProfile, normalizeProfile} from '../src/QSessionProfile';

afterEach(() => jest.restoreAllMocks());

function response(payload: unknown, ok = true) {
  return {ok, status: ok ? 200 : 401, json: async () => payload} as Response;
}

test('descarta sesiones vencidas y conserva sesiones vigentes', () => {
  expect(normalizeAccountSession({token: 'abc', expiresAt: '2020-01-01T00:00:00Z', account: {id: 'a', email: 'a@b.co'}})).toBeNull();
  const session = normalizeAccountSession({token: 'abc', expiresAt: '2099-01-01T00:00:00Z', account: {id: 'a', email: 'a@b.co', emailVerified: false, status: 'active'}});
  expect(session?.account.email).toBe('a@b.co');
});

test('inicia sesión móvil sin guardar la contraseña', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({
    token: 'token-seguro',
    expiresAt: '2099-01-01T00:00:00Z',
    account: {id: 'account_1', email: 'luna@example.com', emailVerified: false, status: 'active'},
    profile: {id: 'profile_1', displayName: 'Luna', visible: false},
  }));
  const result = await loginAccount('https://www.qsession.org', 'luna@example.com', 'clave-muy-segura');
  expect(result.session.token).toBe('token-seguro');
  expect(fetchMock).toHaveBeenCalledWith('https://www.qsession.org/api/auth/login', expect.objectContaining({
    headers: expect.objectContaining({'x-qsession-client': 'mobile'}),
  }));
  expect(JSON.stringify(result)).not.toContain('clave-muy-segura');
});

test('conserva el código HTTP cuando el servidor rechaza una sesión', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({error: 'Sesión vencida'}, false));
  await expect(loginAccount('https://www.qsession.org', 'luna@example.com', 'clave-muy-segura')).rejects.toMatchObject({
    name: 'QSessionAccountError',
    status: 401,
  });
});

test('sube fotos pendientes, guarda la galería y publica un Story', async () => {
  const session = normalizeAccountSession({
    token: 'token-seguro',
    expiresAt: '2099-01-01T00:00:00Z',
    account: {id: 'account_1', email: 'luna@example.com', emailVerified: false, status: 'active'},
  })!;
  const profile = addProfilePhoto(normalizeProfile({...createEmptyProfile(), displayName: 'Luna', isPublic: true}), {
    localUri: 'content://foto',
    dataUrl: 'data:image/jpeg;base64,/9j/',
  });
  const fetchMock = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response({media: {id: 'media_1', url: '/api/profile-media/media_1'}}))
    .mockResolvedValueOnce(response({profile: {
      id: 'profile_1', displayName: 'Luna', visible: true,
      photos: [{id: 'media_1', url: '/api/profile-media/media_1'}],
      social: {allowMatchmaking: false},
    }}))
    .mockResolvedValueOnce(response({story: {id: 'story_1', text: 'A bailar', createdAt: '2026-09-02T12:00:00Z', expiresAt: '2026-09-03T12:00:00Z'}}));
  const saved = await saveAccountProfile('https://www.qsession.org', session, profile);
  expect(saved.gallery[0].mediaId).toBe('media_1');
  expect(saved.gallery[0].remoteUrl).toBe('https://www.qsession.org/api/profile-media/media_1');
  const story = await publishStory('https://www.qsession.org', session, 'A bailar', 'media_1');
  expect(story.id).toBe('story_1');
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock).toHaveBeenLastCalledWith(
    'https://www.qsession.org/api/stories',
    expect.objectContaining({body: JSON.stringify({text: 'A bailar', mediaId: 'media_1'})}),
  );
});

test('convierte el perfil del servidor sin perder la URI local de la misma foto', () => {
  const current = addProfilePhoto(createEmptyProfile(), {localUri: 'content://local', mediaId: 'media_1', remoteUrl: 'https://old/media_1'});
  const restored = profileFromServer('https://www.qsession.org', {
    id: 'profile_1', displayName: 'Ana', photos: [{id: 'media_1', url: '/api/profile-media/media_1'}], visible: true,
  }, current);
  expect(restored.gallery[0].localUri).toBe('content://local');
  expect(restored.photoUri).toBe('content://local');
});
