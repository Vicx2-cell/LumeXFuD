-- ============================================================
-- LumeX Fud — Migration 013: Wallet System Enhancement
-- Adds missing columns, extended types, atomic Postgres functions,
-- and wallet-release tracking on orders.
-- Run AFTER 012_created_by_columns.sql
-- ============================================================

-- ─── WALLET BALANCES: Add missing columns ────────────────────────────────────
ALTER TABLE wallet_balances
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_code           TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name   TEXT,
  ADD COLUMN IF NOT EXISTS bank_name           TEXT,
  ADD COLUMN IF NOT EXISTS frozen_reason       TEXT,
  ADD COLUMN IF NOT EXISTS frozen_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifetime_earned     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_withdrawals   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_attempts        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until    TIMESTAMPTZ;

-- ─── WALLET TRANSACTIONS: Add missing columns ─────────────────────────────────
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS available_before       BIGINT,
  ADD COLUMN IF NOT EXISTS available_after        BIGINT,
  ADD COLUMN IF NOT EXISTS held_before            BIGINT,
  ADD COLUMN IF NOT EXISTS held_after             BIGINT,
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS paystack_recipient_code TEXT,
  ADD COLUMN IF NOT EXISTS initiated_by           TEXT,
  ADD COLUMN IF NOT EXISTS release_at             TIMESTAMPTZ;

-- Extend type constraint to include new transaction types
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'CREDIT','DEBIT','HOLD','RELEASE','FREEZE','UNFREEZE',
    'WITHDRAWAL','WITHDRAWAL_REVERSAL','ADMIN_ADJUSTMENT'
  ));

-- Extend status constraint to include REVERSED
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_status_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_status_check
  CHECK (status IN ('PENDING','COMPLETED','FAILED','REVERSED'));

-- ─── ORDERS: Add wallet tracking columns ─────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS wallet_released       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vendor_auto_release_at TIMESTAMPTZ;

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference
  ON wallet_transactions(reference) WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_order_id
  ON wallet_transactions(order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_hold_release
  ON wallet_transactions(release_at)
  WHERE type = 'HOLD' AND status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_orders_wallet_release
  ON orders(rider_auto_release_at, wallet_released)
  WHERE status = 'DELIVERED' AND wallet_released = FALSE;

-- ─── ATOMIC WALLET FUNCTION: credit_wallet_held ───────────────────────────────
-- Atomically adds amount to total_balance + held_balance and logs a HOLD transaction.
-- Called when an order is marked DELIVERED and wallets need to be credited.
CREATE OR REPLACE FUNCTION credit_wallet_held(
  p_user_id    TEXT,
  p_user_type  TEXT,
  p_amount     BIGINT,
  p_order_id   TEXT,
  p_description TEXT,
  p_release_at TIMESTAMPTZ,
  p_reference  TEXT
) RETURNS UUID AS $$
DECLARE
  v_wb RECORD;
  v_tx_id UUID;
BEGIN
  -- Ensure wallet row exists before locking
  INSERT INTO wallet_balances (user_id, user_type)
  VALUES (p_user_id, p_user_type)
  ON CONFLICT (user_id, user_type) DO NOTHING;

  -- Lock wallet row for the duration of this transaction
  SELECT * INTO v_wb
  FROM wallet_balances
  WHERE user_id = p_user_id AND user_type = p_user_type
  FOR UPDATE;

  -- Update balances: total += amount, held += amount
  UPDATE wallet_balances
  SET
    total_balance   = total_balance + p_amount,
    held_balance    = held_balance + p_amount,
    lifetime_earned = lifetime_earned + p_amount,
    updated_at      = NOW()
  WHERE user_id = p_user_id AND user_type = p_user_type;

  -- Log the HOLD transaction (PENDING until release_at)
  INSERT INTO wallet_transactions (
    user_id, user_type, type, amount,
    balance_before, balance_after,
    available_before, available_after,
    held_before, held_after,
    reference, order_id, description, status, release_at
  ) VALUES (
    p_user_id, p_user_type, 'HOLD', p_amount,
    v_wb.total_balance,    v_wb.total_balance + p_amount,
    v_wb.available_balance, v_wb.available_balance,
    COALESCE(v_wb.held_balance, 0), COALESCE(v_wb.held_balance, 0) + p_amount,
    p_reference, p_order_id, p_description, 'PENDING', p_release_at
  ) RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── ATOMIC WALLET FUNCTION: release_held_batch ──────────────────────────────
-- Scans HOLD transactions past their release_at, moves held → available,
-- logs RELEASE records. Returns count + JSON array of released items for
-- WhatsApp notification dispatch in the cron handler.
CREATE OR REPLACE FUNCTION release_held_batch(
  OUT released_count INT,
  OUT released_data  JSONB
) AS $$
DECLARE
  v_tx RECORD;
  v_wb RECORD;
  v_arr JSONB := '[]'::JSONB;
BEGIN
  released_count := 0;

  FOR v_tx IN
    SELECT * FROM wallet_transactions
    WHERE type = 'HOLD' AND status = 'PENDING' AND release_at <= NOW()
    ORDER BY release_at ASC
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Lock wallet balance row
    SELECT total_balance, available_balance, held_balance
    INTO v_wb
    FROM wallet_balances
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Move held → available (total stays the same)
    UPDATE wallet_balances
    SET
      available_balance = available_balance + v_tx.amount,
      held_balance      = GREATEST(held_balance - v_tx.amount, 0),
      updated_at        = NOW()
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;

    -- Complete the HOLD record
    UPDATE wallet_transactions
    SET status = 'COMPLETED'
    WHERE id = v_tx.id;

    -- Insert RELEASE ledger entry
    INSERT INTO wallet_transactions (
      user_id, user_type, type, amount,
      balance_before, balance_after,
      available_before, available_after,
      held_before, held_after,
      reference, order_id, description, status
    ) VALUES (
      v_tx.user_id, v_tx.user_type, 'RELEASE', v_tx.amount,
      v_wb.total_balance, v_wb.total_balance,
      v_wb.available_balance,            v_wb.available_balance + v_tx.amount,
      v_wb.held_balance,                 GREATEST(v_wb.held_balance - v_tx.amount, 0),
      'RELEASE-' || v_tx.id::TEXT, v_tx.order_id,
      COALESCE(v_tx.description, 'Earnings released'), 'COMPLETED'
    );

    v_arr := v_arr || jsonb_build_object(
      'user_id',   v_tx.user_id,
      'user_type', v_tx.user_type,
      'amount',    v_tx.amount,
      'order_id',  v_tx.order_id
    );

    released_count := released_count + 1;
  END LOOP;

  released_data := v_arr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── ATOMIC WALLET FUNCTION: debit_wallet_withdrawal ─────────────────────────
-- Atomically debits available_balance + total_balance and logs a PENDING
-- WITHDRAWAL. Returns (tx_id, success, error_msg).
-- The calling code then initiates the Paystack Transfer; on failure it calls
-- reverse_withdrawal() to restore the balance.
CREATE OR REPLACE FUNCTION debit_wallet_withdrawal(
  p_user_id    TEXT,
  p_user_type  TEXT,
  p_amount     BIGINT,
  p_reference  TEXT,
  p_description TEXT
) RETURNS TABLE(tx_id UUID, success BOOLEAN, error_msg TEXT) AS $$
DECLARE
  v_wb RECORD;
  v_tx_id UUID;
BEGIN
  -- Lock wallet row
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


-- ─── ATOMIC WALLET FUNCTION: reverse_withdrawal ──────────────────────────────
-- Called when a Paystack Transfer fails. Restores balance and logs a reversal.
CREATE OR REPLACE FUNCTION reverse_withdrawal(
  p_tx_id        UUID,
  p_failure_reason TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_tx RECORD;
  v_wb RECORD;
BEGIN
  SELECT * INTO v_tx
  FROM wallet_transactions
  WHERE id = p_tx_id AND type = 'WITHDRAWAL' AND status = 'PENDING'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT total_balance, available_balance, held_balance
  INTO v_wb
  FROM wallet_balances
  WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type
  FOR UPDATE;

  -- Restore balance
  UPDATE wallet_balances
  SET
    total_balance     = total_balance + v_tx.amount,
    available_balance = available_balance + v_tx.amount,
    total_withdrawals = GREATEST(total_withdrawals - v_tx.amount, 0),
    updated_at        = NOW()
  WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;

  -- Mark original WITHDRAWAL as FAILED
  UPDATE wallet_transactions
  SET status = 'FAILED', failure_reason = p_failure_reason
  WHERE id = p_tx_id;

  -- Insert REVERSAL ledger entry
  INSERT INTO wallet_transactions (
    user_id, user_type, type, amount,
    balance_before, balance_after,
    available_before, available_after,
    held_before, held_after,
    reference, description, status
  ) VALUES (
    v_tx.user_id, v_tx.user_type, 'WITHDRAWAL_REVERSAL', v_tx.amount,
    v_wb.total_balance,     v_wb.total_balance + v_tx.amount,
    v_wb.available_balance, v_wb.available_balance + v_tx.amount,
    v_wb.held_balance,      v_wb.held_balance,
    'REVERSAL-' || COALESCE(v_tx.reference, v_tx.id::TEXT),
    'Withdrawal reversed: ' || COALESCE(p_failure_reason, 'Transfer failed'),
    'COMPLETED'
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
