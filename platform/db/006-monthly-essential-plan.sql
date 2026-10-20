BEGIN;

ALTER TABLE billing_plans
  DROP CONSTRAINT IF EXISTS billing_plans_segment;

ALTER TABLE billing_plans
  ADD CONSTRAINT billing_plans_segment
  CHECK (segment IN ('event', 'professional', 'business', 'enterprise', 'membership'));

INSERT INTO billing_plans (
  id, name, description, price_cents, max_participants, duration_minutes,
  credits_per_purchase, billing_interval, segment, highlighted, features, active, sort_order
) VALUES (
  'monthly-essential-25',
  'Mensual Esencial 25',
  'Cuatro salas al mes para clases, encuentros y transmisiones frecuentes. Renovación manual, sin permanencia.',
  3900000,
  25,
  120,
  4,
  'monthly',
  'membership',
  TRUE,
  '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb,
  TRUE,
  90
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
