BEGIN;

-- El chat público es el primer flujo que sale del archivo JSON. Sus identificadores
-- son texto porque la beta ya utiliza prefijos legibles (msg_, profile_, etc.).
CREATE TABLE room_messages (
  id TEXT PRIMARY KEY,
  room_code VARCHAR(6) NOT NULL,
  profile_id TEXT,
  author VARCHAR(60) NOT NULL,
  avatar_url TEXT,
  kind VARCHAR(20) NOT NULL DEFAULT 'text',
  body VARCHAR(600) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT room_messages_kind_valid CHECK (kind IN ('text', 'reaction'))
);
CREATE INDEX room_messages_room_timeline_idx
  ON room_messages (room_code, created_at DESC, id DESC);

-- Presencia efímera durable únicamente para auditoría y recuperación. Redis mantiene
-- los contadores calientes; estas concesiones expiran y nunca guardan ubicación exacta.
CREATE TABLE room_presence_leases (
  room_code VARCHAR(6) NOT NULL,
  account_id TEXT NOT NULL,
  profile_id TEXT,
  connection_id TEXT NOT NULL,
  country_code CHAR(2),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_code, connection_id)
);
CREATE INDEX room_presence_expiry_idx ON room_presence_leases (expires_at);
CREATE INDEX room_presence_room_idx ON room_presence_leases (room_code, expires_at DESC);

-- El DJ puede conectar hasta tres cámaras, pero la audiencia recibe un único programa.
CREATE TABLE broadcast_sessions (
  id TEXT PRIMARY KEY,
  room_code VARCHAR(6) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_input_id TEXT,
  playback_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'preparing',
  camera_limit SMALLINT NOT NULL DEFAULT 3 CHECK (camera_limit BETWEEN 1 AND 3),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT broadcast_sessions_status_valid CHECK (status IN ('preparing', 'live', 'ended', 'failed'))
);
CREATE UNIQUE INDEX broadcast_sessions_live_room_idx
  ON broadcast_sessions (room_code)
  WHERE status IN ('preparing', 'live');

-- Las cargas directas evitan que fotos y videos grandes atraviesen el proceso Node.
CREATE TABLE media_upload_intents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT,
  room_code VARCHAR(6),
  object_key TEXT NOT NULL UNIQUE,
  content_type VARCHAR(80) NOT NULL,
  byte_length BIGINT NOT NULL CHECK (byte_length > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT media_upload_intents_target CHECK (conversation_id IS NOT NULL OR room_code IS NOT NULL),
  CONSTRAINT media_upload_intents_status_valid CHECK (status IN ('pending', 'uploaded', 'approved', 'rejected', 'expired'))
);
CREATE INDEX media_upload_intents_expiry_idx ON media_upload_intents (expires_at) WHERE status = 'pending';
CREATE INDEX media_upload_intents_room_idx ON media_upload_intents (room_code, created_at DESC) WHERE room_code IS NOT NULL;

COMMIT;
