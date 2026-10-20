'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function encode(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function readServiceAccount({json = '', filePath = ''} = {}) {
  try {
    const source = String(json || '').trim() || (filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
    if (!source) return null;
    const account = JSON.parse(source);
    return account.project_id && account.client_email && account.private_key ? account : null;
  } catch {
    return null;
  }
}

function createFirebasePushProvider(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const serviceAccount = options.serviceAccount || readServiceAccount({
    json: options.serviceAccountJson,
    filePath: options.serviceAccountFile,
  });
  let cachedAccessToken = '';
  let accessTokenExpiresAt = 0;

  async function accessToken() {
    if (!serviceAccount) throw new Error('Firebase Cloud Messaging no está configurado');
    if (cachedAccessToken && accessTokenExpiresAt > Date.now() + 60_000) return cachedAccessToken;
    const issuedAt = Math.floor(Date.now() / 1000);
    const assertionBody = `${encode({alg: 'RS256', typ: 'JWT'})}.${encode({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3600,
    })}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(assertionBody), serviceAccount.private_key).toString('base64url');
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${assertionBody}.${signature}`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new Error('Firebase rechazó la credencial de envío');
    cachedAccessToken = payload.access_token;
    accessTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return cachedAccessToken;
  }

  async function send(token, data) {
    const authorization = await accessToken();
    const response = await fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authorization}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? '').slice(0, 500)])),
            android: {priority: 'high', ttl: data.type === 'call' ? '60s' : '86400s'},
          },
        }),
      },
    );
    if (!response.ok) {
      if (response.status === 401) {
        cachedAccessToken = '';
        accessTokenExpiresAt = 0;
      }
      throw new Error(`Firebase no entregó la notificación (${response.status})`);
    }
    return true;
  }

  async function sendToTokens(tokens, data) {
    if (!serviceAccount) return {configured: false, attempted: 0, delivered: 0};
    const uniqueTokens = [...new Set((tokens || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 1000);
    const results = await Promise.allSettled(uniqueTokens.map(token => send(token, data)));
    return {
      configured: true,
      attempted: uniqueTokens.length,
      delivered: results.filter(result => result.status === 'fulfilled').length,
    };
  }

  return {configured: Boolean(serviceAccount), sendToTokens};
}

module.exports = {createFirebasePushProvider, readServiceAccount};
