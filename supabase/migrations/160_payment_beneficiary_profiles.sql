-- Versioned vendor/rider payout profiles with Paystack recipient support.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.payment_beneficiary_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_type TEXT NOT NULL CHECK (beneficiary_type IN ('VENDOR', 'RIDER')),
  beneficiary_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'SUPERSEDED')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  bank_name TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_account_last4 TEXT NOT NULL CHECK (length(bank_account_last4) = 4),
  bank_account_masked TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  bank_account_number_hash TEXT NOT NULL,
  bank_account_number_encrypted TEXT NOT NULL,
  paystack_recipient_code TEXT,
  paystack_subaccount_code TEXT,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  profile_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_reason TEXT,
  verified_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (beneficiary_type, beneficiary_id, environment, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_beneficiary_profiles_active_uidx
  ON public.payment_beneficiary_profiles (beneficiary_type, beneficiary_id, environment)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS payment_beneficiary_profiles_recipient_uidx
  ON public.payment_beneficiary_profiles (paystack_recipient_code)
  WHERE paystack_recipient_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_beneficiary_profiles_subaccount_uidx
  ON public.payment_beneficiary_profiles (paystack_subaccount_code)
  WHERE paystack_subaccount_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_beneficiary_profiles_lookup_idx
  ON public.payment_beneficiary_profiles (beneficiary_type, beneficiary_id, environment, created_at DESC);

DROP TRIGGER IF EXISTS trg_payment_beneficiary_profiles_immutable ON public.payment_beneficiary_profiles;
CREATE TRIGGER trg_payment_beneficiary_profiles_immutable
BEFORE UPDATE OR DELETE ON public.payment_beneficiary_profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();

ALTER TABLE public.payment_beneficiary_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_beneficiary_profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_beneficiary_profiles TO service_role;

DROP POLICY IF EXISTS payment_beneficiary_profiles_service_role_all ON public.payment_beneficiary_profiles;
CREATE POLICY payment_beneficiary_profiles_service_role_all ON public.payment_beneficiary_profiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.upsert_payment_beneficiary_profile(
  p_beneficiary_type TEXT,
  p_beneficiary_id UUID,
  p_environment TEXT,
  p_bank_name TEXT,
  p_bank_code TEXT,
  p_bank_account_last4 TEXT,
  p_bank_account_masked TEXT,
  p_bank_account_name TEXT,
  p_bank_account_number_hash TEXT,
  p_bank_account_number_encrypted TEXT,
  p_verification_status TEXT,
  p_status TEXT,
  p_paystack_recipient_code TEXT DEFAULT NULL,
  p_paystack_subaccount_code TEXT DEFAULT NULL,
  p_provider_metadata JSONB DEFAULT '{}'::jsonb,
  p_profile_metadata JSONB DEFAULT '{}'::jsonb,
  p_verification_reason TEXT DEFAULT NULL
) RETURNS TABLE(profile_id UUID, version_number INTEGER, replayed BOOLEAN, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_env TEXT := lower(btrim(COALESCE(p_environment, '')));
  v_current public.payment_beneficiary_profiles%ROWTYPE;
  v_next_version INTEGER := 1;
BEGIN
  IF p_beneficiary_type NOT IN ('VENDOR', 'RIDER') THEN
    RAISE EXCEPTION 'unsupported beneficiary type: %', p_beneficiary_type;
  END IF;
  IF v_env NOT IN ('test', 'production') THEN
    RAISE EXCEPTION 'unsupported environment: %', p_environment;
  END IF;
  IF length(btrim(COALESCE(p_bank_name, ''))) = 0 THEN
    RAISE EXCEPTION 'bank name is required';
  END IF;
  IF length(btrim(COALESCE(p_bank_code, ''))) = 0 THEN
    RAISE EXCEPTION 'bank code is required';
  END IF;
  IF length(btrim(COALESCE(p_bank_account_last4, ''))) <> 4 THEN
    RAISE EXCEPTION 'bank account last4 is required';
  END IF;
  IF length(btrim(COALESCE(p_bank_account_masked, ''))) = 0 THEN
    RAISE EXCEPTION 'masked account number is required';
  END IF;
  IF length(btrim(COALESCE(p_bank_account_name, ''))) = 0 THEN
    RAISE EXCEPTION 'bank account name is required';
  END IF;
  IF length(btrim(COALESCE(p_bank_account_number_hash, ''))) = 0 THEN
    RAISE EXCEPTION 'bank account hash is required';
  END IF;
  IF length(btrim(COALESCE(p_bank_account_number_encrypted, ''))) = 0 THEN
    RAISE EXCEPTION 'encrypted bank account is required';
  END IF;
  IF p_verification_status NOT IN ('PENDING', 'VERIFIED', 'REJECTED') THEN
    RAISE EXCEPTION 'unsupported verification status: %', p_verification_status;
  END IF;
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'unsupported profile status: %', p_status;
  END IF;

  SELECT *
    INTO v_current
  FROM public.payment_beneficiary_profiles
  WHERE beneficiary_type = p_beneficiary_type
    AND beneficiary_id = p_beneficiary_id
    AND environment = v_env
    AND status = 'ACTIVE'
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_current.bank_account_number_hash = p_bank_account_number_hash
      AND v_current.bank_code = p_bank_code
      AND v_current.bank_account_name = p_bank_account_name
      AND COALESCE(v_current.paystack_recipient_code, '') = COALESCE(p_paystack_recipient_code, '')
      AND COALESCE(v_current.paystack_subaccount_code, '') = COALESCE(p_paystack_subaccount_code, '')
      AND v_current.verification_status = p_verification_status
    THEN
      profile_id := v_current.id;
      version_number := v_current.version_number;
      replayed := TRUE;
      status := v_current.status;
      RETURN NEXT;
      RETURN;
    END IF;

    UPDATE public.payment_beneficiary_profiles
    SET status = 'SUPERSEDED',
        superseded_at = now(),
        updated_at = now()
    WHERE id = v_current.id;

    v_next_version := v_current.version_number + 1;
  END IF;

  INSERT INTO public.payment_beneficiary_profiles (
    beneficiary_type, beneficiary_id, environment, version_number, status, verification_status,
    bank_name, bank_code, bank_account_last4, bank_account_masked, bank_account_name,
    bank_account_number_hash, bank_account_number_encrypted, paystack_recipient_code,
    paystack_subaccount_code, provider_metadata, profile_metadata, verification_reason,
    verified_at, created_at, updated_at
  ) VALUES (
    p_beneficiary_type, p_beneficiary_id, v_env, v_next_version, p_status, p_verification_status,
    p_bank_name, p_bank_code, p_bank_account_last4, p_bank_account_masked, p_bank_account_name,
    p_bank_account_number_hash, p_bank_account_number_encrypted, p_paystack_recipient_code,
    p_paystack_subaccount_code, COALESCE(p_provider_metadata, '{}'::jsonb), COALESCE(p_profile_metadata, '{}'::jsonb), p_verification_reason,
    CASE WHEN p_verification_status = 'VERIFIED' THEN now() ELSE NULL END, now(), now()
  )
  RETURNING id INTO profile_id;

  version_number := v_next_version;
  replayed := FALSE;
  status := p_status;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_payment_beneficiary_profile(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_payment_beneficiary_profile(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) TO service_role;
