'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {Pool} = require('pg');

const BASE_FEATURES = Object.freeze({
  hostVideo: true,
  hostAudio: true,
  publicChat: true,
  guestCameras: true,
  videoUploads: true,
});

const DEFAULT_PLANS = Object.freeze([
  {
    id: 'room-25', name: 'Sala Esencial 25', segment: 'event', highlighted: false,
    description: 'Para reuniones privadas, celebraciones pequeñas y primeras transmisiones.',
    priceCents: 1_200_000, maxParticipants: 25, durationMinutes: 120, creditsPerPurchase: 1, sortOrder: 10,
  },
  {
    id: 'event-100', name: 'Evento 100', segment: 'event', highlighted: false,
    description: 'Para cumpleaños, bodas, conferencias y encuentros de hasta 100 personas.',
    priceCents: 2_700_000, maxParticipants: 100, durationMinutes: 180, creditsPerPurchase: 1, sortOrder: 20,
  },
  {
    id: 'event-250', name: 'Evento 250', segment: 'event', highlighted: true,
    description: 'Una sala amplia para comunidades, fiestas y eventos con mayor alcance.',
    priceCents: 5_340_000, maxParticipants: 250, durationMinutes: 240, creditsPerPurchase: 1, sortOrder: 30,
  },
  {
    id: 'event-500', name: 'Evento 500', segment: 'event', highlighted: false,
    description: 'Para lanzamientos, celebraciones y transmisiones públicas de gran formato.',
    priceCents: 15_900_000, maxParticipants: 500, durationMinutes: 240, creditsPerPurchase: 1, sortOrder: 40,
  },
  {
    id: 'instructor-50-4', name: 'Instructor 50 · 4 sesiones', segment: 'professional', highlighted: true,
    description: 'Paquete para profesores de yoga, meditación, baile y bienestar.',
    priceCents: 6_900_000, maxParticipants: 50, durationMinutes: 90, creditsPerPurchase: 4, sortOrder: 50,
  },
  {
    id: 'instructor-100-8', name: 'Instructor Pro 100 · 8 sesiones', segment: 'professional', highlighted: false,
    description: 'Para academias y profesores con grupos recurrentes y una comunidad en crecimiento.',
    priceCents: 16_900_000, maxParticipants: 100, durationMinutes: 120, creditsPerPurchase: 8, sortOrder: 60,
  },
  {
    id: 'business-250-10', name: 'Comercio 250 · 10 sesiones', segment: 'business', highlighted: true,
    description: 'Para comercios, marcas, hoteles y organizadores con programación frecuente.',
    priceCents: 44_900_000, maxParticipants: 250, durationMinutes: 240, creditsPerPurchase: 10, sortOrder: 70,
  },
  {
    id: 'large-event-1000', name: 'Gran evento 1.000', segment: 'enterprise', highlighted: false,
    description: 'Para grandes conferencias, conciertos y eventos institucionales de alcance nacional.',
    priceCents: 28_900_000, maxParticipants: 1000, durationMinutes: 360, creditsPerPurchase: 1, sortOrder: 80,
  },
  {
    id: 'monthly-essential-25', name: 'Mensual Esencial 25', segment: 'membership', highlighted: true,
    description: 'Cuatro salas al mes para clases, encuentros y transmisiones frecuentes. Renovación manual, sin permanencia.',
    priceCents: 3_900_000, maxParticipants: 25, durationMinutes: 120, creditsPerPurchase: 4, sortOrder: 90,
    billingInterval: 'monthly',
  },
  {
    id: 'monthly-community-100', name: 'Mensual Comunidad 100', segment: 'membership', highlighted: false,
    description: 'Cuatro salas mensuales para comunidades, clases y encuentros de hasta 100 personas.',
    priceCents: 8_900_000, maxParticipants: 100, durationMinutes: 180, creditsPerPurchase: 4, sortOrder: 100,
    billingInterval: 'monthly',
  },
  {
    id: 'monthly-pro-250', name: 'Mensual Pro 250', segment: 'membership', highlighted: false,
    description: 'Cuatro salas amplias al mes para academias, marcas y eventos recurrentes.',
    priceCents: 16_900_000, maxParticipants: 250, durationMinutes: 240, creditsPerPurchase: 4, sortOrder: 110,
    billingInterval: 'monthly',
  },
].map(plan => Object.freeze({
  ...plan,
  currency: 'COP',
  billingInterval: plan.billingInterval === 'monthly' ? 'monthly' : 'one_time',
  features: {...BASE_FEATURES},
  active: true,
  revision: 1,
})));

const DEFAULT_PLAN = DEFAULT_PLANS[0];
const PLAN_SEGMENTS = new Set(['event', 'professional', 'business', 'enterprise', 'membership']);

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function normalizePlan(input = {}, previous = DEFAULT_PLAN) {
  const name = String(input.name ?? previous.name).trim().replace(/\s+/g, ' ').slice(0, 100);
  const description = String(input.description ?? previous.description).trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!name) throw new Error('El plan necesita un nombre');
  return {
    ...previous,
    name,
    description,
    priceCents: boundedInteger(input.priceCents, 0, 2_000_000_000, previous.priceCents),
    currency: 'COP',
    maxParticipants: boundedInteger(input.maxParticipants, 1, 50_000, previous.maxParticipants),
    durationMinutes: boundedInteger(input.durationMinutes, 15, 24 * 60, previous.durationMinutes),
    creditsPerPurchase: boundedInteger(input.creditsPerPurchase, 1, 100, previous.creditsPerPurchase),
    billingInterval: input.billingInterval === 'monthly' ? 'monthly' : 'one_time',
    segment: PLAN_SEGMENTS.has(input.segment) ? input.segment : (previous.segment || 'event'),
    highlighted: typeof input.highlighted === 'boolean' ? input.highlighted : Boolean(previous.highlighted),
    features: input.features && typeof input.features === 'object' && !Array.isArray(input.features)
      ? Object.fromEntries(Object.entries(input.features).slice(0, 30).map(([key, value]) => {
        const normalizedKey = String(key).slice(0, 60);
        return [normalizedKey, normalizedKey === 'translationLanguages'
          ? boundedInteger(value, 1, 3, 1)
          : Boolean(value)];
      }))
      : previous.features,
    active: typeof input.active === 'boolean' ? input.active : previous.active,
    sortOrder: boundedInteger(input.sortOrder, -10_000, 10_000, previous.sortOrder),
    revision: Number(previous.revision || 0) + 1,
  };
}

function planSnapshot(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents,
    currency: plan.currency,
    maxParticipants: plan.maxParticipants,
    durationMinutes: plan.durationMinutes,
    creditsPerPurchase: plan.creditsPerPurchase,
    billingInterval: plan.billingInterval,
    segment: plan.segment || 'event',
    highlighted: Boolean(plan.highlighted),
    features: clone(plan.features || {}),
    revision: plan.revision,
  };
}

function normalizeCustomPlan(input = {}) {
  const planId = String(input.id || '');
  if (!/^custom-quote-[a-f0-9-]{36}$/i.test(planId)) throw new Error('La cotización personalizada no es válida');
  const plan = normalizePlan({
    ...input,
    billingInterval: 'one_time',
    segment: 'event',
    highlighted: false,
    active: false,
    sortOrder: 20_000,
  }, DEFAULT_PLAN);
  if (plan.priceCents < 1) throw new Error('La cotización personalizada no tiene un precio válido');
  return {...plan, id: planId, billingInterval: 'one_time', active: false, revision: 1};
}

function paymentStatus(value) {
  const status = String(value || '').toUpperCase();
  return ({APPROVED: 'approved', DECLINED: 'declined', VOIDED: 'voided', ERROR: 'error'}[status] || 'pending');
}

function checkoutReference() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `QS-${date}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

function createFileBillingStore({filePath}) {
  let state = {version: 2, plans: clone(DEFAULT_PLANS), orders: [], paymentEvents: [], credits: [], reservations: [], adjustments: []};
  if (filePath && fs.existsSync(filePath)) {
    try {
      state = {...state, ...JSON.parse(fs.readFileSync(filePath, 'utf8'))};
    } catch {
      throw new Error('No se pudo leer el libro contable de pagos');
    }
  }
  DEFAULT_PLANS.forEach(defaultPlan => {
    const index = state.plans.findIndex(plan => plan.id === defaultPlan.id);
    if (index < 0) state.plans.push(clone(defaultPlan));
    else state.plans[index] = {
      ...clone(defaultPlan),
      ...state.plans[index],
      features: {...clone(defaultPlan.features), ...(state.plans[index].features || {})},
    };
  });
  state.version = 2;

  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
    fs.renameSync(temporary, filePath);
  }

  async function listPlans({includeInactive = false} = {}) {
    return clone(state.plans.filter(plan => includeInactive || plan.active).sort((a, b) => a.sortOrder - b.sortOrder));
  }

  async function updatePlan(planId, input) {
    const index = state.plans.findIndex(plan => plan.id === planId);
    if (index < 0) throw new Error('El plan no existe');
    state.plans[index] = {...normalizePlan(input, state.plans[index]), id: state.plans[index].id, updatedAt: now()};
    persist();
    return clone(state.plans[index]);
  }

  async function createOrder({accountId, customerEmail, planId, planOverride = null}) {
    let plan = null;
    if (planOverride) {
      plan = normalizeCustomPlan(planOverride);
      if (!state.plans.some(item => item.id === plan.id)) state.plans.push(clone(plan));
    } else {
      plan = state.plans.find(item => item.id === planId && item.active);
      if (!plan) throw new Error('Este plan no está disponible');
    }
    const createdAt = now();
    const order = {
      id: id('order'), reference: checkoutReference(), accountId, planId: plan.id, planRevision: plan.revision,
      planSnapshot: planSnapshot(plan), amountCents: plan.priceCents, currency: 'COP', status: 'pending', provider: 'wompi',
      providerTransactionId: null, paymentMethodType: null, customerEmail: String(customerEmail || '').slice(0, 254),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), approvedAt: null, createdAt, updatedAt: createdAt,
    };
    state.orders.push(order);
    persist();
    return clone(order);
  }

  async function getOrderByReference(reference) {
    return clone(state.orders.find(order => order.reference === reference) || null);
  }

  async function applyPaymentEvent(event) {
    const duplicate = state.paymentEvents.find(item => item.eventKey === event.eventKey);
    if (duplicate) return {duplicate: true, order: await getOrderByReference(event.reference)};
    const order = state.orders.find(item => item.reference === event.reference);
    const eventRecord = {...event, id: id('payment_event'), receivedAt: now(), orderId: order?.id || null};
    state.paymentEvents.push(eventRecord);
    if (!order) {
      persist();
      throw new Error('La referencia del pago no pertenece a Q Session');
    }
    if (Number(event.amountCents) !== order.amountCents || event.currency !== order.currency) {
      persist();
      throw new Error('El monto o la moneda del pago no coincide con la orden');
    }
    order.status = paymentStatus(event.status);
    order.providerTransactionId = event.transactionId || order.providerTransactionId;
    order.paymentMethodType = event.paymentMethodType || order.paymentMethodType;
    order.updatedAt = now();
    if (order.status === 'approved' && !order.approvedAt) {
      order.approvedAt = order.updatedAt;
      const plan = state.plans.find(item => item.id === order.planId) || order.planSnapshot;
      state.credits.push({
        id: id('credit'), accountId: order.accountId, planId: order.planId, sourceOrderId: order.id,
        unitsGranted: order.planSnapshot.creditsPerPurchase, unitsRemaining: order.planSnapshot.creditsPerPurchase,
        status: 'available', expiresAt: new Date(Date.now() + (plan.billingInterval === 'monthly' ? 35 : 365) * 86400000).toISOString(),
        createdAt: order.updatedAt, updatedAt: order.updatedAt,
      });
    }
    persist();
    return {duplicate: false, order: clone(order)};
  }

  async function accountBilling(accountId) {
    const credits = state.credits.filter(credit => credit.accountId === accountId).map(credit => ({
      ...credit,
      plan: planSnapshot(state.plans.find(plan => plan.id === credit.planId) || DEFAULT_PLAN),
    }));
    return {
      plans: await listPlans(), credits: clone(credits),
      orders: clone(state.orders.filter(order => order.accountId === accountId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)),
      reservations: clone(state.reservations.filter(item => item.accountId === accountId)),
    };
  }

  async function deactivateAccount(accountId) {
    const changedAt = now();
    state.orders.filter(order => order.accountId === accountId).forEach(order => {
      order.customerEmail = null;
      order.updatedAt = changedAt;
    });
    state.credits.filter(credit => credit.accountId === accountId).forEach(credit => {
      credit.unitsRemaining = 0;
      credit.status = 'reversed';
      credit.updatedAt = changedAt;
    });
    state.reservations.filter(item => item.accountId === accountId && item.status === 'reserved').forEach(item => {
      item.status = 'released';
      item.releasedAt = changedAt;
    });
    persist();
    return {ok: true};
  }

  async function reserveCredit({accountId, roomId, roomCode, planId = ''}) {
    const existing = state.reservations.find(item => item.roomId === roomId);
    if (existing) return clone(existing);
    const credit = state.credits.find(item => item.accountId === accountId && item.status === 'available'
      && item.unitsRemaining > 0 && (!planId || item.planId === planId) && (!item.expiresAt || new Date(item.expiresAt) > new Date()));
    if (!credit) throw new Error('Necesitas un bono disponible para crear esta sala');
    credit.unitsRemaining -= 1;
    credit.status = credit.unitsRemaining ? 'available' : 'depleted';
    credit.updatedAt = now();
    const reservation = {id: id('reservation'), accountId, creditId: credit.id, roomId, roomCode, status: 'reserved', reservedAt: now(), consumedAt: null, releasedAt: null};
    state.reservations.push(reservation);
    persist();
    return clone(reservation);
  }

  async function consumeReservation(roomId) {
    const reservation = state.reservations.find(item => item.roomId === roomId);
    if (!reservation) throw new Error('Esta sala no tiene un bono reservado');
    if (reservation.status === 'consumed') return clone(reservation);
    if (reservation.status !== 'reserved') throw new Error('El bono de esta sala ya fue liberado');
    reservation.status = 'consumed';
    reservation.consumedAt = now();
    persist();
    return clone(reservation);
  }

  async function releaseReservation(roomId) {
    const reservation = state.reservations.find(item => item.roomId === roomId);
    if (!reservation || reservation.status !== 'reserved') return reservation ? clone(reservation) : null;
    reservation.status = 'released';
    reservation.releasedAt = now();
    const credit = state.credits.find(item => item.id === reservation.creditId);
    if (credit) {
      credit.unitsRemaining = Math.min(credit.unitsGranted, credit.unitsRemaining + 1);
      credit.status = 'available';
      credit.updatedAt = reservation.releasedAt;
    }
    persist();
    return clone(reservation);
  }

  async function grantCredit({accountId, planId, units = 1, reason, administrator}) {
    const plan = state.plans.find(item => item.id === planId);
    if (!plan) throw new Error('El plan no existe');
    const count = boundedInteger(units, 1, 100, 1);
    const createdAt = now();
    const credit = {id: id('credit'), accountId, planId, sourceOrderId: null, unitsGranted: count, unitsRemaining: count, status: 'available', expiresAt: null, createdAt, updatedAt: createdAt};
    state.credits.push(credit);
    state.adjustments.push({id: id('adjustment'), accountId, planId, creditId: credit.id, units: count, reason: String(reason || 'Ajuste administrativo').slice(0, 300), administrator, createdAt});
    persist();
    return clone(credit);
  }

  async function adminSummary() {
    const approved = state.orders.filter(order => order.status === 'approved');
    const revenueCents = approved.reduce((sum, order) => sum + order.amountCents, 0);
    return {
      generatedAt: now(), revenueCents,
      orders: {total: state.orders.length, approved: approved.length, pending: state.orders.filter(order => order.status === 'pending').length, declined: state.orders.filter(order => ['declined', 'error', 'voided'].includes(order.status)).length},
      credits: {granted: state.credits.reduce((sum, item) => sum + item.unitsGranted, 0), available: state.credits.reduce((sum, item) => sum + item.unitsRemaining, 0), reserved: state.reservations.filter(item => item.status === 'reserved').length, consumed: state.reservations.filter(item => item.status === 'consumed').length},
      plans: await listPlans({includeInactive: true}),
      recentOrders: clone(state.orders.slice(-50).reverse()),
    };
  }

  return {driver: 'file', listPlans, updatePlan, createOrder, getOrderByReference, applyPaymentEvent, accountBilling, deactivateAccount, reserveCredit, consumeReservation, releaseReservation, grantCredit, adminSummary, close: async () => undefined};
}

function rowPlan(row) {
  return {id: row.id, name: row.name, description: row.description, priceCents: row.price_cents, currency: row.currency, maxParticipants: row.max_participants, durationMinutes: row.duration_minutes, creditsPerPurchase: row.credits_per_purchase, billingInterval: row.billing_interval, segment: row.segment || 'event', highlighted: Boolean(row.highlighted), features: row.features || {}, active: row.active, sortOrder: row.sort_order, revision: row.revision};
}

function rowOrder(row) {
  if (!row) return null;
  return {id: row.id, reference: row.reference, accountId: row.account_id, planId: row.plan_id, planRevision: row.plan_revision, planSnapshot: row.plan_snapshot, amountCents: row.amount_cents, currency: row.currency, status: row.status, provider: row.provider, providerTransactionId: row.provider_transaction_id, paymentMethodType: row.payment_method_type, customerEmail: row.customer_email, expiresAt: row.expires_at, approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at};
}

function createPostgresBillingStore({databaseUrl, pool: providedPool}) {
  const pool = providedPool || new Pool({connectionString: databaseUrl, max: 10});
  async function listPlans({includeInactive = false} = {}) {
    const result = await pool.query(`SELECT * FROM billing_plans ${includeInactive ? '' : 'WHERE active = TRUE'} ORDER BY sort_order, price_cents, id`);
    return result.rows.map(rowPlan);
  }
  async function updatePlan(planId, input) {
    const currentResult = await pool.query('SELECT * FROM billing_plans WHERE id = $1', [planId]);
    if (!currentResult.rowCount) throw new Error('El plan no existe');
    const next = normalizePlan(input, rowPlan(currentResult.rows[0]));
    const result = await pool.query(`UPDATE billing_plans SET name=$2, description=$3, price_cents=$4, max_participants=$5, duration_minutes=$6, credits_per_purchase=$7, billing_interval=$8, features=$9, active=$10, sort_order=$11, segment=$12, highlighted=$13, revision=revision+1, updated_at=NOW() WHERE id=$1 RETURNING *`, [planId, next.name, next.description, next.priceCents, next.maxParticipants, next.durationMinutes, next.creditsPerPurchase, next.billingInterval, next.features, next.active, next.sortOrder, next.segment, next.highlighted]);
    return rowPlan(result.rows[0]);
  }
  async function createOrder({accountId, customerEmail, planId, planOverride = null}) {
    let plan;
    if (planOverride) {
      plan = normalizeCustomPlan(planOverride);
      await pool.query(`INSERT INTO billing_plans (id,name,description,price_cents,currency,max_participants,duration_minutes,credits_per_purchase,billing_interval,segment,highlighted,features,active,sort_order,revision) VALUES ($1,$2,$3,$4,'COP',$5,$6,$7,'one_time','event',FALSE,$8,FALSE,20000,1) ON CONFLICT (id) DO NOTHING`, [plan.id, plan.name, plan.description, plan.priceCents, plan.maxParticipants, plan.durationMinutes, plan.creditsPerPurchase, plan.features]);
    } else {
      const plans = await pool.query('SELECT * FROM billing_plans WHERE id=$1 AND active=TRUE', [planId]);
      if (!plans.rowCount) throw new Error('Este plan no está disponible');
      plan = rowPlan(plans.rows[0]);
    }
    const result = await pool.query(`INSERT INTO billing_orders (id,reference,account_id,plan_id,plan_revision,plan_snapshot,amount_cents,currency,customer_email,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'COP',$8,NOW()+INTERVAL '30 minutes') RETURNING *`, [crypto.randomUUID(), checkoutReference(), accountId, plan.id, plan.revision, planSnapshot(plan), plan.priceCents, customerEmail]);
    return rowOrder(result.rows[0]);
  }
  async function getOrderByReference(reference) {
    const result = await pool.query('SELECT * FROM billing_orders WHERE reference=$1', [reference]);
    return rowOrder(result.rows[0]);
  }
  async function applyPaymentEvent(event) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query('SELECT * FROM billing_orders WHERE reference=$1 FOR UPDATE', [event.reference]);
      const order = rowOrder(orderResult.rows[0]);
      const eventInsert = await client.query(`INSERT INTO billing_payment_events (id,provider,event_key,transaction_id,order_id,event_type,status,environment,signature_valid,payload) VALUES ($1,'wompi',$2,$3,$4,$5,$6,$7,TRUE,$8) ON CONFLICT (provider,event_key) DO NOTHING RETURNING id`, [crypto.randomUUID(), event.eventKey, event.transactionId, order?.id || null, event.eventType, event.status, event.environment, event.payload]);
      if (!eventInsert.rowCount) { await client.query('ROLLBACK'); return {duplicate: true, order}; }
      if (!order) throw new Error('La referencia del pago no pertenece a Q Session');
      if (Number(event.amountCents) !== order.amountCents || event.currency !== order.currency) throw new Error('El monto o la moneda del pago no coincide con la orden');
      const status = paymentStatus(event.status);
      const updated = await client.query(`UPDATE billing_orders SET status=$2,provider_transaction_id=$3,payment_method_type=$4,approved_at=CASE WHEN $2='approved' THEN COALESCE(approved_at,NOW()) ELSE approved_at END,updated_at=NOW() WHERE id=$1 RETURNING *`, [order.id, status, event.transactionId, event.paymentMethodType]);
      if (status === 'approved') {
        await client.query(`INSERT INTO billing_credits (id,account_id,plan_id,source_order_id,units_granted,units_remaining,expires_at) VALUES ($1,$2,$3,$4,$5,$5,CASE WHEN ($6->>'billingInterval')='monthly' THEN NOW()+INTERVAL '35 days' ELSE NOW()+INTERVAL '365 days' END) ON CONFLICT (source_order_id) DO NOTHING`, [crypto.randomUUID(), order.accountId, order.planId, order.id, order.planSnapshot.creditsPerPurchase, order.planSnapshot]);
      }
      await client.query('COMMIT');
      return {duplicate: false, order: rowOrder(updated.rows[0])};
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function accountBilling(accountId) {
    const [credits, orders, reservations] = await Promise.all([
      pool.query(`SELECT c.*,to_jsonb(p.*) plan_row FROM billing_credits c JOIN billing_plans p ON p.id=c.plan_id WHERE c.account_id=$1 ORDER BY c.created_at DESC`, [accountId]),
      pool.query('SELECT * FROM billing_orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50', [accountId]),
      pool.query('SELECT * FROM billing_credit_reservations WHERE account_id=$1 ORDER BY reserved_at DESC', [accountId]),
    ]);
    return {plans: await listPlans(), credits: credits.rows.map(row => ({id: row.id, accountId: row.account_id, planId: row.plan_id, sourceOrderId: row.source_order_id, unitsGranted: row.units_granted, unitsRemaining: row.units_remaining, status: row.status, expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at, plan: rowPlan(row.plan_row)})), orders: orders.rows.map(rowOrder), reservations: reservations.rows};
  }
  async function deactivateAccount(accountId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE billing_orders SET customer_email=NULL,updated_at=NOW() WHERE account_id=$1', [accountId]);
      await client.query("UPDATE billing_credits SET units_remaining=0,status='reversed',updated_at=NOW() WHERE account_id=$1", [accountId]);
      await client.query("UPDATE billing_credit_reservations SET status='released',released_at=NOW() WHERE account_id=$1 AND status='reserved'", [accountId]);
      await client.query('COMMIT');
      return {ok: true};
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function reserveCredit({accountId, roomId, roomCode, planId = ''}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM billing_credit_reservations WHERE room_id=$1', [roomId]);
      if (existing.rowCount) { await client.query('COMMIT'); return existing.rows[0]; }
      const result = await client.query(`SELECT * FROM billing_credits WHERE account_id=$1 AND status='available' AND units_remaining>0 AND (expires_at IS NULL OR expires_at>NOW()) AND ($2='' OR plan_id=$2) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`, [accountId, planId]);
      if (!result.rowCount) throw new Error('Necesitas un bono disponible para crear esta sala');
      const credit = result.rows[0];
      await client.query(`UPDATE billing_credits SET units_remaining=units_remaining-1,status=CASE WHEN units_remaining-1=0 THEN 'depleted' ELSE 'available' END,updated_at=NOW() WHERE id=$1`, [credit.id]);
      const reservation = await client.query(`INSERT INTO billing_credit_reservations (id,account_id,credit_id,room_id,room_code) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [crypto.randomUUID(), accountId, credit.id, roomId, roomCode]);
      await client.query('COMMIT');
      return reservation.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function consumeReservation(roomId) {
    const result = await pool.query(`UPDATE billing_credit_reservations SET status='consumed',consumed_at=NOW() WHERE room_id=$1 AND status='reserved' RETURNING *`, [roomId]);
    if (result.rowCount) return result.rows[0];
    const current = await pool.query('SELECT * FROM billing_credit_reservations WHERE room_id=$1', [roomId]);
    if (!current.rowCount) throw new Error('Esta sala no tiene un bono reservado');
    if (current.rows[0].status === 'consumed') return current.rows[0];
    throw new Error('El bono de esta sala ya fue liberado');
  }
  async function releaseReservation(roomId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reservation = await client.query(`UPDATE billing_credit_reservations SET status='released',released_at=NOW() WHERE room_id=$1 AND status='reserved' RETURNING *`, [roomId]);
      if (reservation.rowCount) await client.query(`UPDATE billing_credits SET units_remaining=LEAST(units_granted,units_remaining+1),status='available',updated_at=NOW() WHERE id=$1`, [reservation.rows[0].credit_id]);
      await client.query('COMMIT');
      return reservation.rows[0] || null;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function grantCredit({accountId, planId, units = 1, reason, administrator}) {
    const count = boundedInteger(units, 1, 100, 1); const client = await pool.connect();
    try { await client.query('BEGIN'); const creditId = crypto.randomUUID(); const credit = await client.query(`INSERT INTO billing_credits (id,account_id,plan_id,units_granted,units_remaining) VALUES ($1,$2,$3,$4,$4) RETURNING *`, [creditId, accountId, planId, count]); await client.query(`INSERT INTO billing_adjustments (id,account_id,plan_id,credit_id,units,reason,administrator) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [crypto.randomUUID(), accountId, planId, creditId, count, String(reason || 'Ajuste administrativo').slice(0, 300), administrator]); await client.query('COMMIT'); return credit.rows[0]; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function adminSummary() {
    const [orders, credits, recent] = await Promise.all([pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='approved')::int approved,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status IN ('declined','error','voided'))::int declined,COALESCE(SUM(amount_cents) FILTER(WHERE status='approved'),0)::bigint revenue FROM billing_orders`), pool.query(`SELECT COALESCE(SUM(units_granted),0)::int granted,COALESCE(SUM(units_remaining),0)::int available,(SELECT COUNT(*)::int FROM billing_credit_reservations WHERE status='reserved') reserved,(SELECT COUNT(*)::int FROM billing_credit_reservations WHERE status='consumed') consumed FROM billing_credits`), pool.query('SELECT * FROM billing_orders ORDER BY created_at DESC LIMIT 50')]);
    return {generatedAt: now(), revenueCents: Number(orders.rows[0].revenue), orders: orders.rows[0], credits: credits.rows[0], plans: await listPlans({includeInactive: true}), recentOrders: recent.rows.map(rowOrder)};
  }
  return {driver: 'postgres', listPlans, updatePlan, createOrder, getOrderByReference, applyPaymentEvent, accountBilling, deactivateAccount, reserveCredit, consumeReservation, releaseReservation, grantCredit, adminSummary, close: async () => { if (!providedPool) await pool.end(); }};
}

function createBillingStore(options = {}) {
  return options.databaseUrl
    ? createPostgresBillingStore(options)
    : createFileBillingStore({filePath: options.filePath});
}

module.exports = {DEFAULT_PLAN, DEFAULT_PLANS, createBillingStore, normalizePlan, normalizeCustomPlan, planSnapshot, paymentStatus};
