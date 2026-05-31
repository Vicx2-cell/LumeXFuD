-- ============================================================
-- LumeX Fud — Migration 009: Performance Indexes
-- ============================================================

-- ─── CUSTOMERS ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customers_phone
  ON customers(phone)
  WHERE deleted_at IS NULL;

-- ─── VENDORS ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vendors_phone
  ON vendors(phone)
  WHERE deleted_at IS NULL;

-- Homepage vendor list: active + open
CREATE INDEX IF NOT EXISTS idx_vendors_homepage
  ON vendors(is_active, status, deleted_at)
  WHERE deleted_at IS NULL;

-- ─── MENU ITEMS ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_menu_vendor
  ON menu_items(vendor_id, is_available)
  WHERE deleted_at IS NULL;

-- ─── RIDERS ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_riders_phone
  ON riders(phone)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_riders_status
  ON riders(status)
  WHERE deleted_at IS NULL;

-- ─── ORDERS ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_customer
  ON orders(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_vendor
  ON orders(vendor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_rider
  ON orders(rider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status, created_at DESC);

-- Rider: available orders (READY + no rider)
CREATE INDEX IF NOT EXISTS idx_orders_rider_available
  ON orders(status, created_at DESC)
  WHERE status = 'READY' AND rider_id IS NULL;

-- Cron: vendor auto-cancel (PENDING orders)
CREATE INDEX IF NOT EXISTS idx_orders_vendor_cancel
  ON orders(status, created_at)
  WHERE status = 'PENDING';

-- Cron: release rider payments after hold expires
CREATE INDEX IF NOT EXISTS idx_orders_rider_release
  ON orders(status, rider_auto_release_at)
  WHERE status = 'DELIVERED';

-- NOTE: the vendor_scores index lives in 018_vendor_scores.sql, alongside the
-- CREATE TABLE. It was removed from here because the table does not exist yet at
-- migration 009 — indexing it here aborts a fresh-DB run with "relation
-- vendor_scores does not exist". 018 owns the table and its index.
