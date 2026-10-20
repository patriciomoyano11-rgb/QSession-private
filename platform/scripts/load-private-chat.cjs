'use strict';

// Entirely loopback: no provider credentials, cloud machines or real accounts.
// Measures socket delivery/isolation only, not persistence, media or production.
const http = require('node:http');
const {once} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const {createRealtimeHub} = require('../realtime-hub');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= end) throw new Error('Local delivery deadline exceeded');
    await wait(10);
  }
}
async function run({users = 10000, batchSize = 100, profileSockets = true} = {}) {
  if (!Number.isSafeInteger(users) || users < 10 || users > 10000 || users % 10) throw new Error('Expected 10..10000 users in complete ten-person groups');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 200) throw new Error('Invalid local connection batch');
  const groupFor = i => `private:synthetic_group_${Math.floor(i / 10)}`;
  const profileFor = i => `profile:synthetic_profile_${i}`;
  const server = http.createServer((_req, res) => res.end('local synthetic test'));
  const hub = createRealtimeHub({server, maximumConnections: users * 2 + 64,
    authorize: ({channel, token}) => {
      const match = /^synthetic-user-(\d+)$/.exec(token);
      const i = match ? Number(match[1]) : -1;
      return i >= 0 && i < users && (channel === groupFor(i) || channel === profileFor(i));
    }});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const records = Array.from({length: users}, () => []);
  const allSockets = new Set();
  const deliveries = new Map(), received = new Map(), latencies = [];
  let wrongChannel = 0, duplicate = 0, disconnectedDuringDelivery = 0, delivering = false;
  const started = Date.now();
  const socketsPerUser = profileSockets ? 2 : 1;
  async function connect(i, kind) {
    const channel = kind === 'group' ? groupFor(i) : profileFor(i);
    // Two loopback source addresses avoid a single Windows ephemeral-port
    // range masquerading as a 16k server connection ceiling.
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/realtime?channel=${channel}&token=synthetic-user-${i}`,
      {localAddress: kind === 'group' ? '127.0.0.1' : '127.0.0.2', handshakeTimeout: 15000});
    allSockets.add(socket);
    socket.on('close', () => { if (delivering) disconnectedDuringDelivery++; });
    socket.on('message', raw => {
      const event = JSON.parse(raw);
      if (event.type !== 'private-message' && event.type !== 'private-activity') return;
      if (event.channel !== channel) { wrongChannel++; return; }
      const key = `${i}:${kind}:${event.sequence}`;
      if (received.has(key)) { duplicate++; return; }
      received.set(key, true);
      deliveries.set(event.sequence, (deliveries.get(event.sequence) || 0) + 1);
      latencies.push(Date.now() - event.sentAt);
    });
    await once(socket, 'open');
    records[i].push(socket);
  }
  async function publishRound(sequence) {
    const began = Date.now();
    delivering = true;
    for (let i = 0; i < users; i++) {
      if (i % 10 === 0) await hub.publish(groupFor(i), {type: 'private-message', sequence, sentAt: Date.now(),
        message: {id: `synthetic-${sequence}-${i}`, text: 'Conversación de mi grupo privado'}});
      if (profileSockets) await hub.publish(profileFor(i), {type: 'private-activity', sequence, sentAt: Date.now()});
      if (i % 100 === 99) await new Promise(resolve => setImmediate(resolve));
    }
    await until(() => deliveries.get(sequence) === users * socketsPerUser);
    delivering = false;
    return Date.now() - began;
  }
  try {
    for (let start = 0; start < users; start += batchSize) {
      await Promise.all(Array.from({length: Math.min(batchSize, users - start)}, (_, offset) =>
        Promise.all([connect(start + offset, 'group'), ...(profileSockets ? [connect(start + offset, 'profile')] : [])])));
    }
    const connectMs = Date.now() - started;
    const connectionsBefore = hub.status().connections;
    const firstDeliveryMs = await publishRound(1);
    const reconnectUsers = Math.min(100, users);
    const closeEvents = [];
    for (let i = 0; i < reconnectUsers; i++) {
      for (const socket of records[i]) { closeEvents.push(once(socket, 'close')); socket.close(); }
      records[i] = [];
    }
    await Promise.all(closeEvents);
    await until(() => hub.status().connections === (users - reconnectUsers) * socketsPerUser);
    for (let start = 0; start < reconnectUsers; start += batchSize) {
      await Promise.all(Array.from({length: Math.min(batchSize, reconnectUsers - start)}, (_, offset) =>
        Promise.all([connect(start + offset, 'group'), ...(profileSockets ? [connect(start + offset, 'profile')] : [])])));
    }
    const connectionsAfter = hub.status().connections;
    const secondDeliveryMs = await publishRound(2);
    latencies.sort((a, b) => a - b);
    return {schemaVersion: 1, localOnly: true, cloudResourcesCreated: 0,
      syntheticUsers: users, privateGroups: users / 10, membersPerGroup: 10,
      profileNotificationSocketsIncluded: profileSockets,
      connectionsBefore, connectionsAfter, reconnectUsers,
      deliveredBeforeReconnect: deliveries.get(1), deliveredAfterReconnect: deliveries.get(2),
      wrongChannel, duplicate, disconnectedDuringDelivery,
      passed: connectionsBefore === users * socketsPerUser && connectionsAfter === users * socketsPerUser
        && !wrongChannel && !duplicate && !disconnectedDuringDelivery,
      connectMs, firstDeliveryMs, secondDeliveryMs,
      deliveryP95Ms: latencies[Math.floor(latencies.length * .95)],
      residentMegabytes: Math.round(process.memoryUsage().rss / 1024 / 1024),
      capacityCertified: false,
      excludes: ['HTTP authentication and persistence', 'Redis distribution', 'HLS audio/video',
        'voice/video calls', 'image delivery', 'production network and hardware']};
  } catch (error) {
    return {schemaVersion: 1, localOnly: true, cloudResourcesCreated: 0, passed: false,
      syntheticUsers: users, requestedSockets: users * socketsPerUser,
      connectionsObserved: hub.status().connections, errorCode: error.code || 'LOCAL_TEST_FAILED',
      profileNotificationSocketsIncluded: profileSockets, capacityCertified: false,
      interpretation: 'A local generator/runtime failure is not a production capacity result.'};
  } finally {
    delivering = false;
    for (const socket of allSockets) socket.terminate();
    await hub.close();
    await new Promise(resolve => server.close(resolve));
  }
}
if (require.main === module) {
  const userIndex = process.argv.indexOf('--users');
  const outputIndex = process.argv.indexOf('--output');
  run({users: userIndex < 0 ? 10000 : Number(process.argv[userIndex + 1]), profileSockets: !process.argv.includes('--groups-only')})
    .then(report => {
      if (outputIndex >= 0) {
        const root = path.resolve(__dirname, '../..');
        const output = path.resolve(root, process.argv[outputIndex + 1]);
        if (!output.startsWith(path.join(root, 'release') + path.sep) || !output.endsWith('.json')) throw new Error('Output must be a release JSON report');
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
      }
      console.log(JSON.stringify(report, null, 2));
      if (!report.passed) process.exitCode = 1;
    }).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
}
module.exports = {run};
