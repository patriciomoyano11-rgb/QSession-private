'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const test = require('node:test');
const WebSocket = require('ws');
const {createRealtimeHub} = require('../realtime-hub');
const {createScalableChatStore} = require('../scalable-chat-store');
const {createDirectVideoUploadProvider} = require('../direct-video-upload');

test('el canal WebSocket entrega un mensaje sin sondeo periódico', async t => {
  const server = http.createServer((_req, res) => res.end('ok'));
  const hub = createRealtimeHub({
    server,
    authorize: ({token}) => token === 'permitido',
    maximumConnections: 5000,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await hub.close();
    await new Promise(resolve => server.close(resolve));
  });

  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/realtime?channel=room:ABC123&token=permitido`);
  const messages = [];
  socket.on('message', value => messages.push(JSON.parse(value.toString())));
  await once(socket, 'open');
  await hub.publish('room:ABC123', {type: 'room-message', message: {id: 'msg_1', text: 'hola'}});
  while (!messages.some(message => message.type === 'room-message')) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(messages.find(message => message.type === 'room-message').message.text, 'hola');
  assert.equal(hub.status().maximumConnections, 5000);
  socket.close();
});

test('el chat conserva el adaptador de archivo durante la migración', async () => {
  const messages = [];
  const productStore = {
    addMessage(input) {
      const message = {...input, id: 'msg_file', createdAt: new Date().toISOString()};
      messages.push(message);
      return message;
    },
    listMessages() { return messages; },
  };
  const store = createScalableChatStore({productStore});
  const created = await store.addMessage({roomCode: 'ABC123', text: 'compatibilidad'});
  assert.equal(created.id, 'msg_file');
  assert.equal((await store.listMessages('ABC123')).length, 1);
  assert.deepEqual(store.status(), {driver: 'file', ready: true});
});

test('el adaptador PostgreSQL limita y ordena el historial de sala', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({sql, values});
      if (/SELECT id/.test(sql)) {
        return {rows: [
          {id: 'msg_2', room_code: 'ABC123', profile_id: 'profile_1', author: 'B', avatar_url: null, kind: 'text', body: 'dos', created_at: '2026-09-23T01:00:02.000Z'},
          {id: 'msg_1', room_code: 'ABC123', profile_id: 'profile_1', author: 'A', avatar_url: null, kind: 'text', body: 'uno', created_at: '2026-09-23T01:00:01.000Z'},
        ]};
      }
      return {rows: [], rowCount: 1};
    },
  };
  const store = createScalableChatStore({productStore: {}, pool});
  await new Promise(resolve => setImmediate(resolve));
  const messages = await store.listMessages('abc123', 5000);
  assert.deepEqual(messages.map(message => message.id), ['msg_1', 'msg_2']);
  const select = queries.find(query => /SELECT id/.test(query.sql));
  assert.deepEqual(select.values, ['ABC123', 100]);
  assert.equal(store.status().driver, 'postgres');
});

test('los videos obtienen una URL directa sin atravesar Q Session', async () => {
  let providerRequest;
  const provider = createDirectVideoUploadProvider({
    accountId: 'account_1',
    apiToken: 'secret-test-token',
    publicUrl: 'https://qsession.example',
    fetchImpl: async (url, init) => {
      providerRequest = {url, init};
      return {
        ok: true,
        status: 200,
        async json() {
          return {success: true, result: {uid: 'video_1', uploadURL: 'https://upload.example/one-time'}};
        },
      };
    },
  });
  const upload = await provider.create({
    creatorId: 'profile_1',
    roomCode: 'ABC123',
    originalName: 'saludo.mp4',
    contentType: 'video/mp4',
    byteLength: 20 * 1024 * 1024,
    durationSeconds: 30,
  });
  assert.equal(upload.uploadUrl, 'https://upload.example/one-time');
  assert.equal(upload.assetId, 'video_1');
  assert.match(providerRequest.url, /\/stream\/direct_upload$/);
  assert.doesNotMatch(providerRequest.init.body, /secret-test-token/);
  assert.match(providerRequest.init.body, /ABC123/);
});

test('las sesiones largas preparan una carga TUS reanudable y privada', async () => {
  let providerRequest;
  const headers = new Map([
    ['location', 'https://upload.videodelivery.net/tus-session'],
    ['stream-media-id', 'video_session_1'],
  ]);
  const provider = createDirectVideoUploadProvider({
    accountId: 'account_1', apiToken: 'secret-test-token', publicUrl: 'https://qsession.org',
    fetchImpl: async (url, init) => {
      providerRequest = {url, init};
      return {ok: true, status: 201, headers: {get: key => headers.get(String(key).toLowerCase()) || ''}};
    },
  });
  const upload = await provider.create({
    purpose: 'session', creatorId: 'profile_1', originalName: 'set-largo.mp4',
    contentType: 'video/mp4', byteLength: 750 * 1024 * 1024, durationSeconds: 3 * 60 * 60,
  });
  assert.equal(upload.protocol, 'tus');
  assert.equal(upload.assetId, 'video_session_1');
  assert.match(providerRequest.url, /\/stream\?direct_user=true$/);
  assert.equal(providerRequest.init.headers['Tus-Resumable'], '1.0.0');
  assert.equal(providerRequest.init.headers['Upload-Length'], String(750 * 1024 * 1024));
  assert.match(providerRequest.init.headers['Upload-Metadata'], /maxdurationseconds/);
  assert.match(providerRequest.init.headers['Upload-Metadata'], /requiresignedurls/);
});
