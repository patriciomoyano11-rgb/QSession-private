'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
}

function validateBaseDomain(value) {
  const domain = normalizeDomain(value);
  if (!DOMAIN_PATTERN.test(domain)) throw new Error('Escribe un dominio válido, por ejemplo qsession.org.');
  return domain;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function createSecrets() {
  return {
    livekitApiKey: `QSESSION${crypto.randomBytes(12).toString('hex').toUpperCase()}`,
    livekitApiSecret: randomToken(36),
    authPepper: randomToken(32),
    roomSecret: randomToken(32),
    analyticsSecret: randomToken(32),
    adminSessionSecret: randomToken(32),
    databasePassword: randomToken(32),
  };
}

function renderEnvironment(domains, secrets) {
  const databasePassword = secrets.databasePassword || randomToken(32);
  return [
    '# Generado por Q Session. Contiene secretos: no compartir ni publicar.',
    'NODE_ENV=production',
    'QSESSION_PORT=8090',
    `QSESSION_PUBLIC_URL=https://${domains.apex}`,
    'QSESSION_PUBLIC_ROOMS_ENABLED=true',
    'QSESSION_STORAGE_DRIVER=hybrid',
    'QSESSION_DATA_FILE=/data/qsession-state.json',
    'QSESSION_PROFILE_MEDIA_DIR=/data/profile-media',
    'QSESSION_PRIVATE_MEDIA_DIR=/data/private-media',
    'QSESSION_PROMOTION_MEDIA_DIR=/data/promotion-media',
    'QSESSION_ANALYTICS_DATA_FILE=/data/qsession-analytics.ndjson',
    'POSTGRES_DB=qsession',
    'POSTGRES_USER=qsession',
    `POSTGRES_PASSWORD=${databasePassword}`,
    `QSESSION_DATABASE_URL=postgresql://qsession:${databasePassword}@127.0.0.1:5432/qsession`,
    'QSESSION_DATABASE_POOL_SIZE=20',
    'QSESSION_REDIS_URL=redis://127.0.0.1:6379',
    'QSESSION_ROOM_TARGET_CAPACITY=5000',
    'QSESSION_REALTIME_MAX_CONNECTIONS=6000',
    'QSESSION_DJ_CAMERA_LIMIT=3',
    `QSESSION_AUTH_PEPPER=${secrets.authPepper}`,
    `QSESSION_ROOM_SECRET=${secrets.roomSecret}`,
    `QSESSION_ANALYTICS_SECRET=${secrets.analyticsSecret}`,
    `QSESSION_ADMIN_SESSION_SECRET=${secrets.adminSessionSecret}`,
    'QSESSION_ADMIN_USERNAME=',
    'QSESSION_ADMIN_PASSWORD_HASH=',
    'LIVEKIT_URL=http://127.0.0.1:7880',
    `LIVEKIT_PUBLIC_URL=wss://${domains.media}`,
    `LIVEKIT_API_KEY=${secrets.livekitApiKey}`,
    `LIVEKIT_API_SECRET=${secrets.livekitApiSecret}`,
    '# R2 es la ruta económica principal. Si faltan sus credenciales, Q Session',
    '# conserva temporalmente el origen local y los oyentes aún tienen WebRTC.',
    'QSESSION_BROADCAST_PROVIDER=cloudflare-r2-hls',
    'QSESSION_EDGE_MEDIA_DIR=/data/edge-live',
    'QSESSION_EGRESS_OUTPUT_DIRECTORY=/out/edge-live',
    'QSESSION_EDGE_PLAYBACK_PATH_PREFIX=edge-live',
    '# Variables heredadas para instalaciones anteriores.',
    'QSESSION_EDGE_PLAYBACK_MANIFEST_SUFFIX=',
    '# Cloudflare R2: una sola copia HLS, egreso sin cargo y ciclo de vida de 24 horas.',
    'QSESSION_BROADCAST_STORAGE_ENDPOINT=',
    'QSESSION_BROADCAST_STORAGE_BUCKET=qsession-live',
    'QSESSION_BROADCAST_STORAGE_ACCESS_KEY=',
    'QSESSION_BROADCAST_STORAGE_SECRET_KEY=',
    'QSESSION_BROADCAST_STORAGE_REGION=us-east-1',
    'QSESSION_BROADCAST_FORCE_PATH_STYLE=true',
    `QSESSION_BROADCAST_STORAGE_PLAYBACK_BASE_URL=https://${domains.live}`,
    'QSESSION_BROADCAST_STORAGE_PLAYBACK_PATH_PREFIX=',
    'QSESSION_BROADCAST_STORAGE_PLAYBACK_MANIFEST_SUFFIX=',
    '# Respaldo directo: sólo se usa mientras R2 no esté completamente configurado.',
    `QSESSION_BROADCAST_LOCAL_PLAYBACK_BASE_URL=https://${domains.apex}`,
    'QSESSION_BROADCAST_LOCAL_PLAYBACK_PATH_PREFIX=edge-live',
    'QSESSION_BROADCAST_LOCAL_PLAYBACK_MANIFEST_SUFFIX=',
    `QSESSION_EDGE_PLAYBACK_BASE_URL=https://${domains.live}`,
    '# Seis segundos reducen 33% las solicitudes sin perder la experiencia en vivo.',
    'QSESSION_HLS_SEGMENT_SECONDS=6',
    'QSESSION_HLS_VIDEO_BITRATE=1600000',
    'QSESSION_HLS_AUDIO_BITRATE=128000',
    '',
  ].join('\n');
}

function renderLiveKit(domains, secrets) {
  return [
    'port: 7880',
    'bind_addresses:',
    '  - "0.0.0.0"',
    'rtc:',
    '  tcp_port: 7881',
    '  port_range_start: 50000',
    '  port_range_end: 60000',
    '  use_external_ip: true',
    'redis:',
    '  address: 127.0.0.1:6379',
    'keys:',
    `  ${secrets.livekitApiKey}: ${secrets.livekitApiSecret}`,
    'turn:',
    '  enabled: true',
    `  domain: ${domains.turn}`,
    '  external_tls: true',
    '  tls_port: 5349',
    '  udp_port: 3478',
    'logging:',
    '  level: info',
    '  json: false',
    '',
  ].join('\n');
}

function renderEgress(secrets) {
  return [
    `api_key: ${secrets.livekitApiKey}`,
    `api_secret: ${secrets.livekitApiSecret}`,
    'ws_url: ws://127.0.0.1:7880',
    'redis:',
    '  address: 127.0.0.1:6379',
    'health_port: 8081',
    'prometheus_port: 9091',
    'log_level: info',
    'session_limits:',
    '  segment_output_max_duration: 6h',
    '',
  ].join('\n');
}

function renderCaddy(domains) {
  return `logging:
  logs:
    default:
      level: INFO
storage:
  module: file_system
  root: /data
apps:
  tls:
    certificates:
      automate:
        - ${domains.apex}
        - ${domains.www}
        - ${domains.media}
        - ${domains.turn}
  layer4:
    servers:
      main:
        listen: [":443"]
        routes:
          - match:
              - tls:
                  sni: ["${domains.turn}"]
            handle:
              - handler: tls
              - handler: proxy
                upstreams:
                  - dial: ["localhost:5349"]
          - match:
              - tls:
                  sni: ["${domains.media}"]
            handle:
              - handler: tls
                connection_policies:
                  - alpn: ["http/1.1"]
              - handler: proxy
                upstreams:
                  - dial: ["localhost:7880"]
          - match:
              - tls:
                  sni: ["${domains.apex}", "${domains.www}"]
            handle:
              - handler: tls
                connection_policies:
                  - alpn: ["http/1.1"]
              - handler: proxy
                upstreams:
                  - dial: ["localhost:8090"]
`;
}

function createDeployment(baseDomain, secrets = createSecrets()) {
  const apex = validateBaseDomain(baseDomain);
  const domains = {apex, www: `www.${apex}`, media: `media.${apex}`, turn: `turn.${apex}`, live: `live.${apex}`};
  return {
    domains,
    files: {
      'qsession.env': renderEnvironment(domains, secrets),
      'livekit.yaml': renderLiveKit(domains, secrets),
      'egress.yaml': renderEgress(secrets),
      'caddy.yaml': renderCaddy(domains),
    },
  };
}

function writeDeployment(outputDirectory, deployment, {force = false} = {}) {
  for (const [name, contents] of Object.entries(deployment.files)) {
    const target = path.join(outputDirectory, name);
    if (!force && fs.existsSync(target)) throw new Error(`${name} ya existe; no se reemplazaron las credenciales.`);
    fs.writeFileSync(target, contents, {encoding: 'utf8', mode: 0o600, flag: force ? 'w' : 'wx'});
    fs.chmodSync(target, 0o600);
  }
}

function parseArguments(argv) {
  const args = {force: false};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--domain') args.domain = argv[++index];
    else if (argv[index] === '--force') args.force = true;
    else throw new Error(`Opción desconocida: ${argv[index]}`);
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (!args.domain) throw new Error('Uso: node render-config.js --domain qsession.org [--force]');
    const deployment = createDeployment(args.domain);
    writeDeployment(__dirname, deployment, {force: args.force});
    console.log('Configuración privada e independiente de Q Session creada.');
  } catch (error) {
    console.error(`No se pudo preparar Q Session: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {createDeployment, createSecrets, normalizeDomain, parseArguments, renderCaddy, renderEgress, renderEnvironment, renderLiveKit, validateBaseDomain, writeDeployment};
