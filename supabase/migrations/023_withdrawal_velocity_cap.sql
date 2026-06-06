-- ============================================================
-- LumeX Fud — Migration 023: Atomic withdrawal velocity caps
-- ============================================================
-- The daily/weekly withdrawal caps were enforced in the route by summing
-- wallet_transactions, THEN checking, THEN calling debit_wallet_withdrawal —
-- all outside the wallet-row lock. Two concurrent withdrawals could each read
-- the same running total, both pass the cap, and both debit. The atomic debit
-- still prevents an overdraft, but the velocity control (a fraud limit) could be
-- exceeded.
--
-- Fix: fold the cap check INTO the RPC, evaluated under the same FOR UPDATE lock
-- that serialises a user's withdrawals — so the running total is consistent and
-- the cap is race-free. Period boundaries are passed in by the caller (which
-- already computes local day/week starts).
--
-- Drops the old 5-arg signature and recreates with 9 args. Idempotent.
-- ============================================================

DROP FUNCTION IF EXISTS debit_wallet_withdrawal(TEXT, TEXT, BIGINT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION debit_wallet_withdrawal(
  p_user_id      TEXT,
  p_user_type    TEXT,
  p_amount       BIGINT,
  p_reference    TEXT,
  p_description  TEXT,
  p_daily_limit  BIGINT,
  p_daily_start  TIMESTAMPTZ,
  p_weekly_limit BIGINT,
  p_weekly_start TIMESTAMPTZ
) RETURNS TABLE(tx_id UUID, success BOOLEAN, error_msg TEXT) AS $$
DECLARE
  v_wb     RECORD;
  v_tx_id  UUID;
  v_daily  BIGINT;
  v_weekly BIGINT;
BEGIN
  -- Lock wallet row — serialises all of this user's withdrawals
  SELECT * INTO v_wb
  FROM wallet_balances
  WHERE user_id = p_user_id AND user_type = p_user_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'Wallet not found';
    RETURN;
  END IF;

  IF v_wb.is_frozen THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'Wallet is frozen';
    RETURN;
  END IF;

  IF v_wb.available_balance < p_amount THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'Insufficient available balance';
    RETURN;
  END IF;

  -- Velocity caps, evaluated inside the lock (race-free). Count everything that
  -- still holds funds out of the wallet — exclude only FAILED/REVERSED.
  SELECT COALESCE(SUM(amount), 0) INTO v_daily
  FROM wallet_transactions
  WHERE user_id = p_user_id AND user_type = p_user_type
    AND type = 'WITHDRAWAL' AND status NOT IN ('FAILED', 'REVERSED')
    AND created_at >= p_daily_start;

  IF v_daily + p_amount > p_daily_limit THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'Daily withdrawal limit reached';
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_weekly
  FROM wallet_transactions
  WHERE user_id = p_user_id AND user_type = p_user_type
    AND type = 'WITHDRAWAL' AND status NOT IN ('FAILED', 'REVERSED')
    AND created_at >= p_weekly_start;

  IF v_weekly + p_amount > p_weekly_limit THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'Weekly withdrawal limit reached';
    RETURN;
  END IF;

  -- Debit balance
  UPDATE wallet_balances
  SET
    total_balance     = total_balance - p_amount,
    available_balance = available_balance - p_amount,
    total_withdrawals = total_withdrawals + p_amount,
    updated_at        = NOW()
  WHERE user_id = p_user_id AND user_type = p_user_type;

  -- Log WITHDRAWAL as PENDING (Paystack webhook confirms completion)
  INSERT INTO wallet_transactions (
    user_id, user_type, type, amount,
    balance_before, balance_after,
    available_before, available_after,
    held_before, held_after,
    reference, description, status
  ) VALUES (
    p_user_id, p_user_type, 'WITHDRAWAL', p_amount,
    v_wb.total_balance,     v_wb.total_balance - p_amount,
    v_wb.available_balance, v_wb.available_balance - p_amount,
    v_wb.held_balance,      v_wb.held_balance,
    p_reference, p_description, 'PENDING'
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_tx_id, TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
