-- Allow controlled lifecycle updates on payment profiles and payout history
-- while keeping snapshot-bearing fields immutable.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.prevent_payment_profile_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment beneficiary profiles are append-only';
  END IF;

  IF NEW.beneficiary_type IS DISTINCT FROM OLD.beneficiary_type
    OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.bank_code IS DISTINCT FROM OLD.bank_code
    OR NEW.bank_account_last4 IS DISTINCT FROM OLD.bank_account_last4
    OR NEW.bank_account_masked IS DISTINCT FROM OLD.bank_account_masked
    OR NEW.bank_account_name IS DISTINCT FROM OLD.bank_account_name
    OR NEW.bank_account_number_hash IS DISTINCT FROM OLD.bank_account_number_hash
    OR NEW.bank_account_number_encrypted IS DISTINCT FROM OLD.bank_account_number_encrypted
    OR NEW.paystack_recipient_code IS DISTINCT FROM OLD.paystack_recipient_code
    OR NEW.paystack_subaccount_code IS DISTINCT FROM OLD.paystack_subaccount_code
    OR NEW.provider_metadata IS DISTINCT FROM OLD.provider_metadata
    OR NEW.profile_metadata IS DISTINCT FROM OLD.profile_metadata
  THEN
    RAISE EXCEPTION 'payment beneficiary profile snapshot fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_payout_batch_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout batches are append-only';
  END IF;

  IF NEW.batch_reference IS DISTINCT FROM OLD.batch_reference
    OR NEW.beneficiary_type IS DISTINCT FROM OLD.beneficiary_type
    OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.total_amount_kobo IS DISTINCT FROM OLD.total_amount_kobo
    OR NEW.item_count IS DISTINCT FROM OLD.item_count
  THEN
    RAISE EXCEPTION 'payout batch snapshot fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_payout_batch_item_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout batch items are append-only';
  END IF;

  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
    OR NEW.beneficiary_type IS DISTINCT FROM OLD.beneficiary_type
    OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
    OR NEW.payment_profile_id IS DISTINCT FROM OLD.payment_profile_id
    OR NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.bank_code IS DISTINCT FROM OLD.bank_code
    OR NEW.bank_account_last4 IS DISTINCT FROM OLD.bank_account_last4
    OR NEW.bank_account_masked IS DISTINCT FROM OLD.bank_account_masked
    OR NEW.bank_account_name IS DISTINCT FROM OLD.bank_account_name
    OR NEW.paystack_recipient_code IS DISTINCT FROM OLD.paystack_recipient_code
    OR NEW.paystack_subaccount_code IS DISTINCT FROM OLD.paystack_subaccount_code
    OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference
    OR NEW.snapshot_metadata IS DISTINCT FROM OLD.snapshot_metadata
  THEN
    RAISE EXCEPTION 'payout batch item snapshot fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_payout_transfer_attempt_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout transfer attempts are append-only';
  END IF;

  IF NEW.payout_batch_item_id IS DISTINCT FROM OLD.payout_batch_item_id
    OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
    OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference
    OR NEW.initiated_at IS DISTINCT FROM OLD.initiated_at
  THEN
    RAISE EXCEPTION 'payout transfer attempt snapshot fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_beneficiary_profiles_immutable ON public.payment_beneficiary_profiles;
CREATE TRIGGER trg_payment_beneficiary_profiles_immutable
BEFORE UPDATE OR DELETE ON public.payment_beneficiary_profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_profile_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_payout_batches_immutable ON public.payout_batches;
CREATE TRIGGER trg_payout_batches_immutable
BEFORE UPDATE OR DELETE ON public.payout_batches
FOR EACH ROW EXECUTE FUNCTION public.prevent_payout_batch_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_payout_batch_items_immutable ON public.payout_batch_items;
CREATE TRIGGER trg_payout_batch_items_immutable
BEFORE UPDATE OR DELETE ON public.payout_batch_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_payout_batch_item_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_payout_transfer_attempts_immutable ON public.payout_transfer_attempts;
CREATE TRIGGER trg_payout_transfer_attempts_immutable
BEFORE UPDATE OR DELETE ON public.payout_transfer_attempts
FOR EACH ROW EXECUTE FUNCTION public.prevent_payout_transfer_attempt_snapshot_mutation();
