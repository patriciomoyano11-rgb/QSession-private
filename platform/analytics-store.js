'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RETENTION_DAYS = 180;
const MAX_EVENTS = 200_000;
const EVENT_NAMES = new Set([
  'session_start',
  'session_end',
  'page_view',
  'feature_use',
  'heartbeat',
  'network_sample',
  'client_error',
]);
const SURFACES = new Set(['web', 'android', 'windows']);

function boundedText(value, maximum = 120) {
  return String(value || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, maximum);
}

function finiteNumber(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function average(values) {
  const measured = values.filter(Number.isFinite);
  if (!measured.length) return null;
  return Math.round(measured.reduce((sum, value) => sum + value, 0) / measured.length * 10) / 10;
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function ranked(map, limit = 20) {
  return [...map.entries()]
    .map(([name, count]) => ({name, count}))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function createAnalyticsStore({filePath, secret, now = () => new Date()} = {}) {
  if (!filePath) throw new Error('Falta QSESSION_ANALYTICS_DATA_FILE');
  const analyticsSecret = String(secret || 'qsession-development-analytics-secret');
  let events = [];

  function anonymousId(value, namespace) {
    const normalized = boundedText(value, 160);
    if (!normalized) return null;
    return crypto.createHmac('sha256', analyticsSecret)
      .update(`${namespace}\u0000${normalized}`)
      .digest('base64url')
      .slice(0, 32);
  }

  function load() {
    try {
      const rows = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
      events = rows.flatMap(row => {
        try { return [JSON.parse(row)]; } catch { return []; }
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    prune({compact: false});
  }

  function rewrite() {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const body = events.map(event => JSON.stringify(event)).join('\n');
    fs.writeFileSync(filePath, body ? `${body}\n` : '', {encoding: 'utf8', mode: 0o600});
  }

  function prune({compact = true} = {}) {
    const cutoff = now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const originalLength = events.length;
    events = events
      .filter(event => new Date(event.receivedAt).getTime() >= cutoff)
      .slice(-MAX_EVENTS);
    if (compact && events.length !== originalLength) rewrite();
  }

  function cleanNetwork(value = {}) {
    return {
      online: value.online !== false,
      effectiveType: boundedText(value.effectiveType, 12) || null,
      downlinkMbps: finiteNumber(value.downlinkMbps ?? value.downlink, 0, 10_000),
      rttMs: finiteNumber(value.rttMs ?? value.rtt, 0, 60_000),
      packetLossPercent: finiteNumber(value.packetLossPercent ?? value.packetLoss, 0, 100),
      uploadBps: finiteNumber(value.uploadBps ?? value.upload, 0, 10_000_000_000),
      downloadBps: finiteNumber(value.downloadBps ?? value.download, 0, 10_000_000_000),
    };
  }

  function cleanEvent(input = {}) {
    const name = EVENT_NAMES.has(input.name) ? input.name : null;
    if (!name) return null;
    const receivedAt = now().toISOString();
    return {
      id: crypto.randomUUID(),
      name,
      receivedAt,
      clientId: anonymousId(input.clientId, 'client'),
      sessionId: anonymousId(input.sessionId, 'session'),
      surface: SURFACES.has(input.surface) ? input.surface : 'web',
      version: boundedText(input.version, 32) || null,
      path: boundedText(input.path, 160).replace(/[?#].*$/, '') || '/',
      feature: boundedText(input.feature, 100).replace(/[^a-z0-9:._-]/gi, '') || null,
      durationMs: finiteNumber(input.durationMs, 0, 24 * 60 * 60 * 1000),
      network: cleanNetwork(input.network),
    };
  }

  function recordBatch(inputEvents) {
    const accepted = (Array.isArray(inputEvents) ? inputEvents : [inputEvents])
      .slice(0, 30)
      .map(cleanEvent)
      .filter(Boolean);
    if (!accepted.length) return {accepted: 0};
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.appendFileSync(filePath, `${accepted.map(event => JSON.stringify(event)).join('\n')}\n`, {encoding: 'utf8', mode: 0o600});
    events.push(...accepted);
    if (events.length > MAX_EVENTS || events.length % 5000 < accepted.length) prune();
    return {accepted: accepted.length};
  }

  function summary({days = 30, product = {}} = {}) {
    const safeDays = Math.min(180, Math.max(1, Number(days) || 30));
    const end = now();
    const start = new Date(end.getTime() - safeDays * 24 * 60 * 60 * 1000);
    const selected = events.filter(event => new Date(event.receivedAt) >= start);
    const visitors = new Set(selected.map(event => event.clientId).filter(Boolean));
    const visits = new Set(selected.map(event => event.sessionId).filter(Boolean));
    const activeSince = end.getTime() - 5 * 60 * 1000;
    const activeVisitors = new Set(selected
      .filter(event => new Date(event.receivedAt).getTime() >= activeSince && event.name !== 'session_end')
      .map(event => event.clientId)
      .filter(Boolean));
    const surfaceEvents = new Map();
    const surfaceVisitors = new Map();
    const surfaceSessions = new Map();
    const surfaceFeatures = new Map();
    const surfaceNetworkSamples = new Map();
    const versions = new Map();
    const features = new Map();
    const daily = new Map();
    const networkSamples = [];

    selected.forEach(event => {
      increment(surfaceEvents, event.surface);
      if (event.version) increment(versions, `${event.surface} ${event.version}`);
      if (event.name === 'feature_use' && event.feature) {
        increment(features, event.feature);
        if (!surfaceFeatures.has(event.surface)) surfaceFeatures.set(event.surface, new Map());
        increment(surfaceFeatures.get(event.surface), event.feature);
      }
      if (event.name === 'network_sample' || event.name === 'heartbeat') {
        networkSamples.push(event.network || {});
        if (!surfaceNetworkSamples.has(event.surface)) surfaceNetworkSamples.set(event.surface, []);
        surfaceNetworkSamples.get(event.surface).push(event.network || {});
      }
      const date = event.receivedAt.slice(0, 10);
      if (!daily.has(date)) daily.set(date, {date, events: 0, pageViews: 0, visitors: new Set(), sessions: new Set()});
      const point = daily.get(date);
      point.events += 1;
      if (event.name === 'page_view') point.pageViews += 1;
      if (event.clientId) point.visitors.add(event.clientId);
      if (event.sessionId) point.sessions.add(event.sessionId);
      if (event.clientId) {
        if (!surfaceVisitors.has(event.surface)) surfaceVisitors.set(event.surface, new Set());
        surfaceVisitors.get(event.surface).add(event.clientId);
      }
      if (event.sessionId) {
        if (!surfaceSessions.has(event.surface)) surfaceSessions.set(event.surface, new Set());
        surfaceSessions.get(event.surface).add(event.sessionId);
      }
    });

    const summarizeNetwork = samples => ({
      samples: samples.length,
      onlinePercent: samples.length
        ? Math.round(samples.filter(sample => sample.online !== false).length / samples.length * 1000) / 10
        : null,
      averageRttMs: average(samples.map(sample => sample.rttMs)),
      averageDownlinkMbps: average(samples.map(sample => sample.downlinkMbps)),
      averagePacketLossPercent: average(samples.map(sample => sample.packetLossPercent)),
      averageUploadKbps: average(samples.map(sample => Number.isFinite(sample.uploadBps) ? sample.uploadBps / 1000 : null)),
      averageDownloadKbps: average(samples.map(sample => Number.isFinite(sample.downloadBps) ? sample.downloadBps / 1000 : null)),
    });
    const surfaces = ['web', 'android', 'windows'].map(name => ({
      name,
      visitors: surfaceVisitors.get(name)?.size || 0,
      sessions: surfaceSessions.get(name)?.size || 0,
      events: surfaceEvents.get(name) || 0,
      features: ranked(surfaceFeatures.get(name) || new Map(), 5),
      network: summarizeNetwork(surfaceNetworkSamples.get(name) || []),
    }));
    const productRooms = Array.isArray(product.rooms) ? product.rooms : [];
    const roomJoins = productRooms.reduce((total, room) => total + (Number(room.totalJoins) || 0), 0);
    const peakListeners = productRooms.reduce((maximum, room) => Math.max(maximum, Number(room.peakListeners) || 0), 0);

    return {
      generatedAt: end.toISOString(),
      period: {days: safeDays, from: start.toISOString(), to: end.toISOString()},
      overview: {
        activeNow: activeVisitors.size,
        visitors: visitors.size,
        sessions: visits.size,
        pageViews: selected.filter(event => event.name === 'page_view').length,
        featureUses: selected.filter(event => event.name === 'feature_use').length,
        clientErrors: selected.filter(event => event.name === 'client_error').length,
      },
      surfaces,
      versions: ranked(versions, 12),
      features: ranked(features, 24),
      network: summarizeNetwork(networkSamples),
      product: {
        accounts: Array.isArray(product.accounts) ? product.accounts.length : 0,
        visibleProfiles: Array.isArray(product.profiles) ? product.profiles.filter(profile => profile.visible).length : 0,
        rooms: productRooms.length,
        liveRooms: productRooms.filter(room => room.status === 'live').length,
        archivedRooms: productRooms.filter(room => room.status === 'archived').length,
        roomJoins,
        peakListeners,
        roomMessages: Array.isArray(product.messages) ? product.messages.length : 0,
        privateMessages: Array.isArray(product.privateMessages) ? product.privateMessages.length : 0,
        profileInteractions: Array.isArray(product.profileActions) ? product.profileActions.length : 0,
      },
      daily: [...daily.values()]
        .map(point => ({...point, visitors: point.visitors.size, sessions: point.sessions.size}))
        .sort((left, right) => left.date.localeCompare(right.date)),
    };
  }

  load();
  return {recordBatch, summary};
}

module.exports = {createAnalyticsStore};
