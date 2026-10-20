'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');

function definition(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const tail = source.slice(start);
  const next = /\n(?:async )?function \w+\(/.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function fixture({restoredPage = false} = {}) {
  const calls = [], nodes = new Map();
  const oldDelivery = {kind: 'broadcast', audienceMode: 'cdn-only', url: 'https://cdn.invalid/live/index.m3u8?qsat=old-lease'};
  const state = {currentRoomCode: 'ABC123', mediaRole: 'listener', mediaConnected: !restoredPage,
    mediaRoomCode: restoredPage ? '' : 'ABC123', mediaRoom: null,
    broadcastDelivery: restoredPage ? null : oldDelivery, broadcastUsingEdge: !restoredPage,
    edgeNativeSessionActive: !restoredPage, edgeNativeRoomCode: restoredPage ? '' : 'ABC123',
    edgeNativeBackgroundActive: !restoredPage, remoteAudioTracks: new Set(), peopleVideoTracks: new Map(),
    listenerOutputGain: 1, listenerMuted: false, chatMode: 'private'};
  const byId = id => {
    if (!nodes.has(id)) nodes.set(id, {hidden: false, disabled: false, style: {removeProperty() {}}, dataset: {},
      classList: {remove() {}, toggle() {}}, removeEventListener() {}, pause() {}, load() {}, removeAttribute() {}, replaceChildren() {}});
    return nodes.get(id);
  };
  const context = {state, URL, clearTimeout() {}, byId, isNativeAndroidApp: () => true, hasNativeAndroidAudio: () => true,
    window: {QSessionMusic: {release() {}, showRoomTrack() {}}, LivekitClient: {Room: class {
      async startAudio() { calls.push({type: 'unlock-audio'}); }
      async connect() { throw new Error('An HLS listener must never enter the SFU'); }
    }}},
    postNativeAudioCommand: command => { calls.push(command); return true; },
    setMediaStatus: (message, error) => calls.push({message, error}),
    setMediaControlsActive: active => calls.push({controlsActive: active}),
    updateMediaConnection: active => calls.push({connected: active}),
    startEdgeBroadcastPlayback: async delivery => {
      state.broadcastDelivery = delivery; state.broadcastUsingEdge = true;
      state.edgeNativeSessionActive = true; state.edgeNativeRoomCode = state.currentRoomCode;
      calls.push({type: 'listener-edge-start', url: delivery.url});
      return true;
    },
    stopVoiceOverlay: async () => {}, wireMediaRoom() {}, setListenerActionButtonLabel() {}, setBroadcastActionButtonLabel() {},
    setStatus() {}, clearPrimaryVideo() {}, renderPeople() {}, resetCameraSourceControl() {}, resetCameraFraming() {},
    stopConnectionMonitor() {}, stopFlowerListeningRewards() {}, stopSessionVisual() {}, clearMediaSignalTimer() {},
    stopMediaMeter() {}, stopDesktopChromeCapture() {}, stopChatPolling() {}, startProfileActivityPolling() {}};
  vm.createContext(context);
  vm.runInContext('let listenerAudioRecoveryGeneration = 0;', context);
  for (const name of ['isCdnOnlyAudience', 'stopEdgeBroadcastPlayback', 'disconnectMedia', 'connectMedia', 'joinBroadcast', 'showListenerRetry']) {
    vm.runInContext(definition(name), context);
  }
  const grant = url => ({transport: 'hls', delivery: {kind: 'broadcast', audienceMode: 'cdn-only',
    url: url || 'https://cdn.invalid/live/index.m3u8?qsat=renewed-lease', fallback: null}, permissions: ['listen']});
  return {context, state, calls, nodes, oldDelivery, grant};
}

test('a same-room retry waits for a valid replacement grant before touching native playback', async () => {
  const h = fixture(), pending = deferred();
  h.context.mediaCredentials = () => pending.promise;
  const joining = h.context.joinBroadcast();
  assert.equal(h.state.broadcastDelivery, h.oldDelivery);
  assert.equal(h.state.edgeNativeSessionActive, true);
  assert.ok(!h.calls.some(call => /stop$/.test(call.type || '')));
  const grant = h.grant(); pending.resolve(grant); await joining;
  assert.equal(h.state.broadcastDelivery, grant.delivery);
  assert.equal(h.state.mediaRoom, null);
  assert.ok(!h.calls.some(call => call.type === 'listener-stop' || call.type === 'listener-edge-stop' || call.type === 'listener-start'));
  assert.equal(h.calls.find(call => call.type === 'listener-edge-start').url, grant.delivery.url);
});

test('failed, invalid, or downgraded replacement grants preserve the admitted signal and offer retry', async () => {
  for (const invalid of ['network', 'invalid-url', 'script-url', 'sfu-downgrade']) {
    const h = fixture();
    h.context.mediaCredentials = async () => {
      if (invalid === 'invalid-url') return h.grant('not-an-hls-url');
      if (invalid === 'script-url') return h.grant('javascript:alert(1)');
      if (invalid === 'sfu-downgrade') return {transport: 'sfu', url: 'wss://sfu.invalid', token: 'direct-media'};
      throw new Error('Credentials temporarily unavailable');
    };
    await h.context.joinBroadcast();
    assert.equal(h.state.broadcastDelivery, h.oldDelivery);
    assert.equal(h.state.mediaConnected, true);
    assert.equal(h.state.edgeNativeSessionActive, true);
    assert.ok(!h.calls.some(call => call.type === 'listener-stop' || call.type === 'listener-edge-stop'));
    assert.equal(h.nodes.get('joinBroadcast').hidden, false);
    assert.equal(h.nodes.get('joinBroadcast').disabled, false);
    assert.ok(h.calls.some(call => call.error));
  }
});

test('a pending retry cannot revive playback after explicit leave', async () => {
  const h = fixture(), pending = deferred();
  h.context.mediaCredentials = () => pending.promise;
  const joining = h.context.joinBroadcast();
  await h.context.disconnectMedia();
  assert.ok(h.calls.some(call => call.type === 'listener-edge-stop'));
  const before = h.calls.length;
  pending.resolve(h.grant()); await joining;
  assert.equal(h.state.mediaConnected, false);
  assert.equal(h.state.broadcastDelivery, null);
  assert.equal(h.calls.length, before, 'late admission cannot change controls, status, or restart native playback');
});

test('a newer retry wins over an older credential response in the same room', async () => {
  const h = fixture(), oldRequest = deferred(), newRequest = deferred();
  let requests = 0;
  h.context.mediaCredentials = () => (++requests === 1 ? oldRequest.promise : newRequest.promise);
  const oldJoin = h.context.joinBroadcast(), newJoin = h.context.joinBroadcast();
  oldRequest.resolve(h.grant('https://unrelated.invalid/live/index.m3u8?qsat=stale'));
  await oldJoin;
  assert.ok(!h.calls.some(call => call.type === 'listener-edge-start'));
  const grant = h.grant(); newRequest.resolve(grant); await newJoin;
  assert.deepEqual(h.calls.filter(call => call.type === 'listener-edge-start').map(call => call.url), [grant.delivery.url]);
});

test('a restored Android page replaces HLS without issuing a stop that kills the surviving service', async () => {
  const h = fixture({restoredPage: true});
  h.context.mediaCredentials = async () => h.grant();
  await h.context.joinBroadcast();
  assert.ok(h.calls.some(call => call.type === 'listener-edge-start'));
  assert.ok(!h.calls.some(call => call.type === 'listener-stop' || call.type === 'listener-edge-stop' || call.type === 'listener-start'));
  assert.equal(h.state.mediaRoom, null);
});

test('a restored page with failed credentials does not send a stop to a surviving native service', async () => {
  const h = fixture({restoredPage: true});
  h.context.mediaCredentials = async () => { throw new Error('Network is unavailable after reload'); };
  await h.context.joinBroadcast();
  assert.ok(!h.calls.some(call => call.type === 'listener-stop' || call.type === 'listener-edge-stop' || call.type === 'listener-start'));
  assert.equal(h.state.mediaConnected, false);
  assert.equal(h.nodes.get('joinBroadcast').disabled, false);
});

test('a late credential stores its admission under the requested room, never the room now on screen', async () => {
  const pending = deferred(), stored = new Map(), state = {currentRoomCode: 'ABC123'};
  const context = {state, api: () => pending.promise, rememberedBroadcastAdmission: code => `${code}-previous`,
    sessionStorage: {setItem: (key, value) => stored.set(key, value)}};
  vm.createContext(context);
  vm.runInContext(definition('mediaCredentials'), context);
  const requesting = context.mediaCredentials('listener');
  state.currentRoomCode = 'DEF456';
  pending.resolve({delivery: {admissionToken: 'ABC123-scoped-lease'}});
  await requesting;
  assert.equal(stored.get('qsession-hls-admission-ABC123'), 'ABC123-scoped-lease');
  assert.equal(stored.has('qsession-hls-admission-DEF456'), false);
});
