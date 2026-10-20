BEGIN;

CREATE TABLE billing_plans (
  id TEXT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'COP',
  max_participants INTEGER NOT NULL CHECK (max_participants > 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  credits_per_purchase INTEGER NOT NULL DEFAULT 1 CHECK (credits_per_purchase BETWEEN 1 AND 100),
  billing_interval VARCHAR(20) NOT NULL DEFAULT 'one_time',
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_plans_currency CHECK (currency = 'COP'),
  CONSTRAINT billing_plans_interval CHECK (billing_interval IN ('one_time', 'monthly'))
);

INSERT INTO billing_plans (
  id, name, description, price_cents, max_participants, duration_minutes,
  credits_per_purchase, billing_interval, features, sort_order
) VALUES (
  'room-25',
  'Sala 25',
  'Una señal del anfitrión para una comunidad pequeña.',
  2000000,
  25,
  120,
  1,
  'one_time',
  '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":false,"videoUploads":false}'::jsonb,
  10
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE billing_orders (
  id UUID PRIMARY KEY,
  reference VARCHAR(80) NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES billing_plans(id),
  plan_revision INTEGER NOT NULL,
  plan_snapshot JSONB NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'COP',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  provider VARCHAR(30) NOT NULL DEFAULT 'wompi',
  provider_transaction_id TEXT,
  payment_method_type VARCHAR(40),
  customer_email VARCHAR(254),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_orders_status CHECK (status IN ('pending', 'approved', 'declined', 'voided', 'error', 'expired', 'refunded')),
  CONSTRAINT billing_orders_currency CHECK (currency = 'COP')
);
CREATE INDEX billing_orders_account_idx ON billing_orders (account_id, created_at DESC);
CREATE INDEX billing_orders_status_idx ON billing_orders (status, created_at DESC);
CREATE UNIQUE INDEX billing_orders_provider_transaction_unique
  ON billing_orders (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE TABLE billing_payment_events (
  id UUID PRIMARY KEY,
  provider VARCHAR(30) NOT NULL,
  event_key TEXT NOT NULL,
  transaction_id TEXT,
  order_id UUID REFERENCES billing_orders(id),
  event_type VARCHAR(80) NOT NULL,
  status VARCHAR(30),
  environment VARCHAR(12),
  signature_valid BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_key)
);
CREATE INDEX billing_payment_events_order_idx ON billing_payment_events (order_id, received_at DESC);

CREATE TABLE billing_credits (
  id UUID PRIMARY KEY,
  account_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES billing_plans(id),
  source_order_id UUID UNIQUE REFERENCES billing_orders(id),
  units_granted INTEGER NOT NULL CHECK (units_granted > 0),
  units_remaining INTEGER NOT NULL CHECK (units_remaining >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_credits_status CHECK (status IN ('available', 'depleted', 'expired', 'reversed')),
  CONSTRAINT billing_credits_remaining CHECK (units_remaining <= units_granted)
);
CREATE INDEX billing_credits_account_available_idx
  ON billing_credits (account_id, created_at)
  WHERE status = 'available' AND units_remaining > 0;

CREATE TABLE billing_credit_reservations (
  id UUID PRIMARY KEY,
  account_id TEXT NOT NULL,
  credit_id UUID NOT NULL REFERENCES billing_credits(id),
  room_id TEXT NOT NULL UNIQUE,
  room_code CHAR(6) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'reserved',
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  CONSTRAINT billing_reservation_status CHECK (status IN ('reserved', 'consumed', 'released'))
);
CREATE INDEX billing_credit_reservations_account_idx
  ON billing_credit_reservations (account_id, reserved_at DESC);

CREATE TABLE billing_adjustments (
  id UUID PRIMARY KEY,
  account_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES billing_plans(id),
  credit_id UUID REFERENCES billing_credits(id),
  units INTEGER NOT NULL,
  reason VARCHAR(300) NOT NULL,
  administrator VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
