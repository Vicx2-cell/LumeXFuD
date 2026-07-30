-- Ledger-backed payout batches and transfer attempt history.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.payout_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference TEXT NOT NULL UNIQUE,
  beneficiary_type TEXT NOT NULL CHECK (beneficiary_type IN ('VENDOR', 'RIDER')),
  beneficiary_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  total_amount_kobo BIGINT NOT NULL CHECK (total_amount_kobo >= 0),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  kill_switch_snapshot TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_batches_beneficiary_idx
  ON public.payout_batches (beneficiary_type, beneficiary_id, environment, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payout_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.payout_batches(id) ON DELETE RESTRICT,
  beneficiary_type TEXT NOT NULL CHECK (beneficiary_type IN ('VENDOR', 'RIDER')),
  beneficiary_id UUID NOT NULL,
  payment_profile_id UUID REFERENCES public.payment_beneficiary_profiles(id) ON DELETE RESTRICT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  bank_name TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_account_last4 TEXT NOT NULL CHECK (length(bank_account_last4) = 4),
  bank_account_masked TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  paystack_recipient_code TEXT NOT NULL,
  paystack_subaccount_code TEXT,
  transfer_reference TEXT NOT NULL UNIQUE,
  paystack_transfer_code TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED')),
  snapshot_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_batch_items_batch_idx
  ON public.payout_batch_items (batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payout_batch_items_status_idx
  ON public.payout_batch_items (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payout_transfer_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_batch_item_id UUID NOT NULL REFERENCES public.payout_batch_items(id) ON DELETE RESTRICT,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  transfer_reference TEXT NOT NULL UNIQUE,
  paystack_transfer_code TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED')),
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  succeeded_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_transfer_attempts_item_idx
  ON public.payout_transfer_attempts (payout_batch_item_id, attempt_no DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payout_transfer_attempts_code_uidx
  ON public.payout_transfer_attempts (paystack_transfer_code)
  WHERE paystack_transfer_code IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payout_batches_immutable ON public.payout_batches;
CREATE TRIGGER trg_payout_batches_immutable
BEFORE UPDATE OR DELETE ON public.payout_batches
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_payout_batch_items_immutable ON public.payout_batch_items;
CREATE TRIGGER trg_payout_batch_items_immutable
BEFORE UPDATE OR DELETE ON public.payout_batch_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_transfer_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payout_batches, public.payout_batch_items, public.payout_transfer_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payout_batches TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payout_batch_items TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payout_transfer_attempts TO service_role;

DROP POLICY IF EXISTS payout_batches_service_role_all ON public.payout_batches;
CREATE POLICY payout_batches_service_role_all ON public.payout_batches
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS payout_batch_items_service_role_all ON public.payout_batch_items;
CREATE POLICY payout_batch_items_service_role_all ON public.payout_batch_items
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS payout_transfer_attempts_service_role_all ON public.payout_transfer_attempts;
CREATE POLICY payout_transfer_attempts_service_role_all ON public.payout_transfer_attempts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
