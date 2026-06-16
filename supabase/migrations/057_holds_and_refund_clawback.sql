-- ============================================================
-- LumeX Fud — Migration 057: proper holds + refund clawback
-- ============================================================
-- Fixes the money-hold model so funds are held correctly on every order AND a
-- refund can always reclaim what the rider/vendor were paid.
--
-- THE PROBLEM (three inconsistent assumptions):
--   1. Holds were near-instant for established accounts (~5 min rider), on the
--      assumption the dispute window was 15 min.
--   2. The dispute window is actually 24h (app/api/orders/[id]/dispute).
--   3. Resolving a dispute as REFUND refunded the CUSTOMER but never reversed the
--      rider/vendor earnings — so a refunded order paid the customer back AND kept
--      the rider+vendor paid. The platform ate both.
--
-- THE MODEL NOW (short holds + reclaimable):
--   • Hold base 5h, scaled DOWN by trust tier, floored at 1h (see lib/wallet.ts).
--   • When a problem is reported, the order's still-held funds are locked (the
--     app pushes their release_at out) so they can't auto-release while disputed.
--   • A REFUND reverses the rider/vendor earnings: pulled back from held funds
--     first, then from available. Anything already withdrawn is recorded as a
--     debt (clawback_owed) that the next earnings automatically repay — balances
--     never go negative (respects the migration-028 CHECK(>=0) guards).
--
-- Idempotent. CREATE OR REPLACE only; no existing row is mutated except the
-- live-tunable hold settings.
-- ============================================================

-- ─── 1. Debt column: unrecovered clawback owed back to the platform ───────────
ALTER TABLE wallet_balances
  ADD COLUMN IF NOT EXISTS clawback_owed BIGINT NOT NULL DEFAULT 0;

-- ─── 2. Hold durations: 5h base, 1h floor (live-tunable in settings) ──────────
-- value shape {"minutes": N}. The floor is applied AFTER the per-tier reduction
-- in lib/wallet.ts (BRONZE 0% … DIAMOND 100%), so the fastest possible hold is
-- the floor, never zero.
INSERT INTO settings (id, value) VALUES
  ('hold_rider_base_minutes',  '{"minutes": 300}'),
  ('hold_rider_new_minutes',   '{"minutes": 300}'),
  ('hold_vendor_base_minutes', '{"minutes": 300}'),
  ('hold_vendor_new_minutes',  '{"minutes": 300}'),
  ('hold_floor_minutes',       '{"minutes": 60}')
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;

-- ─── 3. credit_wallet_held: repay outstanding clawback debt first ─────────────
-- Identical to migration 013 EXCEPT: if the wallet owes a clawback (clawback_owed
-- > 0), incoming earnings repay that debt before any remainder is held. This is
-- how a refund that couldn't be fully reclaimed at the time self-heals from the
-- rider/vendor's next jobs.
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
  v_owed BIGINT;
  v_applied BIGINT;
  v_net BIGINT;
BEGIN
  INSERT INTO wallet_balances (user_id, user_type)
  VALUES (p_user_id, p_user_type)
  ON CONFLICT (user_id, user_type) DO NOTHING;

  SELECT * INTO v_wb
  FROM wallet_balances
  WHERE user_id = p_user_id AND user_type = p_user_type
  FOR UPDATE;

  v_owed    := GREATEST(COALESCE(v_wb.clawback_owed, 0), 0);
  v_applied := LEAST(v_owed, p_amount);   -- earnings repay debt first
  v_net     := p_amount - v_applied;      -- remainder is actually held

  UPDATE wallet_balances
  SET
    total_balance   = total_balance + v_net,
    held_balance    = held_balance + v_net,
    lifetime_earned = lifetime_earned + p_amount,
    clawback_owed   = GREATEST(COALESCE(clawback_owed, 0) - v_applied, 0),
    updated_at      = NOW()
  WHERE user_id = p_user_id AND user_type = p_user_type;

  -- Ledger the portion that repaid a debt (so the rider/vendor can see it).
  IF v_applied > 0 THEN
    INSERT INTO wallet_transactions (
      user_id, user_type, type, amount,
      balance_before, balance_after,
      available_before, available_after,
      held_before, held_after,
      reference, order_id, description, status
    ) VALUES (
      p_user_id, p_user_type, 'ADMIN_ADJUSTMENT', v_applied,
      v_wb.total_balance,     v_wb.total_balance,
      v_wb.available_balance, v_wb.available_balance,
      v_wb.held_balance,      v_wb.held_balance,
      'DEBTREPAY-' || p_reference, p_order_id,
      'Earnings applied to an earlier refund clawback', 'COMPLETED'
    );
  END IF;

  -- Hold the remainder (if any survived the debt repayment).
  IF v_net > 0 THEN
    INSERT INTO wallet_transactions (
      user_id, user_type, type, amount,
      balance_before, balance_after,
      available_before, available_after,
      held_before, held_after,
      reference, order_id, description, status, release_at
    ) VALUES (
      p_user_id, p_user_type, 'HOLD', v_net,
      v_wb.total_balance + 0,                          v_wb.total_balance + v_net,
      v_wb.available_balance,                          v_wb.available_balance,
      COALESCE(v_wb.held_balance, 0),                  COALESCE(v_wb.held_balance, 0) + v_net,
      p_reference, p_order_id, p_description, 'PENDING', p_release_at
    ) RETURNING id INTO v_tx_id;
  END IF;

  RETURN v_tx_id;  -- NULL only when the whole credit went to repaying debt
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. reverse_order_payout: claw back rider/vendor pay on a refund ──────────
-- For every HOLD credit tied to the order, reverse it:
--   • still held  → pull straight back out of held_balance
--   • released    → pull out of available_balance (down to zero, never negative)
--   • withdrawn   → the shortfall is added to clawback_owed (repaid by future
--                   earnings via credit_wallet_held above)
-- Idempotent per (user, order) via the CLAWBACK-<type>-<order_id> reference.
-- Returns the number of wallet credits reversed.
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
      -- Funds are still held against this order.
      v_from_held  := LEAST(v_tx.amount, GREATEST(COALESCE(v_wb.held_balance, 0), 0));
      v_from_avail := LEAST(v_tx.amount - v_from_held, GREATEST(v_wb.available_balance, 0));
    ELSE
      -- Already released to available.
      v_from_held  := 0;
      v_from_avail := LEAST(v_tx.amount, GREATEST(v_wb.available_balance, 0));
    END IF;
    v_recovered := v_from_held + v_from_avail;
    v_shortfall := v_tx.amount - v_recovered;   -- already withdrawn → becomes debt

    UPDATE wallet_balances
    SET
      held_balance      = held_balance - v_from_held,
      available_balance = available_balance - v_from_avail,
      total_balance     = total_balance - v_recovered,
      lifetime_earned   = GREATEST(lifetime_earned - v_tx.amount, 0),
      clawback_owed     = COALESCE(clawback_owed, 0) + v_shortfall,
      updated_at        = NOW()
    WHERE user_id = v_tx.user_id AND user_type = v_tx.user_type;

    -- Retire the original HOLD so release_held_batch can never act on it.
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
