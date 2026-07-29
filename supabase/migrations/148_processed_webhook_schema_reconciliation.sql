-- Keep the tracked schema aligned with the production webhook idempotency row.
-- The application writes both references so admin diagnostics can query either
-- the provider reference or the generic event reference. Earlier production
-- setup added this column outside migrations; without it a fresh project would
-- reject every webhook dedup insert and leave paid orders unprocessed.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.processed_webhooks
  ADD COLUMN IF NOT EXISTS paystack_reference TEXT;

UPDATE public.processed_webhooks
SET paystack_reference = reference
WHERE paystack_reference IS NULL;

ALTER TABLE public.processed_webhooks
  ALTER COLUMN paystack_reference SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_paystack_reference_event
  ON public.processed_webhooks(paystack_reference, event);
