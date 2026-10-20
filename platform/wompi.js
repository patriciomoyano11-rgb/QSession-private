'use strict';

const crypto = require('node:crypto');

function safeEqual(left, right) {
  const a = Buffer.from(String(left || '').toLowerCase());
  const b = Buffer.from(String(right || '').toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function nestedValue(source, property) {
  return String(property || '').split('.').reduce((value, key) => value?.[key], source);
}

function createWompiGateway({publicKey = '', integritySecret = '', eventsSecret = '', checkoutBaseUrl = 'https://checkout.wompi.co/p/'} = {}) {
  const key = String(publicKey).trim();
  const integrity = String(integritySecret).trim();
  const events = String(eventsSecret).trim();
  const environment = key.startsWith('pub_prod_') ? 'prod' : 'test';
  const checkoutConfigured = /^pub_(?:test|prod)_/.test(key) && /^(?:test|prod)_integrity_/.test(integrity);
  const eventsConfigured = /^(?:test|prod)_events_/.test(events);

  function checkout(order, {redirectUrl, customerEmail = '', customerName = ''} = {}) {
    if (!checkoutConfigured) throw new Error('Wompi todavía no tiene llaves de checkout configuradas');
    const expiresAt = new Date(order.expiresAt).toISOString();
    const signature = sha256(`${order.reference}${order.amountCents}${order.currency}${expiresAt}${integrity}`);
    const params = new URLSearchParams({
      'public-key': key,
      currency: order.currency,
      'amount-in-cents': String(order.amountCents),
      reference: order.reference,
      'signature:integrity': signature,
      'expiration-time': expiresAt,
    });
    if (redirectUrl) params.set('redirect-url', redirectUrl);
    if (customerEmail) params.set('customer-data:email', String(customerEmail).slice(0, 254));
    if (customerName) params.set('customer-data:full-name', String(customerName).trim().slice(0, 120));
    return {url: `${checkoutBaseUrl}?${params}`, signature, expiresAt, environment};
  }

  function verifyEvent(payload, headerChecksum = '') {
    if (!eventsConfigured) throw new Error('Wompi todavía no tiene el secreto de eventos configurado');
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.signature?.properties)) return false;
    const values = payload.signature.properties.map(property => nestedValue(payload.data, property));
    if (values.some(value => value === undefined || value === null)) return false;
    const calculated = sha256(`${values.map(String).join('')}${payload.timestamp}${events}`);
    const supplied = headerChecksum || payload.signature.checksum;
    return safeEqual(calculated, supplied);
  }

  function normalizeTransactionEvent(payload) {
    const transaction = payload?.data?.transaction;
    if (payload?.event !== 'transaction.updated' || !transaction?.id || !transaction?.reference) {
      throw new Error('El evento de Wompi no contiene una transacción válida');
    }
    return {
      eventKey: `${transaction.id}:${String(transaction.status || '').toUpperCase()}`,
      eventType: payload.event,
      transactionId: String(transaction.id),
      reference: String(transaction.reference),
      status: String(transaction.status || '').toUpperCase(),
      amountCents: Number(transaction.amount_in_cents),
      currency: String(transaction.currency || '').toUpperCase(),
      paymentMethodType: String(transaction.payment_method_type || '').slice(0, 40) || null,
      environment: String(payload.environment || ''),
      payload,
    };
  }

  return {
    provider: 'wompi', environment, checkoutConfigured, eventsConfigured,
    configured: checkoutConfigured && eventsConfigured,
    checkout, verifyEvent, normalizeTransactionEvent,
  };
}

module.exports = {createWompiGateway, nestedValue, sha256};
