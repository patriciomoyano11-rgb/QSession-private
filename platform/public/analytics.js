(() => {
  'use strict';

  const ENDPOINT = '/api/analytics/collect';
  const CLIENT_KEY = 'qsession-analytics-client-v1';
  const MAX_BATCH = 20;
  const userAgent = navigator.userAgent || '';
  const androidVersion = userAgent.match(/\bQSessionAndroid\/([^\s;,)]+)/i)?.[1] || null;
  const windowsVersion = userAgent.match(/\bQSessionDesktop\/([^\s;,)]+)/i)?.[1] || null;
  const surface = androidVersion ? 'android' : windowsVersion ? 'windows' : 'web';
  const version = androidVersion || windowsVersion || null;
  const sessionId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();
  let batch = [];
  let lastNetworkSampleAt = 0;

  function clientId() {
    try {
      const existing = localStorage.getItem(CLIENT_KEY);
      if (existing) return existing;
      const created = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(CLIENT_KEY, created);
      return created;
    } catch {
      return sessionId;
    }
  }

  const anonymousClientId = clientId();

  function connectionSnapshot(extra = {}) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    return {
      online: navigator.onLine !== false,
      effectiveType: connection.effectiveType || null,
      downlinkMbps: Number.isFinite(Number(connection.downlink)) ? Number(connection.downlink) : null,
      rttMs: Number.isFinite(Number(extra.rtt ?? connection.rtt)) ? Number(extra.rtt ?? connection.rtt) : null,
      packetLossPercent: Number.isFinite(Number(extra.packetLoss)) ? Number(extra.packetLoss) : null,
      uploadBps: Number.isFinite(Number(extra.upload)) ? Number(extra.upload) : null,
      downloadBps: Number.isFinite(Number(extra.download)) ? Number(extra.download) : null,
    };
  }

  function eventPayload(name, details = {}) {
    return {
      name,
      clientId: anonymousClientId,
      sessionId,
      surface,
      version,
      path: location.pathname,
      feature: details.feature || null,
      durationMs: details.durationMs ?? null,
      network: details.network || connectionSnapshot(),
    };
  }

  function flush({beacon = false} = {}) {
    if (!batch.length) return;
    const outgoing = batch.splice(0, MAX_BATCH);
    const body = JSON.stringify({events: outgoing});
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], {type: 'application/json'}));
    } else {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body,
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => undefined);
    }
    if (batch.length) window.setTimeout(() => flush(), 250);
  }

  function track(name, details = {}) {
    batch.push(eventPayload(name, details));
    if (batch.length >= MAX_BATCH) flush();
  }

  function featureFor(element) {
    if (!element) return null;
    if (element.dataset.analyticsFeature) return element.dataset.analyticsFeature;
    if (element.id) return `control:${element.id}`;
    if (element.dataset.view) return `view:${element.dataset.view}`;
    if (element.dataset.route) return `route:${element.dataset.route}`;
    const href = element.getAttribute?.('href');
    if (href?.startsWith('#')) return `route:${href.slice(1)}`;
    return null;
  }

  function sampleNetwork(metrics = {}) {
    const current = Date.now();
    if (current - lastNetworkSampleAt < 20_000) return;
    lastNetworkSampleAt = current;
    track('network_sample', {network: connectionSnapshot(metrics)});
  }

  window.QSessionAnalytics = Object.freeze({track, flush, network: sampleNetwork, surface, version});

  document.addEventListener('click', event => {
    const control = event.target.closest?.('button, a, [data-view], [data-route], [data-analytics-feature]');
    const feature = featureFor(control);
    if (feature) track('feature_use', {feature});
  }, {capture: true, passive: true});

  document.addEventListener('submit', event => {
    const feature = event.target?.id ? `form:${event.target.id}` : null;
    if (feature) track('feature_use', {feature});
  }, {capture: true});

  window.addEventListener('hashchange', () => track('page_view', {feature: `route:${location.hash.slice(1) || 'live'}`}));
  window.addEventListener('online', () => sampleNetwork());
  window.addEventListener('offline', () => sampleNetwork());
  window.addEventListener('error', () => track('client_error', {feature: 'javascript'}));
  window.addEventListener('unhandledrejection', () => track('client_error', {feature: 'promise'}));
  window.addEventListener('pagehide', () => {
    track('session_end', {durationMs: Date.now() - startedAt});
    flush({beacon: true});
  });

  track('session_start');
  track('page_view', {feature: `route:${location.hash.slice(1) || 'live'}`});
  window.setInterval(() => {
    track('heartbeat', {durationMs: Date.now() - startedAt, network: connectionSnapshot()});
    flush();
  }, 30_000);
  window.setTimeout(() => flush(), 1500);
})();
