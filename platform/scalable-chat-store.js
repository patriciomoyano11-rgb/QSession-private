'use strict';

const crypto = require('node:crypto');

function cleanText(value, maximum) {
  return String(value ?? '').trim().slice(0, maximum);
}

function safeLimit(value, fallback = 50) {
  return Math.min(100, Math.max(1, Number(value) || fallback));
}

function createScalableChatStore({databaseUrl = '', productStore, pool = null, maximumPoolSize = 20} = {}) {
  if (!productStore) throw new Error('Chat necesita el almacén principal de Q Session');
  const usePostgres = Boolean(databaseUrl || pool);
  const database = pool || (usePostgres ? new (require('pg').Pool)({
    connectionString: databaseUrl,
    max: maximumPoolSize,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  }) : null);
  let databaseReady = false;
  let lastDatabaseError = '';

  async function check() {
    if (!database) return {driver: 'file', ready: true};
    try {
      await database.query('SELECT 1 FROM room_messages LIMIT 1');
      databaseReady = true;
      lastDatabaseError = '';
    } catch (error) {
      databaseReady = false;
      lastDatabaseError = error.message;
    }
    return status();
  }

  function status() {
    return {
      driver: database ? 'postgres' : 'file',
      ready: database ? databaseReady : true,
      ...(lastDatabaseError ? {error: lastDatabaseError} : {}),
    };
  }

  async function listMessages(roomCode, limit = 50) {
    if (!database) return productStore.listMessages(roomCode, limit);
    const result = await database.query(`
      SELECT id, room_code, profile_id, author, avatar_url, kind, body, created_at
      FROM room_messages
      WHERE room_code = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `, [String(roomCode).toUpperCase(), safeLimit(limit)]);
    databaseReady = true;
    return result.rows.reverse().map(row => ({
      id: row.id,
      roomCode: row.room_code,
      profileId: row.profile_id,
      author: row.author,
      avatarUrl: row.avatar_url,
      kind: row.kind,
      text: row.body,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async function addMessage(input = {}) {
    if (!database) return productStore.addMessage(input);
    const roomCode = cleanText(input.roomCode, 6).toUpperCase();
    const kind = input.kind === 'reaction' ? 'reaction' : 'text';
    const body = cleanText(input.text, kind === 'reaction' ? 12 : 600);
    if (!body) throw new Error('El mensaje está vacío');
    const message = {
      id: `msg_${crypto.randomUUID()}`,
      roomCode,
      profileId: cleanText(input.profileId, 100) || null,
      author: cleanText(input.author, 60) || 'Oyente',
      avatarUrl: cleanText(input.avatarUrl, 2048) || null,
      kind,
      text: body,
      createdAt: new Date().toISOString(),
    };
    await database.query(`
      INSERT INTO room_messages (id, room_code, profile_id, author, avatar_url, kind, body, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      message.id,
      message.roomCode,
      message.profileId,
      message.author,
      message.avatarUrl,
      message.kind,
      message.text,
      message.createdAt,
    ]);
    databaseReady = true;
    return message;
  }

  async function close() {
    if (database && !pool) await database.end();
  }

  if (database) void check();
  return {listMessages, addMessage, check, close, status};
}

module.exports = {createScalableChatStore};
