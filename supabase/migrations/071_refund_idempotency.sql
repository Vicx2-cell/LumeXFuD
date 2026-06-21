-- ============================================================
-- LumeX Fud — Migration 071: Atomic, idempotent order refunds
-- ============================================================
-- AUDIT FIX (finding #1). app/api/paystack/refund/route.ts checked only
-- payment_status='PAID' and never changed it, so every call (duplicate, concurrent,
-- or deliberately split below the ₦50k step-up) re-passed the guard → double refund
-- and step-up bypass.
--
-- Fix: move the guard into an RPC that locks the order row (FOR UPDATE), re-sums
-- prior refunds under the lock (cumulative cap), writes the refunds ledger row, and
-- flips payment_status — mirroring debit_wallet_withdrawal (migration 023).
-- A companion fail_order_refund compensates when the external Paystack call fails.
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Allow a partial-refund state on the order.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('PENDING','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED'));

-- ─── Reserve a refund atomically ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reserve_order_refund(
  p_order_id     UUID,
  p_amount_kobo  BIGINT,
  p_reason       TEXT,
  p_triggered_by TEXT,
  p_reference    TEXT
) RETURNS TABLE(refund_id UUID, success BOOLEAN, error_code TEXT, prior_refunded BIGINT, fully_refunded BOOLEAN) AS $$
DECLARE
  v_order     RECORD;
  v_prior     BIGINT;
  v_new_total BIGINT;
  v_fully     BOOLEAN;
  v_id        UUID;
BEGIN
  SELECT id, total_amount, payment_status, status INTO v_order
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'NOT_FOUND', 0::BIGINT, FALSE; RETURN;
  END IF;

  IF v_order.payment_status NOT IN ('PAID','PARTIALLY_REFUNDED') THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'NOT_REFUNDABLE', 0::BIGINT, FALSE; RETURN;
  END IF;

  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'INVALID_AMOUNT', 0::BIGINT, FALSE; RETURN;
  END IF;

  -- Sum everything that still holds money out (exclude only FAILED).
  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_prior
  FROM refunds WHERE order_id = p_order_id AND status <> 'FAILED';

  IF v_prior + p_amount_kobo > v_order.total_amount THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'EXCEEDS_TOTAL', v_prior, FALSE; RETURN;
  END IF;

  INSERT INTO refunds (order_id, paystack_transaction_reference, amount_kobo, reason, status, triggered_by)
  VALUES (p_order_id, p_reference, p_amount_kobo, p_reason, 'PROCESSING', p_triggered_by)
  RETURNING id INTO v_id;

  v_new_total := v_prior + p_amount_kobo;
  v_fully     := v_new_total >= v_order.total_amount;

  -- Flip payment_status under the same lock. (order.status is set by the caller
  -- only after Paystack confirms, so a failed external call leaves no stale status.)
  UPDATE orders SET
    payment_status = CASE WHEN v_fully THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END,
    updated_at     = NOW()
  WHERE id = p_order_id;

  RETURN QUERY SELECT v_id, TRUE, NULL::TEXT, v_prior, v_fully;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Compensate a reserved refund the provider rejected ──────────────────────
CREATE OR REPLACE FUNCTION fail_order_refund(
  p_refund_id UUID,
  p_reason    TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_order_id  UUID;
  v_total     BIGINT;
  v_remaining BIGINT;
BEGIN
  UPDATE refunds SET status = 'FAILED', failure_reason = p_reason
  WHERE id = p_refund_id AND status = 'PROCESSING'
  RETURNING order_id INTO v_order_id;

  IF v_order_id IS NULL THEN RETURN FALSE; END IF;  -- already resolved / not found

  SELECT total_amount INTO v_total FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_remaining
  FROM refunds WHERE order_id = v_order_id AND status <> 'FAILED';

  UPDATE orders SET
    payment_status = CASE
      WHEN v_remaining <= 0        THEN 'PAID'
      WHEN v_remaining >= v_total  THEN 'REFUNDED'
      ELSE 'PARTIALLY_REFUNDED' END,
    updated_at = NOW()
  WHERE id = v_order_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
