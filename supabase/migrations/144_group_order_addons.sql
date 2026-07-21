-- ============================================================
-- LumeX Fud - Migration 144: Group order add-on snapshots
-- ============================================================
-- Group orders must preserve the same add-on choices as solo cart checkout.
-- The route validates add-on ids against menu_item_addons and stores a compact
-- snapshot so shared baskets, split readiness, and checkout handoff do not drop
-- paid extras.
-- ============================================================

ALTER TABLE group_order_items
  ADD COLUMN IF NOT EXISTS addons JSONB NOT NULL DEFAULT '[]'::jsonb;

