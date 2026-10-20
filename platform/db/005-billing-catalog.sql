BEGIN;

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS segment VARCHAR(20) NOT NULL DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS highlighted BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_plans_segment'
  ) THEN
    ALTER TABLE billing_plans
      ADD CONSTRAINT billing_plans_segment
      CHECK (segment IN ('event', 'professional', 'business', 'enterprise'));
  END IF;
END $$;

INSERT INTO billing_plans (
  id, name, description, price_cents, max_participants, duration_minutes,
  credits_per_purchase, billing_interval, segment, highlighted, features, active, sort_order
) VALUES
  ('event-100', 'Evento 100', 'Para cumpleaños, bodas, conferencias y encuentros de hasta 100 personas.', 4500000, 100, 180, 1, 'one_time', 'event', FALSE, '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb, TRUE, 20),
  ('event-250', 'Evento 250', 'Una sala amplia para comunidades, fiestas y eventos con mayor alcance.', 8900000, 250, 240, 1, 'one_time', 'event', TRUE, '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb, TRUE, 30),
  ('event-500', 'Evento 500', 'Para lanzamientos, celebraciones y transmisiones públicas de gran formato.', 15900000, 500, 240, 1, 'one_time', 'event', FALSE, '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb, TRUE, 40),
  ('instructor-50-4', 'Instructor 50 · 4 sesiones', 'Paquete para profesores de yoga, meditación, baile y bienestar.', 6900000, 50, 90, 4, 'one_time', 'professional', TRUE, '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb, TRUE, 50),
  ('instructor-100-8', 'Instructor Pro 100 · 8 sesiones', 'Para academias y profesores con grupos recurrentes y una comunidad en crecimiento.', 16900000, 100, 120, 8, 'one_time', 'professional', FALSE, '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb, TRUE, 60),
  ('business-250-10', 'Comercio 250 · 10 sesiones', 'Para comercios, marcas, hoteles y organizadores con programación frecuente.', 44900000, 250, 240, 10, 'one_time', 'business', TRUE, '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb, TRUE, 70),
  ('large-event-1000', 'Gran evento 1.000', 'Para grandes conferencias, conciertos y eventos institucionales de alcance nacional.', 28900000, 1000, 360, 1, 'one_time', 'enterprise', FALSE, '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb, TRUE, 80)
ON CONFLICT (id) DO NOTHING;

UPDATE billing_plans
SET name = 'Sala Esencial 25',
    description = 'Para reuniones privadas, celebraciones pequeñas y primeras transmisiones.',
    segment = 'event',
    highlighted = FALSE,
    features = features || '{"hostVideo":true,"hostAudio":true,"publicChat":true,"guestCameras":true,"videoUploads":true}'::jsonb,
    updated_at = NOW()
WHERE id = 'room-25' AND revision = 1;

COMMIT;
