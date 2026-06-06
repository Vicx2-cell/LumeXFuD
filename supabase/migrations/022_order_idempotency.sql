-- ============================================================
-- LumeX Fud — Migration 022: Order creation idempotency
-- ============================================================
-- POST /api/orders previously set idempotency_key to a fresh random UUID on
-- every call, so a double-tapped checkout created TWO orders and TWO Paystack
-- transactions. The route now reserves a client-supplied Idempotency-Key by
-- inserting the order row BEFORE calling Paystack — the existing
-- orders.idempotency_key UNIQUE constraint (001_core_schema) makes the second
-- concurrent insert fail, and the route returns the first order's stored
-- Paystack authorization instead of charging again.
--
-- This migration only adds the columns needed to replay that authorization to a
-- duplicate request (the UNIQUE constraint already exists). Idempotent.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS paystack_authorization_url TEXT,
  ADD COLUMN IF NOT EXISTS paystack_access_code       TEXT;

-- Fast lookup of an in-flight/duplicate order by its idempotency key.
-- (The UNIQUE constraint already indexes it, but it is nullable; this partial
-- index keeps replay lookups cheap and intent explicit.)
CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
