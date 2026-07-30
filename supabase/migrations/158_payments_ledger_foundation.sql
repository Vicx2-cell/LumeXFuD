-- Payments foundation: double-entry ledger, immutable order snapshots, and
-- wallet reservation state machine.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type TEXT NOT NULL CHECK (account_type IN (
    'CUSTOMER_AVAILABLE',
    'CUSTOMER_RESERVED',
    'COLLECTION_CLEARING',
    'PAYSTACK_RECEIVABLE',
    'VENDOR_PAYABLE',
    'RIDER_PAYABLE',
    'PLATFORM_FEE_REVENUE',
    'COMMISSION_REVENUE',
    'REFUND_PAYABLE',
    'PROMOTIONAL_CREDIT',
    'PAYOUT_CLEARING',
    'SETTLEMENT_CLEARING',
    'DISPUTE_RESERVE'
  )),
  owner_type TEXT NOT NULL CHECK (owner_type IN (
    'CUSTOMER',
    'VENDOR',
    'RIDER',
    'PLATFORM',
    'PAYSTACK',
    'DISPUTE',
    'SYSTEM'
  )),
  owner_id UUID,
  owner_key TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_type <> 'SYSTEM' OR owner_id IS NULL),
  CHECK (owner_type IN ('PLATFORM', 'PAYSTACK', 'SYSTEM') OR owner_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_active_uidx
  ON public.financial_accounts (account_type, owner_key, currency, environment)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS financial_accounts_owner_lookup_idx
  ON public.financial_accounts (owner_type, owner_id, currency, environment);

CREATE TABLE IF NOT EXISTS public.ledger_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_type TEXT NOT NULL,
  business_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOIDED')),
  source TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  correlation_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  entries_hash TEXT NOT NULL,
  reversal_of_journal_id UUID REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(btrim(journal_type)) > 0),
  CHECK (length(btrim(business_reference)) > 0),
  CHECK (length(btrim(idempotency_key)) > 0),
  CHECK (length(btrim(source)) > 0),
  CHECK (length(btrim(actor_type)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_journals_reversal_uidx
  ON public.ledger_journals (reversal_of_journal_id)
  WHERE reversal_of_journal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_journals_business_reference_idx
  ON public.ledger_journals (business_reference, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id UUID NOT NULL REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  entry_no INTEGER NOT NULL CHECK (entry_no > 0),
  account_id UUID NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (journal_id, entry_no)
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON public.ledger_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_journal_idx
  ON public.ledger_entries (journal_id, entry_no);

CREATE TABLE IF NOT EXISTS public.order_financial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  rider_id UUID REFERENCES public.riders(id) ON DELETE RESTRICT,
  zone_id UUID REFERENCES public.cities(id) ON DELETE RESTRICT,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('BIKE', 'DOOR', 'PICKUP')),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  pricing_policy_version TEXT NOT NULL,
  commission_policy_version TEXT NOT NULL,
  merchandise_subtotal_kobo BIGINT NOT NULL CHECK (merchandise_subtotal_kobo >= 0),
  vendor_gross_kobo BIGINT NOT NULL CHECK (vendor_gross_kobo >= 0),
  vendor_commission_rate_bps INTEGER NOT NULL CHECK (vendor_commission_rate_bps BETWEEN 0 AND 10000),
  vendor_commission_kobo BIGINT NOT NULL CHECK (vendor_commission_kobo >= 0),
  vendor_net_kobo BIGINT NOT NULL CHECK (vendor_net_kobo >= 0),
  delivery_fee_kobo BIGINT NOT NULL CHECK (delivery_fee_kobo >= 0),
  delivery_platform_fee_kobo BIGINT NOT NULL CHECK (delivery_platform_fee_kobo >= 0),
  rider_allocation_kobo BIGINT NOT NULL CHECK (rider_allocation_kobo >= 0),
  platform_fee_kobo BIGINT NOT NULL CHECK (platform_fee_kobo >= 0),
  guest_fee_kobo BIGINT NOT NULL CHECK (guest_fee_kobo >= 0),
  packaging_fee_kobo BIGINT NOT NULL CHECK (packaging_fee_kobo >= 0),
  discount_amount_kobo BIGINT NOT NULL CHECK (discount_amount_kobo >= 0),
  discount_funding_source TEXT NOT NULL CHECK (discount_funding_source IN ('LUMEX', 'VENDOR', 'PLATFORM', 'PROMO', 'NONE')),
  promotional_credit_kobo BIGINT NOT NULL CHECK (promotional_credit_kobo >= 0),
  total_customer_charge_kobo BIGINT NOT NULL CHECK (total_customer_charge_kobo >= 0),
  calculation_timestamp TIMESTAMPTZ NOT NULL,
  snapshot_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (vendor_gross_kobo = merchandise_subtotal_kobo),
  CHECK (vendor_net_kobo + vendor_commission_kobo = vendor_gross_kobo),
  CHECK (delivery_fee_kobo = rider_allocation_kobo + delivery_platform_fee_kobo),
  CHECK (
    total_customer_charge_kobo = merchandise_subtotal_kobo
      + delivery_fee_kobo
      + platform_fee_kobo
      + guest_fee_kobo
      + packaging_fee_kobo
      - discount_amount_kobo
      - promotional_credit_kobo
  )
);
CREATE INDEX IF NOT EXISTS order_financial_snapshots_vendor_idx
  ON public.order_financial_snapshots (vendor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wallet_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED', 'REVERSED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  reservation_journal_id UUID REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  release_journal_id UUID REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  consume_journal_id UUID REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  reversal_journal_id UUID REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_reservations_customer_status_idx
  ON public.wallet_reservations (customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_reservations_expiry_idx
  ON public.wallet_reservations (status, expires_at);

CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'ledger rows are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_journals_immutable ON public.ledger_journals;
CREATE TRIGGER trg_ledger_journals_immutable
BEFORE UPDATE OR DELETE ON public.ledger_journals
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON public.ledger_entries;
CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

DROP TRIGGER IF EXISTS trg_order_financial_snapshots_immutable ON public.order_financial_snapshots;
CREATE TRIGGER trg_order_financial_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.order_financial_snapshots
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_financial_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_accounts, public.ledger_journals, public.ledger_entries,
  public.order_financial_snapshots, public.wallet_reservations FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.financial_accounts TO service_role;
GRANT SELECT, INSERT ON public.ledger_journals TO service_role;
GRANT SELECT, INSERT ON public.ledger_entries TO service_role;
GRANT SELECT, INSERT ON public.order_financial_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.wallet_reservations TO service_role;

DROP POLICY IF EXISTS financial_accounts_service_role_all ON public.financial_accounts;
CREATE POLICY financial_accounts_service_role_all ON public.financial_accounts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS ledger_journals_service_role_all ON public.ledger_journals;
CREATE POLICY ledger_journals_service_role_all ON public.ledger_journals
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS ledger_entries_service_role_all ON public.ledger_entries;
CREATE POLICY ledger_entries_service_role_all ON public.ledger_entries
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS order_financial_snapshots_service_role_all ON public.order_financial_snapshots;
CREATE POLICY order_financial_snapshots_service_role_all ON public.order_financial_snapshots
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS wallet_reservations_service_role_all ON public.wallet_reservations;
CREATE POLICY wallet_reservations_service_role_all ON public.wallet_reservations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON FUNCTION public.prevent_ledger_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_ledger_mutation() TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_financial_account(
  p_account_type TEXT,
  p_owner_type TEXT,
  p_owner_id UUID DEFAULT NULL,
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production',
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id UUID;
  v_owner_key TEXT;
  v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
  v_environment TEXT := lower(btrim(COALESCE(p_environment, '')));
BEGIN
  IF p_account_type NOT IN (
    'CUSTOMER_AVAILABLE',
    'CUSTOMER_RESERVED',
    'COLLECTION_CLEARING',
    'PAYSTACK_RECEIVABLE',
    'VENDOR_PAYABLE',
    'RIDER_PAYABLE',
    'PLATFORM_FEE_REVENUE',
    'COMMISSION_REVENUE',
    'REFUND_PAYABLE',
    'PROMOTIONAL_CREDIT',
    'PAYOUT_CLEARING',
    'SETTLEMENT_CLEARING',
    'DISPUTE_RESERVE'
  ) THEN
    RAISE EXCEPTION 'unsupported financial account type: %', p_account_type;
  END IF;
  IF p_owner_type NOT IN ('CUSTOMER', 'VENDOR', 'RIDER', 'PLATFORM', 'PAYSTACK', 'DISPUTE', 'SYSTEM') THEN
    RAISE EXCEPTION 'unsupported owner type: %', p_owner_type;
  END IF;
  IF v_currency <> 'NGN' THEN
    RAISE EXCEPTION 'unsupported currency: %', p_currency;
  END IF;
  IF v_environment NOT IN ('test', 'production') THEN
    RAISE EXCEPTION 'unsupported environment: %', p_environment;
  END IF;
  v_owner_key := lower(p_owner_type) || ':' || COALESCE(p_owner_id::text, 'system');

  INSERT INTO public.financial_accounts (
    account_type, owner_type, owner_id, owner_key, currency, environment, status, metadata
  ) VALUES (
    p_account_type, p_owner_type, p_owner_id, v_owner_key, v_currency, v_environment, 'ACTIVE', COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (account_type, owner_key, currency, environment) WHERE status = 'ACTIVE'
  DO NOTHING
  RETURNING id INTO v_account_id;

  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
    FROM public.financial_accounts
    WHERE account_type = p_account_type
      AND owner_key = v_owner_key
      AND currency = v_currency
      AND environment = v_environment
      AND status = 'ACTIVE'
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'could not ensure financial account';
  END IF;

  RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_account_balance(p_account_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    SUM(CASE WHEN e.side = 'CREDIT' THEN e.amount_kobo ELSE -e.amount_kobo END),
    0
  )::BIGINT
  FROM public.ledger_entries e
  JOIN public.ledger_journals j ON j.id = e.journal_id AND j.status = 'POSTED'
  WHERE e.account_id = p_account_id;
$$;

CREATE OR REPLACE FUNCTION public.financial_account_balance_by_identity(
  p_account_type TEXT,
  p_owner_type TEXT,
  p_owner_id UUID DEFAULT NULL,
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_key TEXT;
  v_account_id UUID;
BEGIN
  v_owner_key := lower(p_owner_type) || ':' || COALESCE(p_owner_id::text, 'system');
  SELECT id INTO v_account_id
  FROM public.financial_accounts
  WHERE account_type = p_account_type
    AND owner_key = v_owner_key
    AND currency = upper(btrim(COALESCE(p_currency, '')))
    AND environment = lower(btrim(COALESCE(p_environment, '')))
    AND status = 'ACTIVE'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RETURN 0;
  END IF;

  RETURN public.financial_account_balance(v_account_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_available_balance(
  p_customer_id UUID,
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.financial_account_balance_by_identity('CUSTOMER_AVAILABLE', 'CUSTOMER', p_customer_id, p_currency, p_environment);
$$;

CREATE OR REPLACE FUNCTION public.get_customer_reserved_balance(
  p_customer_id UUID,
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.financial_account_balance_by_identity('CUSTOMER_RESERVED', 'CUSTOMER', p_customer_id, p_currency, p_environment);
$$;

CREATE OR REPLACE FUNCTION public.get_vendor_payable_balance(
  p_vendor_id UUID,
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.financial_account_balance_by_identity('VENDOR_PAYABLE', 'VENDOR', p_vendor_id, p_currency, p_environment);
$$;

CREATE OR REPLACE FUNCTION public.get_rider_payable_balance(
  p_rider_id UUID,
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.financial_account_balance_by_identity('RIDER_PAYABLE', 'RIDER', p_rider_id, p_currency, p_environment);
$$;

CREATE OR REPLACE FUNCTION public.get_platform_fee_revenue_balance(
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.financial_account_balance_by_identity('PLATFORM_FEE_REVENUE', 'PLATFORM', NULL, p_currency, p_environment);
$$;

CREATE OR REPLACE FUNCTION public.get_pending_settlement_balance(
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.financial_account_balance_by_identity('SETTLEMENT_CLEARING', 'PLATFORM', NULL, p_currency, p_environment);
$$;

CREATE OR REPLACE FUNCTION public.get_payout_cleared_balance(
  p_currency TEXT DEFAULT 'NGN',
  p_environment TEXT DEFAULT 'production'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.financial_account_balance_by_identity('PAYOUT_CLEARING', 'PLATFORM', NULL, p_currency, p_environment);
$$;

CREATE OR REPLACE FUNCTION public.post_ledger_journal(
  p_journal_type TEXT,
  p_business_reference TEXT,
  p_idempotency_key TEXT,
  p_currency TEXT,
  p_source TEXT,
  p_actor_type TEXT,
  p_actor_id UUID DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_reversal_of_journal_id UUID DEFAULT NULL,
  p_entries JSONB DEFAULT '[]'::jsonb
) RETURNS TABLE(journal_id UUID, replayed BOOLEAN, journal_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
  v_metadata JSONB := COALESCE(p_metadata, '{}'::jsonb);
  v_entries_hash TEXT := md5(COALESCE(p_entries::text, '[]'));
  v_existing public.ledger_journals%ROWTYPE;
  v_journal_id UUID;
  v_entry JSONB;
  v_entry_no INTEGER := 0;
  v_account_id UUID;
  v_side TEXT;
  v_amount BIGINT;
  v_account_currency TEXT;
  v_account_environment TEXT;
  v_debits BIGINT := 0;
  v_credits BIGINT := 0;
  v_entry_count INTEGER := 0;
BEGIN
  IF v_currency <> 'NGN' THEN
    RAISE EXCEPTION 'unsupported currency: %', p_currency;
  END IF;
  IF length(btrim(COALESCE(p_idempotency_key, ''))) = 0 THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_entries, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'entries must be an array';
  END IF;
  IF jsonb_array_length(COALESCE(p_entries, '[]'::jsonb)) < 2 THEN
    RAISE EXCEPTION 'ledger journal requires at least two entries';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.ledger_journals
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.journal_type <> p_journal_type
      OR v_existing.business_reference <> p_business_reference
      OR v_existing.currency <> v_currency
      OR v_existing.source <> p_source
      OR v_existing.actor_type <> p_actor_type
      OR COALESCE(v_existing.actor_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(p_actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR COALESCE(v_existing.correlation_id, '') <> COALESCE(p_correlation_id, '')
      OR COALESCE(v_existing.metadata, '{}'::jsonb) <> v_metadata
      OR COALESCE(v_existing.reversal_of_journal_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(p_reversal_of_journal_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR COALESCE(v_existing.entries_hash, '') <> v_entries_hash
    THEN
      RAISE EXCEPTION 'idempotency key conflict for ledger journal %', p_idempotency_key;
    END IF;

    journal_id := v_existing.id;
    replayed := TRUE;
    journal_status := v_existing.status;
    RETURN NEXT;
    RETURN;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) AS t(value)
  LOOP
    v_entry_no := v_entry_no + 1;
    v_account_id := NULLIF(btrim(COALESCE(v_entry->>'account_id', '')), '')::uuid;
    v_side := upper(btrim(COALESCE(v_entry->>'side', '')));
    v_amount := NULLIF(btrim(COALESCE(v_entry->>'amount_kobo', '')), '')::bigint;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'ledger entry % is missing account_id', v_entry_no;
    END IF;
    IF v_side NOT IN ('DEBIT', 'CREDIT') THEN
      RAISE EXCEPTION 'ledger entry % has invalid side', v_entry_no;
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'ledger entry % has invalid amount', v_entry_no;
    END IF;

    SELECT currency, environment
    INTO v_account_currency, v_account_environment
    FROM public.financial_accounts
    WHERE id = v_account_id
      AND status = 'ACTIVE';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ledger entry % references an inactive or missing account', v_entry_no;
    END IF;
    IF v_account_currency <> v_currency THEN
      RAISE EXCEPTION 'ledger entry % currency mismatch', v_entry_no;
    END IF;
    IF p_metadata ? 'environment' THEN
      IF v_account_environment <> lower(btrim(COALESCE(p_metadata->>'environment', ''))) THEN
        RAISE EXCEPTION 'ledger entry % environment mismatch', v_entry_no;
      END IF;
    END IF;

    IF v_side = 'DEBIT' THEN
      v_debits := v_debits + v_amount;
    ELSE
      v_credits := v_credits + v_amount;
    END IF;
    v_entry_count := v_entry_count + 1;
  END LOOP;

  IF v_entry_count < 2 THEN
    RAISE EXCEPTION 'ledger journal requires at least two entries';
  END IF;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'ledger journal is unbalanced';
  END IF;

  INSERT INTO public.ledger_journals (
    journal_type, business_reference, idempotency_key, currency, status, source,
    actor_type, actor_id, correlation_id, metadata, entries_hash, reversal_of_journal_id, posted_at
  ) VALUES (
    p_journal_type, p_business_reference, p_idempotency_key, v_currency, 'POSTED', p_source,
    p_actor_type, p_actor_id, p_correlation_id, v_metadata, v_entries_hash, p_reversal_of_journal_id, now()
  )
  RETURNING id INTO v_journal_id;

  v_entry_no := 0;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) AS t(value)
  LOOP
    v_entry_no := v_entry_no + 1;
    v_account_id := NULLIF(btrim(COALESCE(v_entry->>'account_id', '')), '')::uuid;
    v_side := upper(btrim(COALESCE(v_entry->>'side', '')));
    v_amount := NULLIF(btrim(COALESCE(v_entry->>'amount_kobo', '')), '')::bigint;
    INSERT INTO public.ledger_entries (
      journal_id, entry_no, account_id, side, amount_kobo, currency, metadata
    ) VALUES (
      v_journal_id,
      v_entry_no,
      v_account_id,
      v_side,
      v_amount,
      v_currency,
      COALESCE(v_entry->'metadata', '{}'::jsonb)
    );
  END LOOP;

  journal_id := v_journal_id;
  replayed := FALSE;
  journal_status := 'POSTED';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_ledger_journal(
  p_original_journal_id UUID,
  p_idempotency_key TEXT,
  p_actor_type TEXT,
  p_actor_id UUID DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'system',
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(reversal_journal_id UUID, replayed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_original public.ledger_journals%ROWTYPE;
  v_entries JSONB := '[]'::jsonb;
  v_entry RECORD;
  v_result RECORD;
BEGIN
  SELECT * INTO v_original
  FROM public.ledger_journals
  WHERE id = p_original_journal_id
    AND status = 'POSTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'original journal not found or not posted';
  END IF;

  FOR v_entry IN
    SELECT e.account_id, e.side, e.amount_kobo, e.metadata
    FROM public.ledger_entries e
    WHERE e.journal_id = v_original.id
    ORDER BY e.entry_no
  LOOP
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_entry.account_id,
        'side', CASE WHEN v_entry.side = 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
        'amount_kobo', v_entry.amount_kobo,
        'metadata', COALESCE(v_entry.metadata, '{}'::jsonb)
      )
    );
  END LOOP;

  SELECT * INTO v_result
  FROM public.post_ledger_journal(
    'REVERSAL',
    v_original.business_reference,
    p_idempotency_key,
    v_original.currency,
    p_source,
    p_actor_type,
    p_actor_id,
    p_correlation_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('original_journal_id', v_original.id),
    v_original.id,
    v_entries
  );

  reversal_journal_id := v_result.journal_id;
  replayed := v_result.replayed;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_order_financial_snapshot(
  p_order_id UUID,
  p_customer_id UUID,
  p_vendor_id UUID,
  p_rider_id UUID,
  p_zone_id UUID,
  p_delivery_type TEXT,
  p_currency TEXT,
  p_pricing_policy_version TEXT,
  p_commission_policy_version TEXT,
  p_merchandise_subtotal_kobo BIGINT,
  p_vendor_gross_kobo BIGINT,
  p_vendor_commission_rate_bps INTEGER,
  p_vendor_commission_kobo BIGINT,
  p_vendor_net_kobo BIGINT,
  p_delivery_fee_kobo BIGINT,
  p_delivery_platform_fee_kobo BIGINT,
  p_rider_allocation_kobo BIGINT,
  p_platform_fee_kobo BIGINT,
  p_guest_fee_kobo BIGINT,
  p_packaging_fee_kobo BIGINT,
  p_discount_amount_kobo BIGINT,
  p_discount_funding_source TEXT,
  p_promotional_credit_kobo BIGINT,
  p_total_customer_charge_kobo BIGINT,
  p_calculation_timestamp TIMESTAMPTZ,
  p_idempotency_key TEXT,
  p_snapshot_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(snapshot_id UUID, replayed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.order_financial_snapshots%ROWTYPE;
BEGIN
  IF p_currency <> 'NGN' THEN
    RAISE EXCEPTION 'unsupported currency: %', p_currency;
  END IF;
  IF length(btrim(COALESCE(p_idempotency_key, ''))) = 0 THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;
  IF p_merchandise_subtotal_kobo < 0
    OR p_vendor_gross_kobo < 0
    OR p_vendor_commission_rate_bps < 0
    OR p_vendor_commission_kobo < 0
    OR p_vendor_net_kobo < 0
    OR p_delivery_fee_kobo < 0
    OR p_delivery_platform_fee_kobo < 0
    OR p_rider_allocation_kobo < 0
    OR p_platform_fee_kobo < 0
    OR p_guest_fee_kobo < 0
    OR p_packaging_fee_kobo < 0
    OR p_discount_amount_kobo < 0
    OR p_promotional_credit_kobo < 0
    OR p_total_customer_charge_kobo < 0
  THEN
    RAISE EXCEPTION 'snapshot amounts must be non-negative';
  END IF;
  IF p_vendor_gross_kobo <> p_merchandise_subtotal_kobo THEN
    RAISE EXCEPTION 'vendor gross must equal merchandise subtotal';
  END IF;
  IF p_vendor_net_kobo + p_vendor_commission_kobo <> p_vendor_gross_kobo THEN
    RAISE EXCEPTION 'vendor allocation is inconsistent';
  END IF;
  IF p_delivery_fee_kobo <> p_rider_allocation_kobo + p_delivery_platform_fee_kobo THEN
    RAISE EXCEPTION 'delivery allocation is inconsistent';
  END IF;
  IF p_total_customer_charge_kobo <> p_merchandise_subtotal_kobo
    + p_delivery_fee_kobo
    + p_platform_fee_kobo
    + p_guest_fee_kobo
    + p_packaging_fee_kobo
    - p_discount_amount_kobo
    - p_promotional_credit_kobo
  THEN
    RAISE EXCEPTION 'snapshot total is inconsistent';
  END IF;
  IF p_discount_funding_source NOT IN ('LUMEX', 'VENDOR', 'PLATFORM', 'PROMO', 'NONE') THEN
    RAISE EXCEPTION 'unsupported discount funding source';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.order_financial_snapshots
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.order_id <> p_order_id
      OR COALESCE(v_existing.customer_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(p_customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR v_existing.vendor_id <> p_vendor_id
      OR COALESCE(v_existing.rider_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(p_rider_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR COALESCE(v_existing.zone_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(p_zone_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR v_existing.delivery_type <> p_delivery_type
      OR v_existing.currency <> p_currency
      OR v_existing.pricing_policy_version <> p_pricing_policy_version
      OR v_existing.commission_policy_version <> p_commission_policy_version
      OR v_existing.merchandise_subtotal_kobo <> p_merchandise_subtotal_kobo
      OR v_existing.vendor_gross_kobo <> p_vendor_gross_kobo
      OR v_existing.vendor_commission_rate_bps <> p_vendor_commission_rate_bps
      OR v_existing.vendor_commission_kobo <> p_vendor_commission_kobo
      OR v_existing.vendor_net_kobo <> p_vendor_net_kobo
      OR v_existing.delivery_fee_kobo <> p_delivery_fee_kobo
      OR v_existing.delivery_platform_fee_kobo <> p_delivery_platform_fee_kobo
      OR v_existing.rider_allocation_kobo <> p_rider_allocation_kobo
      OR v_existing.platform_fee_kobo <> p_platform_fee_kobo
      OR v_existing.guest_fee_kobo <> p_guest_fee_kobo
      OR v_existing.packaging_fee_kobo <> p_packaging_fee_kobo
      OR v_existing.discount_amount_kobo <> p_discount_amount_kobo
      OR v_existing.discount_funding_source <> p_discount_funding_source
      OR v_existing.promotional_credit_kobo <> p_promotional_credit_kobo
      OR v_existing.total_customer_charge_kobo <> p_total_customer_charge_kobo
    THEN
      RAISE EXCEPTION 'idempotency key conflict for order snapshot %', p_idempotency_key;
    END IF;

    snapshot_id := v_existing.id;
    replayed := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.order_financial_snapshots (
    order_id, customer_id, vendor_id, rider_id, zone_id, delivery_type, currency,
    pricing_policy_version, commission_policy_version,
    merchandise_subtotal_kobo, vendor_gross_kobo, vendor_commission_rate_bps, vendor_commission_kobo,
    vendor_net_kobo, delivery_fee_kobo, delivery_platform_fee_kobo, rider_allocation_kobo,
    platform_fee_kobo, guest_fee_kobo, packaging_fee_kobo, discount_amount_kobo,
    discount_funding_source, promotional_credit_kobo, total_customer_charge_kobo,
    calculation_timestamp, snapshot_metadata, idempotency_key
  ) VALUES (
    p_order_id, p_customer_id, p_vendor_id, p_rider_id, p_zone_id, p_delivery_type, p_currency,
    p_pricing_policy_version, p_commission_policy_version,
    p_merchandise_subtotal_kobo, p_vendor_gross_kobo, p_vendor_commission_rate_bps, p_vendor_commission_kobo,
    p_vendor_net_kobo, p_delivery_fee_kobo, p_delivery_platform_fee_kobo, p_rider_allocation_kobo,
    p_platform_fee_kobo, p_guest_fee_kobo, p_packaging_fee_kobo, p_discount_amount_kobo,
    p_discount_funding_source, p_promotional_credit_kobo, p_total_customer_charge_kobo,
    p_calculation_timestamp, COALESCE(p_snapshot_metadata, '{}'::jsonb), p_idempotency_key
  )
  RETURNING id INTO snapshot_id;

  replayed := FALSE;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_wallet_balance(
  p_customer_id UUID,
  p_order_id UUID,
  p_amount_kobo BIGINT,
  p_currency TEXT,
  p_environment TEXT,
  p_idempotency_key TEXT,
  p_expires_at TIMESTAMPTZ,
  p_correlation_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(reservation_id UUID, journal_id UUID, replayed BOOLEAN, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_available_account_id UUID;
  v_reserved_account_id UUID;
  v_existing public.wallet_reservations%ROWTYPE;
  v_balance BIGINT;
  v_result RECORD;
  v_environment TEXT := lower(btrim(COALESCE(p_environment, '')));
BEGIN
  IF p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'reservation amount must be positive';
  END IF;
  IF upper(btrim(COALESCE(p_currency, ''))) <> 'NGN' THEN
    RAISE EXCEPTION 'unsupported currency: %', p_currency;
  END IF;
  IF v_environment NOT IN ('test', 'production') THEN
    RAISE EXCEPTION 'unsupported environment: %', p_environment;
  END IF;
  IF length(btrim(COALESCE(p_idempotency_key, ''))) = 0 THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.wallet_reservations
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.customer_id <> p_customer_id
      OR v_existing.order_id <> p_order_id
      OR v_existing.amount_kobo <> p_amount_kobo
      OR v_existing.currency <> upper(btrim(COALESCE(p_currency, '')))
      OR v_existing.environment <> v_environment
    THEN
      RAISE EXCEPTION 'idempotency key conflict for reservation %', p_idempotency_key;
    END IF;

    reservation_id := v_existing.id;
    journal_id := v_existing.reservation_journal_id;
    replayed := TRUE;
    status := v_existing.status;
    RETURN NEXT;
    RETURN;
  END IF;

  v_available_account_id := public.ensure_financial_account('CUSTOMER_AVAILABLE', 'CUSTOMER', p_customer_id, p_currency, p_environment, p_metadata);
  v_reserved_account_id := public.ensure_financial_account('CUSTOMER_RESERVED', 'CUSTOMER', p_customer_id, p_currency, p_environment, p_metadata);

  PERFORM 1
  FROM public.financial_accounts
  WHERE id = v_available_account_id
  FOR UPDATE;

  v_balance := public.financial_account_balance(v_available_account_id);
  IF v_balance < p_amount_kobo THEN
    RAISE EXCEPTION 'insufficient available balance';
  END IF;

  INSERT INTO public.wallet_reservations (
    customer_id, order_id, amount_kobo, currency, environment, status, idempotency_key,
    expires_at, metadata
  ) VALUES (
    p_customer_id, p_order_id, p_amount_kobo, upper(btrim(COALESCE(p_currency, ''))), v_environment, 'ACTIVE', p_idempotency_key,
    p_expires_at, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO reservation_id;

  SELECT * INTO v_result
  FROM public.post_ledger_journal(
    'WALLET_RESERVATION',
    p_order_id::text,
    p_idempotency_key,
    p_currency,
    'reservation',
    'system',
    NULL,
    p_correlation_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('environment', v_environment, 'reservation_id', reservation_id, 'customer_id', p_customer_id, 'order_id', p_order_id),
    NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', v_available_account_id, 'side', 'DEBIT', 'amount_kobo', p_amount_kobo, 'metadata', jsonb_build_object('flow', 'reserve')),
      jsonb_build_object('account_id', v_reserved_account_id, 'side', 'CREDIT', 'amount_kobo', p_amount_kobo, 'metadata', jsonb_build_object('flow', 'reserve'))
    )
  );

  UPDATE public.wallet_reservations
  SET reservation_journal_id = v_result.journal_id,
      updated_at = now()
  WHERE id = reservation_id;

  journal_id := v_result.journal_id;
  replayed := FALSE;
  status := 'ACTIVE';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_wallet_reservation(
  p_reservation_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(reservation_id UUID, journal_id UUID, replayed BOOLEAN, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.wallet_reservations%ROWTYPE;
  v_available_account_id UUID;
  v_reserved_account_id UUID;
  v_result RECORD;
BEGIN
  SELECT * INTO v_reservation
  FROM public.wallet_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found';
  END IF;

  IF v_reservation.status = 'RELEASED' AND v_reservation.release_journal_id IS NOT NULL THEN
    reservation_id := v_reservation.id;
    journal_id := v_reservation.release_journal_id;
    replayed := TRUE;
    status := v_reservation.status;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_reservation.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation cannot be released from status %', v_reservation.status;
  END IF;

  v_available_account_id := public.ensure_financial_account('CUSTOMER_AVAILABLE', 'CUSTOMER', v_reservation.customer_id, v_reservation.currency, v_reservation.environment, p_metadata);
  v_reserved_account_id := public.ensure_financial_account('CUSTOMER_RESERVED', 'CUSTOMER', v_reservation.customer_id, v_reservation.currency, v_reservation.environment, p_metadata);

  SELECT * INTO v_result
  FROM public.post_ledger_journal(
    'WALLET_RESERVATION_RELEASE',
    v_reservation.order_id::text,
    p_idempotency_key,
    v_reservation.currency,
    'reservation',
    p_actor_type,
    p_actor_id,
    p_correlation_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('reservation_id', v_reservation.id, 'reason', p_reason, 'action', 'release'),
    NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', v_reserved_account_id, 'side', 'DEBIT', 'amount_kobo', v_reservation.amount_kobo, 'metadata', jsonb_build_object('flow', 'release')),
      jsonb_build_object('account_id', v_available_account_id, 'side', 'CREDIT', 'amount_kobo', v_reservation.amount_kobo, 'metadata', jsonb_build_object('flow', 'release'))
    )
  );

  UPDATE public.wallet_reservations
  SET status = 'RELEASED',
      released_at = now(),
      cancellation_reason = p_reason,
      release_journal_id = v_result.journal_id,
      updated_at = now()
  WHERE id = v_reservation.id;

  reservation_id := v_reservation.id;
  journal_id := v_result.journal_id;
  replayed := FALSE;
  status := 'RELEASED';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_wallet_reservation(
  p_reservation_id UUID,
  p_idempotency_key TEXT,
  p_correlation_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(reservation_id UUID, journal_id UUID, replayed BOOLEAN, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.wallet_reservations%ROWTYPE;
  v_result RECORD;
BEGIN
  SELECT * INTO v_reservation
  FROM public.wallet_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found';
  END IF;

  IF v_reservation.status = 'EXPIRED' AND v_reservation.release_journal_id IS NOT NULL THEN
    reservation_id := v_reservation.id;
    journal_id := v_reservation.release_journal_id;
    replayed := TRUE;
    status := v_reservation.status;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_reservation.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation cannot expire from status %', v_reservation.status;
  END IF;

  SELECT * INTO v_result
  FROM public.release_wallet_reservation(
    v_reservation.id,
    'expired',
    p_idempotency_key,
    'system',
    NULL,
    p_correlation_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('action', 'expire')
  );

  UPDATE public.wallet_reservations
  SET status = 'EXPIRED',
      released_at = now(),
      cancellation_reason = 'expired',
      release_journal_id = v_result.journal_id,
      updated_at = now()
  WHERE id = v_reservation.id;

  reservation_id := v_reservation.id;
  journal_id := v_result.journal_id;
  replayed := v_result.replayed;
  status := 'EXPIRED';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_wallet_reservation(
  p_reservation_id UUID,
  p_idempotency_key TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(reservation_id UUID, journal_id UUID, replayed BOOLEAN, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.wallet_reservations%ROWTYPE;
  v_reserved_account_id UUID;
  v_settlement_account_id UUID;
  v_result RECORD;
BEGIN
  SELECT * INTO v_reservation
  FROM public.wallet_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found';
  END IF;

  IF v_reservation.status = 'CONSUMED' AND v_reservation.consume_journal_id IS NOT NULL THEN
    reservation_id := v_reservation.id;
    journal_id := v_reservation.consume_journal_id;
    replayed := TRUE;
    status := v_reservation.status;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_reservation.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation cannot be consumed from status %', v_reservation.status;
  END IF;

  v_reserved_account_id := public.ensure_financial_account('CUSTOMER_RESERVED', 'CUSTOMER', v_reservation.customer_id, v_reservation.currency, v_reservation.environment, p_metadata);
  v_settlement_account_id := public.ensure_financial_account('SETTLEMENT_CLEARING', 'PLATFORM', NULL, v_reservation.currency, v_reservation.environment, p_metadata);

  SELECT * INTO v_result
  FROM public.post_ledger_journal(
    'WALLET_RESERVATION_CONSUME',
    v_reservation.order_id::text,
    p_idempotency_key,
    v_reservation.currency,
    'reservation',
    p_actor_type,
    p_actor_id,
    p_correlation_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('reservation_id', v_reservation.id, 'action', 'consume'),
    NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', v_reserved_account_id, 'side', 'DEBIT', 'amount_kobo', v_reservation.amount_kobo, 'metadata', jsonb_build_object('flow', 'consume')),
      jsonb_build_object('account_id', v_settlement_account_id, 'side', 'CREDIT', 'amount_kobo', v_reservation.amount_kobo, 'metadata', jsonb_build_object('flow', 'consume'))
    )
  );

  UPDATE public.wallet_reservations
  SET status = 'CONSUMED',
      consumed_at = now(),
      consume_journal_id = v_result.journal_id,
      updated_at = now()
  WHERE id = v_reservation.id;

  reservation_id := v_reservation.id;
  journal_id := v_result.journal_id;
  replayed := FALSE;
  status := 'CONSUMED';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_wallet_reservation(
  p_reservation_id UUID,
  p_idempotency_key TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(reservation_id UUID, journal_id UUID, replayed BOOLEAN, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.wallet_reservations%ROWTYPE;
  v_result RECORD;
BEGIN
  SELECT * INTO v_reservation
  FROM public.wallet_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found';
  END IF;

  IF v_reservation.status = 'REVERSED' AND v_reservation.reversal_journal_id IS NOT NULL THEN
    reservation_id := v_reservation.id;
    journal_id := v_reservation.reversal_journal_id;
    replayed := TRUE;
    status := v_reservation.status;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_reservation.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation cannot be reversed from status %', v_reservation.status;
  END IF;

  SELECT * INTO v_result
  FROM public.release_wallet_reservation(
    v_reservation.id,
    'reversed',
    p_idempotency_key,
    p_actor_type,
    p_actor_id,
    p_correlation_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('action', 'reverse')
  );

  UPDATE public.wallet_reservations
  SET status = 'REVERSED',
      reversed_at = now(),
      reversal_journal_id = v_result.journal_id,
      updated_at = now()
  WHERE id = v_reservation.id;

  reservation_id := v_reservation.id;
  journal_id := v_result.journal_id;
  replayed := v_result.replayed;
  status := 'REVERSED';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_due_wallet_reservations(
  p_cutoff TIMESTAMPTZ DEFAULT now()
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id
    FROM public.wallet_reservations
    WHERE status = 'ACTIVE'
      AND expires_at IS NOT NULL
      AND expires_at <= p_cutoff
    ORDER BY expires_at ASC
  LOOP
    PERFORM public.expire_wallet_reservation(
      v_row.id,
      'expire:' || v_row.id::text,
      'system',
      '{}'::jsonb
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_financial_account(TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.financial_account_balance(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.financial_account_balance_by_identity(TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_available_balance(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_reserved_balance(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_vendor_payable_balance(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_rider_payable_balance(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_fee_revenue_balance(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_settlement_balance(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_payout_cleared_balance(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_ledger_journal(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_ledger_journal(UUID, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_order_financial_snapshot(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_wallet_balance(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_wallet_reservation(UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_wallet_reservation(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_wallet_reservation(UUID, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_wallet_reservation(UUID, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_due_wallet_reservations(TIMESTAMPTZ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_financial_account(TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_account_balance(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_account_balance_by_identity(TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_available_balance(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_reserved_balance(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_payable_balance(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_rider_payable_balance(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_platform_fee_revenue_balance(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_settlement_balance(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payout_cleared_balance(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_ledger_journal(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_ledger_journal(UUID, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_order_financial_snapshot(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, INTEGER, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_wallet_balance(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_reservation(UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_wallet_reservation(UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_wallet_reservation(UUID, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_wallet_reservation(UUID, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_due_wallet_reservations(TIMESTAMPTZ) TO service_role;
