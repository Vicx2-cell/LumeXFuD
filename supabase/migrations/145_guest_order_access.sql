-- ============================================================
-- LumeX Fud - Migration 145: Guest order access tokens
-- ============================================================
-- Guest checkout orders have no customer account, so order tracking needs a
-- non-enumerable bearer token. Store only the SHA-256 hash.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS guest_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_access_token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_guest_access_token_hash
  ON orders(guest_access_token_hash)
  WHERE guest_access_token_hash IS NOT NULL;

