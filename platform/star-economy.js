'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  copPerStar: 100,
  artistSharePercent: 80,
  sponsorRewardStars: 2,
  sponsorDailyLimit: 10,
  sponsorMinimumViewSeconds: 15,
});

const DEFAULT_PACKAGES = Object.freeze([
  {id: 'stars-50', name: '50 estrellas', stars: 50, sortOrder: 10, active: true},
  {id: 'stars-120', name: '120 estrellas', stars: 120, sortOrder: 20, active: true},
  {id: 'stars-300', name: '300 estrellas', stars: 300, sortOrder: 30, active: true},
]);

const FLOWER_CATALOG = Object.freeze([
  {id: 'margarita', name: 'Margarita', symbol: '✿', thresholdSeconds: 15 * 60},
  {id: 'tulipan', name: 'Tulipán', symbol: '♧', thresholdSeconds: 30 * 60},
  {id: 'rosa', name: 'Rosa', symbol: '❀', thresholdSeconds: 60 * 60},
  {id: 'orquidea', name: 'Orquídea', symbol: '❁', thresholdSeconds: 120 * 60},
  {id: 'loto', name: 'Loto', symbol: '⌘', thresholdSeconds: 240 * 60},
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }
function uid(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function integer(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function paymentStatus(value) {
  return ({APPROVED: 'approved', DECLINED: 'declined', VOIDED: 'voided', ERROR: 'error'}[String(value || '').toUpperCase()] || 'pending');
}
function reference() {
  return `QSSTAR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

function createStarEconomyStore({filePath = null} = {}) {
  let state = {
    version: 1,
    settings: clone(DEFAULT_SETTINGS),
    packages: clone(DEFAULT_PACKAGES),
    orders: [],
    paymentEvents: [],
    ledger: [],
    unlocks: [],
    sponsorViews: [],
    flowerLedger: [],
    flowerSessions: [],
  };
  if (filePath && fs.existsSync(filePath)) {
    try { state = {...state, ...JSON.parse(fs.readFileSync(filePath, 'utf8'))}; }
    catch { throw new Error('No se pudo leer el libro contable de estrellas'); }
  }
  state.settings = {...DEFAULT_SETTINGS, ...(state.settings || {})};
  state.flowerLedger = Array.isArray(state.flowerLedger) ? state.flowerLedger : [];
  state.flowerSessions = Array.isArray(state.flowerSessions) ? state.flowerSessions : [];
  for (const item of DEFAULT_PACKAGES) if (!state.packages.some(candidate => candidate.id === item.id)) state.packages.push(clone(item));

  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
    fs.renameSync(temporary, filePath);
  }
  function amountFor(stars) { return stars * state.settings.copPerStar * 100; }
  function balance(accountId) {
    return state.ledger.filter(entry => entry.accountId === accountId).reduce((sum, entry) => sum + entry.stars, 0);
  }
  function flowerBalance(accountId, flowerId) {
    return state.flowerLedger
      .filter(entry => entry.accountId === accountId && entry.flowerId === flowerId)
      .reduce((sum, entry) => sum + entry.quantity, 0);
  }
  function flowerWallet(accountId) {
    const inventory = FLOWER_CATALOG.map(flower => ({
      ...flower,
      quantity: Math.max(0, flowerBalance(accountId, flower.id)),
    }));
    return {
      catalog: clone(FLOWER_CATALOG),
      inventory,
      total: inventory.reduce((sum, flower) => sum + flower.quantity, 0),
      recent: clone(state.flowerLedger.filter(entry => entry.accountId === accountId).slice(-50).reverse()),
    };
  }
  function publicCatalog() {
    return {
      currency: 'COP',
      copPerStar: state.settings.copPerStar,
      artistSharePercent: state.settings.artistSharePercent,
      sponsorRewardStars: state.settings.sponsorRewardStars,
      sponsorMinimumViewSeconds: state.settings.sponsorMinimumViewSeconds,
      packages: state.packages.filter(item => item.active).sort((a, b) => a.sortOrder - b.sortOrder).map(item => ({
        ...item,
        amountCents: amountFor(item.stars),
      })),
    };
  }
  async function accountWallet(accountId) {
    return {
      balance: balance(accountId),
      flowers: flowerWallet(accountId),
      transactions: clone(state.ledger.filter(entry => entry.accountId === accountId).slice(-100).reverse()),
      orders: clone(state.orders.filter(order => order.accountId === accountId).slice(-50).reverse()),
      unlocks: clone(state.unlocks.filter(item => item.accountId === accountId).slice(-100).reverse()),
      ...publicCatalog(),
    };
  }
  function listeningSession(accountId, roomId, roomCode, artistAccountId) {
    let session = state.flowerSessions.find(item => item.accountId === accountId && item.roomId === roomId);
    if (!session) {
      session = {
        id: uid('flower_session'), accountId, roomId, roomCode, artistAccountId,
        connectedSeconds: 0, awardedFlowerIds: [], lastPulseAt: null,
        createdAt: now(), updatedAt: now(),
      };
      state.flowerSessions.push(session);
    }
    return session;
  }
  async function recordListeningPulse({accountId, roomId, roomCode, artistAccountId}) {
    if (!accountId || !roomId || accountId === artistAccountId) {
      throw new Error('Las flores de permanencia son para oyentes de la sesión');
    }
    const session = listeningSession(accountId, roomId, roomCode, artistAccountId);
    const currentTime = Date.now();
    const previousTime = session.lastPulseAt ? new Date(session.lastPulseAt).getTime() : currentTime;
    const elapsedSeconds = Math.max(0, Math.floor((currentTime - previousTime) / 1000));
    // Sólo se acepta un intervalo continuo y breve. Una pestaña suspendida no
    // puede acreditar horas al volver a abrirse.
    session.connectedSeconds += Math.min(90, elapsedSeconds);
    session.lastPulseAt = new Date(currentTime).toISOString();
    session.updatedAt = session.lastPulseAt;
    const awarded = [];
    for (const flower of FLOWER_CATALOG) {
      if (session.connectedSeconds < flower.thresholdSeconds || session.awardedFlowerIds.includes(flower.id)) continue;
      session.awardedFlowerIds.push(flower.id);
      const entry = {
        id: uid('flower_tx'), accountId, flowerId: flower.id, quantity: 1,
        type: 'listening_reward', roomId, roomCode, sessionId: session.id, createdAt: now(),
      };
      state.flowerLedger.push(entry);
      awarded.push({...flower, transactionId: entry.id});
    }
    persist();
    const next = FLOWER_CATALOG.find(flower => !session.awardedFlowerIds.includes(flower.id)) || null;
    return {
      connectedSeconds: session.connectedSeconds,
      awarded,
      next: next ? {...next, remainingSeconds: Math.max(0, next.thresholdSeconds - session.connectedSeconds)} : null,
      flowers: flowerWallet(accountId),
    };
  }
  function requireFlower(accountId, requestedFlowerId = '') {
    const requested = FLOWER_CATALOG.find(flower => flower.id === requestedFlowerId);
    if (requested && flowerBalance(accountId, requested.id) > 0) return requested;
    const available = FLOWER_CATALOG.find(flower => flowerBalance(accountId, flower.id) > 0);
    if (!available) throw new Error('Aún no tienes flores disponibles');
    if (requestedFlowerId) throw new Error('Ya no tienes esa flor disponible');
    return available;
  }
  function transferFlower({fromAccountId, toAccountId, flowerId, type, roomId = null, profileId = null}) {
    if (!toAccountId || fromAccountId === toAccountId) throw new Error('El destinatario de la flor no es válido');
    const flower = requireFlower(fromAccountId, flowerId);
    const transferId = uid('flower_transfer');
    const createdAt = now();
    state.flowerLedger.push({id: uid('flower_tx'), transferId, accountId: fromAccountId, flowerId: flower.id, quantity: -1, type, roomId, profileId, createdAt});
    state.flowerLedger.push({id: uid('flower_tx'), transferId, accountId: toAccountId, flowerId: flower.id, quantity: 1, type: `${type}_received`, roomId, profileId, createdAt});
    persist();
    return {id: transferId, flower: clone(flower), flowers: flowerWallet(fromAccountId), createdAt};
  }
  async function sendFlower(input) { return transferFlower({...input, type: 'artist_gift'}); }
  function canUseFlower(accountId) { return FLOWER_CATALOG.some(flower => flowerBalance(accountId, flower.id) > 0); }
  function useFlowerForMatchmaking({accountId, targetAccountId, profileId, roomId = null}) {
    return transferFlower({fromAccountId: accountId, toAccountId: targetAccountId, flowerId: '', type: 'matchmaking', roomId, profileId});
  }
  async function createOrder({accountId, customerEmail, packageId}) {
    const pack = state.packages.find(item => item.id === packageId && item.active);
    if (!pack) throw new Error('El paquete de estrellas no está disponible');
    const createdAt = now();
    const order = {
      id: uid('star_order'), reference: reference(), accountId, packageId: pack.id,
      stars: pack.stars, amountCents: amountFor(pack.stars), currency: 'COP', status: 'pending', provider: 'wompi',
      customerEmail: String(customerEmail || '').slice(0, 254), providerTransactionId: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), approvedAt: null, createdAt, updatedAt: createdAt,
    };
    state.orders.push(order); persist(); return clone(order);
  }
  async function getOrderByReference(value) { return clone(state.orders.find(order => order.reference === value) || null); }
  async function applyPaymentEvent(event) {
    const duplicate = state.paymentEvents.some(item => item.eventKey === event.eventKey);
    if (duplicate) return {duplicate: true, order: await getOrderByReference(event.reference)};
    const order = state.orders.find(item => item.reference === event.reference);
    state.paymentEvents.push({...event, id: uid('star_event'), orderId: order?.id || null, receivedAt: now()});
    if (!order) { persist(); throw new Error('La referencia de estrellas no pertenece a Q Session'); }
    if (Number(event.amountCents) !== order.amountCents || event.currency !== order.currency) {
      persist(); throw new Error('El monto o la moneda del pago de estrellas no coincide');
    }
    order.status = paymentStatus(event.status);
    order.providerTransactionId = event.transactionId || order.providerTransactionId;
    order.updatedAt = now();
    if (order.status === 'approved' && !order.approvedAt) {
      order.approvedAt = now();
      state.ledger.push({id: uid('star_tx'), accountId: order.accountId, stars: order.stars, type: 'purchase', orderId: order.id, createdAt: now()});
    }
    persist(); return {duplicate: false, order: clone(order)};
  }
  function transfer({fromAccountId, toAccountId, stars, type, roomId = null, note = ''}) {
    const quantity = integer(stars, 1, 1_000_000, 0);
    if (!quantity) throw new Error('Indica una cantidad válida de estrellas');
    if (!toAccountId || fromAccountId === toAccountId) throw new Error('El destinatario de las estrellas no es válido');
    if (balance(fromAccountId) < quantity) throw new Error('No tienes suficientes estrellas');
    const transferId = uid('star_transfer');
    const createdAt = now();
    state.ledger.push({id: uid('star_tx'), transferId, accountId: fromAccountId, stars: -quantity, type, roomId, note, createdAt});
    state.ledger.push({id: uid('star_tx'), transferId, accountId: toAccountId, stars: quantity, type: `${type}_received`, roomId, note, createdAt});
    persist();
    return {id: transferId, stars: quantity, balance: balance(fromAccountId), createdAt};
  }
  async function sendStars(input) { return transfer({...input, type: 'tip'}); }
  async function unlockSession({accountId, artistAccountId, roomId, roomCode, stars}) {
    const existing = state.unlocks.find(item => item.accountId === accountId && item.roomId === roomId);
    if (existing) return clone({...existing, alreadyUnlocked: true});
    const paid = transfer({fromAccountId: accountId, toAccountId: artistAccountId, stars, type: 'session_unlock', roomId, note: roomCode});
    const unlock = {id: uid('star_unlock'), accountId, artistAccountId, roomId, roomCode, stars: paid.stars, createdAt: now()};
    state.unlocks.push(unlock); persist(); return clone({...unlock, alreadyUnlocked: false});
  }
  async function hasUnlocked(accountId, roomId) { return state.unlocks.some(item => item.accountId === accountId && item.roomId === roomId); }
  async function beginSponsorView({accountId, promotionId, roomCode}) {
    const today = new Date().toISOString().slice(0, 10);
    const daily = state.sponsorViews.filter(item => item.accountId === accountId && item.day === today).length;
    if (daily >= state.settings.sponsorDailyLimit) throw new Error('Ya alcanzaste el límite diario de recompensas');
    if (state.sponsorViews.some(item => item.accountId === accountId && item.day === today && item.promotionId === promotionId)) {
      throw new Error('Esta campaña ya te entregó o está preparando una recompensa hoy');
    }
    const view = {id: uid('sponsor_view'), accountId, promotionId, roomCode, day: today, startedAt: now(), rewardedAt: null};
    state.sponsorViews.push(view); persist(); return clone({...view, waitSeconds: state.settings.sponsorMinimumViewSeconds});
  }
  async function rewardSponsorView({accountId, viewId}) {
    const view = state.sponsorViews.find(item => item.id === viewId && item.accountId === accountId);
    if (!view) throw new Error('La vista patrocinada no existe');
    if (view.rewardedAt) return {duplicate: true, stars: state.settings.sponsorRewardStars, balance: balance(accountId)};
    const rewardedToday = state.sponsorViews.filter(item => item.accountId === accountId && item.day === view.day && item.rewardedAt).length;
    if (rewardedToday >= state.settings.sponsorDailyLimit) throw new Error('Ya alcanzaste el límite diario de recompensas');
    const elapsed = Date.now() - new Date(view.startedAt).getTime();
    if (elapsed < state.settings.sponsorMinimumViewSeconds * 1000) throw new Error('Completa el tiempo de visualización para recibir estrellas');
    view.rewardedAt = now();
    state.ledger.push({id: uid('star_tx'), accountId, stars: state.settings.sponsorRewardStars, type: 'sponsor_reward', promotionId: view.promotionId, roomCode: view.roomCode, createdAt: now()});
    persist(); return {duplicate: false, stars: state.settings.sponsorRewardStars, balance: balance(accountId)};
  }
  async function updateSettings(input = {}) {
    state.settings = {
      copPerStar: integer(input.copPerStar, 1, 100_000, state.settings.copPerStar),
      artistSharePercent: integer(input.artistSharePercent, 0, 100, state.settings.artistSharePercent),
      sponsorRewardStars: integer(input.sponsorRewardStars, 0, 10_000, state.settings.sponsorRewardStars),
      sponsorDailyLimit: integer(input.sponsorDailyLimit, 0, 1000, state.settings.sponsorDailyLimit),
      sponsorMinimumViewSeconds: integer(input.sponsorMinimumViewSeconds, 5, 3600, state.settings.sponsorMinimumViewSeconds),
    };
    persist(); return clone(state.settings);
  }
  async function adminSummary() {
    const purchased = state.ledger.filter(item => item.type === 'purchase').reduce((sum, item) => sum + item.stars, 0);
    const tipped = state.ledger.filter(item => item.type === 'tip').reduce((sum, item) => sum - item.stars, 0);
    const rewarded = state.ledger.filter(item => item.type === 'sponsor_reward').reduce((sum, item) => sum + item.stars, 0);
    return {settings: clone(state.settings), catalog: publicCatalog(), totals: {purchased, tipped, rewarded, orders: state.orders.length, approvedOrders: state.orders.filter(item => item.status === 'approved').length}, recentTransactions: clone(state.ledger.slice(-100).reverse())};
  }
  async function deactivateAccount(accountId) {
    state.orders.filter(item => item.accountId === accountId).forEach(item => { item.customerEmail = ''; });
    state.flowerSessions = state.flowerSessions.filter(item => item.accountId !== accountId && item.artistAccountId !== accountId);
    state.flowerLedger = state.flowerLedger.filter(item => item.accountId !== accountId);
    persist();
  }
  return {driver: 'file', publicCatalog, accountWallet, recordListeningPulse, sendFlower, canUseFlower, useFlowerForMatchmaking, createOrder, getOrderByReference, applyPaymentEvent, sendStars, unlockSession, hasUnlocked, beginSponsorView, rewardSponsorView, updateSettings, adminSummary, deactivateAccount, close: async () => undefined};
}

module.exports = {createStarEconomyStore, DEFAULT_SETTINGS, DEFAULT_PACKAGES, FLOWER_CATALOG};
