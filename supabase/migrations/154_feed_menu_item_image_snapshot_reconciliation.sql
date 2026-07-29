-- Reconciliation 154: preserve the feed menu-image snapshot schema under a unique migration version.
ALTER TABLE post_menu_items
  ADD COLUMN IF NOT EXISTS menu_item_image_url_snapshot TEXT;

COMMENT ON COLUMN post_menu_items.menu_item_image_url_snapshot IS
  'Snapshot of the linked menu item image URL at publish time for feed-safe previews.';
