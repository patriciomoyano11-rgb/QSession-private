'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createQsessionServer} = require('../server');

async function startAdminPlatform() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsession-admin-test-'));
  const app = createQsessionServer({
    port: 0,
    dataFile: path.join(directory, 'state.json'),
    analyticsDataFile: path.join(directory, 'analytics.ndjson'),
    mediaDirectory: path.join(directory, 'media'),
    privateMediaDirectory: path.join(directory, 'private-media'),
    publicUrl: 'https://qsession.org',
    roomSecret: 'room-secret-with-enough-entropy',
    authPepper: 'auth-pepper-with-enough-entropy',
    analyticsSecret: 'analytics-secret-with-enough-entropy',
    adminUsername: 'maria',
    adminPassword: 'test-admin-secret-2026',
    adminRecoveryCode: 'QSESSION-RECOVERY-TEST-2026',
    adminCredentialFile: path.join(directory, 'admin-credential.json'),
    adminSessionSecret: 'admin-session-secret-with-enough-entropy',
    originalMusicDirectory: path.join(directory, 'original-music'),
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  return {
    ...app,
    directory,
    baseUrl: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return {response, payload};
}

test('el panel administrativo separa web, Android y Windows sin recopilar contenido personal', async () => {
  const app = await startAdminPlatform();
  try {
    const adminResponse = await fetch(`${app.baseUrl}/admin`);
    const adminPage = await adminResponse.text();
    assert.match(adminPage, /Panel administrativo/);
    assert.match(adminPage, /id="adminUsername"/);
    assert.match(adminPage, /id="adminPassword"/);
    assert.match(adminPage, /id="adminRecoveryOpen"/);
    assert.match(adminPage, /id="adminRecoveryForm"/);
    assert.match(adminPage, /Actividad por versión/);
    assert.match(adminPage, /id="musicAdminTitle">Biblioteca musical/);
    assert.match(adminPage, /id="adminMusicSection" class="admin-section admin-music-section"/);
    assert.match(adminPage, /id="adminCommunitySection" class="admin-section"/);
    assert.match(adminPage, /id="adminStarsSection" class="admin-section"/);
    assert.match(adminPage, /Usuarios y salas/);
    assert.match(adminPage, /Pagos, planes y bonos/);
    assert.match(adminPage, /Estrellas y beneficios/);
    assert.match(adminPage, /data-open-music data-import-music><span aria-hidden="true">＋<\/span> Agregar música/);
    assert.match(adminPage, /id="adminMusicGenre"/);
    assert.match(adminPage, /id="adminMusicEditor"/);
    assert.match(adminPage, /id="adminMusicDeleteDialog"/);
    assert.match(adminPage, /\/music-library\.css\?v=20261008-live-dj-v1/);
    assert.match(adminPage, /\/qsession-sky-palette\.css\?v=20261016-sky-palette-v1/);
    assert.match(adminPage, /\/qdj-request\.js\?v=20261010-semantic-intent-v1/);
    assert.match(adminPage, /\/dj-mixer\.js\?v=20261016-autodj-calibration-v2/);
    assert.match(adminPage, /\/music-library\.js\?v=20261016-autodj-calibration-v2/);
    assert.equal(adminResponse.headers.get('x-frame-options'), 'DENY');
    assert.equal(adminResponse.headers.get('cache-control'), 'no-store');
    assert.match(adminResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);

    const adminStyles = await (await fetch(`${app.baseUrl}/admin.css`)).text();
    assert.match(adminStyles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
    assert.match(adminStyles, /\.music-admin-launch\s*\{/);
    assert.match(adminStyles, /\.admin-section\s*\{/);
    assert.match(adminStyles, /\.music-genre-groups\s*\{/);
    const adminScript = await (await fetch(`${app.baseUrl}/admin.js`)).text();
    assert.match(adminScript, /\$\{number\(value\)\} eventos/);
    assert.match(adminScript, /async function loadAdminMusic\(\)/);
    assert.match(adminScript, /data-delete-track/);
    assert.match(adminScript, /function syncAdminSectionNavigation\(\)/);
    assert.match(adminScript, /other\.open = false/);
    const musicScript = await (await fetch(`${app.baseUrl}/music-library.js`)).text();
    assert.match(musicScript, /const standaloneAdmin = !appViewHost/);
    assert.match(musicScript, /standaloneAdmin&&control\.hasAttribute\('data-import-music'\)/);
    assert.doesNotMatch(musicScript, /\$\('view-live'\)\.parentElement\.append/);

    const anonymousSummary = await request(`${app.baseUrl}/api/admin/analytics`);
    assert.equal(anonymousSummary.response.status, 401);
    assert.equal((await fetch(`${app.baseUrl}/api/admin/music/tracks`)).status, 401);

    const badLogin = await request(`${app.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({username: 'maria', password: 'incorrect-password'}),
    });
    assert.equal(badLogin.response.status, 401);

    const login = await request(`${app.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({username: 'maria', password: 'test-admin-secret-2026'}),
    });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    assert.match(login.response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.response.headers.get('set-cookie'), /SameSite=Strict/);
    const emptyMusic = await request(`${app.baseUrl}/api/admin/music/tracks`, {headers: {cookie}});
    assert.equal(emptyMusic.response.status, 200);
    assert.deepEqual(emptyMusic.payload.tracks, []);

    const collection = await request(`${app.baseUrl}/api/analytics/collect`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({events: [
        {name: 'session_start', clientId: 'web-user', sessionId: 'web-session', surface: 'web', path: '/'},
        {name: 'page_view', clientId: 'web-user', sessionId: 'web-session', surface: 'web', path: '/', feature: 'route:live'},
        {name: 'feature_use', clientId: 'android-user', sessionId: 'android-session', surface: 'android', version: '0.1.20', feature: 'control:shareRoomInvitation'},
        {name: 'network_sample', clientId: 'android-user', sessionId: 'android-session', surface: 'android', version: '0.1.20', network: {online: true, rttMs: 80, packetLossPercent: 0.4, downloadBps: 256000}},
        {name: 'heartbeat', clientId: 'windows-user', sessionId: 'windows-session', surface: 'windows', version: '0.4.2', network: {online: true, downlinkMbps: 25}},
      ]}),
    });
    assert.equal(collection.response.status, 202);
    assert.equal(collection.payload.accepted, 5);

    const stored = fs.readFileSync(path.join(app.directory, 'analytics.ndjson'), 'utf8');
    assert.doesNotMatch(stored, /web-user|android-user|windows-user/);
    assert.doesNotMatch(stored, /incorrect-password|test-admin-secret/);

    const summary = await request(`${app.baseUrl}/api/admin/analytics?days=30`, {headers: {cookie}});
    assert.equal(summary.response.status, 200);
    assert.equal(summary.payload.analytics.overview.visitors, 3);
    assert.equal(summary.payload.analytics.overview.sessions, 3);
    assert.equal(summary.payload.analytics.overview.pageViews, 1);
    assert.deepEqual(summary.payload.analytics.surfaces.map(surface => [surface.name, surface.visitors]), [
      ['web', 1],
      ['android', 1],
      ['windows', 1],
    ]);
    assert.equal(summary.payload.analytics.network.averageRttMs, 80);
    assert.equal(summary.payload.analytics.network.averagePacketLossPercent, 0.4);
    const androidSurface = summary.payload.analytics.surfaces.find(surface => surface.name === 'android');
    assert.equal(androidSurface.network.averageRttMs, 80);
    assert.equal(androidSurface.features[0].name, 'control:shareRoomInvitation');
    assert.equal(summary.payload.analytics.features[0].name, 'control:shareRoomInvitation');
    assert.equal(summary.payload.analytics.versions[0].name, 'android 0.1.20');

    const logout = await request(`${app.baseUrl}/api/admin/logout`, {method: 'POST', headers: {cookie}});
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
  }
});

test('la recuperación administrativa cambia la contraseña y sólo persiste su hash', async () => {
  const app = await startAdminPlatform();
  try {
    const badRecovery = await request(`${app.baseUrl}/api/admin/recover`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        username: 'maria',
        recoveryCode: 'incorrect-recovery-code',
        newPassword: 'new-admin-password-2026',
      }),
    });
    assert.equal(badRecovery.response.status, 401);

    const shortPassword = await request(`${app.baseUrl}/api/admin/recover`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        username: 'maria',
        recoveryCode: 'QSESSION-RECOVERY-TEST-2026',
        newPassword: 'short',
      }),
    });
    assert.equal(shortPassword.response.status, 400);

    const recovery = await request(`${app.baseUrl}/api/admin/recover`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        username: 'maria',
        recoveryCode: 'QSESSION-RECOVERY-TEST-2026',
        newPassword: 'new-admin-password-2026',
      }),
    });
    assert.equal(recovery.response.status, 200);

    const oldLogin = await request(`${app.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({username: 'maria', password: 'test-admin-secret-2026'}),
    });
    assert.equal(oldLogin.response.status, 401);

    const newLogin = await request(`${app.baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({username: 'maria', password: 'new-admin-password-2026'}),
    });
    assert.equal(newLogin.response.status, 200);

    const stored = fs.readFileSync(path.join(app.directory, 'admin-credential.json'), 'utf8');
    assert.match(stored, /"passwordHash":"scrypt\$/);
    assert.doesNotMatch(stored, /new-admin-password|QSESSION-RECOVERY-TEST/);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
  }
});
