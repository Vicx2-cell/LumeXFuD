-- ============================================================
-- LumeX Fud — Migration 069: pay a group order from everyone's wallet at once
-- ============================================================
-- Real split, no host fronting: at checkout EACH participant's own share is
-- debited from THEIR wallet in a single atomic transaction. If ANY participant is
-- short, the whole thing rolls back (RAISE) and no one is charged — so the host
-- literally cannot place the order until everyone has funded their share.
--
-- p_shares = jsonb array of { "customer_id": uuid, "amount_kobo": bigint } for
-- ALL participants (incl. the host). The sum equals the order total, so the order
-- is fully paid from the combined wallet debits (platform float backs it exactly
-- like a normal wallet order — reconciliation unaffected). SECURITY DEFINER.
-- Idempotency is handled by the caller (orders.idempotency_key). Idempotent DDL.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION group_order_collect(
  p_order_id     UUID,
  p_order_number TEXT,
  p_shares       JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  elem  JSONB;
  v_cid UUID;
  v_amt BIGINT;
  v_w   RECORD;
  v_ref TEXT;
BEGIN
  FOR elem IN SELECT * FROM jsonb_array_elements(p_shares) LOOP
    v_cid := (elem->>'customer_id')::uuid;
    v_amt := (elem->>'amount_kobo')::bigint;
    IF v_amt <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_w FROM customer_wallets WHERE customer_id = v_cid FOR UPDATE;
    IF NOT FOUND OR v_w.is_frozen OR v_w.balance_kobo < v_amt THEN
      RAISE EXCEPTION 'INSUFFICIENT:%', v_cid;  -- rolls back every debit in this call
    END IF;

    v_ref := 'CWSPLIT-' || p_order_number || '-' || left(v_cid::text, 8);
    UPDATE customer_wallets
      SET balance_kobo = balance_kobo - v_amt,
          lifetime_spent_kobo = lifetime_spent_kobo + v_amt
      WHERE customer_id = v_cid;
    INSERT INTO customer_wallet_transactions
      (customer_id, type, amount_kobo, balance_before_kobo, balance_after_kobo, reference, order_id, description, status)
      VALUES (v_cid, 'GROUP_SPLIT', v_amt, v_w.balance_kobo, v_w.balance_kobo - v_amt,
              v_ref, p_order_id, 'Your share of group order ' || p_order_number, 'COMPLETED');
  END LOOP;
END;
$$;
