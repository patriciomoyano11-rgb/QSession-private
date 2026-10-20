'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createBillingStore} = require('../billing-store');
const {calculateCustomRoomQuote} = require('../custom-room-pricing');
const {createQsessionServer} = require('../server');
const {createWompiGateway, sha256} = require('../wompi');

async function request(url, {method = 'GET', body, cookie, headers = {}} = {}) {
  const requestBody = body;
  const response = await fetch(url, {
    method,
    headers: {...(requestBody ? {'content-type': 'application/json'} : {}), ...(cookie ? {cookie} : {}), ...headers},
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
  return {response, payload: await response.json().catch(() => ({}))};
}

test('Wompi genera checkout firmado y valida propiedades dinámicas del webhook', () => {
  const gateway = createWompiGateway({
    publicKey: 'pub_test_qsession',
    integritySecret: 'test_integrity_qsession',
    eventsSecret: 'test_events_qsession',
  });
  const order = {reference: 'QS-TEST-1', amountCents: 2_000_000, currency: 'COP', expiresAt: '2026-09-25T00:00:00.000Z'};
  const checkout = gateway.checkout(order, {redirectUrl: 'https://qsession.org/payments/return', customerEmail: 'dj@example.com'});
  assert.match(checkout.url, /^https:\/\/checkout\.wompi\.co\/p\//);
  assert.equal(checkout.signature, sha256('QS-TEST-12000000COP2026-09-25T00:00:00.000Ztest_integrity_qsession'));

  const payload = {
    event: 'transaction.updated', environment: 'test', timestamp: 1530291411,
    data: {transaction: {id: 'tx-1', status: 'APPROVED', amount_in_cents: 2_000_000, currency: 'COP', reference: 'QS-TEST-1'}},
    signature: {properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']},
  };
  payload.signature.checksum = sha256('tx-1APPROVED20000001530291411test_events_qsession');
  assert.equal(gateway.verifyEvent(payload), true);
  payload.data.transaction.amount_in_cents = 100;
  assert.equal(gateway.verifyEvent(payload), false);
});

test('la cotización personalizada calcula capacidad, funciones y descuento sin confiar en el navegador', () => {
  const quote = calculateCustomRoomQuote({
    capacity: 180,
    durationMinutes: 180,
    sessions: 6,
    translationLanguages: 2,
    guestCameras: true,
    participantAudio: true,
    videoUploads: true,
    recording: true,
  });
  assert.equal(quote.capacity, 180);
  assert.equal(quote.durationMinutes, 180);
  assert.equal(quote.sessions, 6);
  assert.equal(quote.discountPercent, 18);
  assert.equal(quote.features.guestCameras, true);
  assert.ok(quote.priceCents > 0);
  assert.equal(quote.priceCents % 100_000, 0);
});

test('las cotizaciones de 10.000 y aforo manual conservan el número exacto y requieren revisión', () => {
  const quote = calculateCustomRoomQuote({
    capacity: 10000, publicChat: true, guestCameras: true, participantAudio: true,
    videoUploads: true, recording: true, aiCameraEffects: true, vjVisuals: true, translationLanguages: 3,
  });
  assert.equal(quote.capacity, 10000);
  assert.equal(quote.requiresReview, true);
  assert.equal(quote.priceStatus, 'estimate');
  assert.equal(quote.deliveryMode, 'dj-broadcast');
  assert.equal(quote.capacityValidated, false);
  assert.equal(quote.priceCents, 188_700_000);
  assert.equal(quote.translationLanguages, 0);
  assert.equal(quote.features.hostAudio, true);
  assert.equal(quote.features.hostVideo, true);
  for (const name of ['publicChat', 'guestCameras', 'participantAudio', 'videoUploads', 'recording', 'aiCameraEffects', 'vjVisuals']) {
    assert.equal(quote.features[name], false, name);
  }
  assert.doesNotMatch(quote.lineItems.map(item => item.label).join(' '), /Traducción|Cámaras de participantes|Micrófonos de participantes/);
  const manual = calculateCustomRoomQuote({capacity: 12345});
  assert.equal(manual.capacity, 12345);
  assert.equal(manual.priceCents, 230_300_000);
  assert.ok(manual.priceCents > quote.priceCents);
  assert.equal(calculateCustomRoomQuote({capacity: '50000'}).capacity, 50000);
  assert.equal(calculateCustomRoomQuote({capacity: 1}).capacity, 1);
  for (const [capacity, priceCents] of [[100, 2_700_000], [1000, 28_900_000], [5000, 99_900_000]]) {
    const existing = calculateCustomRoomQuote({capacity});
    assert.equal(existing.priceCents, priceCents);
    assert.equal(existing.requiresReview, false);
    assert.equal(existing.deliveryMode, 'interactive');
    assert.equal(existing.features.publicChat, true);
    assert.equal(existing.translationLanguages, 1);
  }
});

test('el aforo de la cotización rechaza datos inválidos sin redondear ni truncar', () => {
  for (const capacity of [undefined, null, '', ' ', 0, -1, 10.5, '10.5', 50001, Infinity, NaN, true, [], {}]) {
    assert.throws(() => calculateCustomRoomQuote({capacity}), /aforo entero entre 1 y 50\.000/);
  }
});

test('la API entrega estimaciones firmadas de aforo masivo y bloquea su compra y creación de sala', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-billing-estimates-'));
  const app = createQsessionServer({
    port: 0, dataFile: path.join(directory, 'state.json'), billingDataFile: path.join(directory, 'billing.json'),
    analyticsDataFile: path.join(directory, 'analytics.ndjson'), mediaDirectory: path.join(directory, 'media'),
    privateMediaDirectory: path.join(directory, 'private-media'), promotionMediaDirectory: path.join(directory, 'promotion-media'),
    publicUrl: 'https://qsession.org', roomSecret: 'room-secret', authPepper: 'auth-pepper', billingEnforced: true,
    wompiPublicKey: 'pub_test_qsession', wompiIntegritySecret: 'test_integrity_qsession', wompiEventsSecret: 'test_events_qsession',
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const registration = await request(`${baseUrl}/api/auth/register`, {method: 'POST', body: {
      email: 'massive-quote@example.com', password: 'password-segura-123', displayName: 'Organizador', role: 'dj',
    }});
    const cookie = registration.response.headers.get('set-cookie').split(';')[0];
    for (const capacity of [10000, 12345]) {
      const result = await request(`${baseUrl}/api/billing/custom-quotes`, {method: 'POST', cookie, body: {
        capacity, guestCameras: true, participantAudio: true, videoUploads: true, priceCents: 1, requiresReview: false,
      }});
      assert.equal(result.response.status, 201);
      assert.equal(result.payload.quote.capacity, capacity);
      assert.equal(result.payload.plan.maxParticipants, capacity);
      assert.equal(result.payload.quote.requiresReview, true);
      assert.equal(result.payload.plan.requiresReview, true);
      assert.equal(result.payload.plan.priceStatus, 'estimate');
      assert.equal(result.payload.plan.deliveryMode, 'dj-broadcast');
      assert.equal(result.payload.plan.capacityValidated, false);
      assert.equal(result.payload.plan.features.guestCameras, false);
      assert.equal(result.payload.plan.features.participantAudio, false);
      assert.equal(result.payload.plan.features.videoUploads, false);
      assert.equal(result.payload.checkoutConfigured, false);
      assert.match(result.payload.quoteToken, /\./);
      const order = await request(`${baseUrl}/api/billing/orders`, {method: 'POST', cookie, body: {
        quoteToken: result.payload.quoteToken, priceCents: 1, requiresReview: false,
        plan: {...result.payload.plan, requiresReview: false, maxParticipants: 25},
        features: {guestCameras: true, participantAudio: true},
      }});
      assert.equal(order.response.status, 409);
      assert.equal(order.payload.requiresReview, true);
      assert.match(order.payload.error, /estimación.*revisión/);
      const directOrder = await request(`${baseUrl}/api/billing/orders`, {method: 'POST', cookie, body: {planId: result.payload.plan.id}});
      assert.equal(directOrder.response.status, 400);
      const room = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie, body: {
        billingPlanId: result.payload.plan.id, name: 'Evento pendiente', capacity, capacityMode: 'limited',
      }});
      assert.equal(room.response.status, 400);
      const [encoded, signature] = result.payload.quoteToken.split('.');
      const altered = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      altered.quote.requiresReview = false;
      altered.plan.requiresReview = false;
      altered.plan.maxParticipants = 25;
      const alteredToken = `${Buffer.from(JSON.stringify(altered)).toString('base64url')}.${signature}`;
      const alteredOrder = await request(`${baseUrl}/api/billing/orders`, {method: 'POST', cookie, body: {quoteToken: alteredToken}});
      assert.equal(alteredOrder.response.status, 400);
    }
    const invalid = await request(`${baseUrl}/api/billing/custom-quotes`, {method: 'POST', cookie, body: {capacity: 12345.5}});
    assert.equal(invalid.response.status, 400);
    const normal = await request(`${baseUrl}/api/billing/custom-quotes`, {method: 'POST', cookie, body: {capacity: 5000}});
    assert.equal(normal.response.status, 201);
    assert.equal(normal.payload.checkoutConfigured, true);
    const billing = await app.billingStore.accountBilling(registration.payload.account.id);
    assert.equal(billing.orders.length, 0);
    assert.equal(billing.credits.length, 0);
    assert.equal(billing.reservations.length, 0);
    assert.equal(billing.plans.some(plan => plan.id.startsWith('custom-quote-')), false);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('un pago aprobado entrega una sola vez el bono y su reserva es auditable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-billing-store-'));
  try {
    const store = createBillingStore({filePath: path.join(directory, 'billing.json')});
    const order = await store.createOrder({accountId: 'account-1', customerEmail: 'dj@example.com', planId: 'room-25'});
    const event = {eventKey: 'tx-1:APPROVED', eventType: 'transaction.updated', transactionId: 'tx-1', reference: order.reference, status: 'APPROVED', amountCents: 1_200_000, currency: 'COP', paymentMethodType: 'CARD', environment: 'test', payload: {}};
    assert.equal((await store.applyPaymentEvent(event)).duplicate, false);
    assert.equal((await store.applyPaymentEvent(event)).duplicate, true);
    let account = await store.accountBilling('account-1');
    assert.equal(account.credits.length, 1);
    assert.equal(account.credits[0].unitsRemaining, 1);
    const reservation = await store.reserveCredit({accountId: 'account-1', roomId: 'room-1', roomCode: 'ABC123', planId: 'room-25'});
    assert.equal(reservation.status, 'reserved');
    account = await store.accountBilling('account-1');
    assert.equal(account.credits[0].unitsRemaining, 0);
    assert.equal((await store.consumeReservation('room-1')).status, 'consumed');
    assert.equal((await store.releaseReservation('room-1')).status, 'consumed');
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('el catálogo ofrece planes individuales y mensualidades por capacidad', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-billing-catalog-'));
  try {
    const store = createBillingStore({filePath: path.join(directory, 'billing.json')});
    const plans = await store.listPlans();
    assert.equal(plans.length, 11);
    assert.deepEqual([...new Set(plans.map(plan => plan.segment))], ['event', 'professional', 'business', 'enterprise', 'membership']);
    assert.equal(plans.find(plan => plan.id === 'room-25').priceCents, 1_200_000);
    assert.equal(plans.find(plan => plan.id === 'event-100').priceCents, 2_700_000);
    assert.equal(plans.find(plan => plan.id === 'event-250').priceCents, 5_340_000);
    const instructor = plans.find(plan => plan.id === 'instructor-50-4');
    assert.equal(instructor.maxParticipants, 50);
    assert.equal(instructor.durationMinutes, 90);
    assert.equal(instructor.creditsPerPurchase, 4);
    assert.equal(instructor.priceCents, 6_900_000);
    assert.equal(instructor.highlighted, true);
    const monthly = plans.find(plan => plan.id === 'monthly-essential-25');
    assert.equal(monthly.billingInterval, 'monthly');
    assert.equal(plans.find(plan => plan.id === 'monthly-community-100').priceCents, 8_900_000);
    assert.equal(plans.find(plan => plan.id === 'monthly-pro-250').maxParticipants, 250);
    assert.equal(monthly.priceCents, 3_900_000);
    assert.equal(monthly.maxParticipants, 25);
    assert.equal(monthly.durationMinutes, 120);
    assert.equal(monthly.creditsPerPurchase, 4);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('la creación pagada exige bono y lo consume al solicitar acceso de DJ', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-billing-server-'));
  const app = createQsessionServer({
    port: 0,
    dataFile: path.join(directory, 'state.json'),
    billingDataFile: path.join(directory, 'billing.json'),
    analyticsDataFile: path.join(directory, 'analytics.ndjson'),
    mediaDirectory: path.join(directory, 'media'),
    privateMediaDirectory: path.join(directory, 'private-media'),
    promotionMediaDirectory: path.join(directory, 'promotion-media'),
    publicUrl: 'https://qsession.org',
    livekitUrl: 'wss://media.qsession.org',
    livekitApiKey: 'test-key', livekitApiSecret: 'test-secret',
    roomSecret: 'room-secret', authPepper: 'auth-pepper', billingEnforced: true,
    liveRoomActivityProvider: async rooms => new Map(rooms.map(room => [room.code, {
      listenerCount: 25, participantCount: 26, audioLive: true, cameraLive: true,
    }])),
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const publicPlans = await request(`${baseUrl}/api/billing/plans`);
    assert.equal(publicPlans.payload.directVideoUploadsConfigured, false);
    assert.equal(publicPlans.payload.plans.find(plan => plan.id === 'room-25').features.videoUploads, false);
    const registration = await request(`${baseUrl}/api/auth/register`, {method: 'POST', body: {email: 'paid@example.com', password: 'password-segura-123', displayName: 'DJ Pago', role: 'dj'}});
    const cookie = registration.response.headers.get('set-cookie').split(';')[0];
    const roomInput = {billingPlanId: 'room-25', name: 'Sala pagada', roomType: 'music', visibility: 'private'};
    const blocked = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie, body: roomInput});
    assert.equal(blocked.response.status, 400);
    assert.match(blocked.payload.error, /bono disponible/);

    await app.billingStore.grantCredit({accountId: registration.payload.account.id, planId: 'room-25', units: 1, reason: 'Prueba', administrator: 'test'});
    for (const invalid of [
      {capacity: 1.5}, {capacity: -1}, {capacity: true}, {capacity: []}, {capacity: 1_000_001},
      {capacity: 0, capacityMode: 'limited'}, {capacity: '', capacityMode: 'limited'},
    ]) {
      const result = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie, body: {...roomInput, ...invalid}});
      assert.equal(result.response.status, 400);
      assert.match(result.payload.error, /entero|entera/);
    }
    const oversized = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie, body: {...roomInput, capacity: 26}});
    assert.equal(oversized.response.status, 400);
    assert.match(oversized.payload.error, /hasta 25 personas/);
    const created = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie, body: roomInput});
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.billing.reservationStatus, 'reserved');
    assert.equal(created.payload.room.capacity, 25);
    assert.equal(created.payload.room.billingPlan.maxParticipants, 25);
    assert.equal(created.payload.room.billingPlan.durationMinutes, 120);

    const media = await request(`${baseUrl}/api/rooms/${created.payload.room.code}/media-token`, {method: 'POST', cookie, body: {role: 'dj', hostToken: created.payload.hostToken}});
    assert.equal(media.response.status, 200);
    const fullRoom = await request(`${baseUrl}/api/rooms/${created.payload.room.code}/media-token`, {method: 'POST', cookie, body: {role: 'listener'}});
    assert.equal(fullRoom.response.status, 429);
    assert.match(fullRoom.payload.error, /capacidad de 25 personas/);
    const billing = await request(`${baseUrl}/api/account/billing`, {cookie});
    assert.ok(billing.payload.plans.length >= 9);
    assert.equal(billing.payload.reservations[0].status, 'consumed');
    await app.billingStore.grantCredit({accountId: registration.payload.account.id, planId: 'room-25', units: 1, reason: 'Aforo manual', administrator: 'test'});
    const manual = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie, body: {...roomInput, capacity: 17, capacityMode: 'limited'}});
    assert.equal(manual.response.status, 201);
    assert.equal(manual.payload.room.capacity, 17);
    assert.equal(manual.payload.room.capacityMode, 'limited');
    assert.equal(manual.payload.room.billingPlan.maxParticipants, 25);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('administración modifica precios y entrega bonos por correo con auditoría', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-billing-admin-'));
  const app = createQsessionServer({
    port: 0, dataFile: path.join(directory, 'state.json'), billingDataFile: path.join(directory, 'billing.json'),
    analyticsDataFile: path.join(directory, 'analytics.ndjson'), mediaDirectory: path.join(directory, 'media'),
    privateMediaDirectory: path.join(directory, 'private-media'), promotionMediaDirectory: path.join(directory, 'promotion-media'),
    publicUrl: 'https://qsession.org', roomSecret: 'room-secret', authPepper: 'auth-pepper',
    billingEnforced: true,
    adminUsername: 'maria', adminPassword: 'admin-password-2026', adminSessionSecret: 'admin-session-secret',
    wompiPublicKey: 'pub_test_qsession', wompiIntegritySecret: 'test_integrity_qsession', wompiEventsSecret: 'test_events_qsession',
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const registration = await request(`${baseUrl}/api/auth/register`, {method: 'POST', body: {email: 'organizer@example.com', password: 'password-segura-123', displayName: 'Organizador', role: 'dj'}});
    const accountCookie = registration.response.headers.get('set-cookie').split(';')[0];
    const blockedAndroidCheckout = await request(`${baseUrl}/api/billing/orders`, {
      method: 'POST',
      cookie: accountCookie,
      headers: {'user-agent': 'Mozilla/5.0 QSessionAndroid/0.1.35'},
      body: {planId: 'room-25'},
    });
    assert.equal(blockedAndroidCheckout.response.status, 403);
    assert.match(blockedAndroidCheckout.payload.error, /Google Play/);
    const login = await request(`${baseUrl}/api/admin/login`, {method: 'POST', body: {username: 'maria', password: 'admin-password-2026'}});
    const adminCookie = login.response.headers.get('set-cookie').split(';')[0];
    const update = await request(`${baseUrl}/api/admin/billing/plans/room-25`, {method: 'PATCH', cookie: adminCookie, body: {priceCents: 2_100_000, maxParticipants: 25, durationMinutes: 120, segment: 'professional', highlighted: true, sortOrder: 15}});
    assert.equal(update.response.status, 200);
    assert.equal(update.payload.plan.priceCents, 2_100_000);
    assert.equal(update.payload.plan.segment, 'professional');
    assert.equal(update.payload.plan.highlighted, true);
    const grant = await request(`${baseUrl}/api/admin/billing/credits`, {method: 'POST', cookie: adminCookie, body: {accountId: 'organizer@example.com', planId: 'room-25', units: 2, reason: 'Cortesía de lanzamiento'}});
    assert.equal(grant.response.status, 201);
    assert.equal(grant.payload.credit.unitsRemaining, 2);
    const summary = await request(`${baseUrl}/api/admin/billing`, {cookie: adminCookie});
    assert.equal(summary.response.status, 200);
    assert.equal(summary.payload.billing.credits.available, 2);
    assert.equal(summary.payload.billing.plans[0].priceCents, 2_100_000);

    const customQuote = await request(`${baseUrl}/api/billing/custom-quotes`, {method: 'POST', cookie: accountCookie, body: {capacity: 80, durationMinutes: 180, sessions: 2, guestCameras: true, videoUploads: true, translationLanguages: 2}});
    assert.equal(customQuote.response.status, 201);
    assert.equal(customQuote.payload.plan.maxParticipants, 80);
    assert.match(customQuote.payload.quoteToken, /\./);
    const customOrder = await request(`${baseUrl}/api/billing/orders`, {method: 'POST', cookie: accountCookie, body: {quoteToken: customQuote.payload.quoteToken}});
    assert.equal(customOrder.response.status, 201);
    assert.equal(customOrder.payload.order.planSnapshot.maxParticipants, 80);
    assert.equal(customOrder.payload.order.planSnapshot.features.translationLanguages, 2);
    assert.equal(customOrder.payload.order.amountCents, customQuote.payload.quote.priceCents);
    await app.billingStore.applyPaymentEvent({eventKey: 'custom-tx:APPROVED', eventType: 'transaction.updated', transactionId: 'custom-tx', reference: customOrder.payload.order.reference, status: 'APPROVED', amountCents: customOrder.payload.order.amountCents, currency: 'COP', paymentMethodType: 'CARD', environment: 'test', payload: {}});
    const customRoom = await request(`${baseUrl}/api/rooms`, {method: 'POST', cookie: accountCookie, body: {billingPlanId: customOrder.payload.order.planId, name: 'Sala a medida', roomType: 'custom', visibility: 'private', capacity: 80, translation: {sourceLanguage: 'es', mode: 'subtitles', targetLanguages: ['en', 'de', 'fr']}}});
    assert.equal(customRoom.response.status, 201);
    assert.equal(customRoom.payload.room.billingPlan.maxParticipants, 80);
    assert.equal(customRoom.payload.room.billingPlan.durationMinutes, 180);
    assert.deepEqual(customRoom.payload.room.translation.targetLanguages, ['en', 'de']);

    await request(`${baseUrl}/api/admin/billing/plans/room-25`, {method: 'PATCH', cookie: adminCookie, body: {billingInterval: 'monthly'}});
    const monthly = await request(`${baseUrl}/api/billing/orders`, {method: 'POST', cookie: accountCookie, body: {planId: 'room-25'}});
    assert.equal(monthly.response.status, 201);
    assert.equal(monthly.payload.order.planSnapshot.billingInterval, 'monthly');
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
