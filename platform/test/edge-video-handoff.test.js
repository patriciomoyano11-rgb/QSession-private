'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');

function definition(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/\n(?:async )?function /);
  return source.slice(start, start + 1 + end);
}

function harness() {
  const calls = [], nodes = new Map(), timers = new Map(); let timerId = 0;
  const node = id => ({id, connected: true, hidden: true, muted: false, volume: 1, srcObject: null, events: new Map(),
    classList: {add() {}, remove() {}, toggle() {}}, style: {removeProperty() {}}, dataset: {},
    remove() { this.connected = false; }, pause() {}, load() {}, removeAttribute() {},
    addEventListener(name, handler, options) {
      const callback = options?.once ? () => { this.events.delete(name); handler(); } : handler;
      callback.original = handler;
      this.events.set(name, callback);
    },
    removeEventListener(name, handler) { if (this.events.get(name)?.original === handler) this.events.delete(name); },
    querySelectorAll() { return []; }});
  for (const id of ['liveVideo', 'broadcastVideo', 'mediaFallback', 'mediaFullscreen', 'mediaStage', 'mediaLiveBadge',
    'mediaFallbackTitle', 'mediaFallbackText', 'mediaAudioRack', 'joinBroadcast']) nodes.set(id, node(id));
  const directVideo = nodes.get('liveVideo'), video = nodes.get('broadcastVideo');
  directVideo.srcObject = {directCamera: true};
  directVideo.hidden = false;
  let allowSound = true;
  video.play = async () => {
    calls.push({playMuted: video.muted});
    if (!video.muted && !allowSound) throw new Error('NotAllowedError: user gesture required');
    video.events.get('playing')?.();
  };
  const track = {kind: 'video', detach(target) { directVideo.srcObject = null; return [target || directVideo]; }};
  const participant = {identity: 'dj-primary-jntuby'};
  const state = {mediaRole: 'listener', mediaConnected: true, currentRoomCode: 'JNTUBY',
    listenerMuted: false, listenerOutputGain: 1, remoteAudioTracks: new Set(),
    primaryVideoTrack: track, broadcastUsingEdge: false, broadcastEdgeReady: false,
    edgeNativeBackgroundActive: false, edgePlaybackNeedsGesture: false};
  class Hls {
    static Events = {MANIFEST_PARSED: 'parsed', ERROR: 'error'};
    static ErrorTypes = {MEDIA_ERROR: 'media', NETWORK_ERROR: 'network'};
    static isSupported() { return true; }
    constructor() { Hls.last = this; this.handlers = new Map(); }
    on(name, handler) { this.handlers.set(name, handler); }
    emit(name) { this.handlers.get(name)?.(); }
    loadSource(url) { calls.push({loadSource: url}); } attachMedia(target) {
      assert.equal(target.srcObject, null, 'MediaSource must not share the WebRTC srcObject');
      assert.equal(target.id, 'broadcastVideo');
      target.src = 'blob:hls-video';
    }
    destroy() {} startLoad() {} recoverMediaError() {}
  }
  const context = {state, URL, window: {Hls}, byId: id => nodes.get(id)?.connected ? nodes.get(id) : null,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    api: async () => ({broadcast: {state: 'active'}}),
    postNativeAudioCommand: command => { calls.push(command); return false; },
    syncWebMediaSubscriptions() { if (state.broadcastEdgeReady) context.detachRemoteTrack(track, {}, participant); },
    setMediaStatus: message => calls.push({status: message}),
    setListenerActionButtonLabel: (_id, label) => calls.push({label}),
    clearMediaSignalTimer() {}, scheduleListenerSignalCheck() {}, unregisterPeopleCamera() {},
    registerPeopleCamera() {}, showPrimaryVideo() { throw new Error('Old WebRTC video replaced HLS'); },
    isCdnOnlyAudience: () => false, applyListenerWebAudioVolume() {}, listenerAudioElementShouldStayMuted: () => false,
    setMediaControlsActive() {}, scheduleListenerAudioRecovery() {},
    disconnectMedia: async () => {}, showListenerRetry() {},
  };
  vm.createContext(context);
  vm.runInContext('let listenerAudioRecoveryGeneration = 0;', context);
  for (const name of ['detachedTrackElements', 'removeDetachedTrackElements', 'clearPrimaryVideo',
    'stopEdgeBroadcastPlayback', 'showEdgeBroadcastStage', 'finishEdgeNativeForegroundHandoff', 'playEdgeBroadcastVideo',
    'startEdgeBroadcastPlayback', 'scheduleEdgeVideoRestart', 'scheduleDjBroadcastRefresh', 'attachRemoteTrack', 'detachRemoteTrack', 'toggleListenerSound',
    'joinBroadcast', 'resumeListenerAudio', 'scheduleListenerAudioRecovery']) vm.runInContext(definition(name), context);
  return {context, state, calls, video, directVideo, nodes, track, participant, Hls, timers,
    allowSound(value) { allowSound = value; }};
}

test('releasing a direct DJ track preserves the permanent video element and removes temporary media', () => {
  const h = harness(), temporary = {remove() { this.removed = true; }};
  h.track.detach = () => [h.directVideo, temporary];
  h.context.detachRemoteTrack(h.track, {}, h.participant);
  assert.equal(h.directVideo.connected, true);
  assert.equal(h.directVideo.hidden, true);
  assert.equal(temporary.removed, true);
  assert.match(h.nodes.get('mediaFallbackText').textContent, /cámara del DJ está apagada/);
});

test('synchronous and delayed WebRTC unsubscribe callbacks cannot clear the HLS picture', async () => {
  const h = harness();
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8'});
  h.Hls.last.emit('parsed');
  await new Promise(setImmediate);
  assert.equal(h.video.connected, true);
  assert.equal(h.video.hidden, false);
  assert.equal(h.nodes.get('mediaFallback').hidden, true);
  assert.equal(h.video.src, 'blob:hls-video');
  assert.equal(h.state.primaryVideoTrack, null);
  h.context.detachRemoteTrack(h.track, {}, h.participant);
  h.state.remoteAudioTracks.add('old-audio');
  h.context.detachRemoteTrack({kind: 'audio', detach: () => []}, {}, h.participant);
  assert.equal(h.state.remoteAudioReceived, true);
  const subscriptions = [];
  for (const kind of ['video', 'audio']) h.context.attachRemoteTrack({kind, detach: () => []},
    {setSubscribed: value => subscriptions.push(value)}, h.participant);
  assert.deepEqual(subscriptions, [false, false]);
  assert.equal(h.video.hidden, false);
  assert.equal(h.nodes.get('mediaFallback').hidden, true);
});

test('HLS owns a separate element and parsing alone cannot remove the current direct camera', async () => {
  const h = harness();
  h.video.play = async () => {};
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8'});
  h.Hls.last.emit('parsed');
  await new Promise(setImmediate);
  assert.equal(h.state.broadcastEdgeReady, false);
  assert.equal(h.directVideo.hidden, false);
  assert.ok(h.directVideo.srcObject?.directCamera);
  assert.equal(h.video.hidden, true);
  h.video.events.get('playing')();
  assert.equal(h.state.broadcastEdgeReady, true);
  assert.equal(h.directVideo.hidden, true);
  assert.equal(h.video.hidden, false);
});

test('incognito autoplay rejection keeps muted video and one sound-button gesture starts audio', async () => {
  const h = harness(); h.allowSound(false);
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8'});
  h.Hls.last.emit('parsed');
  await new Promise(setImmediate);
  assert.equal(h.video.hidden, false);
  assert.equal(h.video.muted, true);
  assert.equal(h.state.edgePlaybackNeedsGesture, true);
  assert.ok(h.calls.some(call => call.label === 'Activar sonido'));
  const attempts = h.calls.filter(call => 'playMuted' in call).length;
  assert.equal(await h.context.resumeListenerAudio(), false);
  assert.equal(h.calls.filter(call => 'playMuted' in call).length, attempts, 'background retries must preserve muted preview');
  h.allowSound(true);
  await h.context.toggleListenerSound();
  assert.equal(h.state.listenerMuted, false);
  assert.equal(h.state.edgePlaybackNeedsGesture, false);
  assert.equal(h.video.muted, false);
  assert.equal(h.calls.at(-1).status, 'Sonido de la transmisión activo.');
});

test('a rejected sound-button attempt preserves the preview and never claims audio started', async () => {
  const h = harness(); h.allowSound(false);
  h.state.broadcastUsingEdge = true; h.state.edgePlaybackNeedsGesture = true;
  await h.context.toggleListenerSound();
  assert.equal(h.video.muted, true);
  assert.equal(h.state.edgePlaybackNeedsGesture, true);
  assert.ok(!h.calls.some(call => call.status === 'Sonido de la transmisión activo.'));
});

test('finishing an automatic join cannot hide an HLS camera that became ready during connection', async () => {
  const h = harness();
  h.context.connectMedia = async () => { h.state.broadcastUsingEdge = true; h.state.broadcastEdgeReady = true; h.state.primaryVideoTrack = null; };
  await h.context.joinBroadcast({automatic: true});
  assert.equal(h.video.hidden, false);
  assert.equal(h.nodes.get('mediaFallback').hidden, true);
});

test('a stopped player ignores a late manifest callback and a late play rejection', async () => {
  const h = harness();
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8'});
  const old = h.Hls.last;
  h.context.stopEdgeBroadcastPlayback();
  const before = h.calls.length;
  old.emit('parsed');
  assert.equal(h.calls.length, before);
  let reject;
  h.state.broadcastUsingEdge = true;
  h.video.play = () => new Promise((_resolve, fail) => { reject = fail; });
  const playing = h.context.playEdgeBroadcastVideo();
  h.state.broadcastUsingEdge = false;
  reject(new Error('Late autoplay failure'));
  assert.equal(await playing, false);
  assert.equal(h.state.edgePlaybackNeedsGesture, false);
});

test('an encoder playlist ending reloads the same authorized URL when the broadcast is active', async () => {
  const h = harness(), delivery = {url: 'https://cdn.invalid/index.m3u8?token=existing-lease'};
  await h.context.startEdgeBroadcastPlayback(delivery);
  h.Hls.last.emit('parsed');
  h.video.events.get('ended')();
  const [timer, callback] = [...h.timers.entries()][0];
  h.timers.delete(timer);
  await callback();
  assert.equal(h.calls.filter(c => c.loadSource).at(-1).loadSource, delivery.url);
  assert.equal(h.state.broadcastDelivery, delivery);
  h.context.stopEdgeBroadcastPlayback();
  assert.equal(h.timers.size, 0);
  assert.equal(h.video.events.has('ended'), false);
});

test('DJ track changes debounce one authenticated refresh and ignore a departed room', async () => {
  const h = harness(), room = {};
  h.state.mediaRole = 'dj'; h.state.mediaRoom = room; h.state.hostToken = 'host-only';
  const requests = [];
  h.context.api = async (url, options) => { requests.push({url, options}); };
  h.context.scheduleDjBroadcastRefresh(room);
  h.context.scheduleDjBroadcastRefresh(room);
  assert.equal(h.timers.size, 1);
  await [...h.timers.values()][0]();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/rooms/JNTUBY/broadcast/start');
  assert.equal(JSON.parse(requests[0].options.body).hostToken, 'host-only');
  h.context.scheduleDjBroadcastRefresh(room);
  h.state.mediaRoom = {};
  await [...h.timers.values()].at(-1)();
  assert.equal(requests.length, 1);
});

test('an admitted listener survives a 39-second encoder outage and preserves password authorization', async () => {
  const h = harness();
  const delivery = {url: 'https://cdn.invalid/index.m3u8?token=same-lease'};
  await h.context.startEdgeBroadcastPlayback(delivery);
  h.Hls.last.emit('parsed');
  let elapsed = 0, originActive = false;
  class RecoveryDate extends Date { static now() { return 100000 + elapsed; } }
  h.context.Date = RecoveryDate;
  h.context.Math = Object.create(Math);
  h.context.Math.random = () => .5;
  h.context.setTimeout = (fn, delay) => { h.timers.set(1, async () => { h.timers.delete(1); elapsed += delay; await fn(); }); return 1; };
  h.state.currentRoomAccessToken = 'room-password-grant';
  h.context.api = async (_url, options) => {
    assert.equal(options.headers['X-QSession-Room-Access'], 'room-password-grant');
    originActive = elapsed >= 39000;
    return {broadcast: {state: originActive ? 'active' : 'inactive'}};
  };
  h.video.events.get('ended')();
  for (let attempts = 0; !originActive && attempts < 15; attempts++) await h.timers.get(1)();
  assert.ok(elapsed >= 39000);
  assert.ok(elapsed < 180000);
  assert.equal(h.state.broadcastUsingEdge, true);
  assert.equal(h.state.broadcastDelivery, delivery);
  assert.equal(h.timers.size, 0, 'actual playing cancels subsequent recovery checks');
  assert.equal(h.state.edgeRecoveryStartedAt, null);
});

test('an active encoder without playable media cannot declare recovery and repeated errors share a timer', async () => {
  const h = harness();
  const delivery = {url: 'https://cdn.invalid/index.m3u8?token=same-lease'};
  await h.context.startEdgeBroadcastPlayback(delivery);
  h.video.play = async () => {};
  h.context.scheduleEdgeVideoRestart(delivery);
  h.context.scheduleEdgeVideoRestart(delivery);
  assert.equal(h.timers.size, 1);
  const [id, callback] = [...h.timers.entries()][0];
  h.timers.delete(id);
  await callback();
  assert.equal(h.state.broadcastUsingEdge, true);
  assert.equal(h.timers.size, 1);
  assert.notEqual(h.state.edgeRecoveryStartedAt, null);
  h.context.stopEdgeBroadcastPlayback();
  assert.equal(h.timers.size, 0);
});

test('CDN listeners resume a paused player on return without a direct-media connection', async () => {
  const h = harness();
  h.context.isCdnOnlyAudience = () => true;
  await h.context.startEdgeBroadcastPlayback({audienceMode: 'cdn-only', url: 'https://cdn.invalid/index.m3u8?qsat=admitted'});
  h.state.mediaRoom = null;
  h.context.scheduleListenerAudioRecovery();
  await [...h.timers.values()][0]();
  assert.ok(h.calls.some(call => call.playMuted === false));
  assert.equal(h.state.broadcastEdgeReady, true);
  assert.equal(h.state.mediaRoom, null);
  assert.ok(!h.calls.some(call => call.type === 'listener-start'));
});

test('CDN recovery respects an autoplay rejection until one explicit sound gesture', async () => {
  const h = harness(); h.allowSound(false);
  h.context.isCdnOnlyAudience = () => true;
  await h.context.startEdgeBroadcastPlayback({audienceMode: 'cdn-only', url: 'https://cdn.invalid/index.m3u8?qsat=admitted'});
  h.context.scheduleListenerAudioRecovery();
  const callbacks = [...h.timers.values()];
  await callbacks[0]();
  const attempts = h.calls.filter(call => 'playMuted' in call).length;
  for (const callback of callbacks.slice(1)) await callback();
  assert.equal(h.calls.filter(call => 'playMuted' in call).length, attempts);
  assert.equal(h.video.muted, true);
  assert.equal(h.state.edgePlaybackNeedsGesture, true);
  assert.ok(h.calls.some(call => call.label === 'Activar sonido'));
  assert.ok(!h.calls.some(call => call.type === 'listener-start'));
  h.allowSound(true);
  await h.context.toggleListenerSound();
  assert.equal(h.video.muted, false);
  assert.equal(h.state.edgePlaybackNeedsGesture, false);
});

test('a recovery scheduled for the previous delivery cannot play its replacement', async () => {
  const h = harness();
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/old.m3u8?qsat=old'});
  h.context.scheduleListenerAudioRecovery();
  const callbacks = [...h.timers.values()];
  h.state.broadcastDelivery = {url: 'https://cdn.invalid/new.m3u8?qsat=new'};
  const before = h.calls.length;
  for (const callback of callbacks) await callback();
  assert.equal(h.calls.length, before);
});

test('same-room HLS replacement preserves native audio and invalid URLs leave it untouched', async () => {
  const h = harness();
  h.context.postNativeAudioCommand = command => { h.calls.push(command); return true; };
  h.state.edgeNativeSessionActive = true;
  h.state.edgeNativeRoomCode = h.state.currentRoomCode;
  h.state.edgeNativeBackgroundActive = true;
  const oldDelivery = {url: 'https://cdn.invalid/index.m3u8?qsat=old'};
  h.state.broadcastDelivery = oldDelivery;
  assert.equal(await h.context.startEdgeBroadcastPlayback({url: 'invalid'}), false);
  assert.equal(h.state.broadcastDelivery, oldDelivery);
  assert.equal(h.calls.length, 0);
  const delivery = {url: 'https://cdn.invalid/index.m3u8?qsat=renewed'};
  await h.context.startEdgeBroadcastPlayback(delivery);
  assert.ok(!h.calls.some(call => call.type === 'listener-edge-stop' || call.type === 'listener-stop'));
  assert.equal(h.calls.find(call => call.type === 'listener-edge-start').url, delivery.url);
  assert.equal(h.state.edgeNativeBackgroundActive, true);
  h.context.stopEdgeBroadcastPlayback();
  assert.equal(h.calls.filter(call => call.type === 'listener-edge-stop').length, 1);
});

test('native foreground handoff keeps the web player muted until native release and ignores old deliveries', async () => {
  const h = harness();
  h.context.postNativeAudioCommand = command => { h.calls.push(command); return true; };
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8?qsat=admitted'});
  h.state.edgeNativeForegroundPending = true;
  await h.context.playEdgeBroadcastVideo();
  assert.equal(h.video.muted, true);
  assert.ok(h.calls.some(call => call.type === 'listener-edge-foreground-ready'));
  const callback = [...h.timers.values()].at(-1);
  h.state.broadcastDelivery = {url: 'https://cdn.invalid/new.m3u8?qsat=other'};
  callback();
  assert.equal(h.video.muted, true, 'a late handoff must not unmute a new lease');
});

test('Android background and foreground events hand off audio without two audible players', async () => {
  const h = harness(), handlers = new Map();
  h.context.window.addEventListener = (name, handler) => handlers.set(name, handler);
  h.context.postNativeAudioCommand = command => { h.calls.push(command); return true; };
  h.context.detachPeopleVideos = () => {};
  h.nodes.set('view-people', {connected: true, hidden: true});
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8?qsat=admitted'});
  h.Hls.last.stopLoad = () => h.calls.push({stopWebLoad: true});
  const start = source.indexOf("window.addEventListener('qsession-native-edge-background', event => {");
  vm.runInContext(source.slice(start, source.indexOf('function localizedUiText(', start)), h.context);
  const background = handlers.get('qsession-native-edge-background');
  background({detail: {active: true}});
  assert.equal(h.video.muted, true);
  assert.ok(h.calls.some(call => call.stopWebLoad));
  background({detail: {active: false}});
  await new Promise(setImmediate);
  assert.equal(h.video.muted, true, 'playing event must not unmute web while native still owns audio');
  assert.ok(h.calls.some(call => call.type === 'listener-edge-foreground-ready'));
  [...h.timers.values()].at(-1)();
  assert.equal(h.video.muted, false);
  assert.equal(h.state.edgeNativeForegroundPending, false);
});

test('native audio remains available when returning requires a sound gesture', async () => {
  const h = harness();
  h.context.postNativeAudioCommand = command => { h.calls.push(command); return true; };
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8?qsat=admitted'});
  h.state.edgeNativeForegroundPending = true;
  h.state.edgePlaybackNeedsGesture = true;
  await h.context.playEdgeBroadcastVideo();
  assert.ok(!h.calls.some(call => call.type === 'listener-edge-foreground-ready'));
  await h.context.toggleListenerSound();
  assert.ok(h.calls.some(call => call.type === 'listener-edge-foreground-ready'));
  assert.equal(h.video.muted, true);
  [...h.timers.values()].at(-1)();
  assert.equal(h.video.muted, false);
});

test('a handoff from a previous lock cycle cannot unmute the current cycle', async () => {
  const h = harness();
  h.context.postNativeAudioCommand = command => { h.calls.push(command); return true; };
  await h.context.startEdgeBroadcastPlayback({url: 'https://cdn.invalid/index.m3u8?qsat=admitted'});
  h.state.edgeNativeForegroundPending = true;
  await h.context.playEdgeBroadcastVideo();
  const oldCallback = [...h.timers.values()].at(-1);
  h.state.edgeNativeHandoffGeneration++;
  oldCallback();
  assert.equal(h.video.muted, true);
  assert.equal(h.state.edgeNativeForegroundPending, true);
});
