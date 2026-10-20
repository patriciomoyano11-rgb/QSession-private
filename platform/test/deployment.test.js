'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {createDeployment} = require('../deploy/render-config');

const DEPLOY = path.join(__dirname, '..', 'deploy');
const fixedSecrets = {
  livekitApiKey: 'QSESSION_API_TEST',
  livekitApiSecret: 'media-secret',
  authPepper: 'auth-secret',
  roomSecret: 'room-secret',
  analyticsSecret: 'analytics-secret',
  adminSessionSecret: 'admin-session-secret',
};

test('genera credenciales y dominios exclusivos de Q Session', () => {
  const deployment = createDeployment('qsession.example', fixedSecrets);
  const environment = deployment.files['qsession.env'];
  const livekit = deployment.files['livekit.yaml'];
  const egress = deployment.files['egress.yaml'];
  assert.match(environment, /QSESSION_PUBLIC_URL=https:\/\/qsession\.example/);
  assert.match(environment, /QSESSION_PUBLIC_ROOMS_ENABLED=true/);
  assert.match(environment, /LIVEKIT_PUBLIC_URL=wss:\/\/media\.qsession\.example/);
  assert.match(environment, /LIVEKIT_API_KEY=QSESSION_API_TEST/);
  assert.match(livekit, /QSESSION_API_TEST: media-secret/);
  assert.match(livekit, /domain: turn\.qsession\.example/);
  assert.match(egress, /ws_url: ws:\/\/127\.0\.0\.1:7880/);
  assert.match(egress, /QSESSION_API_TEST/);
  assert.match(egress, /segment_output_max_duration: 6h/);
  assert.match(environment, /QSESSION_EDGE_PLAYBACK_BASE_URL=https:\/\/live\.qsession\.example/);
  assert.match(environment, /QSESSION_BROADCAST_PROVIDER=cloudflare-r2-hls/);
  assert.match(environment, /QSESSION_BROADCAST_STORAGE_BUCKET=qsession-live/);
  assert.match(environment, /QSESSION_BROADCAST_FORCE_PATH_STYLE=true/);
  assert.match(environment, /QSESSION_BROADCAST_STORAGE_PLAYBACK_BASE_URL=https:\/\/live\.qsession\.example/);
  assert.match(environment, /QSESSION_BROADCAST_LOCAL_PLAYBACK_BASE_URL=https:\/\/qsession\.example/);
  assert.match(environment, /QSESSION_EGRESS_OUTPUT_DIRECTORY=\/out\/edge-live/);
  assert.match(environment, /QSESSION_HLS_SEGMENT_SECONDS=6/);
  assert.match(environment, /QSESSION_HLS_VIDEO_BITRATE=1600000/);
});

test('el Worker de R2 cachea playlists brevemente y segmentos durante su vida útil', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'edge', 'hls-worker.js'), 'utf8');
  assert.match(worker, /caches\.default/);
  assert.match(worker, /s-maxage=2/);
  assert.match(worker, /max-age=86400, immutable/);
  assert.match(worker, /X-QSession-Edge-Cache/);
});

test('la pila de Q Session contiene todos sus servicios y volúmenes propios', () => {
  const compose = fs.readFileSync(path.join(DEPLOY, 'compose.yml'), 'utf8');
  const script = fs.readFileSync(path.join(DEPLOY, 'deploy.sh'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  const dockerignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');
  assert.match(compose, /qsession-app:/);
  assert.match(compose, /livekit:/);
  assert.match(compose, /egress:[\s\S]*livekit\/egress:v1\.14\.1/);
  assert.match(compose, /egress:[\s\S]*cap_add:[\s\S]*SYS_ADMIN/);
  assert.match(compose, /qsession-edge-live:\/out\/edge-live/);
  assert.match(compose, /qsession-edge-live:\/data\/edge-live/);
  assert.match(compose, /redis:/);
  assert.match(compose, /postgres:/);
  assert.match(compose, /nofile:[\s\S]*65535/);
  assert.match(compose, /qsession-data:\/data/);
  assert.match(script, /docker compose -f compose\.yml up -d --build/);
  assert.match(dockerfile, /global-rave-presence\.js/);
  assert.match(dockerfile, /realtime-hub\.js/);
  assert.match(dockerfile, /direct-video-upload\.js/);
  assert.match(dockerfile, /edge-broadcast\.js/);
  assert.match(dockerfile, /billing-store\.js/);
  assert.match(dockerfile, /custom-room-pricing\.js/);
  assert.match(dockerfile, /wompi\.js/);
  assert.match(dockerignore, /!public\/downloads\/QSession-Android-0\.1\.42\.apk/);
  assert.match(dockerignore, /!public\/downloads\/Instalar-QSession-Windows\.exe/);
  assert.match(dockerfile, /node scripts\/migrate\.js && exec node server\.js/);
  assert.match(`${compose}\n${script}`, /Q Session|qsession/);
});

test('las compilaciones móviles y Windows actualizan un único catálogo de descargas', () => {
  const updater = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'update-app-release.cjs'), 'utf8');
  const android = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'android', 'publish-release.ps1'), 'utf8');
  const windows = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'windows', 'build.ps1'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(updater, /No se puede reemplazar/);
  assert.match(updater, /sha256/);
  assert.match(updater, /QSession-Android-latest\.apk/);
  assert.match(updater, /QSession-Windows-latest\.exe/);
  assert.match(android, /assembleRelease/);
  assert.match(android, /update-app-release\.cjs'\) android/);
  assert.match(windows, /update-app-release\.cjs'\) windows/);
  assert.doesNotMatch(serviceWorker, /app-releases\.json/);
});
