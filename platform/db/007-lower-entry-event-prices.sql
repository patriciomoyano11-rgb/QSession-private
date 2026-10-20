BEGIN;

-- Launch adjustment requested for the three entry event plans: 40% lower.
-- Amounts are stored in Colombian centavos.
UPDATE billing_plans
SET price_cents = CASE id
      WHEN 'room-25' THEN 1200000
      WHEN 'event-100' THEN 2700000
      WHEN 'event-250' THEN 5340000
    END,
    revision = revision + 1,
    updated_at = NOW()
WHERE id IN ('room-25', 'event-100', 'event-250');

COMMIT;
