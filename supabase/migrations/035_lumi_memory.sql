-- ============================================================
-- LumeX Fud — Migration 035: Lumi memory (the "knows me" layer)
-- ============================================================
-- Lumi (the in-app food companion) remembers each student so it can greet them
-- by name and lead with their taste instead of a blank "what do you want".
-- One row per customer. Everything here is USER-CONTROLLED: surfaced in Profile
-- as "What Lumi remembers", editable + wipeable in one tap (NDPR + the trust
-- promise). Deliberately scoped to TASTE + light personal context — never health,
-- financial, or sensitive disclosures (enforced in the prompt + lib layer).
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS lumi_memory (
  customer_id          UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  preferred_name       TEXT,                          -- what Lumi calls them
  spice_level          TEXT CHECK (spice_level IN ('none','mild','medium','hot')),
  dietary              TEXT[]  NOT NULL DEFAULT '{}',  -- e.g. {no_pork, vegetarian, halal}
  budget_typical_kobo  BIGINT,                         -- their usual spend, in kobo
  favourites           TEXT[]  NOT NULL DEFAULT '{}',  -- dishes / vendors they love
  dislikes             TEXT[]  NOT NULL DEFAULT '{}',  -- foods to avoid suggesting
  notes                TEXT[]  NOT NULL DEFAULT '{}',  -- light personal context they shared
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE lumi_memory ENABLE ROW LEVEL SECURITY;

-- ─── RLS POLICIES ─────────────────────────────────────────────────────────────
-- DROP-before-CREATE (CREATE POLICY has no IF NOT EXISTS) → idempotent re-runs.

-- Customer can read their own memory row.
DROP POLICY IF EXISTS "customer_sees_own_lumi_memory" ON lumi_memory;
CREATE POLICY "customer_sees_own_lumi_memory" ON lumi_memory
  FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone')
    )
  );

-- Customer can delete their own memory row (direct NDPR erasure path).
DROP POLICY IF EXISTS "customer_deletes_own_lumi_memory" ON lumi_memory;
CREATE POLICY "customer_deletes_own_lumi_memory" ON lumi_memory
  FOR DELETE USING (
    customer_id IN (
      SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone')
    )
  );

-- Service role full access (all app reads/writes go through endpoint authz).
DROP POLICY IF EXISTS "service_role_lumi_memory_all" ON lumi_memory;
CREATE POLICY "service_role_lumi_memory_all" ON lumi_memory
  FOR ALL USING (auth.role() = 'service_role');
