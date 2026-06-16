-- ============================================================
-- LumeX Fud — Migration 036: reduce wallet top-up bonus 5% → 1%
-- ============================================================
-- The bonus rate lives in settings.wallet_topup_bonus_percent and is the source
-- of truth (read by lib/customer-wallet getTopupBonusPct). Migration 014 seeded
-- 5% with ON CONFLICT DO NOTHING, so an explicit UPDATE is needed to change it.
-- Also drops the hardcoded "5%" from the TOPUP_BONUS transaction label so it
-- never drifts when the rate changes again.
-- Idempotent.
-- ============================================================

UPDATE settings SET value = '{"value": 1}' WHERE id = 'wallet_topup_bonus_percent';

-- Re-create topup_customer_wallet identically to migration 014 EXCEPT the bonus
-- transaction description is now rate-free ('Top-up bonus 🎁').
CREATE OR REPLACE FUNCTION topup_customer_wallet(
  p_customer_id  UUID,
  p_amount_kobo  BIGINT,
  p_bonus_kobo   BIGINT,
  p_reference    TEXT,
  p_description  TEXT
) RETURNS UUID AS $$
DECLARE
  v_cw    RECORD;
  v_tx_id UUID;
BEGIN
  SELECT id INTO v_tx_id
  FROM customer_wallet_transactions
  WHERE reference = p_reference AND type = 'TOPUP';

  IF FOUND THEN
    RETURN v_tx_id;
  END IF;

  INSERT INTO customer_wallets (customer_id)
  VALUES (p_customer_id)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT * INTO v_cw
  FROM customer_wallets
  WHERE customer_id = p_customer_id
  FOR UPDATE;

  IF v_cw.is_frozen THEN
    RAISE EXCEPTION 'Customer wallet is frozen';
  END IF;

  UPDATE customer_wallets
  SET
    balance_kobo        = balance_kobo + p_amount_kobo + p_bonus_kobo,
    lifetime_topup_kobo = lifetime_topup_kobo + p_amount_kobo,
    updated_at          = NOW()
  WHERE customer_id = p_customer_id;

  INSERT INTO customer_wallet_transactions (
    customer_id, type, amount_kobo,
    balance_before_kobo, balance_after_kobo,
    reference, description, status
  ) VALUES (
    p_customer_id, 'TOPUP', p_amount_kobo,
    v_cw.balance_kobo, v_cw.balance_kobo + p_amount_kobo + p_bonus_kobo,
    p_reference, p_description, 'COMPLETED'
  ) RETURNING id INTO v_tx_id;

  IF p_bonus_kobo > 0 THEN
    INSERT INTO customer_wallet_transactions (
      customer_id, type, amount_kobo,
      balance_before_kobo, balance_after_kobo,
      reference, description, status
    ) VALUES (
      p_customer_id, 'TOPUP_BONUS', p_bonus_kobo,
      v_cw.balance_kobo + p_amount_kobo,
      v_cw.balance_kobo + p_amount_kobo + p_bonus_kobo,
      'BONUS-' || p_reference,
      'Top-up bonus 🎁',
      'COMPLETED'
    );
  END IF;

  RETURN v_tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
