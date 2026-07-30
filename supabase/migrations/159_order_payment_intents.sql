-- Order payment intents: server-owned, immutable-ish checkout intent records.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.order_payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  guest_phone TEXT,
  guest_name TEXT,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  expected_vendor_allocation_kobo BIGINT NOT NULL CHECK (expected_vendor_allocation_kobo >= 0),
  expected_rider_allocation_kobo BIGINT NOT NULL CHECK (expected_rider_allocation_kobo >= 0),
  expected_platform_allocation_kobo BIGINT NOT NULL CHECK (expected_platform_allocation_kobo >= 0),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'INITIALIZED', 'VERIFIED', 'FINALIZED', 'QUARANTINED', 'FAILED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  internal_reference TEXT NOT NULL UNIQUE,
  paystack_reference TEXT NOT NULL UNIQUE,
  paystack_authorization_url TEXT,
  paystack_access_code TEXT,
  paystack_transaction_id TEXT,
  callback_seen_at TIMESTAMPTZ,
  initialized_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  quarantined_at TIMESTAMPTZ,
  quarantine_reason TEXT,
  provider_amount_kobo BIGINT,
  provider_currency TEXT,
  provider_environment TEXT,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (guest_phone IS NULL OR length(btrim(guest_phone)) > 0),
  CHECK (guest_name IS NULL OR length(btrim(guest_name)) > 0)
);

CREATE INDEX IF NOT EXISTS order_payment_intents_status_idx
  ON public.order_payment_intents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS order_payment_intents_paystack_reference_idx
  ON public.order_payment_intents (paystack_reference);
CREATE INDEX IF NOT EXISTS order_payment_intents_order_idx
  ON public.order_payment_intents (order_id, created_at DESC);

ALTER TABLE public.order_payment_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payment_intents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_payment_intents TO service_role;

DROP POLICY IF EXISTS order_payment_intents_service_role_all ON public.order_payment_intents;
CREATE POLICY order_payment_intents_service_role_all ON public.order_payment_intents
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

