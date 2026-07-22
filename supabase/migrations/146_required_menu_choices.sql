-- Add one required-choice group to the existing menu add-on model.
-- Rows marked required are alternatives: customers must choose exactly one.
ALTER TABLE menu_item_addons
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_menu_item_addons_required
  ON menu_item_addons(menu_item_id, is_required)
  WHERE deleted_at IS NULL AND is_available = TRUE;
