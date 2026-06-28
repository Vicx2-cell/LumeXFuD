-- ============================================================
-- Live BEHAVIOR proof for migration 086 (money-path integrity).
-- Run in the Supabase SQL editor AFTER applying 086.
--
-- SAFE: the whole script runs in ONE transaction and ends with ROLLBACK, so it
-- changes NOTHING in the database — it only proves that the guards fire.
-- Every check prints 'PASS …' or 'FAIL …'. Any FAIL = the guard is missing.
-- ============================================================
BEGIN;

-- ── 1. amount = 0 is rejected on every guarded ledger ────────────────────────

-- wallet_transactions (no FK — direct probe)
DO $$
BEGIN
  INSERT INTO wallet_transactions (user_id, user_type, type, amount, balance_before, balance_after)
  VALUES ('__v086__', 'VENDOR', 'CREDIT', 0, 0, 0);
  RAISE EXCEPTION 'FAIL: wallet_transactions accepted amount=0';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: wallet_transactions rejects amount=0';
END $$;

-- platform_earnings (order_id NULL avoids the FK; SIGNED column → 0 must fail)
DO $$
BEGIN
  INSERT INTO platform_earnings (order_id, type, amount_kobo)
  VALUES (NULL, 'FOOD_MARKUP', 0);
  RAISE EXCEPTION 'FAIL: platform_earnings accepted amount_kobo=0';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: platform_earnings rejects amount_kobo=0';
END $$;

-- customer_wallet_transactions (needs a real customer for the FK)
DO $$
DECLARE v_cid UUID := (SELECT id FROM customers LIMIT 1);
BEGIN
  IF v_cid IS NULL THEN RAISE NOTICE 'SKIP: customer_wallet_transactions (no customer row to test FK)'; RETURN; END IF;
  INSERT INTO customer_wallet_transactions (customer_id, type, amount_kobo, balance_before_kobo, balance_after_kobo, description)
  VALUES (v_cid, 'TOPUP', 0, 0, 0, 'v086 probe');
  RAISE EXCEPTION 'FAIL: customer_wallet_transactions accepted amount_kobo=0';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: customer_wallet_transactions rejects amount_kobo=0';
END $$;

-- refunds (> 0 guard). UPDATE an existing row rather than INSERT: the live
-- refunds table has extra NOT NULL legacy columns (e.g. `amount`) that the app
-- never sets, so a hand-built INSERT trips an unrelated NOT NULL. A CHECK shipped
-- NOT VALID still enforces on UPDATE, so setting amount_kobo=0 on a real row must
-- raise. (Empty table → nothing to probe → SKIP.)
DO $$
DECLARE v_rid UUID := (SELECT id FROM refunds LIMIT 1);
BEGIN
  IF v_rid IS NULL THEN RAISE NOTICE 'SKIP: refunds (no existing row to probe — table empty pre-launch)'; RETURN; END IF;
  UPDATE refunds SET amount_kobo = 0 WHERE id = v_rid;
  RAISE EXCEPTION 'FAIL: refunds accepted amount_kobo=0';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: refunds rejects amount_kobo=0 (> 0 enforced)';
END $$;

-- ── 2. platform_earnings (order_id, type) duplicate is rejected ──────────────
DO $$
DECLARE v_oid UUID := (SELECT id FROM orders LIMIT 1);
BEGIN
  IF v_oid IS NULL THEN RAISE NOTICE 'SKIP: pe duplicate test (no order row)'; RETURN; END IF;
  DELETE FROM platform_earnings WHERE order_id = v_oid AND type = 'DELIVERY_CUT'; -- clean slate (rolled back)
  INSERT INTO platform_earnings (order_id, type, amount_kobo) VALUES (v_oid, 'DELIVERY_CUT', 100);
  INSERT INTO platform_earnings (order_id, type, amount_kobo) VALUES (v_oid, 'DELIVERY_CUT', 100);
  RAISE EXCEPTION 'FAIL: platform_earnings accepted a duplicate (order_id,type)';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS: platform_earnings rejects duplicate (order_id,type)';
END $$;

-- ── 3. ESCROW — both directions, against REAL orders (proves the text cast) ──
DO $$
DECLARE
  v_del UUID := (SELECT id FROM orders WHERE status = 'DELIVERED' LIMIT 1);
  v_bad UUID := (SELECT id FROM orders WHERE status IN ('CANCELLED','DISPUTED') LIMIT 1);
  v_del_status TEXT;
  v_bad_status TEXT;
BEGIN
  -- Synthetic rider wallet holding ₦20 across two holds.
  INSERT INTO wallet_balances (user_id, user_type, total_balance, available_balance, held_balance)
  VALUES ('__v086_rider__', 'RIDER', 2000, 0, 2000)
  ON CONFLICT (user_id, user_type) DO UPDATE SET held_balance = 2000, available_balance = 0, total_balance = 2000;

  IF v_del IS NOT NULL THEN
    INSERT INTO wallet_transactions (user_id, user_type, type, amount, balance_before, balance_after,
      available_before, available_after, held_before, held_after, reference, order_id, status, release_at)
    VALUES ('__v086_rider__','RIDER','HOLD',1000,2000,2000,0,0,0,1000,'v086-del', v_del::text,'PENDING', NOW() - INTERVAL '1 hour');
  END IF;
  IF v_bad IS NOT NULL THEN
    INSERT INTO wallet_transactions (user_id, user_type, type, amount, balance_before, balance_after,
      available_before, available_after, held_before, held_after, reference, order_id, status, release_at)
    VALUES ('__v086_rider__','RIDER','HOLD',1000,2000,2000,0,1000,1000,2000,'v086-bad', v_bad::text,'PENDING', NOW() - INTERVAL '1 hour');
  END IF;

  PERFORM release_held_batch();  -- processes due holds; all rolled back at end

  SELECT status INTO v_del_status FROM wallet_transactions WHERE reference = 'v086-del';
  SELECT status INTO v_bad_status FROM wallet_transactions WHERE reference = 'v086-bad';

  -- (a) DELIVERED order's hold MUST have released → COMPLETED.
  IF v_del IS NULL THEN
    RAISE NOTICE 'SKIP: no DELIVERED order to test release direction (a)';
  ELSIF v_del_status = 'COMPLETED' THEN
    RAISE NOTICE 'PASS: HOLD on a DELIVERED order RELEASED (cast matched a real delivered order)';
  ELSE
    RAISE EXCEPTION 'FAIL: HOLD on a DELIVERED order did NOT release (status=%) — cast/gate trapped legit funds', v_del_status;
  END IF;

  -- (b) CANCELLED/DISPUTED order's hold MUST stay held → PENDING.
  IF v_bad IS NULL THEN
    RAISE NOTICE 'SKIP: no CANCELLED/DISPUTED order to test no-release direction (b)';
  ELSIF v_bad_status = 'PENDING' THEN
    RAISE NOTICE 'PASS: HOLD on a CANCELLED/DISPUTED order was NOT released (stayed held)';
  ELSE
    RAISE EXCEPTION 'FAIL: HOLD on a CANCELLED/DISPUTED order released (status=%) — escrow gate leaked', v_bad_status;
  END IF;
END $$;

ROLLBACK;  -- nothing above is persisted
