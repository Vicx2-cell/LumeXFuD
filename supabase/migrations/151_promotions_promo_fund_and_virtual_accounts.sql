-- Launch promotions, controlled marketing fund, and Paystack virtual-account records.
-- This migration intentionally creates no customer balance or stored-value wallet.

CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  promotion_kind TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (promotion_kind IN ('STANDARD','VENDOR','GROUP_ORDER','REFERRAL','AMBASSADOR')),
  discount_type TEXT NOT NULL
    CHECK (discount_type IN ('FIXED','PERCENTAGE','DELIVERY','FREE_DELIVERY','PLATFORM_FEE')),
  value_kobo BIGINT NOT NULL DEFAULT 0 CHECK (value_kobo >= 0),
  percentage_bps INTEGER NOT NULL DEFAULT 0 CHECK (percentage_bps BETWEEN 0 AND 10000),
  percentage_cap_kobo BIGINT CHECK (percentage_cap_kobo IS NULL OR percentage_cap_kobo >= 0),
  minimum_subtotal_kobo BIGINT NOT NULL DEFAULT 0 CHECK (minimum_subtotal_kobo >= 0),
  eligible_vendor_id UUID REFERENCES public.vendors(id) ON DELETE RESTRICT,
  eligible_category TEXT,
  eligible_campus_id UUID REFERENCES public.cities(id) ON DELETE RESTRICT,
  first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
  group_order_only BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  total_uses_limit INTEGER CHECK (total_uses_limit IS NULL OR total_uses_limit > 0),
  uses_per_customer INTEGER CHECK (uses_per_customer IS NULL OR uses_per_customer > 0),
  funding_source TEXT NOT NULL CHECK (funding_source IN ('LUMEX','VENDOR')),
  campaign_budget_kobo BIGINT CHECK (campaign_budget_kobo IS NULL OR campaign_budget_kobo > 0),
  status TEXT NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('ACTIVE','PAUSED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > starts_at),
  CHECK (funding_source <> 'VENDOR' OR eligible_vendor_id IS NOT NULL),
  CHECK (
    (discount_type = 'PERCENTAGE' AND percentage_bps > 0)
    OR (discount_type <> 'PERCENTAGE' AND value_kobo > 0)
    OR (discount_type = 'FREE_DELIVERY')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS promotions_code_upper_uidx ON public.promotions (upper(code));
CREATE INDEX IF NOT EXISTS promotions_launch_lookup_idx ON public.promotions (upper(code), status, starts_at, expires_at);

CREATE TABLE IF NOT EXISTS public.promo_fund_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('CREDIT','RESERVE','COMMIT','RELEASE','RECONCILED_CREDIT')),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  promotion_id UUID REFERENCES public.promotions(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promo_fund_ledger_campaign_idx ON public.promo_fund_ledger (promotion_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_promo_fund_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'promo fund ledger is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_promo_fund_ledger_immutable ON public.promo_fund_ledger;
CREATE TRIGGER trg_promo_fund_ledger_immutable
BEFORE UPDATE OR DELETE ON public.promo_fund_ledger
FOR EACH ROW EXECUTE FUNCTION public.prevent_promo_fund_ledger_mutation();

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  order_id UUID UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL,
  discount_kobo BIGINT NOT NULL CHECK (discount_kobo > 0),
  funding_source TEXT NOT NULL CHECK (funding_source IN ('LUMEX','VENDOR')),
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','COMMITTED','RELEASED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  committed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promo_redemptions_limits_idx
  ON public.promo_redemptions (promotion_id, customer_id, status);
CREATE INDEX IF NOT EXISTS promo_redemptions_expiry_idx
  ON public.promo_redemptions (status, expires_at);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES public.promotions(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_discount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (promo_discount_kobo >= 0);

CREATE TABLE IF NOT EXISTS public.customer_virtual_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE RESTRICT,
  consented_at TIMESTAMPTZ NOT NULL,
  consent_version TEXT NOT NULL,
  paystack_customer_code TEXT UNIQUE,
  provider_slug TEXT,
  bank_name TEXT,
  account_name TEXT,
  account_number TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROVISIONING','ACTIVE','FAILED','DISABLED')),
  failure_reason TEXT,
  identity_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  assignment_reference TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.virtual_account_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_virtual_account_id UUID NOT NULL REFERENCES public.customer_virtual_accounts(id) ON DELETE RESTRICT,
  paystack_reference TEXT NOT NULL UNIQUE,
  paystack_transaction_id TEXT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'UNALLOCATED'
    CHECK (status IN ('UNALLOCATED','MATCHED_TO_ORDER','REFUNDED','REVIEW_REQUIRED')),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_fund_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_virtual_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_account_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.promotions, public.promo_fund_ledger, public.promo_redemptions,
  public.customer_virtual_accounts, public.virtual_account_receipts FROM anon, authenticated;

CREATE OR REPLACE VIEW public.promo_fund_summary AS
SELECT
  COALESCE(sum(amount_kobo) FILTER (WHERE entry_type IN ('CREDIT','RECONCILED_CREDIT')), 0)::BIGINT AS total_funded_kobo,
  COALESCE(sum(amount_kobo) FILTER (WHERE entry_type = 'COMMIT'), 0)::BIGINT AS total_spent_kobo,
  COALESCE((SELECT sum(discount_kobo) FROM public.promo_redemptions WHERE status = 'RESERVED'), 0)::BIGINT AS reserved_kobo,
  (
    COALESCE(sum(amount_kobo) FILTER (WHERE entry_type IN ('CREDIT','RECONCILED_CREDIT')), 0)
    - COALESCE(sum(amount_kobo) FILTER (WHERE entry_type = 'COMMIT'), 0)
    - COALESCE((SELECT sum(discount_kobo) FROM public.promo_redemptions WHERE status = 'RESERVED'), 0)
  )::BIGINT AS available_kobo
FROM public.promo_fund_ledger;
REVOKE ALL ON public.promo_fund_summary FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.recharge_promo_fund(
  p_amount BIGINT, p_key TEXT, p_provider_reference TEXT, p_reason TEXT,
  p_actor_id TEXT, p_actor_role TEXT, p_reconciled BOOLEAN DEFAULT FALSE
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_amount <= 0 OR length(trim(p_key)) < 8 OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'invalid promo fund credit';
  END IF;
  IF p_reconciled AND p_actor_role <> 'super_admin' THEN RAISE EXCEPTION 'elevated authorization required'; END IF;
  INSERT INTO promo_fund_ledger(entry_type, amount_kobo, idempotency_key, provider_reference, reason, actor_id, actor_role)
  VALUES (CASE WHEN p_reconciled THEN 'RECONCILED_CREDIT' ELSE 'CREDIT' END, p_amount, p_key,
    nullif(trim(p_provider_reference), ''), trim(p_reason), p_actor_id, p_actor_role)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM promo_fund_ledger
    WHERE idempotency_key = p_key
      AND entry_type = CASE WHEN p_reconciled THEN 'RECONCILED_CREDIT' ELSE 'CREDIT' END
      AND amount_kobo = p_amount
      AND provider_reference IS NOT DISTINCT FROM nullif(trim(p_provider_reference), '')
      AND reason = trim(p_reason);
    IF v_id IS NULL THEN RAISE EXCEPTION 'promo fund idempotency conflict'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_launch_promotion(
  p_code TEXT, p_customer UUID, p_order UUID, p_vendor UUID, p_category TEXT,
  p_campus UUID, p_subtotal BIGINT, p_delivery BIGINT, p_platform_fee BIGINT,
  p_vendor_settlement BIGINT, p_is_group BOOLEAN, p_key TEXT, p_expires_at TIMESTAMPTZ
) RETURNS TABLE(promotion_id UUID, discount_kobo BIGINT, funding_source TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p promotions%ROWTYPE; v_discount BIGINT; v_total BIGINT; v_customer BIGINT;
  v_first BOOLEAN; v_campaign_spend BIGINT; v_available BIGINT; v_kill BOOLEAN;
BEGIN
  SELECT COALESCE((value->>'enabled')::boolean, FALSE) INTO v_kill FROM settings WHERE id = 'promo.kill_switch';
  IF COALESCE(v_kill, FALSE) THEN RAISE EXCEPTION 'promotions are paused'; END IF;
  SELECT * INTO p FROM promotions WHERE upper(code) = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND OR p.status <> 'ACTIVE' OR now() < p.starts_at OR (p.expires_at IS NOT NULL AND now() >= p.expires_at)
    THEN RAISE EXCEPTION 'promotion unavailable'; END IF;
  IF p_subtotal < p.minimum_subtotal_kobo
    OR (p.eligible_vendor_id IS NOT NULL AND p.eligible_vendor_id <> p_vendor)
    OR (p.eligible_category IS NOT NULL AND upper(p.eligible_category) <> upper(COALESCE(p_category,'')))
    OR (p.eligible_campus_id IS NOT NULL AND p.eligible_campus_id IS DISTINCT FROM p_campus)
    OR (p.group_order_only AND NOT p_is_group)
    OR (p.promotion_kind = 'GROUP_ORDER' AND NOT p_is_group)
    THEN RAISE EXCEPTION 'promotion not eligible'; END IF;
  SELECT count(*) = 0 INTO v_first FROM orders WHERE customer_id = p_customer AND payment_status = 'PAID';
  IF p.first_order_only AND (p_customer IS NULL OR NOT v_first) THEN RAISE EXCEPTION 'first order only'; END IF;
  SELECT count(*) INTO v_total FROM promo_redemptions WHERE promo_redemptions.promotion_id = p.id AND status IN ('RESERVED','COMMITTED');
  IF p.total_uses_limit IS NOT NULL AND v_total >= p.total_uses_limit THEN RAISE EXCEPTION 'promotion use limit reached'; END IF;
  IF p_customer IS NOT NULL THEN
    SELECT count(*) INTO v_customer FROM promo_redemptions WHERE promo_redemptions.promotion_id = p.id
      AND customer_id = p_customer AND status IN ('RESERVED','COMMITTED');
    IF p.uses_per_customer IS NOT NULL AND v_customer >= p.uses_per_customer THEN RAISE EXCEPTION 'customer use limit reached'; END IF;
  ELSIF p.uses_per_customer IS NOT NULL OR p.first_order_only THEN
    RAISE EXCEPTION 'registered customer required';
  END IF;
  v_discount := CASE p.discount_type
    WHEN 'PERCENTAGE' THEN LEAST((p_subtotal * p.percentage_bps) / 10000, COALESCE(p.percentage_cap_kobo, 9223372036854775807))
    WHEN 'DELIVERY' THEN LEAST(p_delivery, p.value_kobo)
    WHEN 'FREE_DELIVERY' THEN LEAST(p_delivery, CASE WHEN p.value_kobo > 0 THEN p.value_kobo ELSE p_delivery END)
    WHEN 'PLATFORM_FEE' THEN LEAST(p_platform_fee, p.value_kobo)
    ELSE LEAST(p_subtotal, p.value_kobo) END;
  IF p.funding_source = 'VENDOR' THEN
    v_discount := LEAST(v_discount, GREATEST(0, p_vendor_settlement));
  END IF;
  IF v_discount <= 0 THEN RAISE EXCEPTION 'promotion has no applicable value'; END IF;
  SELECT COALESCE(sum(promo_redemptions.discount_kobo),0) INTO v_campaign_spend FROM promo_redemptions
    WHERE promo_redemptions.promotion_id = p.id AND status IN ('RESERVED','COMMITTED');
  IF p.campaign_budget_kobo IS NOT NULL AND v_campaign_spend + v_discount > p.campaign_budget_kobo
    THEN RAISE EXCEPTION 'campaign budget exhausted'; END IF;
  IF p.funding_source = 'LUMEX' THEN
    LOCK TABLE promo_fund_ledger IN SHARE ROW EXCLUSIVE MODE;
    SELECT available_kobo INTO v_available FROM promo_fund_summary;
    IF COALESCE(v_available,0) < v_discount THEN RAISE EXCEPTION 'insufficient promo funds'; END IF;
  END IF;
  INSERT INTO promo_redemptions(promotion_id, customer_id, order_id, discount_kobo, funding_source, idempotency_key, expires_at)
  VALUES (p.id, p_customer, p_order, v_discount, p.funding_source, p_key, p_expires_at)
  ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING promo_redemptions.promotion_id, promo_redemptions.discount_kobo, promo_redemptions.funding_source
  INTO promotion_id, discount_kobo, funding_source;
  IF p.funding_source = 'LUMEX' THEN
    INSERT INTO promo_fund_ledger(entry_type, amount_kobo, promotion_id, order_id, idempotency_key, reason, actor_id, actor_role)
    VALUES ('RESERVE', v_discount, p.id, p_order, 'reserve:' || p_key, 'Checkout promotion reservation', COALESCE(p_customer::text,'guest'), 'system')
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.settle_order_promotion(p_order UUID, p_commit BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r promo_redemptions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM promo_redemptions WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR r.status <> 'RESERVED' THEN RETURN FALSE; END IF;
  UPDATE promo_redemptions SET status = CASE WHEN p_commit THEN 'COMMITTED' ELSE 'RELEASED' END,
    committed_at = CASE WHEN p_commit THEN now() ELSE committed_at END,
    released_at = CASE WHEN p_commit THEN released_at ELSE now() END, updated_at = now() WHERE id = r.id;
  IF r.funding_source = 'LUMEX' THEN
    INSERT INTO promo_fund_ledger(entry_type, amount_kobo, promotion_id, order_id, idempotency_key, reason, actor_id, actor_role)
    VALUES (CASE WHEN p_commit THEN 'COMMIT' ELSE 'RELEASE' END, r.discount_kobo, r.promotion_id, p_order,
      (CASE WHEN p_commit THEN 'commit:' ELSE 'release:' END) || r.idempotency_key,
      COALESCE(p_reason, CASE WHEN p_commit THEN 'Confirmed order payment' ELSE 'Payment failed or expired' END), 'payment-system', 'system')
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.order_promotion_payment_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status = 'PAID' AND OLD.payment_status IS DISTINCT FROM 'PAID' THEN
    PERFORM settle_order_promotion(NEW.id, TRUE, 'Confirmed order payment');
  ELSIF NEW.payment_status = 'FAILED' AND OLD.payment_status = 'PENDING' THEN
    PERFORM settle_order_promotion(NEW.id, FALSE, 'Failed payment');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_promotion_payment ON public.orders;
CREATE TRIGGER trg_order_promotion_payment AFTER UPDATE OF payment_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.order_promotion_payment_trigger();

CREATE OR REPLACE FUNCTION public.order_promotion_delete_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM settle_order_promotion(OLD.id, FALSE, 'Checkout creation rolled back');
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_order_promotion_delete ON public.orders;
CREATE TRIGGER trg_order_promotion_delete BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.order_promotion_delete_trigger();

CREATE OR REPLACE FUNCTION public.release_expired_promo_reservations()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT order_id FROM promo_redemptions WHERE status = 'RESERVED' AND expires_at <= now() FOR UPDATE SKIP LOCKED LOOP
    IF settle_order_promotion(r.order_id, FALSE, 'Expired payment reservation') THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.recharge_promo_fund(BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_launch_promotion(TEXT,UUID,UUID,UUID,TEXT,UUID,BIGINT,BIGINT,BIGINT,BIGINT,BOOLEAN,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_order_promotion(UUID,BOOLEAN,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_expired_promo_reservations() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON public.promotions TO service_role;
GRANT SELECT, INSERT ON public.promo_fund_ledger TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.promo_redemptions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.customer_virtual_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.virtual_account_receipts TO service_role;
GRANT SELECT ON public.promo_fund_summary TO service_role;
GRANT EXECUTE ON FUNCTION public.recharge_promo_fund(BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_launch_promotion(TEXT,UUID,UUID,UUID,TEXT,UUID,BIGINT,BIGINT,BIGINT,BIGINT,BOOLEAN,TEXT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_order_promotion(UUID,BOOLEAN,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_promo_reservations() TO service_role;
