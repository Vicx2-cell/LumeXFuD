-- ============================================================
-- LumeX Fud — Migration 049: Scheduled (pre-ordered) meals
-- ============================================================
-- Lets a customer pay NOW for a meal to be delivered LATER. The order is paid up
-- front (reusing the normal Paystack/wallet/split flow) and parked in a new
-- SCHEDULED status until a cron hands it to the vendor at the right lead time —
-- at which point it becomes a normal PENDING order and runs the usual lifecycle.
--
-- We pay-now/deliver-later (NOT charge-later) on purpose: collecting while the
-- customer is present avoids failed 3am card charges and keeps wallet
-- reconciliation clean. Refund on cancel reuses the existing refund path.
--
-- Columns:
--   scheduled_for         — the customer's desired DELIVERY time (display + the
--                           "this is a scheduled order" flag). NULL = normal.
--   scheduled_release_at  — when the cron hands the order to the vendor
--                           (= scheduled_for − prep − delivery buffer).
--   pending_since         — when the order ENTERED the PENDING (vendor-accept)
--                           state. The 5-min auto-cancel clock keys on this so a
--                           scheduled order (created hours earlier) isn't
--                           instantly cancelled the moment it's released.
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for          TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_release_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_since          TIMESTAMPTZ;

-- Cron lookup: SCHEDULED orders whose release time has arrived.
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_release
  ON orders (scheduled_release_at)
  WHERE status = 'SCHEDULED';

-- ─── Allow SCHEDULED in the status CHECK ─────────────────────────────────────
-- Mirror migration 016: drop the existing order-status CHECK (matched by a value
-- unique to it) and re-add it with SCHEDULED included. Leaves the payment_status
-- / rider_payment_status checks (which also contain 'PENDING') untouched.
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
    'CANCELLED','DISPUTED','REFUNDED'
  ));
