-- ============================================================
-- LumeX Fud — Migration 062: align vendor_scores.visibility_tier CHECK
-- ============================================================
-- The live (legacy 000_sync) visibility_tier CHECK allows the old ranking labels
-- (e.g. 'FEATURED','STANDARD', …) and rejects 'TOP' and 'LOW'. The simplified MVP
-- cron (app/api/cron/recalculate-vendor-scores) writes 'TOP' | 'STANDARD' | 'LOW'
-- (migration 018's intent), so any vendor scored TOP/LOW failed the upsert with
-- check-constraint violation 23514.
--
-- visibility_tier is only SELECTed (homepage orders by composite_score; the value
-- is never compared or displayed), and the table is empty, so re-pointing the
-- constraint to the MVP set is safe. Also reset the column DEFAULT to 'STANDARD'
-- (legacy default may be a now-disallowed value, which would break default inserts).
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE vendor_scores DROP CONSTRAINT IF EXISTS vendor_scores_visibility_tier_check;
ALTER TABLE vendor_scores ALTER COLUMN visibility_tier SET DEFAULT 'STANDARD';
ALTER TABLE vendor_scores ADD CONSTRAINT vendor_scores_visibility_tier_check
  CHECK (visibility_tier IN ('TOP', 'STANDARD', 'LOW'));
