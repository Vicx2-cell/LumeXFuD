-- ============================================================
-- LumeX Fud — Migration 086: money-path integrity (FORTRESS surface #3)
-- ============================================================
-- The ledger is already strong: every balance write is an atomic
-- SELECT ... FOR UPDATE RPC, balances have CHECK(... >= 0), and most operations
-- are idempotent on a UNIQUE reference. This adds the three remaining backstops.
--
-- 🔵 1. Amount-integrity CHECKs on the four transaction/ledger tables, shipped
--       NOT VALID — they enforce every NEW write immediately but do NOT scan
--       (and cannot fail on) historical rows. Predicate is per-table, because
--       two of these ledgers legitimately store NEGATIVE rows:
--         • wallet_transactions.amount          → <> 0 (positive-with-type today,
--                                                   but never assume; kill only 0)
--         • customer_wallet_transactions.amount_kobo → <> 0 (ADMIN_ADJUSTMENT debits)
--         • platform_earnings.amount_kobo       → <> 0 (costs are NEGATIVE)  ← trap
--         • refunds.amount_kobo                 → > 0  (a refund is always positive)
--       A blanket "> 0" would corrupt the signed ledgers; "<> 0" kills the real
--       abuse (a zero / empty-amount row) while staying convention-safe.
--
-- 🔵 2. platform_earnings idempotency: a partial UNIQUE so a re-fired order
--       completion cannot double-book revenue. NULL order_id rows (subscriptions,
--       top-up float) stay unconstrained. Apply-safe: if legacy duplicates exist
--       the index is skipped with a WARNING instead of aborting the migration.
--
-- 🔵 3. Escrow gated on server-confirmed delivery: release_held_batch now only
--       releases a HOLD whose linked order is actually DELIVERED/COMPLETED. A
--       DISPUTED / CANCELLED / REFUNDED order keeps its funds held. (Belt-and-
--       suspenders with the existing dispute-reversal path. Non-order holds keep
--       their timer behaviour.) Re-creates the CURRENT (migration 075) body —
--       lot-opening + sweep-window logic preserved verbatim, gate is the only add.
--
-- MONEY SAFETY: no balance is moved by this migration; the constraints are
-- NOT VALID; the escrow change only makes release STRICTER (never releases
-- something it didn't before). Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── 1. Amount-integrity CHECKs (NOT VALID — enforce new writes only) ─────────
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_tx_amount_nonzero;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_tx_amount_nonzero
  CHECK (amount <> 0) NOT VALID;

ALTER TABLE customer_wallet_transactions DROP CONSTRAINT IF EXISTS cwt_amount_nonzero;
ALTER TABLE customer_wallet_transactions ADD CONSTRAINT cwt_amount_nonzero
  CHECK (amount_kobo <> 0) NOT VALID;

ALTER TABLE platform_earnings DROP CONSTRAINT IF EXISTS pe_amount_nonzero;
ALTER TABLE platform_earnings ADD CONSTRAINT pe_amount_nonzero
  CHECK (amount_kobo <> 0) NOT VALID;

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_amount_positive;
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive
  CHECK (amount_kobo > 0) NOT VALID;

-- ─── 2. platform_earnings idempotency (apply-safe) ────────────────────────────
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_earnings_order_type
    ON platform_earnings (order_id, type) WHERE order_id IS NOT NULL;
  RAISE NOTICE '[086] platform_earnings (order_id,type) idempotency index ready.';
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING '[086] platform_earnings has DUPLICATE (order_id,type) rows — '
    'idempotency index NOT created. Dedupe (see scripts/verify-086 audit), then re-run 086.';
END $$;

-- ─── 3. Escrow gated on server-confirmed delivery ─────────────────────────────
-- CURRENT body is migration 075's (opens a 48h sweep lot per release). The ONLY
-- change vs 075 is the order-status gate added to the cursor WHERE clause.
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

  SELECT COALESCE((value->>'hours')::INT, 48) INTO v_window
  FROM settings WHERE id = 'sweep_window_hours';
  IF v_window IS NULL OR v_window <= 0 THEN v_window := 48; END IF;

  FOR v_tx IN
    SELECT wt.* FROM wallet_transactions wt
    WHERE wt.type = 'HOLD' AND wt.status = 'PENDING' AND wt.release_at <= NOW()
      -- ESCROW GATE: only release if the order is a server-confirmed pay-out
      -- state. A disputed/cancelled/refunded order keeps its funds held. Holds
      -- with no linked order keep their timer behaviour.
      AND (
        wt.order_id IS NULL
        OR EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id::text = wt.order_id
            AND o.status IN ('DELIVERED', 'COMPLETED')
        )
      )
    ORDER BY wt.release_at ASC
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

-- ─── Audit BEFORE any future VALIDATE CONSTRAINT (must all return 0) ──────────
--   SELECT count(*) FROM wallet_transactions          WHERE amount = 0;
--   SELECT count(*) FROM customer_wallet_transactions WHERE amount_kobo = 0;
--   SELECT count(*) FROM platform_earnings            WHERE amount_kobo = 0;
--   SELECT count(*) FROM refunds                      WHERE amount_kobo <= 0;
--   SELECT order_id, type, count(*) FROM platform_earnings
--     WHERE order_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;  -- dupes
-- Only when all are empty:
--   ALTER TABLE wallet_transactions          VALIDATE CONSTRAINT wallet_tx_amount_nonzero;
--   ALTER TABLE customer_wallet_transactions VALIDATE CONSTRAINT cwt_amount_nonzero;
--   ALTER TABLE platform_earnings            VALIDATE CONSTRAINT pe_amount_nonzero;
--   ALTER TABLE refunds                      VALIDATE CONSTRAINT refunds_amount_positive;
