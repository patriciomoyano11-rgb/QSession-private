import {QSessionApi, normalizeQSessionOrigin} from '../src/core/QSessionApi';
import {ROOM_PRESETS} from '../src/core/QSessionContracts';

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => payload),
  } as unknown as Response;
}

test('normaliza una dirección Q Session sin convertirla en WebSocket', () => {
  expect(normalizeQSessionOrigin('wss://qsession.org/ws')).toBe('https://qsession.org');
});

test('crea una sala oficial y conserva el control fuera del objeto público', async () => {
  const fetcher = jest.fn(async () => response(201, {
    ok: true,
    room: {
      code: 'ABC123', name: 'Noche móvil', djName: 'Luna', roomType: 'party',
      status: 'live', transport: 'sfu', ...ROOM_PRESETS.party,
    },
    hostToken: 'control-secreto',
    joinUrl: 'https://qsession.org/?room=ABC123',
    mediaConfigured: true,
  })) as unknown as typeof fetch;
  const api = new QSessionApi('https://qsession.org/', fetcher);
  const rightsDeclaration = {
    accepted: true as const,
    version: 'music-rights-v1-2026-09-29',
    scope: 'host-supplied-content' as const,
  };

  const created = await api.createRoom({
    name: 'Noche móvil', roomType: 'party', visibility: 'public', rightsDeclaration,
  });

  expect(created.room.code).toBe('ABC123');
  expect(created.hostToken).toBe('control-secreto');
  expect(fetcher).toHaveBeenCalledWith(
    'https://qsession.org/api/rooms',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({name: 'Noche móvil', roomType: 'party', visibility: 'public', rightsDeclaration}),
    }),
  );
});

test('solicita una credencial LiveKit efímera para el anfitrión', async () => {
  const fetcher = jest.fn(async () => response(200, {
    ok: true, transport: 'sfu', url: 'wss://media.qsession.org', token: 'media-token',
  })) as unknown as typeof fetch;
  const api = new QSessionApi('qsession.org', fetcher);

  await expect(api.mediaCredentials('abc123', 'dj', 'host-token')).resolves.toEqual({
    transport: 'sfu', url: 'wss://media.qsession.org', token: 'media-token',
  });
  expect(fetcher).toHaveBeenCalledWith(
    'https://qsession.org/api/rooms/ABC123/media-token',
    expect.objectContaining({body: JSON.stringify({role: 'dj', hostToken: 'host-token'})}),
  );
});

test('inicia la única distribución HLS después de publicar al anfitrión', async () => {
  const fetcher = jest.fn(async () => response(202, {
    ok: true,
    broadcast: {
      configured: true,
      provider: 'r2-hls',
      roomCode: 'ABC123',
      state: 'starting',
      ready: false,
      playbackUrl: 'https://live.qsession.org/live/ABC123-SIGNED/index.m3u8',
      segmentDuration: 4,
      approximateLatencySeconds: 12,
    },
  })) as unknown as typeof fetch;
  const api = new QSessionApi('https://qsession.org', fetcher);

  const delivery = await api.startBroadcastDelivery('abc123', 'host-token');

  expect(delivery.provider).toBe('r2-hls');
  expect(delivery.segmentDuration).toBe(4);
  expect(fetcher).toHaveBeenCalledWith(
    'https://qsession.org/api/rooms/ABC123/broadcast/start',
    expect.objectContaining({body: JSON.stringify({hostToken: 'host-token'})}),
  );
});

test('envía la cuenta móvil como Bearer sin incluirla en la URL', async () => {
  const fetcher = jest.fn(async () => response(200, {
    ok: true,
    room: {code: 'ABC123'},
  })) as unknown as typeof fetch;
  const api = new QSessionApi('https://qsession.org', fetcher, 'account-token');

  await api.getRoom('ABC123');

  const [url, options] = (fetcher as jest.Mock).mock.calls[0];
  expect(url).toBe('https://qsession.org/api/rooms/ABC123');
  expect(url).not.toContain('account-token');
  expect(options.headers.authorization).toBe('Bearer account-token');
});
