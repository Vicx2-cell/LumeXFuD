-- ============================================================
-- LumeX Fud — Migration 016: PENDING_PAYMENT status + sessions.phone
-- ============================================================
-- Two schema fixes the application code already depends on:
--   1. orders.status must allow 'PENDING_PAYMENT' (order is created
--      before Paystack confirms payment, then promoted to PENDING).
--   2. sessions needs a `phone` column — lib/session.ts inserts it on
--      every session create (createSession()).
-- Idempotent: safe to run more than once.
-- ============================================================

-- ─── 1. orders.status: add PENDING_PAYMENT ────────────────────────────────────
-- The inline CHECK is normally auto-named orders_status_check, but if the live
-- schema was created outside these migrations the name may differ. Drop ANY
-- CHECK on orders whose definition constrains the status enum — matched via
-- 'VENDOR_ACCEPTED', a value unique to the order-status check (so the
-- payment_status / rider_payment_status checks, which also contain 'PENDING',
-- are left untouched).
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
    'PENDING','VENDOR_ACCEPTED','PREPARING','READY',
    'RIDER_ASSIGNED','PICKED_UP','DELIVERED','COMPLETED',
    'CANCELLED','DISPUTED','REFUNDED'
  ));

-- ─── 2. sessions.phone ────────────────────────────────────────────────────────
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS phone TEXT;
