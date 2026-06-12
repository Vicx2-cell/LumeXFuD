-- ============================================================
-- LumeX Fud — Migration 020: Menu add-ons (simple priced extras)
-- ============================================================
-- Adds optional priced add-ons to menu items (e.g. "+ Extra meat ₦300"),
-- and a snapshot of the chosen add-ons on each order line.
-- Idempotent: safe to run more than once.
-- ============================================================

-- ─── 1. menu_item_addons ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_item_addons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  price_kobo    BIGINT NOT NULL CHECK (price_kobo >= 0),
  is_available  BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_menu_item_addons_item
  ON menu_item_addons(menu_item_id)
  WHERE deleted_at IS NULL;

-- RLS on, no public policy: the storefront reads add-ons through the service-role
-- admin client (server component / API routes), which bypasses RLS. anon/auth get
-- zero rows — correct, and avoids USING (true). (Same pattern as vendor_scores.)
ALTER TABLE menu_item_addons ENABLE ROW LEVEL SECURITY;

-- ─── 2. order_items.addons snapshot ───────────────────────────────────────────
-- Chosen add-ons captured at order time as [{ "name": ..., "price_kobo": ... }],
-- mirroring the existing name/price snapshot columns so historical orders stay
-- accurate even if the add-on is later edited or removed.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS addons JSONB NOT NULL DEFAULT '[]'::jsonb;


