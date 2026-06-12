-- ============================================================
-- LumeX Fud — Migration 028: credit_wallet reversal RPC + balance guards
-- ============================================================
-- Two fixes from the 2026-06-09 wallet-balance audit:
--
-- C1 (CRITICAL): lib/paystack/webhook.ts handles transfer.failed /
--   transfer.reversed by calling db.rpc('credit_wallet', ...) — but no
--   migration ever defined that function (only credit_wallet_held exists).
--   The call errored silently, so when Paystack asynchronously failed or
--   reversed a payout AFTER the withdraw route had already marked the
--   withdrawal COMPLETED, the debited balance was NEVER restored — the
--   rider/vendor permanently lost the money. This creates the missing RPC.
--
-- C2 (defense-in-depth): wallet_balances and customer_wallets had no
--   CHECK(... >= 0) constraints. Negative balances were prevented only by
--   IF-guards inside the RPCs, with no database backstop. Add the guards.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- ─── C1: credit_wallet — atomic withdrawal reversal ──────────────────────────
-- Restores a debited withdrawal to a vendor/rider wallet. Matches the call
-- signature already used in lib/paystack/webhook.ts:
--   credit_wallet(p_user_id, p_user_type, p_amount, p_reference)
--
-- Idempotent on p_reference (wallet_transactions.reference is UNIQUE): a
-- duplicate Paystack webhook — or both a transfer.failed AND a transfer.reversed
-- for the same transfer — credits the wallet at most once.
CREATE OR REPLACE FUNCTION credit_wallet(
  p_user_id   TEXT,
  p_user_type TEXT,
  p_amount    BIGINT,
  p_reference TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_wb RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN FALSE;
  END IF;

  -- Idempotency: this reversal already settled → no-op.
  IF EXISTS (SELECT 1 FROM wallet_transactions WHERE reference = p_reference) THEN
    RETURN TRUE;
  END IF;

  -- Lock wallet row for the duration of this transaction.
  SELECT total_balance, available_balance, held_balance
  INTO v_wb
  FROM wallet_balances
  WHERE user_id = p_user_id AND user_type = p_user_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Restore total + available; unwind the withdrawal tally (never below 0).
  UPDATE wallet_balances
  SET
    total_balance     = total_balance + p_amount,
    available_balance = available_balance + p_amount,
    total_withdrawals = GREATEST(total_withdrawals - p_amount, 0),
    updated_at        = NOW()
  WHERE user_id = p_user_id AND user_type = p_user_type;

  -- Ledger entry.
  INSERT INTO wallet_transactions (
    user_id, user_type, type, amount,
    balance_before, balance_after,
    available_before, available_after,
    held_before, held_after,
    reference, description, status
  ) VALUES (
    p_user_id, p_user_type, 'WITHDRAWAL_REVERSAL', p_amount,
    v_wb.total_balance,     v_wb.total_balance + p_amount,
    v_wb.available_balance, v_wb.available_balance + p_amount,
    v_wb.held_balance,      v_wb.held_balance,
    p_reference, 'Withdrawal reversed by Paystack — balance restored', 'COMPLETED'
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── C2: non-negative balance CHECK constraints ──────────────────────────────
-- DROP-before-ADD: ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS, so this
-- keeps the migration idempotent.

ALTER TABLE wallet_balances DROP CONSTRAINT IF EXISTS wallet_balances_non_negative;
ALTER TABLE wallet_balances ADD CONSTRAINT wallet_balances_non_negative
  CHECK (
    total_balance     >= 0 AND
    available_balance >= 0 AND
    held_balance      >= 0
  );

ALTER TABLE customer_wallets DROP CONSTRAINT IF EXISTS customer_wallets_non_negative;
ALTER TABLE customer_wallets ADD CONSTRAINT customer_wallets_non_negative
  CHECK (balance_kobo >= 0);
