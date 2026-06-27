-- ============================================================
-- LumeX Fud — Migration 082: Gamification & engagement loop
-- ============================================================
-- Adds the launch-phase engagement mechanics as a SINGLE coherent system that
-- never violates the platform's money rules:
--
--   • reward_credits + reward_ledger — a PROMO-CREDIT LIABILITY ledger (kobo).
--       Every reward (referral, tier, surprise) is issued here as a tracked
--       liability and redeemed as an ORDER-LEVEL DISCOUNT — it is NEVER plain
--       cash dropped into customer_wallets. This is the crux: customer_wallets
--       stays exactly backed by Paystack top-ups, so DAILY WALLET RECONCILIATION
--       (non-negotiable rule #10) is untouched. The platform absorbs the discount
--       (out of its own markup / as marketing spend); vendor + rider payouts are
--       read from orders.subtotal / rider_delivery_cut / tip and are NEVER reduced.
--
--   • referral_codes + referrals — both-sided "The Plug": referrer AND new user
--       are rewarded on the new user's 1st AND 2nd COMPLETED order. Server-validated,
--       one referral per genuine new account, no self-referral.
--
--   • customer_tiers — bronze/silver/gold loyalty tier from 30-day completed-order
--       count, recomputed on completion; silver/gold unlock a monthly free-delivery
--       credit (issued through the same ledger).
--
--   • surprise_rewards — a server-decided, expiring scratch reward rolled on each
--       completed order. Outcome is decided AT CREATION (no client trust, no fake
--       "you almost won"); opening only reveals it.
--
--   • gamification_events — append-only, privacy-safe funnel analytics so every
--       mechanic's impact on repeat orders is measurable (rule: what we can't
--       measure gets cut).
--
-- Like streaks (037) and the leaderboard (024), the money-correct parts are driven
-- by TRIGGERS on the orders table, so they fire exactly once regardless of which
-- code path (status route, early-confirm, auto-complete cron) moves the order.
--
-- Single campus (ABSU). Idempotent — safe to re-run.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── Orders: discount tracking columns (additive, idempotent) ────────────────
-- reward_discount_kobo is the promo discount applied to THIS order (the amount
-- the platform absorbed). reward_credit_id links the credit lot that funded it.
-- total_amount on the order is the NET the customer pays (gross − discount), so
-- the Paystack webhook's amount check and vendor/rider payouts need NO changes.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reward_discount_kobo BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_credit_id     UUID;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. REWARD-CREDIT LIABILITY LEDGER
-- ═════════════════════════════════════════════════════════════════════════════

-- One row per issued credit "lot". remaining_kobo lets a credit be partly spent
-- across orders. A credit is the platform's LIABILITY until redeemed or expired.
CREATE TABLE IF NOT EXISTS reward_credits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('REFERRAL','TIER','SURPRISE','MANUAL')),
  amount_kobo   BIGINT NOT NULL CHECK (amount_kobo > 0),
  remaining_kobo BIGINT NOT NULL CHECK (remaining_kobo >= 0),
  reserved_kobo BIGINT NOT NULL DEFAULT 0 CHECK (reserved_kobo >= 0),
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','RESERVED','REDEEMED','EXPIRED','VOID')),
  label         TEXT NOT NULL DEFAULT 'Reward',
  min_order_kobo BIGINT NOT NULL DEFAULT 0,
  -- Idempotency key for issuance: one credit per source event (e.g. the same
  -- referral order can never mint two credits). UNIQUE, so issue is exactly-once.
  source_ref    TEXT UNIQUE,
  order_id      UUID,          -- the order this credit is reserved/redeemed against
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at   TIMESTAMPTZ
);
ALTER TABLE reward_credits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reward_credits_customer
  ON reward_credits (customer_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_reward_credits_order
  ON reward_credits (order_id) WHERE order_id IS NOT NULL;

-- Append-only double-entry trail: every state change of a credit is one signed
-- row. SUM(amount_kobo) over ISSUE − REDEEM − EXPIRE − VOID == outstanding
-- liability, which the reconciliation job reads. Never updated/deleted.
CREATE TABLE IF NOT EXISTS reward_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id   UUID NOT NULL REFERENCES reward_credits(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event       TEXT NOT NULL CHECK (event IN ('ISSUE','REDEEM','EXPIRE','VOID')),
  amount_kobo BIGINT NOT NULL,   -- signed: +ISSUE, −REDEEM/EXPIRE/VOID
  order_id    UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE reward_ledger ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_reward_ledger_credit ON reward_ledger (credit_id);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_event  ON reward_ledger (event, created_at);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. REFERRAL ("THE PLUG")
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_codes (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;

-- One row per referred customer (UNIQUE referred_id ⇒ a person can only ever be
-- referred once). status walks PENDING → QUALIFIED_1 → QUALIFIED_2 as the new
-- user completes their 1st and 2nd orders. signup_ip/device are fraud signals.
CREATE TABLE IF NOT EXISTS referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  referred_id   UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','QUALIFIED_1','QUALIFIED_2')),
  signup_ip     TEXT,
  signup_device TEXT,
  first_reward_at  TIMESTAMPTZ,
  second_reward_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Hard fraud guard at the schema level: you can never refer yourself.
  CONSTRAINT no_self_referral CHECK (referrer_id <> referred_id)
);
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id, status);

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. CUSTOMER LOYALTY TIERS
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_tiers (
  customer_id    UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  tier           TEXT NOT NULL DEFAULT 'BRONZE' CHECK (tier IN ('BRONZE','SILVER','GOLD')),
  orders_30d     INT  NOT NULL DEFAULT 0,
  spend_30d_kobo BIGINT NOT NULL DEFAULT 0,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE customer_tiers ENABLE ROW LEVEL SECURITY;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. SURPRISE REWARD (server-decided scratch on completion)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS surprise_rewards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id    UUID NOT NULL UNIQUE,         -- one surprise per completed order
  outcome_kobo BIGINT NOT NULL DEFAULT 0,   -- decided at creation; 0 = no prize
  status      TEXT NOT NULL DEFAULT 'UNOPENED'
                CHECK (status IN ('UNOPENED','OPENED','EXPIRED')),
  reward_credit_id UUID,                     -- set when opened with a prize
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at   TIMESTAMPTZ
);
ALTER TABLE surprise_rewards ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_surprise_customer
  ON surprise_rewards (customer_id, status, expires_at DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. ANALYTICS (append-only, privacy-safe funnel events)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gamification_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event       TEXT NOT NULL,        -- referral_sent | referral_converted | tier_up | streak_continue | streak_break | reward_claimed | leaderboard_view
  customer_id UUID,                 -- server-side only; never exposed to other users
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE gamification_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_gamification_events
  ON gamification_events (event, created_at DESC);

CREATE OR REPLACE FUNCTION log_gamification_event(p_event TEXT, p_customer UUID, p_meta JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO gamification_events (event, customer_id, meta)
  VALUES (p_event, p_customer, COALESCE(p_meta, '{}'::jsonb));
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS — owner-read where it helps the app; all writes via service role.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reward_credits','reward_ledger','referral_codes','referrals',
    'customer_tiers','surprise_rewards','gamification_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "service_role_all_%1$s" ON %1$s FOR ALL USING (auth.role() = ''service_role'')', t);
  END LOOP;
END $$;

-- Owner read for the customer_id-keyed tables (mirrors 037's phone-claim pattern).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['reward_credits','referral_codes','customer_tiers','surprise_rewards'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "owner_read_%1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "owner_read_%1$s" ON %1$s FOR SELECT USING ' ||
      '(customer_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> ''phone'')))', t);
  END LOOP;
END $$;

-- referrals is keyed by referrer_id / referred_id (no customer_id) — the owner is
-- either side of the relationship.
DROP POLICY IF EXISTS "owner_read_referrals" ON referrals;
CREATE POLICY "owner_read_referrals" ON referrals
  FOR SELECT USING (
    referrer_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
    OR referred_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- SETTINGS — every money/threshold value is live-tunable (rule #17: never hardcode).
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO settings (id, value) VALUES
  ('referral_reward_referrer_kobo', '{"amount_kobo": 30000}'),  -- ₦300 to the referrer per qualifying order
  ('referral_reward_referred_kobo', '{"amount_kobo": 20000}'),  -- ₦200 to the new user
  ('reward_credit_expiry_days',     '{"value": 30}'),
  ('reward_min_order_kobo',         '{"amount_kobo": 50000}'),  -- credit usable only on orders ≥ ₦500
  ('tier_silver_orders_30d',        '{"value": 8}'),
  ('tier_gold_orders_30d',          '{"value": 20}'),
  ('tier_free_delivery_kobo',       '{"amount_kobo": 50000}'),  -- monthly free-delivery credit (₦500 bike)
  ('surprise_reward_expiry_days',   '{"value": 7}')
ON CONFLICT (id) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════
-- ISSUANCE — exactly-once on source_ref.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION issue_reward_credit(
  p_customer    UUID,
  p_amount_kobo BIGINT,
  p_kind        TEXT,
  p_source_ref  TEXT,
  p_expires_at  TIMESTAMPTZ,
  p_min_order   BIGINT DEFAULT 0,
  p_label       TEXT DEFAULT 'Reward'
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RETURN NULL; END IF;

  -- Idempotent: a repeated source event returns the existing credit, never mints
  -- a second (this is what makes "no reward claimed twice" structural).
  SELECT id INTO v_id FROM reward_credits WHERE source_ref = p_source_ref;
  IF FOUND THEN RETURN v_id; END IF;

  INSERT INTO reward_credits (customer_id, kind, amount_kobo, remaining_kobo,
                              status, label, min_order_kobo, source_ref, expires_at)
  VALUES (p_customer, p_kind, p_amount_kobo, p_amount_kobo,
          'ACTIVE', p_label, COALESCE(p_min_order, 0), p_source_ref, p_expires_at)
  ON CONFLICT (source_ref) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN  -- lost a race; return whoever won
    SELECT id INTO v_id FROM reward_credits WHERE source_ref = p_source_ref;
    RETURN v_id;
  END IF;

  INSERT INTO reward_ledger (credit_id, customer_id, event, amount_kobo)
  VALUES (v_id, p_customer, 'ISSUE', p_amount_kobo);

  PERFORM log_gamification_event('reward_claimed', p_customer,
    jsonb_build_object('kind', p_kind, 'amount_kobo', p_amount_kobo, 'phase', 'issued'));
  RETURN v_id;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- RESERVE — pick the best usable credit for an order and earmark it (no spend yet).
-- Called once per order from checkout, AFTER the order row exists.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION reserve_reward_credit(
  p_customer    UUID,
  p_order_id    UUID,
  p_order_total BIGINT,
  p_max_apply   BIGINT
) RETURNS TABLE(applied_kobo BIGINT, credit_id UUID, label TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_credit RECORD;
  v_apply  BIGINT;
BEGIN
  -- Already reserved/redeemed for this order? Return it (idempotent on retry).
  SELECT rc.id, rc.reserved_kobo, rc.label INTO v_credit
    FROM reward_credits rc
   WHERE rc.order_id = p_order_id AND rc.status IN ('RESERVED','REDEEMED')
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_credit.reserved_kobo, v_credit.id, v_credit.label;
    RETURN;
  END IF;

  -- Hygiene: free this customer's stale reservations (order never paid) so the
  -- credit isn't stranded. Bounded to >1h old, still RESERVED.
  UPDATE reward_credits
     SET status = 'ACTIVE', reserved_kobo = 0, order_id = NULL
   WHERE customer_id = p_customer AND status = 'RESERVED' AND created_at < NOW() - INTERVAL '1 hour';

  IF p_max_apply IS NULL OR p_max_apply <= 0 THEN
    RETURN QUERY SELECT 0::BIGINT, NULL::UUID, NULL::TEXT; RETURN;
  END IF;

  -- Best eligible ACTIVE credit: soonest-expiring first (use it or lose it),
  -- then largest. Locked so a concurrent checkout can't double-reserve it.
  SELECT * INTO v_credit
    FROM reward_credits
   WHERE customer_id = p_customer
     AND status = 'ACTIVE'
     AND remaining_kobo > 0
     AND (expires_at IS NULL OR expires_at > NOW())
     AND min_order_kobo <= COALESCE(p_order_total, 0)
   ORDER BY expires_at ASC NULLS LAST, remaining_kobo DESC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::BIGINT, NULL::UUID, NULL::TEXT; RETURN;
  END IF;

  v_apply := LEAST(v_credit.remaining_kobo, p_max_apply);
  IF v_apply <= 0 THEN
    RETURN QUERY SELECT 0::BIGINT, NULL::UUID, NULL::TEXT; RETURN;
  END IF;

  UPDATE reward_credits
     SET status = 'RESERVED', reserved_kobo = v_apply, order_id = p_order_id
   WHERE id = v_credit.id;

  RETURN QUERY SELECT v_apply, v_credit.id, v_credit.label;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- COMMIT — order is PAID: turn the reservation into a real spend (REDEEM).
-- Fired by trigger so it can't drift across the wallet/card/split pay paths.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION commit_reward_credit(p_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v RECORD;
BEGIN
  SELECT * INTO v FROM reward_credits
   WHERE order_id = p_order_id AND status = 'RESERVED' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;   -- nothing to commit / already committed

  UPDATE reward_credits
     SET remaining_kobo = GREATEST(remaining_kobo - reserved_kobo, 0),
         status = CASE WHEN remaining_kobo - reserved_kobo <= 0 THEN 'REDEEMED' ELSE 'ACTIVE' END,
         order_id = CASE WHEN remaining_kobo - reserved_kobo <= 0 THEN p_order_id ELSE NULL END,
         reserved_kobo = 0,
         redeemed_at = NOW()
   WHERE id = v.id;

  INSERT INTO reward_ledger (credit_id, customer_id, event, amount_kobo, order_id)
  VALUES (v.id, v.customer_id, 'REDEEM', -v.reserved_kobo, p_order_id);
END;
$$;

-- RELEASE — order failed/cancelled before paying: hand the reservation back.
CREATE OR REPLACE FUNCTION release_reward_credit(p_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE reward_credits
     SET status = 'ACTIVE', reserved_kobo = 0, order_id = NULL
   WHERE order_id = p_order_id AND status = 'RESERVED';
END;
$$;

-- EXPIRE — lazy hygiene (called best-effort on read): retire lapsed credits.
CREATE OR REPLACE FUNCTION expire_reward_credits()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT := 0; r RECORD;
BEGIN
  FOR r IN
    SELECT id, customer_id, remaining_kobo FROM reward_credits
     WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= NOW()
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE reward_credits SET status = 'EXPIRED', remaining_kobo = 0 WHERE id = r.id;
    IF r.remaining_kobo > 0 THEN
      INSERT INTO reward_ledger (credit_id, customer_id, event, amount_kobo)
      VALUES (r.id, r.customer_id, 'EXPIRE', -r.remaining_kobo);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- REFERRAL ATTACH — link a new customer to a referrer's code (called at signup).
-- All fraud checks are here, server-side: code must exist, can't be your own,
-- you can't already be referred. Returns TRUE if a referral was created.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION attach_referral(
  p_referred UUID, p_code TEXT, p_ip TEXT DEFAULT NULL, p_device TEXT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_referrer UUID;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN RETURN FALSE; END IF;

  SELECT customer_id INTO v_referrer FROM referral_codes WHERE code = upper(trim(p_code));
  IF NOT FOUND OR v_referrer = p_referred THEN RETURN FALSE; END IF;     -- bad code / self-referral
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_id = p_referred) THEN RETURN FALSE; END IF;

  INSERT INTO referrals (referrer_id, referred_id, code, signup_ip, signup_device)
  VALUES (v_referrer, p_referred, upper(trim(p_code)), p_ip, p_device)
  ON CONFLICT (referred_id) DO NOTHING;

  PERFORM log_gamification_event('referral_sent', v_referrer,
    jsonb_build_object('referred_id', p_referred));
  RETURN TRUE;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TIER RECOMPUTE — 30-day completed-order count drives the tier. Silver/Gold get
-- a monthly free-delivery credit (idempotent per tier+month). Returns the tier.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION recompute_customer_tier(p_customer UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_orders INT;
  v_spend  BIGINT;
  v_silver INT;
  v_gold   INT;
  v_tier   TEXT;
  v_old    TEXT;
  v_fd     BIGINT;
  v_expdays INT;
  v_month  TEXT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0) INTO v_orders, v_spend
    FROM orders
   WHERE customer_id = p_customer AND status = 'COMPLETED'
     AND COALESCE(completed_at, delivered_at, updated_at) >= NOW() - INTERVAL '30 days';

  v_silver := COALESCE((SELECT (value->>'value')::int FROM settings WHERE id = 'tier_silver_orders_30d'), 8);
  v_gold   := COALESCE((SELECT (value->>'value')::int FROM settings WHERE id = 'tier_gold_orders_30d'), 20);

  v_tier := CASE WHEN v_orders >= v_gold THEN 'GOLD'
                 WHEN v_orders >= v_silver THEN 'SILVER'
                 ELSE 'BRONZE' END;

  SELECT tier INTO v_old FROM customer_tiers WHERE customer_id = p_customer;

  INSERT INTO customer_tiers (customer_id, tier, orders_30d, spend_30d_kobo, computed_at)
  VALUES (p_customer, v_tier, v_orders, v_spend, NOW())
  ON CONFLICT (customer_id) DO UPDATE
    SET tier = EXCLUDED.tier, orders_30d = EXCLUDED.orders_30d,
        spend_30d_kobo = EXCLUDED.spend_30d_kobo, computed_at = NOW();

  -- Perk: on SILVER/GOLD, grant ONE free-delivery credit per calendar month.
  IF v_tier IN ('SILVER','GOLD') THEN
    v_fd := COALESCE((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'tier_free_delivery_kobo'), 50000);
    v_expdays := COALESCE((SELECT (value->>'value')::int FROM settings WHERE id = 'reward_credit_expiry_days'), 30);
    v_month := to_char((NOW() AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM');
    PERFORM issue_reward_credit(
      p_customer, v_fd, 'TIER',
      'tier:' || v_tier || ':' || p_customer || ':' || v_month,
      NOW() + (v_expdays || ' days')::interval,
      COALESCE((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'reward_min_order_kobo'), 0),
      v_tier || ' perk: free delivery'
    );
  END IF;

  IF v_old IS DISTINCT FROM v_tier AND (v_old IS NOT NULL) THEN
    PERFORM log_gamification_event('tier_up', p_customer,
      jsonb_build_object('from', v_old, 'to', v_tier));
  END IF;
  RETURN v_tier;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- REFERRAL REWARD — on the referred user's 1st & 2nd COMPLETED order, reward both.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION award_referral_on_completion(p_customer UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref RECORD;
  v_done INT;
  v_to_referrer BIGINT;
  v_to_referred BIGINT;
  v_min BIGINT;
  v_expdays INT;
  v_exp TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_ref FROM referrals WHERE referred_id = p_customer FOR UPDATE;
  IF NOT FOUND OR v_ref.status = 'QUALIFIED_2' THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_done FROM orders
   WHERE customer_id = p_customer AND status = 'COMPLETED';

  v_to_referrer := COALESCE((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'referral_reward_referrer_kobo'), 30000);
  v_to_referred := COALESCE((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'referral_reward_referred_kobo'), 20000);
  v_min := COALESCE((SELECT (value->>'amount_kobo')::bigint FROM settings WHERE id = 'reward_min_order_kobo'), 0);
  v_expdays := COALESCE((SELECT (value->>'value')::int FROM settings WHERE id = 'reward_credit_expiry_days'), 30);
  v_exp := NOW() + (v_expdays || ' days')::interval;

  IF v_ref.status = 'PENDING' AND v_done >= 1 THEN
    PERFORM issue_reward_credit(v_ref.referrer_id, v_to_referrer, 'REFERRAL',
      'referral:1:referrer:' || v_ref.referred_id, v_exp, v_min, 'Referral reward 🎉');
    PERFORM issue_reward_credit(v_ref.referred_id, v_to_referred, 'REFERRAL',
      'referral:1:referred:' || v_ref.referred_id, v_exp, v_min, 'Welcome reward 🎉');
    UPDATE referrals SET status = 'QUALIFIED_1', first_reward_at = NOW() WHERE id = v_ref.id;
    PERFORM log_gamification_event('referral_converted', v_ref.referrer_id,
      jsonb_build_object('referred_id', v_ref.referred_id, 'milestone', 1));
  END IF;

  IF v_ref.status IN ('PENDING','QUALIFIED_1') AND v_done >= 2 THEN
    PERFORM issue_reward_credit(v_ref.referrer_id, v_to_referrer, 'REFERRAL',
      'referral:2:referrer:' || v_ref.referred_id, v_exp, v_min, 'Referral reward 🎉');
    PERFORM issue_reward_credit(v_ref.referred_id, v_to_referred, 'REFERRAL',
      'referral:2:referred:' || v_ref.referred_id, v_exp, v_min, 'Loyalty reward 🎉');
    UPDATE referrals SET status = 'QUALIFIED_2', second_reward_at = NOW() WHERE id = v_ref.id;
    PERFORM log_gamification_event('referral_converted', v_ref.referrer_id,
      jsonb_build_object('referred_id', v_ref.referred_id, 'milestone', 2));
  END IF;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- SURPRISE — roll a server-decided outcome for a completed order (once per order).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION roll_surprise_reward(p_customer UUID, p_order UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_roll   NUMERIC;
  v_kobo   BIGINT;
  v_expdays INT;
BEGIN
  IF EXISTS (SELECT 1 FROM surprise_rewards WHERE order_id = p_order) THEN RETURN; END IF;

  -- Honest, modest odds — decided NOW so opening is pure reveal. Most rolls win
  -- nothing; small wins are common, bigger ones rare. No money the platform can't
  -- absorb as marketing (all are order discounts via the credit ledger).
  v_roll := random();
  v_kobo := CASE
    WHEN v_roll < 0.55 THEN 0          -- 55% better luck next time
    WHEN v_roll < 0.82 THEN 10000      -- 27% ₦100 off
    WHEN v_roll < 0.96 THEN 20000      -- 14% ₦200 off
    ELSE 50000                         --  4% ₦500 off
  END;

  v_expdays := COALESCE((SELECT (value->>'value')::int FROM settings WHERE id = 'surprise_reward_expiry_days'), 7);

  INSERT INTO surprise_rewards (customer_id, order_id, outcome_kobo, status, expires_at)
  VALUES (p_customer, p_order, v_kobo, 'UNOPENED', NOW() + (v_expdays || ' days')::interval)
  ON CONFLICT (order_id) DO NOTHING;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TRIGGERS on orders
-- ═════════════════════════════════════════════════════════════════════════════

-- (a) On COMPLETED: referral rewards + tier recompute + surprise roll. COMPLETED
--     is the final, money-settled state — exactly where "1st/2nd completed order"
--     is defined. Guest orders (customer_id NULL) are skipped.
CREATE OR REPLACE FUNCTION on_order_completed_rewards()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  PERFORM award_referral_on_completion(NEW.customer_id);
  PERFORM recompute_customer_tier(NEW.customer_id);
  PERFORM roll_surprise_reward(NEW.customer_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_completed_rewards ON orders;
CREATE TRIGGER trg_order_completed_rewards
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED')
EXECUTE FUNCTION on_order_completed_rewards();

-- (b) On PAID: commit any reserved reward credit (the redemption money-event).
CREATE OR REPLACE FUNCTION on_order_paid_commit_reward()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM commit_reward_credit(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_paid_commit_reward ON orders;
CREATE TRIGGER trg_order_paid_commit_reward
AFTER UPDATE OF payment_status ON orders
FOR EACH ROW
WHEN (NEW.payment_status = 'PAID' AND OLD.payment_status IS DISTINCT FROM 'PAID')
EXECUTE FUNCTION on_order_paid_commit_reward();

-- (c) On CANCELLED: release the reservation back to ACTIVE (only touches RESERVED,
--     so a credit already committed on a paid-then-cancelled order is untouched).
CREATE OR REPLACE FUNCTION on_order_cancelled_release_reward()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM release_reward_credit(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_cancelled_release_reward ON orders;
CREATE TRIGGER trg_order_cancelled_release_reward
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
EXECUTE FUNCTION on_order_cancelled_release_reward();

-- (d) On DELETE (rollback paths drop the reserved order before payment): release.
CREATE OR REPLACE FUNCTION on_order_deleted_release_reward()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM release_reward_credit(OLD.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_deleted_release_reward ON orders;
CREATE TRIGGER trg_order_deleted_release_reward
AFTER DELETE ON orders
FOR EACH ROW
EXECUTE FUNCTION on_order_deleted_release_reward();
