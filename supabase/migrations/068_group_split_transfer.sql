-- ============================================================
-- LumeX Fud — Migration 068: wallet split for group orders
-- ============================================================
-- Real split payment. The HOST pays the full order normally; once it's PAID, each
-- non-host member's share is moved FROM their wallet TO the host's wallet (a
-- reimbursement). Every transfer is ZERO-SUM (member −X, host +X) and atomic, so
-- the daily wallet↔Paystack reconciliation is never disturbed. Idempotent on the
-- per-(order,member) reference, and if a member is short the transfer simply
-- doesn't happen (host covered them) — never a partial/negative balance.
--
-- The RPC is SECURITY DEFINER (service-role calls it). Idempotent migration.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Allow the new transaction type used by both legs of a split transfer.
ALTER TABLE customer_wallet_transactions DROP CONSTRAINT IF EXISTS customer_wallet_transactions_type_check;
ALTER TABLE customer_wallet_transactions ADD CONSTRAINT customer_wallet_transactions_type_check
  CHECK (type IN ('TOPUP', 'TOPUP_BONUS', 'PAYMENT', 'REFUND', 'FREEZE', 'ADMIN_ADJUSTMENT', 'GROUP_SPLIT'));

-- Returns: 'ok' (collected), 'insufficient' (member short → host covers),
--          'done' (already settled), 'skip' (nothing to do).
CREATE OR REPLACE FUNCTION group_split_transfer(
  p_member_id    UUID,
  p_host_id      UUID,
  p_amount_kobo  BIGINT,
  p_order_id     UUID,
  p_order_number TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref_member TEXT := 'GSPLIT-'  || p_order_number || '-' || left(p_member_id::text, 8);
  v_ref_host   TEXT := 'GSPLITH-' || p_order_number || '-' || left(p_member_id::text, 8);
  v_m RECORD;
  v_h RECORD;
  v_dummy INT;
BEGIN
  IF p_amount_kobo <= 0 OR p_member_id = p_host_id THEN RETURN 'skip'; END IF;

  -- Idempotency: this member's share already settled for this order?
  SELECT 1 INTO v_dummy FROM customer_wallet_transactions WHERE reference = v_ref_member;
  IF FOUND THEN RETURN 'done'; END IF;

  -- Make sure the host has a wallet row to receive into (zero-sum guarantee).
  INSERT INTO customer_wallets (customer_id) VALUES (p_host_id) ON CONFLICT (customer_id) DO NOTHING;

  -- Lock member; bail (no debit) if missing / frozen / short.
  SELECT * INTO v_m FROM customer_wallets WHERE customer_id = p_member_id FOR UPDATE;
  IF NOT FOUND OR v_m.is_frozen OR v_m.balance_kobo < p_amount_kobo THEN
    RETURN 'insufficient';
  END IF;

  -- Debit member.
  UPDATE customer_wallets
    SET balance_kobo = balance_kobo - p_amount_kobo,
        lifetime_spent_kobo = lifetime_spent_kobo + p_amount_kobo
    WHERE customer_id = p_member_id;
  -- amount_kobo is stored as a POSITIVE magnitude (platform convention); the
  -- direction is read from the balance delta (after < before = money out).
  INSERT INTO customer_wallet_transactions
    (customer_id, type, amount_kobo, balance_before_kobo, balance_after_kobo, reference, order_id, description, status)
    VALUES (p_member_id, 'GROUP_SPLIT', p_amount_kobo, v_m.balance_kobo, v_m.balance_kobo - p_amount_kobo,
            v_ref_member, p_order_id, 'Your share of group order ' || p_order_number, 'COMPLETED');

  -- Credit host (lock to avoid lost updates).
  SELECT * INTO v_h FROM customer_wallets WHERE customer_id = p_host_id FOR UPDATE;
  UPDATE customer_wallets SET balance_kobo = balance_kobo + p_amount_kobo WHERE customer_id = p_host_id;
  INSERT INTO customer_wallet_transactions
    (customer_id, type, amount_kobo, balance_before_kobo, balance_after_kobo, reference, order_id, description, status)
    VALUES (p_host_id, 'GROUP_SPLIT', p_amount_kobo, v_h.balance_kobo, v_h.balance_kobo + p_amount_kobo,
            v_ref_host, p_order_id, 'Friend''s share of group order ' || p_order_number, 'COMPLETED');

  RETURN 'ok';
END;
$$;
