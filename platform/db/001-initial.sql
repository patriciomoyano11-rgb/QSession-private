BEGIN;

CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  password_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounts_email_normalized CHECK (email = LOWER(email)),
  CONSTRAINT accounts_status_valid CHECK (status IN ('active', 'suspended', 'deleted'))
);
CREATE UNIQUE INDEX accounts_email_active_unique ON accounts (email) WHERE status <> 'deleted';

CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'listener',
  display_name VARCHAR(60),
  bio VARCHAR(300),
  city VARCHAR(100),
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  allow_matchmaking BOOLEAN NOT NULL DEFAULT FALSE,
  allow_messages BOOLEAN NOT NULL DEFAULT FALSE,
  share_approximate_location BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_role_valid CHECK (role IN ('listener', 'dj'))
);
CREATE INDEX profiles_public_updated_idx ON profiles (updated_at DESC) WHERE is_public = TRUE;

CREATE TABLE profile_media (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type VARCHAR(40) NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  sha256 CHAR(64) NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX profile_media_account_idx ON profile_media (account_id, sort_order);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_account_expiry_idx ON sessions (account_id, expires_at);

CREATE TABLE rooms (
  id UUID PRIMARY KEY,
  code CHAR(6) NOT NULL,
  name VARCHAR(100),
  description VARCHAR(800),
  dj_name VARCHAR(100),
  visibility VARCHAR(20) NOT NULL DEFAULT 'private',
  status VARCHAR(20) NOT NULL DEFAULT 'live',
  media_topology VARCHAR(30) NOT NULL DEFAULT 'adaptive',
  region_hint VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  CONSTRAINT rooms_visibility_valid CHECK (visibility IN ('private', 'public')),
  CONSTRAINT rooms_status_valid CHECK (status IN ('waiting', 'live', 'ended'))
);
CREATE UNIQUE INDEX rooms_active_code_unique ON rooms (code) WHERE status <> 'ended';
CREATE INDEX rooms_public_live_idx ON rooms (started_at DESC) WHERE visibility = 'public' AND status = 'live';

CREATE TABLE stories (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_id UUID REFERENCES profile_media(id) ON DELETE SET NULL,
  body VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX stories_profile_expiry_idx ON stories (profile_id, expires_at DESC);

COMMIT;
