'use strict';

const crypto = require('node:crypto');

const COUNTRY_CODE = /^[A-Z]{2}$/;
const DEFAULT_TTL_MS = 3 * 60 * 1000;
const DEFAULT_MAX_POINTS_PER_COUNTRY = 25;

function normalizedCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!COUNTRY_CODE.test(code) || code === 'XX') throw new Error('No fue posible identificar el país');
  return code;
}

function normalizedPublicName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function createGlobalRavePresenceStore({
  ttlMs = DEFAULT_TTL_MS,
  maxPointsPerCountry = DEFAULT_MAX_POINTS_PER_COUNTRY,
  secret = crypto.randomBytes(32).toString('hex'),
} = {}) {
  const entries = new Map();
  const safeTtlMs = Math.max(30_000, Number(ttlMs) || DEFAULT_TTL_MS);
  const safeMaximum = Math.max(1, Math.min(25, Number(maxPointsPerCountry) || DEFAULT_MAX_POINTS_PER_COUNTRY));

  function purge(now = Date.now()) {
    for (const [accountId, presence] of entries) {
      if (presence.expiresAt <= now) entries.delete(accountId);
    }
  }

  function update(input = {}, now = Date.now()) {
    const accountId = String(input.accountId || '').trim();
    if (!accountId) throw new Error('La presencia necesita una cuenta activa');
    const countryCode = normalizedCountryCode(input.countryCode);
    entries.set(accountId, {
      countryCode,
      roomCode: String(input.roomCode || '').trim().toUpperCase().slice(0, 6),
      publicName: input.profileVisible ? normalizedPublicName(input.publicName) : '',
      expiresAt: now + safeTtlMs,
    });
    return {countryCode, expiresAt: now + safeTtlMs};
  }

  function remove(accountId) {
    return entries.delete(String(accountId || '').trim());
  }

  function snapshot(now = Date.now()) {
    purge(now);
    const countries = new Map();
    for (const [accountId, presence] of entries) {
      const country = countries.get(presence.countryCode) || {code: presence.countryCode, count: 0, candidates: []};
      country.count += 1;
      country.candidates.push({
        rank: crypto.createHmac('sha256', secret).update(`rank:${accountId}`).digest('hex'),
        publicName: presence.publicName,
      });
      countries.set(presence.countryCode, country);
    }
    const countryList = [...countries.values()]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map(country => ({
        code: country.code,
        count: country.count,
        points: country.candidates
          .sort((left, right) => left.rank.localeCompare(right.rank))
          .slice(0, safeMaximum)
          .map(() => ({})),
        publicPeople: country.candidates
          .filter(candidate => candidate.publicName)
          .sort((left, right) => left.rank.localeCompare(right.rank))
          .slice(0, safeMaximum)
          .map(candidate => candidate.publicName),
        privateCount: country.candidates.filter(candidate => !candidate.publicName).length,
      }));
    return {
      total: entries.size,
      activeCountries: countryList.length,
      maxPointsPerCountry: safeMaximum,
      countries: countryList,
      updatedAt: new Date(now).toISOString(),
    };
  }

  return {update, remove, snapshot, purge};
}

module.exports = {
  createGlobalRavePresenceStore,
  normalizedCountryCode,
};
