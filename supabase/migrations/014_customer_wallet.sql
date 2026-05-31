-- ============================================================
-- LumeX Fud — Migration 014: Customer Wallet System
-- Tables, RLS, auto-create trigger, atomic RPCs, settings.
-- Run AFTER 013_wallet.sql
-- ============================================================

-- ─── CUSTOMER WALLETS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_wallets (
  customer_id           UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  balance_kobo          BIGINT NOT NULL DEFAULT 0,
  lifetime_topup_kobo   BIGINT NOT NULL DEFAULT 0,
  lifetime_spent_kobo   BIGINT NOT NULL DEFAULT 0,
  is_frozen             BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_reason         TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE customer_wallets ENABLE ROW LEVEL SECURITY;

-- ─── CUSTOMER WALLET TRANSACTIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN (
    'TOPUP', 'TOPUP_BONUS', 'PAYMENT', 'REFUND', 'FREEZE', 'ADMIN_ADJUSTMENT'
  )),
  amount_kobo      BIGINT NOT NULL,
  balance_before_kobo BIGINT NOT NULL,
  balance_after_kobo  BIGINT NOT NULL,
  reference        TEXT UNIQUE,
  order_id         UUID,
  description      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'COMPLETED'
                     CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE customer_wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_customer_wallet_tx
  ON customer_wallet_transactions(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_wallet_tx_reference
  ON customer_wallet_transactions(reference)
  WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_wallet_tx_order
  ON customer_wallet_transactions(order_id)
  WHERE order_id IS NOT NULL;

-- ─── RLS POLICIES ─────────────────────────────────────────────────────────────

-- Customer sees own wallet
CREATE POLICY "customer_sees_own_wallet" ON customer_wallets
  FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone')
    )
  );

-- Customer sees own transactions
CREATE POLICY "customer_sees_own_wallet_tx" ON customer_wallet_transactions
  FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone')
    )
  );

-- Service role full access
CREATE POLICY "service_role_customer_wallet_all" ON customer_wallets
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_customer_wallet_tx_all" ON customer_wallet_transactions
  FOR ALL USING (auth.role() = 'service_role');

-- ─── AUTO-CREATE WALLET ON CUSTOMER SIGNUP ────────────────────────────────────
CREATE OR REPLACE FUNCTION create_customer_wallet()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO customer_wallets (customer_id)
  VALUES (NEW.id)
  ON CONFLICT (customer_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_customer_created_wallet ON customers;
CREATE TRIGGER on_customer_created_wallet
  AFTER INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION create_customer_wallet();

-- Backfill existing customers who don't yet have a wallet row
INSERT INTO customer_wallets (customer_id)
SELECT id FROM customers
WHERE id NOT IN (SELECT customer_id FROM customer_wallets)
ON CONFLICT DO NOTHING;

-- ─── ATOMIC RPC: topup_customer_wallet ───────────────────────────────────────
-- Atomically credits customer wallet from a Paystack webhook.
-- Creates both TOPUP and TOPUP_BONUS transactions in one transaction.
-- Idempotent: reference must be unique — duplicate calls return existing tx_id.
CREATE OR REPLACE FUNCTION topup_customer_wallet(
  p_customer_id  UUID,
  p_amount_kobo  BIGINT,
  p_bonus_kobo   BIGINT,
  p_reference    TEXT,
  p_description  TEXT
) RETURNS UUID AS $$
DECLARE
  v_cw    RECORD;
  v_tx_id UUID;
BEGIN
  -- Idempotency: return existing tx if reference already processed
  SELECT id INTO v_tx_id
  FROM customer_wallet_transactions
  WHERE reference = p_reference AND type = 'TOPUP';

  IF FOUND THEN
    RETURN v_tx_id;
  END IF;

  -- Ensure wallet exists
  INSERT INTO customer_wallets (customer_id)
  VALUES (p_customer_id)
  ON CONFLICT (customer_id) DO NOTHING;

  -- Lock wallet row
  SELECT * INTO v_cw
  FROM customer_wallets
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF v_cw.is_frozen THEN
    RAISE EXCEPTION 'Customer wallet is frozen';
  END IF;

  -- Debit balance = topup + bonus
  UPDATE customer_wallets
  SET
    balance_kobo        = balance_kobo + p_amount_kobo + p_bonus_kobo,
    lifetime_topup_kobo = lifetime_topup_kobo + p_amount_kobo,
    updated_at          = NOW()
  WHERE customer_id = p_customer_id;

  -- Log TOPUP transaction
  INSERT INTO customer_wallet_transactions (
    customer_id, type, amount_kobo,
    balance_before_kobo, balance_after_kobo,
    reference, description, status
  ) VALUES (
    p_customer_id, 'TOPUP', p_amount_kobo,
    v_cw.balance_kobo, v_cw.balance_kobo + p_amount_kobo + p_bonus_kobo,
    p_reference, p_description, 'COMPLETED'
  ) RETURNING id INTO v_tx_id;

  -- Log TOPUP_BONUS transaction (if bonus > 0)
  IF p_bonus_kobo > 0 THEN
    INSERT INTO customer_wallet_transactions (
      customer_id, type, amount_kobo,
      balance_before_kobo, balance_after_kobo,
      reference, description, status
    ) VALUES (
      p_customer_id, 'TOPUP_BONUS', p_bonus_kobo,
      v_cw.balance_kobo + p_amount_kobo,
      v_cw.balance_kobo + p_amount_kobo + p_bonus_kobo,
      'BONUS-' || p_reference,
      '5% top-up bonus 🎁',
      'COMPLETED'
    );
  END IF;

  RETURN v_tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── ATOMIC RPC: spend_customer_wallet ───────────────────────────────────────
-- Atomically debits customer wallet for an order payment.
-- Returns (success, error_msg, new_balance).
CREATE OR REPLACE FUNCTION spend_customer_wallet(
  p_customer_id UUID,
  p_amount_kobo BIGINT,
  p_order_id    UUID,
  p_reference   TEXT,
  p_description TEXT
) RETURNS TABLE(success BOOLEAN, error_msg TEXT, new_balance BIGINT) AS $$
DECLARE
  v_cw RECORD;
BEGIN
  -- Lock wallet
  SELECT * INTO v_cw
  FROM customer_wallets
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Wallet not found', 0::BIGINT;
    RETURN;
  END IF;

  IF v_cw.is_frozen THEN
    RETURN QUERY SELECT FALSE, 'Wallet is frozen', v_cw.balance_kobo;
    RETURN;
  END IF;

  IF v_cw.balance_kobo < p_amount_kobo THEN
    RETURN QUERY SELECT FALSE, 'Insufficient wallet balance', v_cw.balance_kobo;
    RETURN;
  END IF;

  -- Debit balance
  UPDATE customer_wallets
  SET
    balance_kobo        = balance_kobo - p_amount_kobo,
    lifetime_spent_kobo = lifetime_spent_kobo + p_amount_kobo,
    updated_at          = NOW()
  WHERE customer_id = p_customer_id;

  -- Log PAYMENT transaction
  INSERT INTO customer_wallet_transactions (
    customer_id, type, amount_kobo,
    balance_before_kobo, balance_after_kobo,
    reference, order_id, description, status
  ) VALUES (
    p_customer_id, 'PAYMENT', p_amount_kobo,
    v_cw.balance_kobo, v_cw.balance_kobo - p_amount_kobo,
    p_reference, p_order_id, p_description, 'COMPLETED'
  );

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_cw.balance_kobo - p_amount_kobo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── ATOMIC RPC: refund_customer_wallet ──────────────────────────────────────
-- Credits customer wallet for a refund (dispute resolution).
CREATE OR REPLACE FUNCTION refund_customer_wallet(
  p_customer_id UUID,
  p_amount_kobo BIGINT,
  p_order_id    UUID,
  p_reference   TEXT,
  p_description TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_cw RECORD;
BEGIN
  SELECT * INTO v_cw
  FROM customer_wallets
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE customer_wallets
  SET
    balance_kobo        = balance_kobo + p_amount_kobo,
    lifetime_spent_kobo = GREATEST(lifetime_spent_kobo - p_amount_kobo, 0),
    updated_at          = NOW()
  WHERE customer_id = p_customer_id;

  INSERT INTO customer_wallet_transactions (
    customer_id, type, amount_kobo,
    balance_before_kobo, balance_after_kobo,
    reference, order_id, description, status
  ) VALUES (
    p_customer_id, 'REFUND', p_amount_kobo,
    v_cw.balance_kobo, v_cw.balance_kobo + p_amount_kobo,
    p_reference, p_order_id, p_description, 'COMPLETED'
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── SETTINGS: Customer wallet top-up bonuses ─────────────────────────────────
-- Uses same schema as existing settings: id TEXT PK, value JSONB.
-- Percentage stored as {"value": N}, kobo amounts as {"amount_kobo": N}.
INSERT INTO settings (id, value) VALUES
  ('wallet_topup_bonus_percent',  '{"value": 5}'),
  ('wallet_min_topup_kobo',       '{"amount_kobo": 50000}'),
  ('wallet_max_topup_kobo',       '{"amount_kobo": 5000000}')
ON CONFLICT (id) DO NOTHING;

-- ─── SETTINGS: Rider milestone bonuses ────────────────────────────────────────
INSERT INTO settings (id, value) VALUES
  ('rider_bonus_50_kobo',          '{"amount_kobo": 50000}'),
  ('rider_bonus_100_kobo',         '{"amount_kobo": 100000}'),
  ('rider_bonus_300_monthly_kobo', '{"amount_kobo": 250000}'),
  ('rider_sunday_bonus_kobo',      '{"amount_kobo": 5000}')
ON CONFLICT (id) DO NOTHING;

-- ─── ORDERS: Add wallet payment tracking columns ──────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method      TEXT DEFAULT 'PAYSTACK'
    CHECK (payment_method IN ('PAYSTACK', 'WALLET', 'SPLIT')),
  ADD COLUMN IF NOT EXISTS wallet_amount_kobo  BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paystack_amount_kobo BIGINT DEFAULT 0;

-- ─── RIDER MILESTONE TRACKING ─────────────────────────────────────────────────
-- Tracks which bonuses have already been awarded to prevent double-award.
CREATE TABLE IF NOT EXISTS rider_milestone_bonuses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id    UUID NOT NULL REFERENCES riders(id),
  milestone   TEXT NOT NULL,   -- '50_deliveries', '100_deliveries', '2026-01_300_monthly'
  awarded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_kobo BIGINT NOT NULL,
  UNIQUE(rider_id, milestone)
);
ALTER TABLE rider_milestone_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_rider_milestones" ON rider_milestone_bonuses
  FOR ALL USING (auth.role() = 'service_role');
