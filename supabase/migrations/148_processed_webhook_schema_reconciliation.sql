-- Keep the tracked schema aligned with the production webhook idempotency row.
-- The application writes both references so admin diagnostics can query either
-- the provider reference or the generic event reference. Earlier production
-- setup added this column outside migrations; without it a fresh project would
-- reject every webhook dedup insert and leave paid orders unprocessed.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Production predates tracked Supabase migration history. Fail before changing
-- anything unless the schema prerequisites for migrations 148-151 are present.
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(required.table_name || '.' || required.column_name, ', ')
  INTO v_missing
  FROM (VALUES
    ('orders', 'id'), ('orders', 'customer_id'), ('orders', 'vendor_id'),
    ('orders', 'subtotal'), ('orders', 'payment_status'),
    ('vendors', 'id'), ('vendors', 'category'), ('vendors', 'city_id'),
    ('cities', 'id'), ('customers', 'id'),
    ('settings', 'id'), ('settings', 'value'),
    ('processed_webhooks', 'reference'), ('processed_webhooks', 'event'),
    ('processed_webhooks', 'payload')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'launch migration prerequisites missing: %', v_missing;
  END IF;
  IF to_regprocedure('public.rls_coverage_gaps()') IS NULL THEN
    RAISE EXCEPTION 'launch migration prerequisite missing: public.rls_coverage_gaps()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'launch migration prerequisite missing: Supabase API roles';
  END IF;
END $$;

ALTER TABLE public.processed_webhooks
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT;

UPDATE public.processed_webhooks
SET paystack_reference = reference
WHERE paystack_reference IS NULL;

ALTER TABLE public.processed_webhooks
  ALTER COLUMN paystack_reference SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_paystack_reference_event
  ON public.processed_webhooks(paystack_reference, event);
