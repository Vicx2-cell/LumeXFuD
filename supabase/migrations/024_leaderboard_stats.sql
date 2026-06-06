-- ============================================================
-- LumeX Fud — Migration 024: Leaderboard stats — SCHEMA
-- ============================================================
-- Replaces the live-computed customer-only leaderboard with a denormalized
-- counter table that powers three lifetime tabs:
--   • customer  → orders delivered to them
--   • vendor    → orders they fulfilled
--   • rider     → orders they delivered
--
-- A single delivered_count per (entity_type, entity_id) serves all three tabs.
-- The count is bumped by a trigger the moment an order enters DELIVERED — once
-- per order, regardless of which code path performs the transition (status
-- route, early-confirm, cron). XP/levels are NOT part of this (gamification was
-- removed from the MVP — see migration 017 + CLAUDE.md LEGACY NOTES).
--
-- The one-time backfill of existing orders lives in 025 (separate file) so the
-- heavy table scan never blocks this fast DDL — apply 024, then 025.
--
-- Single campus (ABSU) → no campus dimension. Idempotent.
-- ============================================================

-- Fail fast instead of hanging. CREATE TRIGGER / ALTER PUBLICATION below take a
-- lock on the busy `orders` table; on a live DB that lock can queue behind
-- in-flight writes. Without a bound, the Supabase SQL-editor request waits past
-- the gateway timeout and surfaces in the browser as an opaque "Failed to fetch".
-- With these set, a contended run returns a clear `lock_timeout`/`statement
-- timeout` error you can simply re-run (everything here is idempotent), ideally
-- during a quiet moment or via `psql`.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS leaderboard_stats (
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('customer','vendor','rider')),
  entity_id       UUID NOT NULL,
  delivered_count BIGINT NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id)
);
ALTER TABLE leaderboard_stats ENABLE ROW LEVEL SECURITY;

-- Ranking query per tab: ORDER BY delivered_count DESC within a type.
CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
  ON leaderboard_stats (entity_type, delivered_count DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- The leaderboard is intentionally public: these are non-PII aggregate counts,
-- and entity names are resolved server-side via the service role (never exposed
-- through this anon-readable table). Public SELECT here mirrors the existing
-- public reads on settings/trending_data — it is NOT USING(true) hiding private
-- data. Writes happen only via the SECURITY DEFINER trigger and service role;
-- anon/JWT roles get no INSERT/UPDATE/DELETE policy, so they cannot write.
DROP POLICY IF EXISTS "public read leaderboard" ON leaderboard_stats;
CREATE POLICY "public read leaderboard" ON leaderboard_stats
  FOR SELECT USING (true);

-- ─── Increment trigger: fires once when an order enters DELIVERED ─────────────
CREATE OR REPLACE FUNCTION bump_leaderboard_on_delivered()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    INSERT INTO leaderboard_stats (entity_type, entity_id, delivered_count, updated_at)
    VALUES ('customer', NEW.customer_id, 1, NOW())
    ON CONFLICT (entity_type, entity_id)
    DO UPDATE SET delivered_count = leaderboard_stats.delivered_count + 1, updated_at = NOW();
  END IF;

  -- vendor_id is NOT NULL on orders, so a vendor row always bumps.
  INSERT INTO leaderboard_stats (entity_type, entity_id, delivered_count, updated_at)
  VALUES ('vendor', NEW.vendor_id, 1, NOW())
  ON CONFLICT (entity_type, entity_id)
  DO UPDATE SET delivered_count = leaderboard_stats.delivered_count + 1, updated_at = NOW();

  IF NEW.rider_id IS NOT NULL THEN
    INSERT INTO leaderboard_stats (entity_type, entity_id, delivered_count, updated_at)
    VALUES ('rider', NEW.rider_id, 1, NOW())
    ON CONFLICT (entity_type, entity_id)
    DO UPDATE SET delivered_count = leaderboard_stats.delivered_count + 1, updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_leaderboard_on_delivered ON orders;
CREATE TRIGGER trg_leaderboard_on_delivered
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'DELIVERED' AND OLD.status IS DISTINCT FROM 'DELIVERED')
EXECUTE FUNCTION bump_leaderboard_on_delivered();

-- ─── Realtime ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE leaderboard_stats;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
