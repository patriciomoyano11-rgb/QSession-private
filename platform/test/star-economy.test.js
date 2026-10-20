'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createStarEconomyStore} = require('../star-economy');
const {createQsessionServer} = require('../server');

async function request(url, {method = 'GET', body, cookie} = {}) {
  const requestBody = body;
  const response = await fetch(url, {method, headers: {...(requestBody ? {'content-type': 'application/json'} : {}), ...(cookie ? {cookie} : {})}, body: requestBody ? JSON.stringify(requestBody) : undefined});
  return {response, payload: await response.json().catch(() => ({}))};
}

function approved(order, transactionId = 'star-tx-1') {
  return {
    eventKey: `${transactionId}:APPROVED`, eventType: 'transaction.updated', transactionId,
    reference: order.reference, status: 'APPROVED', amountCents: order.amountCents,
    currency: 'COP', paymentMethodType: 'CARD', environment: 'test', payload: {},
  };
}

test('una compra de estrellas acredita una sola vez y permite apoyar al artista', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-stars-'));
  try {
    const store = createStarEconomyStore({filePath: path.join(directory, 'stars.json')});
    const order = await store.createOrder({accountId: 'listener-1', customerEmail: 'listener@example.com', packageId: 'stars-50'});
    assert.equal(order.stars, 50);
    assert.equal(order.amountCents, 500_000);
    assert.equal((await store.applyPaymentEvent(approved(order))).duplicate, false);
    assert.equal((await store.applyPaymentEvent(approved(order))).duplicate, true);
    assert.equal((await store.accountWallet('listener-1')).balance, 50);
    const tip = await store.sendStars({fromAccountId: 'listener-1', toAccountId: 'artist-1', stars: 12, roomId: 'room-1'});
    assert.equal(tip.balance, 38);
    assert.equal((await store.accountWallet('artist-1')).balance, 12);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('el acceso a una sesión se cobra una sola vez', async () => {
  const store = createStarEconomyStore();
  const order = await store.createOrder({accountId: 'listener-1', customerEmail: 'listener@example.com', packageId: 'stars-50'});
  await store.applyPaymentEvent(approved(order));
  const first = await store.unlockSession({accountId: 'listener-1', artistAccountId: 'artist-1', roomId: 'room-1', roomCode: 'ABC123', stars: 20});
  const repeated = await store.unlockSession({accountId: 'listener-1', artistAccountId: 'artist-1', roomId: 'room-1', roomCode: 'ABC123', stars: 20});
  assert.equal(first.alreadyUnlocked, false);
  assert.equal(repeated.alreadyUnlocked, true);
  assert.equal((await store.accountWallet('listener-1')).balance, 30);
  assert.equal((await store.accountWallet('artist-1')).balance, 20);
});

test('la recompensa de sponsor exige tiempo y es idempotente', async () => {
  let current = Date.parse('2026-09-28T12:00:00.000Z');
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(value) { super(value === undefined ? current : value); }
    static now() { return current; }
  };
  try {
    const store = createStarEconomyStore();
    const view = await store.beginSponsorView({accountId: 'listener-1', promotionId: 'promo-1', roomCode: 'ABC123'});
    await assert.rejects(() => store.rewardSponsorView({accountId: 'listener-1', viewId: view.id}), /Completa el tiempo/);
    current += 16_000;
    const reward = await store.rewardSponsorView({accountId: 'listener-1', viewId: view.id});
    const duplicate = await store.rewardSponsorView({accountId: 'listener-1', viewId: view.id});
    assert.equal(reward.stars, 2);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await store.accountWallet('listener-1')).balance, 2);
  } finally { global.Date = RealDate; }
});

test('las flores reconocen permanencia real y sirven para artistas o matchmaking', async () => {
  let current = Date.parse('2026-09-28T12:00:00.000Z');
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(value) { super(value === undefined ? current : value); }
    static now() { return current; }
  };
  try {
    const store = createStarEconomyStore();
    const pulse = () => store.recordListeningPulse({
      accountId: 'listener-1', roomId: 'room-1', roomCode: 'ABC123', artistAccountId: 'artist-1',
    });
    await pulse();
    let reward;
    for (let minute = 1; minute <= 30; minute += 1) {
      current += 60_000;
      reward = await pulse();
    }
    assert.deepEqual(reward.flowers.inventory.filter(item => item.quantity).map(item => item.id), ['margarita', 'tulipan']);
    assert.equal(reward.flowers.total, 2);
    const artistGift = await store.sendFlower({fromAccountId: 'listener-1', toAccountId: 'artist-1', flowerId: 'margarita', roomId: 'room-1'});
    assert.equal(artistGift.flower.name, 'Margarita');
    const connection = store.useFlowerForMatchmaking({accountId: 'listener-1', targetAccountId: 'listener-2', profileId: 'profile-2', roomId: 'room-1'});
    assert.equal(connection.flower.name, 'Tulipán');
    assert.equal((await store.accountWallet('listener-1')).flowers.total, 0);
    assert.equal((await store.accountWallet('artist-1')).flowers.total, 1);
    assert.equal((await store.accountWallet('listener-2')).flowers.total, 1);
  } finally { global.Date = RealDate; }
});

test('la API compra estrellas, crea una sesión grabada pagada y la desbloquea', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-star-api-'));
  const app = createQsessionServer({
    port: 0, dataFile: path.join(directory, 'state.json'), billingDataFile: path.join(directory, 'billing.json'), starDataFile: path.join(directory, 'stars.json'),
    analyticsDataFile: path.join(directory, 'analytics.ndjson'), mediaDirectory: path.join(directory, 'media'), privateMediaDirectory: path.join(directory, 'private'), promotionMediaDirectory: path.join(directory, 'promotions'),
    publicUrl: 'https://qsession.org', roomSecret: 'room-secret', authPepper: 'auth-pepper', livekitUrl: 'wss://media.qsession.org', livekitApiKey: 'key', livekitApiSecret: 'secret',
    wompiPublicKey: 'pub_test_qsession', wompiIntegritySecret: 'test_integrity_qsession', wompiEventsSecret: 'test_events_qsession',
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const artist = await request(`${baseUrl}/api/auth/register`, {method: 'POST', body: {email: 'artist@example.com', password: 'password-segura-123', displayName: 'DJ Test', role: 'dj'}});
    const artistCookie = artist.response.headers.get('set-cookie').split(';')[0];
    const room = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie: artistCookie, body: {name: 'Set grabado', roomType: 'music', visibility: 'public', broadcastMode: 'recorded', recordedAssetId: 'stream-asset-1', starPrice: 20}});
    assert.equal(room.response.status, 201);
    assert.equal(room.payload.room.broadcastMode, 'recorded');
    assert.equal(room.payload.room.starPrice, 20);

    const listener = await request(`${baseUrl}/api/auth/register`, {method: 'POST', body: {email: 'listener@example.com', password: 'password-segura-123', displayName: 'Oyente', role: 'listener'}});
    const listenerCookie = listener.response.headers.get('set-cookie').split(';')[0];
    const order = await request(`${baseUrl}/api/stars/orders`, {method: 'POST', cookie: listenerCookie, body: {packageId: 'stars-50'}});
    assert.equal(order.response.status, 201);
    await app.starEconomy.applyPaymentEvent(approved(order.payload.order, 'api-star-tx'));
    const unlock = await request(`${baseUrl}/api/rooms/${room.payload.room.code}/unlock`, {method: 'POST', cookie: listenerCookie});
    assert.equal(unlock.response.status, 201);
    assert.equal(unlock.payload.unlock.stars, 20);
    const wallet = await request(`${baseUrl}/api/account/stars`, {cookie: listenerCookie});
    assert.equal(wallet.payload.balance, 30);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
