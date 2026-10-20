'use strict';

// An operator-supplied event authorization, separate from commercial billing.
// Parsing or reading this object never enables delivery, changes a room, charges
// a customer, consumes credits or certifies the delivery infrastructure.
const PLAN_ID = 'broadcast-event-10000';
const EVENT_PARTICIPANTS = 10000;
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;
const EVENT_PLAN_FILE_ENV = 'QSESSION_BROADCAST_EVENT_PLAN_FILE';

function invalid(message) {
  throw new Error(`Plan operativo de transmisión no válido: ${message}`);
}

function boundedString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    invalid(`${name} debe ser un texto no vacío de hasta ${maxLength} caracteres.`);
  }
  return value.trim();
}

function instant(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid(`${name} debe ser una fecha ISO con zona horaria.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalid(`${name} debe ser una fecha ISO válida.`);
  return parsed;
}

function parseBroadcastEventPlan(input, {roomCode, roomId, target, now = Date.now()} = {}) {
  let source = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > 16 * 1024) invalid('el documento supera 16 KiB.');
    try { source = JSON.parse(input); } catch { invalid('el documento no contiene JSON válido.'); }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) invalid('falta el documento del evento.');
  if (!Number.isFinite(now)) invalid('la hora de validación no es válida.');
  if (typeof roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(roomCode) || source.roomCode !== roomCode) invalid('el código no corresponde a la sala seleccionada.');
  if (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(roomId) || source.roomId !== roomId) invalid('la generación de sala no corresponde al evento actual.');
  if (source.schemaVersion !== 1 || source.planId !== PLAN_ID || source.status !== 'prepared') invalid('se requiere el plan preparado de evento para 10.000.');
  if (target !== EVENT_PARTICIPANTS || source.targetViewers !== EVENT_PARTICIPANTS || source.maxParticipants !== EVENT_PARTICIPANTS) invalid('este permiso sólo contempla 10.000 espectadores.');
  const approvedBy = boundedString(source.approvedBy, 'approvedBy', 200);
  const authorizationReference = boundedString(source.authorizationReference, 'authorizationReference', 4096);
  const issuedAt = instant(source.issuedAt, 'issuedAt');
  const expiresAt = instant(source.expiresAt, 'expiresAt');
  if (issuedAt > now || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_VALIDITY_MS) {
    invalid('la autorización debe estar vigente y durar como máximo 24 horas.');
  }
  return Object.freeze({
    schemaVersion: 1, planId: PLAN_ID, status: 'prepared', roomCode, roomId,
    targetViewers: EVENT_PARTICIPANTS, maxParticipants: EVENT_PARTICIPANTS,
    approvedBy, authorizationReference,
    issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
    metadata: Object.freeze({
      scope: 'single-event-cdn-only', prepared: true, willActivate: false,
      capacityCertified: false, billingPlanPreserved: true, billingDurationPreserved: true,
      chargesCreated: false, creditsModified: false,
    }),
  });
}

function currentPlan(input, options) {
  try { return parseBroadcastEventPlan(input, options); } catch { return null; }
}

function effectiveBroadcastEventLimit(input, options = {}) {
  if (options.audienceMode !== 'cdn-only' || options.selectedRoomCode !== options.roomCode || options.readinessApproved !== true) return null;
  const plan = currentPlan(input, options);
  return plan ? plan.maxParticipants : null;
}

function publicBroadcastEventPlan(input, options = {}) {
  const plan = currentPlan(input, options);
  if (!plan) return null;
  return {
    planId: plan.planId, status: plan.status, roomCode: plan.roomCode,
    targetViewers: plan.targetViewers, maxParticipants: plan.maxParticipants,
    expiresAt: plan.expiresAt,
    effectiveMaxParticipants: effectiveBroadcastEventLimit(plan, options),
    ...plan.metadata,
  };
}

module.exports = {
  PLAN_ID, EVENT_PARTICIPANTS, MAX_VALIDITY_MS, EVENT_PLAN_FILE_ENV,
  parseBroadcastEventPlan, effectiveBroadcastEventLimit, publicBroadcastEventPlan,
};
