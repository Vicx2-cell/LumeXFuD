-- ============================================================
-- LumeX Fud — Migration 079: Customer favourite vendors (quick re-order)
-- ============================================================
-- A customer can heart a vendor; the home screen then surfaces a one-tap
-- "Favourites" filter so repeat orders are a tap away. Pure convenience layer —
-- directly targets repeat-order rate (the retention metric in CLAUDE.md). No
-- money, no PII beyond the (customer, vendor) pairing.
--
-- Service-role only (auth enforced in API-route code), like the rest of the
-- platform. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS customer_favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vendor_id   UUID NOT NULL REFERENCES vendors(id)   ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, vendor_id)
);
ALTER TABLE customer_favorites ENABLE ROW LEVEL SECURITY;

-- "My favourites" lookup (newest first).
CREATE INDEX IF NOT EXISTS idx_customer_favorites_customer
  ON customer_favorites (customer_id, created_at DESC);

DROP POLICY IF EXISTS "service_role_customer_favorites" ON customer_favorites;
CREATE POLICY "service_role_customer_favorites" ON customer_favorites
  FOR ALL USING (auth.role() = 'service_role');
