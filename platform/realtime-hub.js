'use strict';

const crypto = require('node:crypto');
const {WebSocketServer, WebSocket} = require('ws');

const DEFAULT_PATH = '/api/realtime';
const CHANNEL_PATTERN = /^(?:room:[A-Z0-9]{6}|private:[a-z0-9_-]{10,100}|profile:[a-z0-9_-]{10,100})$/i;

function rejectUpgrade(socket, status, message) {
  if (!socket?.writable) return socket?.destroy();
  const body = String(message || 'No autorizado');
  socket.end([
    `HTTP/1.1 ${status} ${status === 503 ? 'Service Unavailable' : 'Unauthorized'}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n'));
}

function createRealtimeHub({
  server,
  authorize,
  redisUrl = '',
  redisFactory = null,
  path = DEFAULT_PATH,
  maximumConnections = 6000,
  heartbeatMs = 30000,
  allowedOrigin = '',
  maximumBufferedBytes = 65536,
  authorizationTimeoutMs = 5000,
} = {}) {
  if (!server || typeof server.on !== 'function') throw new Error('Realtime necesita un servidor HTTP');
  if (typeof authorize !== 'function') throw new Error('Realtime necesita un autorizador');

  const instanceId = crypto.randomUUID();
  const channels = new Map();
  const wss = new WebSocketServer({noServer: true, perMessageDeflate: false, maxPayload: 4096});
  let connectionCount = 0;
  let pendingUpgrades = 0;
  let slowConnectionsDropped = 0;
  let redisPublisher = null;
  let redisSubscriber = null;
  let redisReady = false;
  let closed = false;

  function send(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.qsessionExpiresAt && socket.qsessionExpiresAt <= Date.now()) {
      removeSocket(socket);
      socket.close(1008, 'Renueva la autorización del canal');
      return false;
    }
    try {
      const encoded = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (socket.bufferedAmount + Buffer.byteLength(encoded) > maximumBufferedBytes) {
        slowConnectionsDropped += 1;
        removeSocket(socket);
        socket.terminate();
        return false;
      }
      socket.send(encoded, error => { if (error) { removeSocket(socket); socket.terminate(); } });
      return true;
    } catch {
      return false;
    }
  }

  function localPublish(channel, event) {
    const subscribers = channels.get(channel);
    if (!subscribers?.size) return 0;
    const encoded = JSON.stringify(event);
    let delivered = 0;
    for (const socket of subscribers) {
      if (send(socket, encoded)) delivered += 1;
    }
    return delivered;
  }

  async function publish(channel, event) {
    if (!CHANNEL_PATTERN.test(String(channel || ''))) return 0;
    const envelope = {
      ...event,
      channel,
      emittedAt: event?.emittedAt || new Date().toISOString(),
    };
    const delivered = localPublish(channel, envelope);
    if (redisReady && redisPublisher) {
      redisPublisher.publish('qsession:realtime', JSON.stringify({instanceId, channel, event: envelope})).catch(() => undefined);
    }
    return delivered;
  }

  function removeSocket(socket) {
    const channel = socket.qsessionChannel;
    if (channel) {
      const subscribers = channels.get(channel);
      subscribers?.delete(socket);
      if (!subscribers?.size) channels.delete(channel);
    }
    if (socket.qsessionCounted) {
      socket.qsessionCounted = false;
      connectionCount = Math.max(0, connectionCount - 1);
    }
  }

  wss.on('connection', (socket, _request, context = {}) => {
    const channel = context.channel;
    socket.qsessionChannel = channel;
    socket.qsessionAlive = true;
    socket.qsessionExpiresAt = context.authorized?.expiresAt || null;
    socket.qsessionCounted = true;
    connectionCount += 1;
    if (!channels.has(channel)) channels.set(channel, new Set());
    channels.get(channel).add(socket);
    socket.on('pong', () => { socket.qsessionAlive = true; });
    socket.on('message', data => {
      if (data.length > 4096) return socket.close(1009, 'Mensaje demasiado grande');
      let message;
      try { message = JSON.parse(data.toString('utf8')); } catch { return; }
      if (message?.type === 'ping') send(socket, {type: 'pong', at: Date.now()});
    });
    socket.on('close', () => removeSocket(socket));
    socket.on('error', () => removeSocket(socket));
    send(socket, {type: 'ready', channel, transport: 'websocket', at: Date.now()});
  });

  server.on('upgrade', async (request, socket, head) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    } catch {
      return rejectUpgrade(socket, 401, 'Solicitud inválida');
    }
    if (requestUrl.pathname !== path) return;
    if (closed || connectionCount + pendingUpgrades >= maximumConnections) {
      return rejectUpgrade(socket, 503, 'El canal en vivo alcanzó su capacidad temporal');
    }
    const origin = String(request.headers.origin || '');
    if (origin && allowedOrigin) {
      try {
        if (new URL(origin).origin !== new URL(allowedOrigin).origin) return rejectUpgrade(socket, 401, 'Origen no autorizado');
      } catch {
        return rejectUpgrade(socket, 401, 'Origen no autorizado');
      }
    }
    const channel = String(requestUrl.searchParams.get('channel') || '');
    if (!CHANNEL_PATTERN.test(channel)) return rejectUpgrade(socket, 401, 'Canal no autorizado');
    // Reserve before awaiting authorization; simultaneous handshakes must not
    // all observe the same free place and overrun the socket/memory limit.
    pendingUpgrades += 1;
    let authorizationTimer;
    try {
      const authorized = await Promise.race([
        authorize({request, channel, token: requestUrl.searchParams.get('token') || ''}),
        new Promise((_, reject) => {
          authorizationTimer = setTimeout(() => reject(new Error('Authorization timed out')), authorizationTimeoutMs);
          authorizationTimer.unref?.();
        }),
      ]);
      if (!authorized) return rejectUpgrade(socket, 401, 'Canal no autorizado');
      if (closed || socket.destroyed) return socket.destroy();
      if (authorized.expiresAt && authorized.expiresAt <= Date.now()) return rejectUpgrade(socket, 401, 'Autorización vencida');
      wss.handleUpgrade(request, socket, head, websocket => {
        wss.emit('connection', websocket, request, {channel, authorized});
      });
    } catch {
      return rejectUpgrade(socket, 401, 'Canal no autorizado');
    } finally {
      clearTimeout(authorizationTimer);
      pendingUpgrades -= 1;
    }
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.qsessionExpiresAt && socket.qsessionExpiresAt <= Date.now()) {
        removeSocket(socket);
        socket.close(1008, 'Renueva la autorización del canal');
        continue;
      }
      if (!socket.qsessionAlive) {
        removeSocket(socket);
        socket.terminate();
        continue;
      }
      socket.qsessionAlive = false;
      try { socket.ping(); } catch { socket.terminate(); }
    }
  }, Math.max(10000, heartbeatMs));
  heartbeat.unref?.();

  async function connectRedis() {
    if (!redisUrl) return;
    try {
      const createClient = redisFactory || require('redis').createClient;
      redisPublisher = createClient({url: redisUrl});
      redisSubscriber = redisPublisher.duplicate();
      const onError = error => console.warn(`Realtime Redis: ${error.message}`);
      redisPublisher.on?.('error', onError);
      redisSubscriber.on?.('error', onError);
      await Promise.all([redisPublisher.connect(), redisSubscriber.connect()]);
      await redisSubscriber.subscribe('qsession:realtime', raw => {
        try {
          const envelope = JSON.parse(raw);
          if (envelope.instanceId === instanceId || !CHANNEL_PATTERN.test(envelope.channel)) return;
          localPublish(envelope.channel, envelope.event);
        } catch { /* Un mensaje inválido no interrumpe el bus. */ }
      });
      redisReady = true;
    } catch (error) {
      redisReady = false;
      console.warn(`Realtime continuará sólo en esta instancia: ${error.message}`);
    }
  }

  void connectRedis();

  async function close() {
    closed = true;
    clearInterval(heartbeat);
    for (const socket of wss.clients) socket.close(1001, 'Servidor reiniciando');
    await Promise.allSettled([
      redisSubscriber?.quit?.(),
      redisPublisher?.quit?.(),
    ]);
    wss.close();
  }

  return {
    publish,
    close,
    status: () => ({
      transport: 'websocket',
      distribution: redisUrl ? (redisReady ? 'redis' : 'redis-connecting') : 'local',
      connections: connectionCount,
      channels: channels.size,
      maximumConnections,
      pendingUpgrades,
      slowConnectionsDropped,
    }),
  };
}

module.exports = {createRealtimeHub, CHANNEL_PATTERN};
