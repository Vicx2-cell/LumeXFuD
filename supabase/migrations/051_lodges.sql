-- ============================================================
-- LumeX Fud — Migration 051: ABSU lodge catalog (admin-managed locations)
-- ============================================================
-- A curated, admin-verified list of ABSU lodges / landmarks so customers pick a
-- known location instead of free-typing, and so we build a map of campus over
-- time. Distinct from customer_addresses (050), which is each customer's OWN
-- learned history. Map-ready: optional latitude/longitude per lodge.
--
-- Service-role only (read + write via API routes) — created_by is an admin
-- identifier, so we never expose the table to the anon key (see migration 048's
-- lesson). The public list is served column-safe by GET /api/lodges.
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS lodges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  area        TEXT,                         -- optional landmark / zone grouping
  latitude    DOUBLE PRECISION,             -- optional, for the map
  longitude   DOUBLE PRECISION,
  is_verified BOOLEAN NOT NULL DEFAULT TRUE, -- admin-added → trusted by default
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name)
);
ALTER TABLE lodges ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_lodges_active ON lodges (is_active, is_verified);

DROP POLICY IF EXISTS "service_role_lodges" ON lodges;
CREATE POLICY "service_role_lodges" ON lodges
  FOR ALL USING (auth.role() = 'service_role');
