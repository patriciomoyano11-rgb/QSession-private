'use strict';

const http = require('node:http');
const {once} = require('node:events');
const WebSocket = require('ws');
const {createRealtimeHub} = require('../realtime-hub');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) || fallback : fallback;
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, 'open');
  return socket;
}

async function run({connections = 500, batchSize = 100} = {}) {
  const server = http.createServer((_request, response) => response.end('ok'));
  const hub = createRealtimeHub({server, authorize: () => true, maximumConnections: connections + 100});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/api/realtime?channel=room:ABC123&token=load`;
  const sockets = [];
  const startedAt = Date.now();
  try {
    for (let offset = 0; offset < connections; offset += batchSize) {
      const size = Math.min(batchSize, connections - offset);
      sockets.push(...await Promise.all(Array.from({length: size}, () => connect(url))));
    }
    let delivered = 0;
    const delivery = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Sólo ${delivered}/${connections} conexiones recibieron el evento`)), 30000);
      sockets.forEach(socket => socket.on('message', raw => {
        try {
          if (JSON.parse(raw.toString()).type !== 'load-test') return;
          delivered += 1;
          if (delivered === connections) {
            clearTimeout(timeout);
            resolve();
          }
        } catch { /* El mensaje ready no forma parte de la medición. */ }
      }));
    });
    const publishStartedAt = Date.now();
    await hub.publish('room:ABC123', {type: 'load-test', sequence: 1});
    await delivery;
    return {
      connections,
      connectMilliseconds: publishStartedAt - startedAt,
      broadcastMilliseconds: Date.now() - publishStartedAt,
      residentMegabytes: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  } finally {
    sockets.forEach(socket => socket.terminate());
    await hub.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  run({connections: argument('connections', 500), batchSize: argument('batch', 100)})
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {run};
