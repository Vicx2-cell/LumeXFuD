-- ============================================================
-- LumeX Fud — Migration 064: group orders (host-pays)
-- ============================================================
-- "Order with friends": a host starts a group for one vendor and shares a code.
-- Friends (logged-in customers) add their items to the shared list. When ready,
-- the HOST checks out the combined list as ONE normal order and pays for it all
-- (single payer → reuses the existing /api/orders money path unchanged; no
-- multi-payer lifecycle, so reconciliation is untouched). Settle-up is social.
--
-- These tables only collect item selections — no money lives here. Prices are
-- always recomputed server-side at checkout from menu_items (rule #4).
--
-- RLS enabled, deny-by-default (no policy). All access is via the service-role
-- client in API routes, with auth enforced in code. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS group_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT UNIQUE NOT NULL,
  vendor_id        UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  host_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CHECKED_OUT', 'EXPIRED')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE TABLE IF NOT EXISTS group_order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id   UUID NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  contributor_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contributor_name TEXT,
  menu_item_id     UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity         INT NOT NULL CHECK (quantity > 0 AND quantity <= 20),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_order_items_group ON group_order_items(group_order_id);
CREATE INDEX IF NOT EXISTS idx_group_orders_code ON group_orders(code);

ALTER TABLE group_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_order_items ENABLE ROW LEVEL SECURITY;
-- No policy: anon/authenticated get zero rows; the service-role client bypasses RLS.
