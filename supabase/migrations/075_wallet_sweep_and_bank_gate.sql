-- ============================================================
-- LumeX Fud — Migration 075: 48h auto-sweep + mandatory verified bank
-- ============================================================
-- TWO changes to the VENDOR/RIDER payout path. Customer wallets are untouched,
-- and the existing hold DURATIONS are not changed (this is purely additive on top
-- of the held → available release that migrations 013/023/057 already do).
--
-- CHANGE 1 — 48-HOUR AUTO-SWEEP
--   When held funds finish their hold and become withdrawable, they start a 48h
--   window. The user may withdraw manually anytime; if they don't, the funds are
--   auto-transferred to their registered bank at the 48h mark.
--
--   We track each released amount as a LOT (wallet_payout_lots) in exactly one
--   state: WITHDRAWABLE → SWEEPING → PAID_OUT (or REVERSED on a refund clawback).
--   `available_balance` stays the single pooled source of truth for "how much can
--   leave the wallet"; the lots partition that pool into 48h-aging buckets so the
--   sweep knows WHICH money is due and HOW MUCH. Every path that reduces the pool
--   (manual withdrawal, sweep, refund clawback) also retires lots FIFO, so the
--   lots can never out-sum the pool and the same naira can never be both manually
--   withdrawn AND swept (no double payout). The pool's CHECK(>=0) is the hard
--   guard; the lot state machine is the bookkeeping.
--
--   Legacy `available_balance` that was released BEFORE this migration has no lot,
--   so it never auto-sweeps — it stays manually withdrawable. Only funds released
--   from now on are governed by the sweep. No backfill is required.
--
-- CHANGE 2 — MANDATORY VERIFIED BANK
--   `wallet_balances.bank_verified_at` records when a bank account was last
--   verified against Paystack. The app gates vendor/rider dashboards + operations
--   until this is set (enforced in code, like the existing face-KYC gate).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / CREATE IF NOT EXISTS.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── 1. Per-amount payout lots ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_payout_lots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  user_type       TEXT NOT NULL CHECK (user_type IN ('VENDOR','RIDER')),
  amount          BIGINT NOT NULL,                  -- original released amount (kobo)
  remaining       BIGINT NOT NULL,                  -- un-paid-out portion (kobo)
  withdrawable_at TIMESTAMPTZ NOT NULL,             -- when the hold released
  sweep_due_at    TIMESTAMPTZ NOT NULL,             -- withdrawable_at + sweep window
  state           TEXT NOT NULL DEFAULT 'WITHDRAWABLE'
                    CHECK (state IN ('WITHDRAWABLE','SWEEPING','PAID_OUT','REVERSED')),
  release_tx_id   UUID,                             -- the RELEASE ledger row
  sweep_tx_id     UUID,                             -- the SWEEP ledger row, once swept
  order_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_payout_lots_remaining_nonneg CHECK (remaining >= 0)
);

-- Sweep cron selects due, still-withdrawable lots.
CREATE INDEX IF NOT EXISTS idx_payout_lots_due
  ON wallet_payout_lots(sweep_due_at)
  WHERE state = 'WITHDRAWABLE';
CREATE INDEX IF NOT EXISTS idx_payout_lots_user
  ON wallet_payout_lots(user_id, user_type, state);
CREATE INDEX IF NOT EXISTS idx_payout_lots_sweep_tx
  ON wallet_payout_lots(sweep_tx_id)
  WHERE sweep_tx_id IS NOT NULL;

-- Service-role-only, like every other wallet table (auth is enforced in code).
ALTER TABLE wallet_payout_lots ENABLE ROW LEVEL SECURITY;

-- ─── 2. wallet_balances: bank verification + sweep bookkeeping ────────────────
ALTER TABLE wallet_balances
  ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sweep_fail_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sweep_at    TIMESTAMPTZ;

-- ─── 3. wallet_transactions: SWEEP types + consumed-lot record ────────────────
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS consumed_lots JSONB;  -- [{id, amt}] retired by this tx

ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'CREDIT','DEBIT','HOLD','RELEASE','FREEZE','UNFREEZE',
    'WITHDRAWAL','WITHDRAWAL_REVERSAL','ADMIN_ADJUSTMENT',
    'SWEEP','SWEEP_REVERSAL'
  ));

-- ─── 4. Sweep config (live-tunable) ───────────────────────────────────────────
INSERT INTO settings (id, value) VALUES
  ('sweep_window_hours',   '{"hours": 48}'),
  ('sweep_fail_alert_at',  '{"count": 3}')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. FIFO lot consumption + restore helpers ────────────────────────────────
-- consume_payout_lots: retire up to p_amount from the oldest WITHDRAWABLE lots
-- (oldest = earliest sweep_due_at). Reduces `remaining`; a lot fully drained flips
-- to p_target_state. Returns [{id, amt}] of what it touched so the caller can
-- store it on the ledger row and reverse it precisely if the payout later fails.
-- Consuming LESS than p_amount is fine (e.g. legacy pre-migration funds have no
-- lot) — the pooled balance remains the source of truth.
CREATE OR REPLACE FUNCTION consume_payout_lots(
  p_user_id      TEXT,
  p_user_type    TEXT,
  p_amount       BIGINT,
  p_target_state TEXT
) RETURNS JSONB AS $$
DECLARE
  v_lot       RECORD;
  v_remaining BIGINT := p_amount;
  v_take      BIGINT;
  v_consumed  JSONB := '[]'::JSONB;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN v_consumed; END IF;

  FOR v_lot IN
    SELECT id, remaining FROM wallet_payout_lots
    WHERE user_id = p_user_id AND user_type = p_user_type
      AND state = 'WITHDRAWABLE' AND remaining > 0
    ORDER BY sweep_due_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_lot.remaining, v_remaining);
    UPDATE wallet_payout_lots
    SET remaining = remaining - v_take,
        state     = CASE WHEN remaining - v_take <= 0 THEN p_target_state ELSE state END,
        updated_at = NOW()
    WHERE id = v_lot.id;
    v_consumed  := v_consumed || jsonb_build_object('id', v_lot.id, 'amt', v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN v_consumed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- restore_payout_lots: undo a consume — add the amounts back and make the lots
-- WITHDRAWABLE again. Used when a withdrawal or sweep transfer fails so the money
-- is never lost and the funds remain payable.
CREATE OR REPLACE FUNCTION restore_payout_lots(p_consumed JSONB)
RETURNS VOID AS $$
DECLARE
  v_item JSONB;
BEGIN
  IF p_consumed IS NULL THEN RETURN; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_consumed)
  LOOP
    UPDATE wallet_payout_lots
    SET remaining   = remaining + (v_item->>'amt')::BIGINT,
        state       = 'WITHDRAWABLE',
        sweep_tx_id = NULL,
        updated_at  = NOW()
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 6. release_held_batch: also open a payout lot per released amount ─────────
-- Same held → available move as migration 013, PLUS: each released amount opens a
-- WITHDRAWABLE lot whose 48h sweep clock starts now. Hold timing is unchanged.
CREATE OR REPLACE FUNCTION release_held_batch(
  OUT released_count INT,
  OUT released_data  JSONB
) AS $$
DECLARE
  v_tx     RECORD;
  v_wb     RECORD;
  v_arr    JSONB := '[]'::JSONB;
  v_rel_id UUID;
  v_window INT;
BEGIN
  released_count := 0;

  -- Sweep window (hours) — live-tunable; defaults to 48h.
  SELECT COALESCE((value->>'hours')::INT, 48) INTO v_window
  FROM settings WHERE id = 'sweep_window_hours';
  IF v_window IS NULL OR v_window <= 0 THEN v_window := 48; END IF;

  FOR v_tx IN
    SELECT * FROM wallet_transactions
    WHERE type = 'HOLD' AND status = 'PENDING' AND release_at <= NOW()
    ORDER BY release_at ASC
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT total_balance, available_balance, held_balance
    INTO v_wb
    FROM wallet_balances
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE wallet_balances
    SET available_balance = available_balance + v_tx.amount,
        held_balance      = GREATEST(held_balance - v_tx.amount, 0),
        updated_at        = NOW()
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;

    UPDATE wallet_transactions
    SET status = 'COMPLETED'
    WHERE id = v_tx.id;

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
    ) RETURNING id INTO v_rel_id;

    -- Open the 48h auto-sweep lot for this released amount.
    INSERT INTO wallet_payout_lots (
      user_id, user_type, amount, remaining,
      withdrawable_at, sweep_due_at, state, release_tx_id, order_id
    ) VALUES (
      v_tx.user_id, v_tx.user_type, v_tx.amount, v_tx.amount,
      NOW(), NOW() + make_interval(hours => v_window), 'WITHDRAWABLE', v_rel_id, v_tx.order_id
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

-- ─── 7. debit_wallet_withdrawal: retire lots FIFO on a manual withdrawal ──────
-- Unchanged velocity-cap logic (migration 023). Adds: after the debit, retire the
-- oldest lots up to the withdrawn amount and record them on the ledger row — so a
-- manual withdrawal during the 48h window cancels the pending sweep for those
-- exact funds, and a failed transfer can restore them.
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
  v_wb       RECORD;
  v_tx_id    UUID;
  v_daily    BIGINT;
  v_weekly   BIGINT;
  v_consumed JSONB;
BEGIN
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

  UPDATE wallet_balances
  SET total_balance     = total_balance - p_amount,
      available_balance = available_balance - p_amount,
      total_withdrawals = total_withdrawals + p_amount,
      updated_at        = NOW()
  WHERE user_id = p_user_id AND user_type = p_user_type;

  -- Retire the oldest lots for this amount (cancels their pending sweep).
  v_consumed := consume_payout_lots(p_user_id, p_user_type, p_amount, 'PAID_OUT');

  INSERT INTO wallet_transactions (
    user_id, user_type, type, amount,
    balance_before, balance_after,
    available_before, available_after,
    held_before, held_after,
    reference, description, status, consumed_lots
  ) VALUES (
    p_user_id, p_user_type, 'WITHDRAWAL', p_amount,
    v_wb.total_balance,     v_wb.total_balance - p_amount,
    v_wb.available_balance, v_wb.available_balance - p_amount,
    v_wb.held_balance,      v_wb.held_balance,
    p_reference, p_description, 'PENDING', v_consumed
  ) RETURNING id INTO v_tx_id;

  RETURN QUERY SELECT v_tx_id, TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 8. reverse_withdrawal: restore lots when a withdrawal transfer fails ─────
CREATE OR REPLACE FUNCTION reverse_withdrawal(
  p_tx_id          UUID,
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

  UPDATE wallet_balances
  SET total_balance     = total_balance + v_tx.amount,
      available_balance = available_balance + v_tx.amount,
      total_withdrawals = GREATEST(total_withdrawals - v_tx.amount, 0),
      updated_at        = NOW()
  WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;

  -- Put the retired lots back into play.
  PERFORM restore_payout_lots(v_tx.consumed_lots);

  UPDATE wallet_transactions
  SET status = 'FAILED', failure_reason = p_failure_reason
  WHERE id = p_tx_id;

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

-- ─── 9. reverse_order_payout: keep lots consistent on a refund clawback ───────
-- Same clawback as migration 057, PLUS: the portion pulled out of available funds
-- also retires lots (state REVERSED) so the lots can never out-sum the (now
-- smaller) pool and the sweep can't pay out money that was clawed back.
CREATE OR REPLACE FUNCTION reverse_order_payout(p_order_id TEXT)
RETURNS INT AS $$
DECLARE
  v_tx RECORD;
  v_wb RECORD;
  v_from_held  BIGINT;
  v_from_avail BIGINT;
  v_recovered  BIGINT;
  v_shortfall  BIGINT;
  v_ref TEXT;
  v_count INT := 0;
BEGIN
  FOR v_tx IN
    SELECT * FROM wallet_transactions
    WHERE order_id = p_order_id AND type = 'HOLD' AND status IN ('PENDING', 'COMPLETED')
    FOR UPDATE
  LOOP
    v_ref := 'CLAWBACK-' || v_tx.user_type || '-' || p_order_id;
    CONTINUE WHEN EXISTS (SELECT 1 FROM wallet_transactions WHERE reference = v_ref);

    SELECT * INTO v_wb
    FROM wallet_balances
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type
    FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    IF v_tx.status = 'PENDING' THEN
      v_from_held  := LEAST(v_tx.amount, GREATEST(COALESCE(v_wb.held_balance, 0), 0));
      v_from_avail := LEAST(v_tx.amount - v_from_held, GREATEST(v_wb.available_balance, 0));
    ELSE
      v_from_held  := 0;
      v_from_avail := LEAST(v_tx.amount, GREATEST(v_wb.available_balance, 0));
    END IF;
    v_recovered := v_from_held + v_from_avail;
    v_shortfall := v_tx.amount - v_recovered;

    UPDATE wallet_balances
    SET held_balance      = held_balance - v_from_held,
        available_balance = available_balance - v_from_avail,
        total_balance     = total_balance - v_recovered,
        lifetime_earned   = GREATEST(lifetime_earned - v_tx.amount, 0),
        clawback_owed     = COALESCE(clawback_owed, 0) + v_shortfall,
        updated_at        = NOW()
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;

    -- Retire any released lots that backed the available funds we just clawed back.
    IF v_from_avail > 0 THEN
      PERFORM consume_payout_lots(v_tx.user_id, v_tx.user_type, v_from_avail, 'REVERSED');
    END IF;

    UPDATE wallet_transactions SET status = 'REVERSED' WHERE id = v_tx.id;

    INSERT INTO wallet_transactions (
      user_id, user_type, type, amount,
      balance_before, balance_after,
      available_before, available_after,
      held_before, held_after,
      reference, order_id, description, status
    ) VALUES (
      v_tx.user_id, v_tx.user_type, 'ADMIN_ADJUSTMENT', v_recovered,
      v_wb.total_balance,     v_wb.total_balance - v_recovered,
      v_wb.available_balance, v_wb.available_balance - v_from_avail,
      v_wb.held_balance,      v_wb.held_balance - v_from_held,
      v_ref, p_order_id,
      CASE WHEN v_shortfall > 0
        THEN 'Order refunded — earnings reversed (' || v_shortfall || ' kobo owed, will be recovered from future earnings)'
        ELSE 'Order refunded — earnings reversed'
      END,
      'COMPLETED'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 10. sweep_due_funds: stage a sweep of all due, fully-fitting lots ────────
-- Under the wallet lock, take the oldest due WITHDRAWABLE lots whose running total
-- still fits inside the live available_balance (the cap protects against a
-- clawback shortfall — never sweep more than the wallet actually holds). Marks
-- them SWEEPING, debits the pool, and logs a PENDING SWEEP. The caller then fires
-- the Paystack transfer and calls finalize_sweep. Returns (tx_id, amount, lots).
CREATE OR REPLACE FUNCTION sweep_due_funds(
  p_user_id   TEXT,
  p_user_type TEXT,
  p_reference TEXT
) RETURNS TABLE(tx_id UUID, swept_amount BIGINT, lot_count INT) AS $$
DECLARE
  v_wb       RECORD;
  v_lot      RECORD;
  v_total    BIGINT := 0;
  v_count    INT := 0;
  v_consumed JSONB := '[]'::JSONB;
  v_tx_id    UUID;
BEGIN
  SELECT * INTO v_wb
  FROM wallet_balances
  WHERE user_id = p_user_id AND user_type = p_user_type
  FOR UPDATE;

  IF NOT FOUND OR v_wb.is_frozen THEN
    RETURN QUERY SELECT NULL::UUID, 0::BIGINT, 0;
    RETURN;
  END IF;

  FOR v_lot IN
    SELECT id, remaining FROM wallet_payout_lots
    WHERE user_id = p_user_id AND user_type = p_user_type
      AND state = 'WITHDRAWABLE' AND remaining > 0
      AND sweep_due_at <= NOW()
    ORDER BY sweep_due_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_total + v_lot.remaining > v_wb.available_balance;
    UPDATE wallet_payout_lots
    SET state = 'SWEEPING', remaining = 0, updated_at = NOW()
    WHERE id = v_lot.id;
    v_consumed := v_consumed || jsonb_build_object('id', v_lot.id, 'amt', v_lot.remaining);
    v_total := v_total + v_lot.remaining;
    v_count := v_count + 1;
  END LOOP;

  IF v_total <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, 0::BIGINT, 0;
    RETURN;
  END IF;

  UPDATE wallet_balances
  SET total_balance     = total_balance - v_total,
      available_balance = available_balance - v_total,
      total_withdrawals = total_withdrawals + v_total,
      last_sweep_at     = NOW(),
      updated_at        = NOW()
  WHERE user_id = p_user_id AND user_type = p_user_type;

  INSERT INTO wallet_transactions (
    user_id, user_type, type, amount,
    balance_before, balance_after,
    available_before, available_after,
    held_before, held_after,
    reference, description, status, consumed_lots
  ) VALUES (
    p_user_id, p_user_type, 'SWEEP', v_total,
    v_wb.total_balance,     v_wb.total_balance - v_total,
    v_wb.available_balance, v_wb.available_balance - v_total,
    v_wb.held_balance,      v_wb.held_balance,
    p_reference, 'Auto-sweep to registered bank', 'PENDING', v_consumed
  ) RETURNING id INTO v_tx_id;

  UPDATE wallet_payout_lots
  SET sweep_tx_id = v_tx_id
  WHERE id IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(v_consumed) e);

  RETURN QUERY SELECT v_tx_id, v_total, v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 11. finalize_sweep: commit or roll back a staged sweep ───────────────────
-- success → SWEEP COMPLETED, lots PAID_OUT, fail counter reset.
-- failure → pool + lots restored (money is never lost), SWEEP FAILED, fail++.
CREATE OR REPLACE FUNCTION finalize_sweep(
  p_tx_id          UUID,
  p_success        BOOLEAN,
  p_transfer_code  TEXT,
  p_recipient_code TEXT,
  p_reason         TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_tx RECORD;
  v_wb RECORD;
BEGIN
  SELECT * INTO v_tx
  FROM wallet_transactions
  WHERE id = p_tx_id AND type = 'SWEEP' AND status = 'PENDING'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT total_balance, available_balance, held_balance
  INTO v_wb
  FROM wallet_balances
  WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type
  FOR UPDATE;

  IF p_success THEN
    UPDATE wallet_transactions
    SET status = 'COMPLETED',
        paystack_transfer_code  = p_transfer_code,
        paystack_recipient_code = p_recipient_code
    WHERE id = p_tx_id;

    UPDATE wallet_payout_lots
    SET state = 'PAID_OUT', remaining = 0, updated_at = NOW()
    WHERE sweep_tx_id = p_tx_id;

    UPDATE wallet_balances
    SET sweep_fail_count = 0, updated_at = NOW()
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;
  ELSE
    UPDATE wallet_balances
    SET total_balance     = total_balance + v_tx.amount,
        available_balance = available_balance + v_tx.amount,
        total_withdrawals = GREATEST(total_withdrawals - v_tx.amount, 0),
        sweep_fail_count  = COALESCE(sweep_fail_count, 0) + 1,
        updated_at        = NOW()
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;

    PERFORM restore_payout_lots(v_tx.consumed_lots);

    UPDATE wallet_transactions
    SET status = 'FAILED', failure_reason = p_reason
    WHERE id = p_tx_id;

    INSERT INTO wallet_transactions (
      user_id, user_type, type, amount,
      balance_before, balance_after,
      available_before, available_after,
      held_before, held_after,
      reference, description, status
    ) VALUES (
      v_tx.user_id, v_tx.user_type, 'SWEEP_REVERSAL', v_tx.amount,
      v_wb.total_balance,     v_wb.total_balance + v_tx.amount,
      v_wb.available_balance, v_wb.available_balance + v_tx.amount,
      v_wb.held_balance,      v_wb.held_balance,
      'SWEEPREV-' || COALESCE(v_tx.reference, v_tx.id::TEXT),
      'Auto-sweep transfer failed — funds restored: ' || COALESCE(p_reason, 'unknown'),
      'COMPLETED'
    );
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 12. reclaim_stuck_sweeps: undo sweeps stranded before the transfer fired ─
-- If the cron crashed AFTER staging a sweep but BEFORE the Paystack call, the
-- lots sit in SWEEPING with a PENDING tx that has no transfer code. Reclaim those
-- older than p_minutes so the money returns to WITHDRAWABLE and can sweep again.
CREATE OR REPLACE FUNCTION reclaim_stuck_sweeps(p_minutes INT)
RETURNS INT AS $$
DECLARE
  v_tx RECORD;
  v_count INT := 0;
BEGIN
  FOR v_tx IN
    SELECT id FROM wallet_transactions
    WHERE type = 'SWEEP' AND status = 'PENDING'
      AND paystack_transfer_code IS NULL
      AND created_at < NOW() - make_interval(mins => p_minutes)
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM finalize_sweep(v_tx.id, FALSE, NULL, NULL, 'Reclaimed: transfer never initiated');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
