-- ============================================================
-- LumeX Fud — Migration 083: reward profit floor + controllable surprise
-- ============================================================
-- Two things on top of migration 082:
--
-- 1. Profit floor (Failure Prevention Rule #1 — "profitable on every order,
--    never subsidize"). Checkout now caps any reward discount at
--    (platform margin − reward_min_profit_kobo), so every order keeps at least
--    the floor for the platform; a larger credit just spreads across orders.
--
-- 2. The surprise reward algorithm is now fully CONTROLLABLE from the settings
--    table — odds and prize amounts live in `surprise_reward_outcomes` (a JSON
--    list of {kobo, weight}). Change them any time with no redeploy. The roll
--    reads that list and picks weighted-randomly; the outcome is still decided
--    AT CREATION (opening only reveals it).
--
-- Idempotent — safe to re-run. (CREATE OR REPLACE + ON CONFLICT DO NOTHING.)
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Minimum platform profit that must survive on EVERY order after a reward.
-- ₦250 = 25000 kobo. Tune live without a redeploy.
INSERT INTO settings (id, value) VALUES
  ('reward_min_profit_kobo', '{"amount_kobo": 25000}')
ON CONFLICT (id) DO NOTHING;

-- Surprise outcomes — fully editable. Each item: kobo = the prize (0 = no prize),
-- weight = relative chance (any positive numbers; they don't need to sum to 100).
-- Default: 55% nothing · 30% ₦100 · 15% ₦200.
INSERT INTO settings (id, value) VALUES
  ('surprise_reward_outcomes',
   '{"outcomes": [{"kobo": 0, "weight": 55}, {"kobo": 10000, "weight": 30}, {"kobo": 20000, "weight": 15}]}')
ON CONFLICT (id) DO NOTHING;

-- Weighted-random roll driven by the settings list above. Falls back to the
-- default distribution if the row is missing/empty/misconfigured (never errors a
-- completed order). Outcome decided here, at creation — opening just reveals it.
CREATE OR REPLACE FUNCTION roll_surprise_reward(p_customer UUID, p_order UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_outcomes JSONB;
  v_total    NUMERIC;
  v_pick     NUMERIC;
  v_acc      NUMERIC := 0;
  v_elem     JSONB;
  v_kobo     BIGINT := 0;
  v_expdays  INT;
BEGIN
  IF EXISTS (SELECT 1 FROM surprise_rewards WHERE order_id = p_order) THEN RETURN; END IF;

  SELECT value->'outcomes' INTO v_outcomes FROM settings WHERE id = 'surprise_reward_outcomes';
  IF v_outcomes IS NULL OR jsonb_typeof(v_outcomes) <> 'array' OR jsonb_array_length(v_outcomes) = 0 THEN
    v_outcomes := '[{"kobo":0,"weight":55},{"kobo":10000,"weight":30},{"kobo":20000,"weight":15}]'::jsonb;
  END IF;

  SELECT COALESCE(SUM(GREATEST((e->>'weight')::numeric, 0)), 0)
    INTO v_total FROM jsonb_array_elements(v_outcomes) e;

  IF v_total > 0 THEN
    v_pick := random() * v_total;
    FOR v_elem IN SELECT e FROM jsonb_array_elements(v_outcomes) e LOOP
      v_acc := v_acc + GREATEST((v_elem->>'weight')::numeric, 0);
      IF v_pick < v_acc THEN
        v_kobo := GREATEST((v_elem->>'kobo')::bigint, 0);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  v_expdays := COALESCE((SELECT (value->>'value')::int FROM settings WHERE id = 'surprise_reward_expiry_days'), 7);

  INSERT INTO surprise_rewards (customer_id, order_id, outcome_kobo, status, expires_at)
  VALUES (p_customer, p_order, v_kobo, 'UNOPENED', NOW() + (v_expdays || ' days')::interval)
  ON CONFLICT (order_id) DO NOTHING;
END;
$$;
