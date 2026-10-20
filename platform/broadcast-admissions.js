'use strict';

const crypto = require('node:crypto');

// A single atomic operation removes expired leases, checks the limit and reserves.
// Redis TIME keeps all app replicas on the same clock for seat ownership.
const LEASE_SCRIPT = `
local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local action=ARGV[1]
local member=ARGV[2]
local capacity=tonumber(ARGV[3])
local ttl=tonumber(ARGV[4])
local eventEnd=tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
local count=redis.call('ZCARD',KEYS[1])
if action=='count' then return {1,count,now} end
local existing=redis.call('ZSCORE',KEYS[1],member)
if action=='release' then
  local removed=redis.call('ZREM',KEYS[1],member)
  return {removed,redis.call('ZCARD',KEYS[1]),now}
end
if eventEnd<=now then return {-2,count,now} end
if action=='touch' and not existing then return {-1,count,now} end
if action=='reserve' and not existing and count>=capacity then return {0,count,now} end
local untilAt=math.min(now+ttl,eventEnd)
redis.call('ZADD',KEYS[1],untilAt,member)
redis.call('PEXPIRE',KEYS[1],ttl+60000)
return {1,redis.call('ZCARD',KEYS[1]),untilAt}
`;

function admissionError(message, statusCode = 503) {
  return Object.assign(new Error(message), {statusCode});
}

function validClaims(value, now = Date.now()) {
  if (!value || value.v !== 1 || value.aud !== 'qsession-hls'
    || !/^[A-Z0-9]{6}$/.test(value.code)
    || !new RegExp('^live/' + value.code + '-[A-Za-z0-9_-]{18}$').test(value.prefix)
    || !/^[A-Za-z0-9_-]{22,128}$/.test(value.lease)
    || !Number.isSafeInteger(value.exp)
    || (value.generation !== undefined && (typeof value.generation !== 'string' || value.generation.length > 100))) {
    throw admissionError('La autorización de reproducción no es válida', 403);
  }
  if (value.exp * 1000 <= now) throw admissionError('La autorización de reproducción caducó', 410);
  return value;
}

function createBroadcastAdmissions({redisUrl = '', secret = '', namespace = 'qsession:broadcast', redisClient = null,
  clock = Date.now, leaseMs = 90_000, operationTimeoutMs = 3000} = {}) {
  if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(namespace)) throw new Error('El espacio de aforo no es válido');
  const configured = Boolean((redisUrl || redisClient) && Buffer.byteLength(secret, 'utf8') >= 32);
  const duration = Math.max(45_000, Math.min(180_000, Number(leaseMs) || 90_000));
  let client = redisClient;
  let connecting = null;
  let lastReady = false;
  let closed = false;

  function decode(token) {
    if (!configured || typeof token !== 'string' || token.length > 2048) throw admissionError('La autorización no está disponible', 403);
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
      throw admissionError('La autorización de reproducción no es válida', 403);
    }
    const expected = crypto.createHmac('sha256', secret).update('v1.' + parts[1]).digest();
    const received = Buffer.from(parts[2], 'base64url');
    if (received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) throw admissionError('La firma de reproducción no es válida', 403);
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
    catch { throw admissionError('La autorización de reproducción no es válida', 403); }
    return validClaims(claims, clock());
  }

  function encode(claims) {
    validClaims(claims, clock());
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return 'v1.' + body + '.' + crypto.createHmac('sha256', secret).update('v1.' + body).digest('base64url');
  }

  function key(claims) {
    const event = crypto.createHash('sha256').update(claims.prefix + ':' + (claims.generation || '')).digest('hex').slice(0,32);
    return `${namespace}:{${claims.code}:${event}}:leases`;
  }

  async function ensureClient() {
    if (!configured || closed) throw admissionError('El control de aforo distribuido no está disponible');
    if (!client) {
      client = require('redis').createClient({url: redisUrl, disableOfflineQueue: true,
        socket: {connectTimeout: operationTimeoutMs, reconnectStrategy: retries => Math.min(5000, 100 + retries * 250)}});
      client.on('error', () => { lastReady = false; });
      client.on('ready', () => { lastReady = true; });
    }
    if (!client.isOpen && !connecting) {
      connecting = client.connect().finally(() => { connecting = null; });
    }
    if (connecting) await connecting;
    if (!client.isReady) throw admissionError('El control de aforo distribuido está reconectando');
    lastReady = true;
    return client;
  }

  async function operate(action, claims, capacity = 1) {
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const redis = await ensureClient();
          return redis.eval(LEASE_SCRIPT, {keys:[key(claims)], arguments:[action,claims.lease,String(capacity),String(duration),String(claims.exp * 1000)]});
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(admissionError('El control de aforo no respondió a tiempo')), operationTimeoutMs); timer.unref?.(); }),
      ]);
    } catch (error) {
      lastReady = false;
      if (error.statusCode) throw error;
      throw admissionError('No fue posible comprobar el aforo distribuido');
    } finally { clearTimeout(timer); }
  }

  async function reserve({code, prefix, capacity, expiresAt, generation = '', previousToken = ''}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 500_000) throw admissionError('El aforo del evento no es válido', 403);
    const exp = Math.floor(Math.min(Number(expiresAt), clock() + 6 * 3600_000) / 1000);
    const claims = {v:1,aud:'qsession-hls',code,prefix,generation,lease:crypto.randomBytes(18).toString('base64url'),exp};
    validClaims(claims,clock());
    if (previousToken) {
      let old;
      try { old = decode(previousToken); } catch { /* A new authorized admission still checks capacity. */ }
      if (old && old.code === code && old.prefix === prefix && (old.generation || '') === generation) {
        const resumed = await operate('touch',old,capacity);
        if (Number(resumed[0]) === 1) return {token:previousToken,lease:old.lease,expiresAt:old.exp*1000,active:Number(resumed[1]),capacity};
      }
    }
    const result = await operate('reserve',claims,capacity);
    if (Number(result[0]) === 0) throw admissionError(`La sala alcanzó su capacidad de ${capacity.toLocaleString('es-CO')} personas`,429);
    if (Number(result[0]) !== 1) throw admissionError('La sesión ya terminó',410);
    return {token:encode(claims),lease:claims.lease,expiresAt:claims.exp*1000,active:Number(result[1]),capacity};
  }

  async function check({token, objectKey}) {
    const claims = decode(token);
    if (typeof objectKey !== 'string' || !objectKey.startsWith(claims.prefix + '/')
      || !/^(index|archive|segment[^/]*)\.(m3u8|ts|m4s)$/.test(objectKey.slice(claims.prefix.length+1))) {
      throw admissionError('La autorización no corresponde a esta señal',403);
    }
    const result = await operate('touch',claims);
    if (Number(result[0]) !== 1) throw admissionError('La sesión de reproducción venció; vuelve a entrar a la sala',410);
    return {ok:true,code:claims.code,cacheSeconds:Math.max(0,Math.min(20,Math.floor(claims.exp-clock()/1000)))};
  }

  async function release(token) {
    const claims=decode(token);
    return Number((await operate('release',claims))[0]) === 1;
  }

  async function count({code,prefix,generation=''}) {
    const claims={code,prefix,generation,lease:'count-only',exp:Math.floor(clock()/1000)+60};
    return Number((await operate('count',claims))[1]);
  }

  async function close() {
    closed = true;
    if (client?.isOpen) await client.quit().catch(() => client.destroy?.());
  }
  return {configured,decode,reserve,check,release,count,close,
    status:()=>({configured,ready:Boolean(lastReady && client?.isReady),driver:configured?'redis':'unconfigured'})};
}

module.exports={createBroadcastAdmissions,validClaims,LEASE_SCRIPT};
