'use strict';

// Controller integration dependency only. Redis atomicity is tested separately
// against Redis, never inferred from this in-memory fixture.
function syntheticAdmissions() {
  const tokens = new Map(), calls = [];
  let sequence = 0;
  const fail = (message, statusCode) => { throw Object.assign(new Error(message), {statusCode}); };
  const fixture = {
    configured: true, unavailable: false, closed: false, calls, tokens,
    status: () => ({configured: true, ready: !fixture.unavailable, driver: 'test-double'}),
    decode(token) {
      const entry = tokens.get(token);
      if (!entry) fail('Autorización inválida', 403);
      if (entry.exp * 1000 <= Date.now()) fail('Autorización caducada', 410);
      return entry;
    },
    async reserve(input) {
      calls.push({action: 'reserve', ...input});
      if (fixture.unavailable) fail('Redis no disponible', 503);
      const entries = [...tokens.entries()].filter(([, item]) => item.code === input.code && item.prefix === input.prefix && item.generation === input.generation && item.until > Date.now());
      const existing = entries.find(([token]) => token === input.previousToken);
      if (existing) return {token: existing[0], active: entries.length, capacity: input.capacity};
      if (entries.length >= input.capacity) fail('La sala alcanzó su capacidad', 429);
      const token = `synthetic-admission-${++sequence}`;
      tokens.set(token, {...input, exp: Math.floor(input.expiresAt / 1000), until: Date.now() + 90000});
      return {token, active: entries.length + 1, capacity: input.capacity};
    },
    async check({token, objectKey}) {
      calls.push({action: 'check', token, objectKey});
      if (fixture.unavailable) fail('Redis no disponible', 503);
      const claims = fixture.decode(token);
      if (!String(objectKey).startsWith(claims.prefix + '/')) fail('Objeto fuera de la señal', 403);
      if (claims.until <= Date.now()) fail('Sesión de reproducción caducada', 410);
      claims.until = Date.now() + 90000;
      return {ok: true, code: claims.code, cacheSeconds: 20};
    },
    async count({code, prefix, generation}) {
      calls.push({action: 'count', code, prefix, generation});
      if (fixture.unavailable) fail('Redis no disponible', 503);
      return [...tokens.values()].filter(item => item.code === code && item.prefix === prefix && item.generation === generation && item.until > Date.now() && item.exp * 1000 > Date.now()).length;
    },
    async release(token) { calls.push({action: 'release', token}); return tokens.delete(token); },
    async close() { fixture.closed = true; },
  };
  return fixture;
}
module.exports = {syntheticAdmissions};
