-- ============================================================
-- LumeX Fud — Migration 018: vendor_scores (was missing)
-- ============================================================
-- GET /api/vendors joins vendor_scores(composite_score, visibility_tier)
-- and 009_indexes.sql indexes it, but no migration ever CREATEd the
-- table — so the homepage query and a fresh migration run were both
-- broken. This adds the simplified MVP scoring table.
--
-- Populated weekly by POST /api/cron/recalculate-vendor-scores.
-- Scoring is intentionally simple for MVP (no ratings — those are out
-- of scope): completed-order volume, low cancellation rate, prep speed.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_scores (
  vendor_id            UUID PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  composite_score      DECIMAL(10,4) NOT NULL DEFAULT 0,
  visibility_tier      TEXT NOT NULL DEFAULT 'STANDARD'
                         CHECK (visibility_tier IN ('TOP','STANDARD','LOW')),
  completed_orders_30d INT NOT NULL DEFAULT 0,
  cancelled_orders_30d INT NOT NULL DEFAULT 0,
  avg_prep_minutes     DECIMAL(6,2),
  calculated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE vendor_scores ENABLE ROW LEVEL SECURITY;

-- No public RLS policy: the homepage reads vendor_scores through the
-- service_role admin client (GET /api/vendors), which bypasses RLS.
-- The cron writes via service_role too. RLS enabled + no policy means
-- anon/auth clients get zero rows — correct, and avoids USING (true).

-- Index already created in 009_indexes.sql (idx_vendor_scores_score).
-- Re-assert it here so this migration is self-contained on a fresh DB.
CREATE INDEX IF NOT EXISTS idx_vendor_scores_score
  ON vendor_scores(composite_score DESC);

-- Seed a baseline row for every existing active vendor so the homepage
-- join returns rows immediately (before the first cron run).
INSERT INTO vendor_scores (vendor_id)
SELECT id FROM vendors WHERE deleted_at IS NULL
ON CONFLICT (vendor_id) DO NOTHING;
