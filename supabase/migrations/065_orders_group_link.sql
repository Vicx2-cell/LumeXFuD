-- ============================================================
-- LumeX Fud — Migration 065: link an order back to its group order
-- ============================================================
-- Lets a placed order remember which group order it came from, so when the order
-- is actually PAID (wallet path immediately, or card path at the webhook) we can
-- notify every participant that the food is on the way + to which location.
--
-- Nullable + ON DELETE SET NULL. The app only writes this column for group
-- checkouts and reads it best-effort, so a normal order/payment never depends on
-- it (and never breaks if this migration hasn't run yet). Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_order_id UUID REFERENCES group_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_group_order_id ON orders(group_order_id);
