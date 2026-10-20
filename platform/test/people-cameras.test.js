'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {PAGE_SIZE, createPager} = require('../public/people-cameras');

test('pages are deterministic across devices and visit all people before repeating', () => {
  const pager = createPager();
  const secondDevice = createPager();
  const ids = Array.from({length: 24}, (_, i) => String(i));
  const visited = new Set();
  for (let page = 0; page < 4; page++) {
    const selected = pager.update(ids, {next: page > 0});
    assert.equal(selected.length, PAGE_SIZE);
    assert.deepEqual(secondDevice.update(ids, {next: page > 0}), selected);
    assert.deepEqual(pager.update(ids), selected, 'refreshes must not reshuffle');
    selected.forEach(id => { assert.ok(!visited.has(id)); visited.add(id); });
  }
  assert.equal(visited.size, 24);
});

test('small rooms, uneven pages, departures and reset never duplicate a person', () => {
  for (const count of [0, 1, 5, 6, 7, 11, 13, 500]) {
    const pager = createPager();
    const ids = Array.from({length: count}, (_, i) => String(i));
    let previous = [];
    for (let page = 0; page < 5; page++) {
      const selected = pager.update(ids, {next: true});
      assert.ok(selected.length <= Math.min(6, count));
      assert.equal(new Set(selected).size, selected.length);
      if (count >= 12 && selected.length) assert.ok(selected.every(id => !previous.includes(id)));
      previous = selected;
    }
    assert.deepEqual(pager.update([]), []);
    pager.reset();
    assert.deepEqual(pager.update(['new-room']), ['new-room']);
  }
});

test('the organizer stays first while attendee pages rotate deterministically', () => {
  const pager = createPager();
  const ids = ['guest-1', 'dj-main', 'guest-2', 'guest-3', 'guest-4', 'guest-5', 'guest-6'];
  assert.deepEqual(pager.update(ids, {pinned: ['dj-main']}), [
    'dj-main', 'guest-1', 'guest-2', 'guest-3', 'guest-4', 'guest-5',
  ]);
  assert.deepEqual(pager.update(ids, {next: true, pinned: ['dj-main']}), ['dj-main', 'guest-6']);
  assert.deepEqual(pager.update(ids, {next: true, pinned: ['dj-main']}), [
    'dj-main', 'guest-1', 'guest-2', 'guest-3', 'guest-4', 'guest-5',
  ]);
});

function browserHarness() {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const names = ['mediaPublicationKind', 'shouldSubscribeWebMedia', 'syncWebMediaPublication',
    'syncWebMediaSubscriptions', 'peopleCamerasVisible', 'peopleCameraCandidates',
    'refreshPeopleCameraPage', 'stableCameraPublishOptions', 'publicCameraPublishOptions'];
  const definitions = names.map(name => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const following = source.slice(start + 1).search(/\n(?:async )?function /);
    return source.slice(start, start + 1 + following);
  }).join('\n');
  const elements = {'view-people': {hidden: false}, peopleNextGroup: {disabled: false}};
  const calls = [];
  const room = {
    localParticipant: {identity: 'listener-self', profile: {id: 'self', visible: true}, trackPublications: new Map()},
    remoteParticipants: new Map(),
  };
  function add(identity, profileId = identity, publications = 1) {
    const participant = {identity, profile: {id: profileId, visible: true, roomOrganizer: identity.startsWith('dj-')}, trackPublications: new Map()};
    for (let i = 0; i < publications; i++) {
      const trackSid = `${identity}-${i}`;
      const publication = {kind: 'video', source: 'camera', trackSid, isMuted: false, subscribed: false,
        setSubscribed(value) { this.subscribed = value; calls.push({trackSid, value}); }};
      participant.trackPublications.set(trackSid, publication);
    }
    room.remoteParticipants.set(identity, participant);
    return participant;
  }
  for (let i = 0; i < 24; i++) add(`user-${i}`);
  add('dj-primary');
  const context = vm.createContext({
    state: {mediaRoom: room, mediaConnected: true, mediaRole: 'listener', currentRoom: {}, profile: {id: 'self'},
      peoplePageRoom: null, peoplePageIds: [], peopleCameraSids: new Set(), broadcastUsingEdge: true, broadcastEdgeReady: true},
    peopleCameraPager: createPager(), PEOPLE_CAMERA_PAGE_SIZE: PAGE_SIZE,
    document: {visibilityState: 'visible'}, window: {LivekitClient: {Track: {Source: {Camera: 'camera'}}}},
    byId: id => elements[id], profileFromRoomParticipant: p => p.profile?.visible ? p.profile : null,
    organizerRoomProfile: () => null,
    cameraParticipantKey: (participant, {local = false} = {}) => local ? 'local-listener' : String(participant?.identity || ''),
    roomParticipantIsOrganizer: p => Boolean(p?.identity.startsWith('dj-')),
    webMediaAudioEnabled: () => true,
  });
  vm.runInContext(definitions, context);
  const active = () => [...room.remoteParticipants.values()].flatMap(p => [...p.trackPublications.values()]).filter(p => p.subscribed).map(p => p.trackSid);
  return {context, elements, calls, room, add, active};
}

test('HLS pins DJ then self and rotates four remote cameras, removing old tracks first', () => {
  const h = browserHarness();
  h.context.syncWebMediaSubscriptions();
  const old = h.active();
  assert.equal(old.length, 4);
  assert.deepEqual([...h.context.state.peoplePageIds].slice(0,2),['dj-primary','listener-self']);
  assert.ok(old.every(id => !id.startsWith('dj-')));
  h.calls.length = 0;
  h.context.refreshPeopleCameraPage({next: true});
  h.context.syncWebMediaSubscriptions();
  assert.equal(h.active().length, 4);
  assert.ok(h.active().every(id => !old.includes(id)));
  const firstStart = h.calls.findIndex(call => call.value);
  assert.ok(old.every(id => h.calls.slice(0, firstStart).some(call => call.trackSid === id && !call.value)));
});

test('hidden People or background tab stops social subscriptions; WebRTC DJ remains available', () => {
  const h = browserHarness();
  h.context.syncWebMediaSubscriptions();
  h.elements['view-people'].hidden = true;
  h.context.syncWebMediaSubscriptions();
  assert.equal(h.active().length, 0);
  h.context.state.broadcastEdgeReady = false;
  h.context.syncWebMediaSubscriptions();
  assert.deepEqual(h.active(), ['dj-primary-0']);
  h.elements['view-people'].hidden = false;
  h.context.syncWebMediaSubscriptions();
  assert.equal(h.active().length, 5);
  h.context.document.visibilityState = 'hidden';
  h.context.syncWebMediaSubscriptions();
  assert.deepEqual(h.active(), ['dj-primary-0']);
  h.context.document.visibilityState = 'visible';
  h.context.state.peopleNativeBackground = true;
  h.context.syncWebMediaSubscriptions();
  assert.deepEqual(h.active(), ['dj-primary-0'], 'Android background handoff also stops guest cameras');
});

test('mute, departure, privacy and extra tracks cannot exceed five social subscriptions beside the DJ', () => {
  const h = browserHarness();
  h.add('duplicate', 'user-0', 3);
  h.add('local-copy', 'self');
  h.add('hidden').profile.visible = false;
  h.context.syncWebMediaSubscriptions();
  assert.equal(h.active().length, 4);
  assert.ok(h.active().every(id => !/duplicate|local-copy|hidden/.test(id)));
  const first = h.context.state.peoplePageIds[2];
  for (const p of h.room.remoteParticipants.get(first).trackPublications.values()) p.isMuted = true;
  h.context.syncWebMediaSubscriptions();
  assert.equal(h.active().length, 4);
  h.room.remoteParticipants.delete(h.context.state.peoplePageIds[2]);
  h.context.syncWebMediaSubscriptions();
  assert.equal(h.active().length, 4);
  h.context.state.currentRoom.allowSocialProfiles = false;
  h.context.syncWebMediaSubscriptions();
  assert.equal(h.active().length, 0);
});

test('guest publishing caps at 300 kbps and 15 fps without changing DJ encoding', () => {
  const h = browserHarness();
  assert.equal(h.context.publicCameraPublishOptions().videoEncoding.maxBitrate, 300000);
  assert.equal(h.context.publicCameraPublishOptions().videoEncoding.maxFramerate, 15);
  assert.equal(h.context.publicCameraPublishOptions().simulcast, false);
  h.context.state.mediaRole = 'dj';
  assert.equal(h.context.publicCameraPublishOptions().videoEncoding.maxBitrate, 1200000);
  assert.equal(h.context.publicCameraPublishOptions().simulcast, false, 'CDN camera remains one continuous input');
  assert.equal(h.context.stableCameraPublishOptions().simulcast, true, 'private-call encoding is unchanged');
});
