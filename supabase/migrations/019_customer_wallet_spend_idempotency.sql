-- ============================================================
-- LumeX Fud — Migration 019: Customer wallet spend idempotency
-- ============================================================
-- Fixes a double-spend hole: spend_customer_wallet (014) had NO idempotency
-- guard, and /api/customer-wallet/use generated a random reference per call
-- and never mutated the order — so two calls for the same order (double-submit,
-- retry, or a malicious client) both debited the wallet. Real, drainable money.
--
-- Two-layer fix:
--   1. DB backstop: at most one settled wallet PAYMENT per order_id (unique idx).
--   2. RPC guard: re-check inside the per-customer wallet-row lock (FOR UPDATE),
--      so concurrent same-order calls serialize and the 2nd returns idempotently
--      instead of debiting again. The route now also sends a deterministic
--      reference (CWUSE-<order_id>) which the existing UNIQUE(reference) catches.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ─── 1. DB backstop: one settled wallet payment per order ─────────────────────
-- NOTE: if a prior double-charge left two COMPLETED PAYMENT rows for the same
-- order, this index creation will fail — clean up the duplicate transaction(s)
-- first, then re-run. (Early MVP: expected to be zero rows.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cwt_order_payment
  ON customer_wallet_transactions(order_id)
  WHERE type = 'PAYMENT' AND status = 'COMPLETED' AND order_id IS NOT NULL;

-- ─── 2. Idempotent spend_customer_wallet ──────────────────────────────────────
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
  -- Lock the wallet row FIRST. All spends for a given customer (and therefore
  -- all spends for any one of their orders) serialize here, which makes the
  -- idempotency check below race-free for the same-order case.
  SELECT * INTO v_cw
  FROM customer_wallets
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Wallet not found', 0::BIGINT;
    RETURN;
  END IF;

  -- Idempotency: this order's wallet payment already settled → return the
  -- current balance WITHOUT debiting again. Checked inside the lock, so a
  -- concurrent duplicate that was still in flight has already committed its row.
  IF EXISTS (
    SELECT 1 FROM customer_wallet_transactions
    WHERE order_id = p_order_id AND type = 'PAYMENT' AND status = 'COMPLETED'
  ) THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT, v_cw.balance_kobo;
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

  UPDATE customer_wallets
  SET
    balance_kobo        = balance_kobo - p_amount_kobo,
    lifetime_spent_kobo = lifetime_spent_kobo + p_amount_kobo,
    updated_at          = NOW()
  WHERE customer_id = p_customer_id;

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
