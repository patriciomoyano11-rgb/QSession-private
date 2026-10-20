'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createQsessionServer} = require('../server');

async function request(url, {method = 'GET', body, cookie} = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? {'content-type': 'application/json'} : {}),
      ...(cookie ? {cookie} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {response, payload: await response.json().catch(() => ({}))};
}

async function lifecycleApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-account-lifecycle-'));
  const messages = [];
  const accountMailer = {
    configured: true,
    provider: 'test',
    async sendPasswordRecovery(message) { messages.push({type: 'recovery', ...message}); },
    async sendPasswordChanged(message) { messages.push({type: 'changed', ...message}); },
  };
  const app = createQsessionServer({
    port: 0,
    dataFile: path.join(directory, 'state.json'),
    billingDataFile: path.join(directory, 'billing.json'),
    analyticsDataFile: path.join(directory, 'analytics.ndjson'),
    mediaDirectory: path.join(directory, 'profile-media'),
    privateMediaDirectory: path.join(directory, 'private-media'),
    promotionMediaDirectory: path.join(directory, 'promotion-media'),
    publicUrl: 'https://qsession.example',
    roomSecret: 'test-room-secret-with-enough-entropy',
    authPepper: 'test-auth-pepper-with-enough-entropy',
    accountMailer,
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  return {
    ...app,
    messages,
    baseUrl: `http://127.0.0.1:${app.server.address().port}`,
    close: async () => {
      await new Promise(resolve => app.server.close(resolve));
      fs.rmSync(directory, {recursive: true, force: true});
    },
  };
}

test('publica la política de privacidad y una eliminación de cuenta accesible fuera de la app', async () => {
  const app = await lifecycleApp();
  try {
    const privacy = await fetch(`${app.baseUrl}/privacidad.html`);
    assert.equal(privacy.status, 200);
    assert.match(privacy.headers.get('content-type'), /text\/html/);
    assert.match(await privacy.text(), /Tus datos siguen siendo tuyos/);

    const deletion = await fetch(`${app.baseUrl}/eliminar-cuenta.html`);
    assert.equal(deletion.status, 200);
    const deletionPage = await deletion.text();
    assert.match(deletionPage, /Eliminar tu cuenta Q Session/);
    assert.match(deletionPage, /deletionLoginForm/);

    const deletionScript = await fetch(`${app.baseUrl}/eliminar-cuenta.js`);
    assert.equal(deletionScript.status, 200);
    assert.match(await deletionScript.text(), /\/api\/account/);
  } finally {
    await app.close();
  }
});

test('recuperación por correo cambia la contraseña, invalida sesiones anteriores y no filtra cuentas', async () => {
  const app = await lifecycleApp();
  try {
    const registered = await request(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'persona@example.com', password: 'contraseña-segura-123', displayName: 'Persona', remember: false},
    });
    assert.equal(registered.response.status, 201);
    assert.doesNotMatch(registered.response.headers.get('set-cookie'), /Max-Age=/i, 'una sesión no recordada debe ser una cookie de sesión');
    const originalCookie = registered.response.headers.get('set-cookie').split(';')[0];

    const missing = await request(`${app.baseUrl}/api/auth/recovery/request`, {
      method: 'POST', body: {email: 'nadie@example.com'},
    });
    assert.equal(missing.response.status, 202);
    assert.match(missing.payload.message, /Si existe una cuenta/);
    assert.equal(app.messages.length, 0);

    const requested = await request(`${app.baseUrl}/api/auth/recovery/request`, {
      method: 'POST', body: {email: 'persona@example.com'},
    });
    assert.equal(requested.response.status, 202);
    assert.equal(app.messages[0].type, 'recovery');
    assert.match(app.messages[0].code, /^\d{6}$/);

    const wrong = await request(`${app.baseUrl}/api/auth/recovery/reset`, {
      method: 'POST', body: {email: 'persona@example.com', code: '999999', newPassword: 'otra-contraseña-segura'},
    });
    assert.equal(wrong.response.status, 400);
    assert.match(wrong.payload.error, /no es válido o ya venció/);

    const reset = await request(`${app.baseUrl}/api/auth/recovery/reset`, {
      method: 'POST',
      body: {email: 'persona@example.com', code: app.messages[0].code, newPassword: 'otra-contraseña-segura', remember: true},
    });
    assert.equal(reset.response.status, 200);
    assert.match(reset.response.headers.get('set-cookie'), /Max-Age=2592000/i);
    const resetCookie = reset.response.headers.get('set-cookie').split(';')[0];

    const oldSession = await request(`${app.baseUrl}/api/account`, {cookie: originalCookie});
    assert.equal(oldSession.response.status, 401, 'cambiar contraseña debe cerrar todas las sesiones anteriores');
    const oldPassword = await request(`${app.baseUrl}/api/auth/login`, {
      method: 'POST', body: {email: 'persona@example.com', password: 'contraseña-segura-123'},
    });
    assert.equal(oldPassword.response.status, 401);
    const reusedCode = await request(`${app.baseUrl}/api/auth/recovery/reset`, {
      method: 'POST', body: {email: 'persona@example.com', code: app.messages[0].code, newPassword: 'tercera-contraseña-segura'},
    });
    assert.equal(reusedCode.response.status, 400, 'el código debe servir una sola vez');
    const account = await request(`${app.baseUrl}/api/account`, {cookie: resetCookie});
    assert.equal(account.response.status, 200);
  } finally {
    await app.close();
  }
});

test('la persona descarga sus datos y puede eliminar definitivamente la cuenta con reautenticación', async () => {
  const app = await lifecycleApp();
  try {
    const registered = await request(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'privacidad@example.com', password: 'contraseña-segura-123', displayName: 'Privacidad', remember: true},
    });
    const cookie = registered.response.headers.get('set-cookie').split(';')[0];
    const exported = await request(`${app.baseUrl}/api/account/export`, {cookie});
    assert.equal(exported.response.status, 200);
    assert.match(exported.response.headers.get('content-disposition'), /qsession-mis-datos-/);
    assert.equal(exported.payload.account.email, 'privacidad@example.com');
    const serialized = JSON.stringify(exported.payload);
    assert.doesNotMatch(serialized, /passwordHash|tokenHash|codeHash|authPepper/);

    const unconfirmed = await request(`${app.baseUrl}/api/account`, {
      method: 'DELETE', cookie, body: {password: 'contraseña-segura-123', confirmation: 'NO'},
    });
    assert.equal(unconfirmed.response.status, 400);
    const wrongPassword = await request(`${app.baseUrl}/api/account`, {
      method: 'DELETE', cookie, body: {password: 'incorrecta-segura-123', confirmation: 'ELIMINAR'},
    });
    assert.equal(wrongPassword.response.status, 400);

    const deleted = await request(`${app.baseUrl}/api/account`, {
      method: 'DELETE', cookie, body: {password: 'contraseña-segura-123', confirmation: 'ELIMINAR'},
    });
    assert.equal(deleted.response.status, 200);
    assert.match(deleted.response.headers.get('set-cookie'), /Max-Age=0/);
    assert.ok(deleted.payload.deletedAt);
    assert.equal((await request(`${app.baseUrl}/api/account`, {cookie})).response.status, 401);
    assert.equal((await request(`${app.baseUrl}/api/auth/login`, {
      method: 'POST', body: {email: 'privacidad@example.com', password: 'contraseña-segura-123'},
    })).response.status, 401);

    const recreated = await request(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      body: {email: 'privacidad@example.com', password: 'contraseña-nueva-456', displayName: 'Cuenta nueva'},
    });
    assert.equal(recreated.response.status, 201, 'el correo debe poder usarse en una cuenta nueva luego de eliminar la anterior');
  } finally {
    await app.close();
  }
});
