'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {createFirebasePushProvider} = require('../push-notifications');

test('Firebase envía datos privados de mensaje con prioridad alta', async () => {
  const {privateKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
  const requests = [];
  const provider = createFirebasePushProvider({
    serviceAccount: {
      project_id: 'q-session-test',
      client_email: 'push@example.invalid',
      private_key: privateKey.export({type: 'pkcs8', format: 'pem'}),
    },
    fetchImpl: async (url, options) => {
      requests.push({url, options});
      if (url.includes('oauth2.googleapis.com')) {
        return {ok: true, json: async () => ({access_token: 'access-token', expires_in: 3600})};
      }
      return {ok: true, json: async () => ({name: 'messages/1'})};
    },
  });

  const result = await provider.sendToTokens(['token-1', 'token-1'], {
    type: 'message', actionId: 'action-1', conversationId: 'conversation-123',
    senderName: 'Ana', body: 'Te envió un mensaje privado',
  });

  assert.deepEqual(result, {configured: true, attempted: 1, delivered: 1});
  assert.equal(requests.length, 2);
  const delivery = JSON.parse(requests[1].options.body);
  assert.equal(delivery.message.token, 'token-1');
  assert.equal(delivery.message.android.priority, 'high');
  assert.equal(delivery.message.data.conversationId, 'conversation-123');
  assert.equal(delivery.message.notification, undefined);
});

test('Firebase queda desactivado sin credencial privada', async () => {
  const provider = createFirebasePushProvider({serviceAccountJson: ''});
  assert.equal(provider.configured, false);
  assert.deepEqual(
    await provider.sendToTokens(['token-1'], {type: 'message'}),
    {configured: false, attempted: 0, delivered: 0},
  );
});
