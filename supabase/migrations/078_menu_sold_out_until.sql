-- ============================================================
-- LumeX Fud — Migration 078: "Sold out for today" (auto-restoring availability)
-- ============================================================
-- Vendors can already permanently toggle menu_items.is_available. This adds a
-- LIGHTER action: "sold out today" — hide a dish in one tap and have it come
-- back automatically the next day, so a vendor who runs out of jollof at 1pm
-- doesn't keep taking orders they can't fill (fewer refunds/disputes), and
-- doesn't have to remember to re-enable it tomorrow.
--
-- sold_out_until holds the restore moment (next Africa/Lagos midnight, computed
-- server-side). The existing reset-daily-limits cron flips is_available back to
-- TRUE once it passes. A NULL value means "not on a timed sell-out" (the dish is
-- either available, or permanently turned off by the vendor).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sold_out_until TIMESTAMPTZ;

-- Cron sweep target: rows waiting to auto-restore.
CREATE INDEX IF NOT EXISTS idx_menu_items_sold_out_until
  ON menu_items (sold_out_until)
  WHERE sold_out_until IS NOT NULL;
