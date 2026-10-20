'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createProductStore} = require('../product-store');

test('a private group includes its creator in the ten-person limit and excludes outsiders', () => {
  const store = createProductStore();
  const people = Array.from({length: 11}, (_, i) => store.upsertProfile({
    displayName: `Person ${i}`, visible: true, social: {allowMessages: true},
  }));
  const creatorProfileId = people[0].id;
  const memberProfileIds = people.slice(1, 10).map(person => person.id);
  const group = store.createPrivateConversation({creatorProfileId, type: 'group', memberProfileIds});
  assert.equal(group.memberCount, 10);
  assert.equal(store.getPrivateConversation(group.id, people[10].id), null);
  assert.throws(() => store.addPrivateMessage({conversationId: group.id, profileId: people[10].id, text: 'forbidden'}));
  const message = store.addPrivateMessage({conversationId: group.id, profileId: people[9].id, text: 'within my group'});
  assert.equal(store.listPrivateMessages(group.id, creatorProfileId).at(-1).id, message.id);
  assert.throws(() => store.createPrivateConversation({creatorProfileId, type: 'group',
    memberProfileIds: people.slice(1).map(person => person.id)}), /hasta 10/);
  const duplicate = store.createPrivateConversation({creatorProfileId, type: 'group',
    memberProfileIds: [...memberProfileIds, ...memberProfileIds, creatorProfileId]});
  assert.equal(duplicate.memberCount, 10);
});

test('legacy oversized groups keep their history but cannot continue text, attachments or calls', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-legacy-group-'));
  try {
    const store = createProductStore();
    const people = Array.from({length: 11}, (_, i) => store.upsertProfile({
      displayName: `Legacy ${i}`, visible: true, social: {allowMessages: true},
    }));
    const group = store.createPrivateConversation({creatorProfileId: people[0].id, type: 'group',
      memberProfileIds: people.slice(1, 10).map(person => person.id)});
    const message = store.addPrivateMessage({conversationId: group.id, profileId: people[0].id, text: 'preserve history'});
    const snapshot = store.snapshot();
    snapshot.privateConversations[0].memberProfileIds.push(people[10].id);
    const filePath = path.join(directory, 'state.json');
    fs.writeFileSync(filePath, JSON.stringify(snapshot));
    const restored = createProductStore({filePath});
    assert.equal(restored.listPrivateMessages(group.id, people[0].id)[0].id, message.id);
    const input = {conversationId: group.id, profileId: people[0].id, text: 'new message'};
    assert.throws(() => restored.addPrivateMessage(input), /historial se conserva/);
    assert.throws(() => restored.addPrivateMediaMessage(input), /historial se conserva/);
    assert.throws(() => restored.notifyPrivateCall(group.id, people[0].id), /historial se conserva/);
    assert.equal(restored.listPrivateMessages(group.id, people[0].id).length, 1);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('the group form rejects an eleventh member before issuing a request', async () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  let requests = 0;
  let status;
  const context = vm.createContext({state: {privateChatKind: 'group'},
    all: () => Array.from({length: 10}, (_, i) => ({value: `person${i}`})),
    byId: () => ({}), setStatus: (_element, message) => { status = message; },
    api: async () => { requests++; throw new Error('must not request'); }});
  vm.runInContext(source.slice(source.indexOf('async function createPrivateChat('),
    source.indexOf('function updatePrivateVoiceControls(')), context);
  await context.createPrivateChat();
  assert.equal(requests, 0);
  assert.match(status, /hasta 10 personas, incluyéndote/);
});

test('the main-room microphone never captures listener audio', async () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  let captures = 0;
  let message;
  const context = vm.createContext({state: {publicChatPushActive: true, publicChatMicOpen: true,
    mediaConnected: true, mediaRoom: {localParticipant: {setMicrophoneEnabled: () => { captures++; }}}},
    updatePublicChatCallControls() {}, setPublicChatCallStatus: value => { message = value; }});
  vm.runInContext(source.slice(source.indexOf('async function setPublicChatMicrophone('),
    source.indexOf('async function mutePublicChatMicrophone(')), context);
  await context.setPublicChatMicrophone(true);
  assert.equal(captures, 0);
  assert.equal(context.state.publicChatMicOpen, false);
  assert.equal(context.state.publicChatPushActive, false);
  assert.match(message, /micrófono de la transmisión es del DJ/);
});

test('private chat reconnects while listening to HLS; a public room chat does not poll', () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  let polls = 0;
  const context = vm.createContext({state: {chatMode: 'private', profile: {social: {allowMessages: true}}},
    isCdnOnlyAudience: () => true, chatViewIsVisible: () => true,
    startChatFallbackPolling: () => { polls++; }});
  vm.runInContext(source.slice(source.indexOf('function startChatPolling('), source.indexOf('function setCurrentRoom(')), context);
  context.startChatPolling();
  context.state.chatMode = 'group';
  context.startChatPolling();
  context.state.chatMode = 'public';
  context.startChatPolling();
  assert.equal(polls, 2);
});
