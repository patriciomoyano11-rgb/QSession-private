import {parseRoomInvitation, roomIsActiveOnServer} from '../src/QSessionRoom';

test('encuentra una sala mundial de QSession antes de buscar en la red local', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    json: async () => ({ok: true, room: {status: 'live'}}),
  })) as unknown as typeof fetch;

  await expect(roomIsActiveOnServer('https://www.qsession.org', 'abc123', fetcher)).resolves.toBe(true);
  expect(fetcher).toHaveBeenCalledWith(
    'https://www.qsession.org/api/rooms/ABC123',
    expect.objectContaining({signal: expect.anything()}),
  );
});

test('lee el enlace oficial que genera Q Session', () => {
  expect(parseRoomInvitation('https://qsession.org/?room=ABC123')).toEqual({
    room: 'ABC123',
    server: 'https://qsession.org',
  });
});

test('permite continuar con el descubrimiento local cuando la sala mundial no está activa', async () => {
  const fetcher = jest.fn(async () => ({ok: false})) as unknown as typeof fetch;
  await expect(roomIsActiveOnServer('https://www.qsession.org', 'ABC123', fetcher)).resolves.toBe(false);
});
