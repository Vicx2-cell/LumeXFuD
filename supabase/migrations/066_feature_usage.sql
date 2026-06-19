-- ============================================================
-- LumeX Fud — Migration 066: feature usage counters
-- ============================================================
-- Lightweight, privacy-safe usage analytics: one aggregate counter per
-- (feature, role) — NO per-user rows, NO PII. The super-admin usage dashboard
-- reads it to see the most-used features and how each is used across customers,
-- vendors and riders. Writes go through bump_feature_usage() (atomic increment),
-- called fire-and-forget from feature entry points so it never slows a request.
--
-- RLS enabled, deny-by-default. The bump function is SECURITY DEFINER so the
-- service-role call always succeeds regardless of policy. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS feature_usage (
  feature_key TEXT NOT NULL,
  role        TEXT NOT NULL,
  count       BIGINT NOT NULL DEFAULT 0,
  last_used   TIMESTAMPTZ,
  PRIMARY KEY (feature_key, role)
);

ALTER TABLE feature_usage ENABLE ROW LEVEL SECURITY;
-- No policy: anon/authenticated get nothing; service role bypasses.

CREATE OR REPLACE FUNCTION bump_feature_usage(p_key TEXT, p_role TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO feature_usage (feature_key, role, count, last_used)
  VALUES (p_key, p_role, 1, NOW())
  ON CONFLICT (feature_key, role)
  DO UPDATE SET count = feature_usage.count + 1, last_used = NOW();
END;
$$;
