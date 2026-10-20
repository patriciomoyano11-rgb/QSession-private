BEGIN;

INSERT INTO billing_plans (
  id, name, description, price_cents, max_participants, duration_minutes,
  credits_per_purchase, billing_interval, segment, highlighted, features, active, sort_order
) VALUES
  (
    'monthly-community-100',
    'Mensual Comunidad 100',
    'Cuatro salas mensuales para comunidades, clases y encuentros de hasta 100 personas.',
    8900000, 100, 180, 4, 'monthly', 'membership', FALSE,
    '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb,
    TRUE, 100
  ),
  (
    'monthly-pro-250',
    'Mensual Pro 250',
    'Cuatro salas amplias al mes para academias, marcas y eventos recurrentes.',
    16900000, 250, 240, 4, 'monthly', 'membership', FALSE,
    '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb,
    TRUE, 110
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
