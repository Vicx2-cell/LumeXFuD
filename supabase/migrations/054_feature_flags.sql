-- ============================================================
-- LumeX Fud — Migration 054: Launch Counter feature flags
-- ============================================================
-- A small, self-contained flag store for the "Launch Counter" feature (and any
-- future simple on/off flags that carry a little config). Kept SEPARATE from the
-- existing settings-based feature catalog (lib/features.ts) on purpose: this one
-- has its own toggle audit trail (feature_flag_audit) per the launch-counter spec.
--
-- RLS is enabled on both tables and denied for client roles (anon/authenticated):
-- like the rest of the platform, real auth is enforced in API-route code and all
-- reads/writes go through the service role (which bypasses RLS). So RLS here is a
-- belt-and-braces deny — never a client surface. Idempotent.
--
-- Does NOT touch or migrate any existing table data.
-- ============================================================

-- ─── feature_flags ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny client feature_flags" ON feature_flags;
CREATE POLICY "deny client feature_flags" ON feature_flags
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─── feature_flag_audit ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flag_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key    TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE feature_flag_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny client feature_flag_audit" ON feature_flag_audit;
CREATE POLICY "deny client feature_flag_audit" ON feature_flag_audit
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_feature_flag_audit_key_time
  ON feature_flag_audit (flag_key, changed_at DESC);

-- ─── Seed the launch_counter flag (idempotent) ──────────────────────────────────
INSERT INTO feature_flags (key, enabled, config)
VALUES ('launch_counter', FALSE, '{"goal":500}'::jsonb)
ON CONFLICT (key) DO NOTHING;
