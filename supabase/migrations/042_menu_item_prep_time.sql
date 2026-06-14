-- ============================================================
-- LumeX Fud — Migration 042: per-item prep time
-- ============================================================
-- Lets vendors set how long EACH dish takes, instead of one flat time for the
-- whole shop. An order's estimated prep is then the longest dish in it (a kitchen
-- cooks in parallel), falling back to the vendor's base prep_time_minutes for any
-- item left blank.
--
-- Nullable on purpose: NULL = "use the vendor's base time", so existing items keep
-- working untouched. Bounded 1..180 min.
--
-- ⚠️  NEEDS HUMAN APPROVAL — LOCKED LANE (database migration). Review, then run in
--     the Supabase SQL editor. Idempotent + non-destructive (additive column).
-- ============================================================

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS prep_time_minutes INT;

ALTER TABLE menu_items
  DROP CONSTRAINT IF EXISTS menu_items_prep_time_minutes_check;
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_prep_time_minutes_check
  CHECK (prep_time_minutes IS NULL OR (prep_time_minutes >= 1 AND prep_time_minutes <= 180));
