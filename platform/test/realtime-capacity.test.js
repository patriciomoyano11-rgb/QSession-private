'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const test = require('node:test');
const WebSocket = require('ws');
const {createRealtimeHub} = require('../realtime-hub');

async function setup(t, options = {}) {
  const server = http.createServer((_req, res) => res.end('ok'));
  const hub = createRealtimeHub({server, authorize: () => true, ...options});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const clients = [];
  t.after(async () => {
    clients.forEach(socket => socket.terminate());
    await hub.close();
    await new Promise(resolve => server.close(resolve));
  });
  function connect(channel = 'private:conversation_1') {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/realtime?channel=${channel}&token=test`);
    clients.push(socket);
    return socket;
  }
  return {hub, connect};
}

test('asynchronous authorization cannot admit past the limit during a connection burst', async t => {
  let allow;
  const gate = new Promise(resolve => { allow = resolve; });
  const {hub, connect} = await setup(t, {maximumConnections: 1, authorize: () => gate});
  const accepted = connect();
  const opening = once(accepted, 'open');
  while (hub.status().pendingUpgrades !== 1) await new Promise(resolve => setImmediate(resolve));
  const refused = connect();
  const refusal = once(refused, 'error');
  assert.match((await refusal)[0].message, /503/);
  allow(true);
  await opening;
  assert.equal(hub.status().connections, 1);
  assert.equal(hub.status().pendingUpgrades, 0);
});

test('a timed-out authorization releases its reserved place', async t => {
  let blocked = true;
  const {hub, connect} = await setup(t, {maximumConnections: 1, authorizationTimeoutMs: 25,
    authorize: () => blocked ? new Promise(() => {}) : true});
  await once(connect(), 'error');
  assert.equal(hub.status().pendingUpgrades, 0);
  blocked = false;
  await once(connect(), 'open');
  assert.equal(hub.status().connections, 1);
});

test('private channel events cannot cross to a different group and an expired grant stops delivery', async t => {
  let expiry = Date.now() + 10000;
  const {hub, connect} = await setup(t, {authorize: () => ({get expiresAt() { return expiry; }})});
  const first = connect(), second = connect('private:conversation_2');
  const messages = [], other = [];
  first.on('message', raw => messages.push(JSON.parse(raw)));
  second.on('message', raw => other.push(JSON.parse(raw)));
  await Promise.all([once(first, 'open'), once(second, 'open')]);
  assert.equal(await hub.publish('private:conversation_1', {type: 'private-message', message: {text: 'ours'}}), 1);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(messages.filter(event => event.type === 'private-message').length, 1);
  assert.equal(other.filter(event => event.type === 'private-message').length, 0);
  // A fresh socket records the short-lived expiry, independently of heartbeat.
  expiry = Date.now() + 50;
  const expiring = connect('private:conversation_3');
  await once(expiring, 'open');
  await new Promise(resolve => setTimeout(resolve, 60));
  const closed = once(expiring, 'close');
  assert.equal(await hub.publish('private:conversation_3', {type: 'private-message'}), 0);
  assert.equal((await closed)[0], 1008);
});

test('oversized outbound queues are disconnected and the next client can recover', async t => {
  const {hub, connect} = await setup(t, {maximumBufferedBytes: 1024});
  const client = connect();
  await once(client, 'open');
  const closed = once(client, 'close');
  assert.equal(await hub.publish('private:conversation_1', {type: 'private-message', text: 'x'.repeat(2048)}), 0);
  await closed;
  assert.equal(hub.status().slowConnectionsDropped, 1);
  const recovered = connect();
  await once(recovered, 'open');
  const delivered = once(recovered, 'message');
  assert.equal(await hub.publish('private:conversation_1', {type: 'private-message', text: 'recovered'}), 1);
  assert.equal(JSON.parse((await delivered)[0]).text, 'recovered');
});
