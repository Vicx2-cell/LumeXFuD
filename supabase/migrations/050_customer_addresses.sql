-- ============================================================
-- LumeX Fud — Migration 050: Remembered delivery addresses (lodges)
-- ============================================================
-- The app "gets used to" where a customer orders to: every order records its
-- delivery address and bumps a use-count, so the cart can pre-fill the most-used
-- lodge and offer the rest as one-tap chips. No PII beyond the address the
-- customer already typed; service-role only (read/written via API routes).
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS customer_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address      TEXT NOT NULL,
  use_count    INT  NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, address)
);
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

-- Most-used first, then most-recent.
CREATE INDEX IF NOT EXISTS idx_customer_addresses_lookup
  ON customer_addresses (customer_id, use_count DESC, last_used_at DESC);

DROP POLICY IF EXISTS "service_role_customer_addresses" ON customer_addresses;
CREATE POLICY "service_role_customer_addresses" ON customer_addresses
  FOR ALL USING (auth.role() = 'service_role');

-- Upsert helper: first use inserts, repeats increment the count + refresh recency.
-- Atomic via ON CONFLICT. Ignores blank/too-short addresses.
CREATE OR REPLACE FUNCTION remember_customer_address(p_customer_id UUID, p_address TEXT)
RETURNS VOID AS $$
BEGIN
  IF p_address IS NULL OR length(btrim(p_address)) < 3 THEN
    RETURN;
  END IF;
  INSERT INTO customer_addresses (customer_id, address)
  VALUES (p_customer_id, btrim(p_address))
  ON CONFLICT (customer_id, address)
  DO UPDATE SET use_count = customer_addresses.use_count + 1, last_used_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
