-- ============================================================
-- LumeX Fud — Migration 060: backfill vendor_scores columns
-- ============================================================
-- The recalculate-vendor-scores cron upserts composite_score, visibility_tier,
-- completed_orders_30d, cancelled_orders_30d, avg_prep_minutes and calculated_at
-- (see app/api/cron/recalculate-vendor-scores). On production the table predates
-- migration 018 (it came from the 000_sync legacy schema) and only has
-- vendor_id + composite_score + visibility_tier — so every run failed with
-- PGRST204 "Could not find the 'avg_prep_minutes' column" and the table stayed
-- empty (homepage vendor ranking never got real scores).
--
-- Add the missing columns to match migration 018. Purely additive + idempotent:
-- ADD COLUMN IF NOT EXISTS, so it's a no-op on any DB already at the 018 shape.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE vendor_scores ADD COLUMN IF NOT EXISTS completed_orders_30d INT NOT NULL DEFAULT 0;
ALTER TABLE vendor_scores ADD COLUMN IF NOT EXISTS cancelled_orders_30d INT NOT NULL DEFAULT 0;
ALTER TABLE vendor_scores ADD COLUMN IF NOT EXISTS avg_prep_minutes     DECIMAL(6,2);
ALTER TABLE vendor_scores ADD COLUMN IF NOT EXISTS calculated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
