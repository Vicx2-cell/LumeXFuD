-- ============================================================
-- LumeX Fud — Migration 015: Platform Earnings
-- Tracks all money that belongs to the founder (Chibuike).
-- Separate from vendor/rider wallets — this is platform revenue.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_earnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN (
    'FOOD_MARKUP',        -- ₦250 per order (positive)
    'DELIVERY_CUT',       -- ₦100 bike / ₦200 door per order (positive)
    'VENDOR_SUBSCRIPTION',-- Monthly vendor fee (positive)
    'WALLET_TOPUP_FLOAT', -- Customer wallet top-up float gain (positive)
    'RIDER_BONUS_COST',   -- Rider milestone bonus paid out (negative)
    'TOPUP_BONUS_COST',   -- Customer wallet top-up bonus issued (negative)
    'REFUND_COST'         -- Refund issued to customer (negative)
  )),
  amount_kobo BIGINT NOT NULL,  -- Positive = revenue, negative = cost
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_earnings_date
  ON platform_earnings(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_earnings_type
  ON platform_earnings(type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_earnings_order
  ON platform_earnings(order_id) WHERE order_id IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Service role (used by all server-side code) bypasses RLS automatically.
-- No customer / vendor / rider should ever touch this table.

ALTER TABLE platform_earnings ENABLE ROW LEVEL SECURITY;

-- Deny all JWT-authenticated access (customers, vendors, riders, admins)
-- DROP first: CREATE POLICY has no IF NOT EXISTS, so a re-run would otherwise
-- abort with 42710 "policy ... already exists". Idempotent: safe to re-run.
DROP POLICY IF EXISTS "platform_earnings_no_public_access" ON platform_earnings;
CREATE POLICY "platform_earnings_no_public_access"
  ON platform_earnings
  FOR ALL
  USING (false);
