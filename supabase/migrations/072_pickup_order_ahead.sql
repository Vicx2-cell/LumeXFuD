-- ============================================================
-- LumeX Fud — Migration 072: Pickup (Order Ahead) — skip the queue
-- ============================================================
-- A two-sided flow that needs no riders: a customer pays upfront for food +
-- a dynamic platform fee + ₦0 delivery, gets a 4-digit pickup code, and walks up
-- to collect. The vendor cooks AFTER payment is captured (so a no-show never
-- costs the vendor food), and entering the customer's code is the ONLY trigger
-- that releases the held funds.
--
-- States reuse the existing order machine:
--   PENDING → VENDOR_ACCEPTED → PREPARING → READY → COMPLETED (collected)
-- Failure branches:
--   • rejected  → CANCELLED  (vendor declines → full auto-refund, existing path)
--   • no-show   → NO_SHOW    (uncollected past the window → customer forfeits,
--                             vendor keeps payment; funds release to the vendor)
--
-- Money model (reuses existing columns so payout/earnings code is unchanged):
--   subtotal              = food (credited to the vendor on collect/no-show)
--   platform_markup       = the standard platform fee (dynamic from super-admin;
--                           the SAME platform fee as delivery — no separate fee)
--   delivery_fee / cuts   = 0  (₦0 delivery, no rider)
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ─── 1. orders: new pickup columns ───────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code        TEXT;        -- 4-digit handover code
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_eta_at      TIMESTAMPTZ; -- promised "ready by" (pacing-aware)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_deadline_at TIMESTAMPTZ; -- no-show forfeit deadline (set at READY)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS collected_at       TIMESTAMPTZ; -- when the vendor entered the code
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_show_at         TIMESTAMPTZ; -- when it was marked NO_SHOW

-- ─── 2. orders.delivery_type: allow PICKUP ───────────────────────────────────
-- Drop the existing delivery_type CHECK (matched by 'BIKE', unique to it) and
-- re-add it with PICKUP. Mirrors the status-check pattern from migrations 016/049.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'orders'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%delivery_type%'
      AND pg_get_constraintdef(con.oid) ILIKE '%BIKE%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE orders ADD CONSTRAINT orders_delivery_type_check
  CHECK (delivery_type IN ('BIKE','DOOR','PICKUP'));

-- ─── 3. orders.status: add NO_SHOW ───────────────────────────────────────────
-- Same drop-and-readd pattern, matched by 'VENDOR_ACCEPTED' (unique to the
-- order-status check, so the payment_status / rider_payment_status checks — which
-- also contain 'PENDING' — are left untouched).
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'orders'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%VENDOR_ACCEPTED%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'PENDING_PAYMENT',
    'SCHEDULED',
    'PENDING','VENDOR_ACCEPTED','PREPARING','READY',
    'RIDER_ASSIGNED','PICKED_UP','DELIVERED','COMPLETED',
    'CANCELLED','DISPUTED','REFUNDED',
    'NO_SHOW'
  ));

-- No-show sweep: READY pickup orders whose forfeit deadline has passed.
CREATE INDEX IF NOT EXISTS idx_orders_pickup_noshow
  ON orders (pickup_deadline_at)
  WHERE status = 'READY' AND delivery_type = 'PICKUP';

-- ─── 4. vendors: pickup capability + pacing ──────────────────────────────────
-- pickup_enabled defaults TRUE so the super-admin `pickup` feature flag is the
-- single master switch at launch; a vendor can opt out from their dashboard.
-- pickup_max_concurrent = 0 means "no cap" (pacing off); >0 caps simultaneous
-- pickup orders and pushes new orders' promised ready-time out by prep batches.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pickup_enabled        BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS pickup_max_concurrent INT     NOT NULL DEFAULT 0;

-- ─── 5. settings: no-show window ─────────────────────────────────────────────
-- Pickup charges the SAME platform fee as delivery (settings.platform_markup) —
-- no separate pickup fee. Only the no-show forfeit window is pickup-specific.
INSERT INTO settings (id, value)
VALUES
  ('pickup_noshow_minutes', '{"minutes": 60}'::jsonb)
ON CONFLICT (id) DO NOTHING;
