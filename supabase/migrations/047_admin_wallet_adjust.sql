-- ============================================================
-- LumeX Fud — Migration 047: Manual wallet adjustment RPCs
-- ============================================================
-- Lets an admin/super-admin credit or debit a wallet by a signed amount, atomic
-- (SELECT FOR UPDATE) with a ledger row of type ADMIN_ADJUSTMENT. p_amount is
-- kobo: positive = credit, negative = debit. A debit can't push a balance below
-- zero. Idempotent on the unique `reference`. Used by /api/admin/wallet-adjust.
-- ============================================================

-- ── Vendor / rider wallet (wallet_balances) ──────────────────────────────────
CREATE OR REPLACE FUNCTION admin_adjust_wallet(
  p_user_id   TEXT,
  p_user_type TEXT,
  p_amount    BIGINT,
  p_reason    TEXT,
  p_by        TEXT,
  p_reference TEXT
) RETURNS JSONB AS $$
DECLARE
  v           RECORD;
  v_new_avail BIGINT;
  v_new_total BIGINT;
BEGIN
  SELECT total_balance, available_balance, held_balance
    INTO v
    FROM wallet_balances
   WHERE user_id = p_user_id AND user_type = p_user_type
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  v_new_avail := v.available_balance + p_amount;
  IF v_new_avail < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Debit exceeds available balance');
  END IF;
  v_new_total := v.total_balance + p_amount;

  UPDATE wallet_balances
     SET available_balance = v_new_avail, total_balance = v_new_total, updated_at = NOW()
   WHERE user_id = p_user_id AND user_type = p_user_type;

  INSERT INTO wallet_transactions (
    user_id, user_type, type, amount,
    balance_before, balance_after,
    available_before, available_after,
    held_before, held_after,
    reference, description, status, initiated_by
  ) VALUES (
    p_user_id, p_user_type, 'ADMIN_ADJUSTMENT', p_amount,
    v.total_balance, v_new_total,
    v.available_balance, v_new_avail,
    v.held_balance, v.held_balance,
    p_reference, p_reason, 'COMPLETED', p_by
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Customer wallet (customer_wallets) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_adjust_customer_wallet(
  p_customer_id UUID,
  p_amount      BIGINT,
  p_reason      TEXT,
  p_reference   TEXT
) RETURNS JSONB AS $$
DECLARE
  v_bal BIGINT;
  v_new BIGINT;
BEGIN
  SELECT balance_kobo INTO v_bal FROM customer_wallets WHERE customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  v_new := v_bal + p_amount;
  IF v_new < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Debit exceeds balance');
  END IF;

  UPDATE customer_wallets SET balance_kobo = v_new, updated_at = NOW() WHERE customer_id = p_customer_id;

  INSERT INTO customer_wallet_transactions (
    customer_id, type, amount_kobo, balance_before_kobo, balance_after_kobo, reference, description, status
  ) VALUES (
    p_customer_id, 'ADMIN_ADJUSTMENT', p_amount, v_bal, v_new, p_reference, p_reason, 'COMPLETED'
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
