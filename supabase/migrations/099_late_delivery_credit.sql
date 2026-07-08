-- Late-delivery customer credits.
-- Credits use the existing customer_wallet_transactions ledger. These columns
-- are only the per-order idempotency/audit flags.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS late_delivery_credit_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS late_delivery_credit_kobo BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_delivery_credit_stage TEXT,
  ADD COLUMN IF NOT EXISTS late_delivery_credit_reference TEXT;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_late_delivery_credit_kobo_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_late_delivery_credit_kobo_check
  CHECK (late_delivery_credit_kobo >= 0);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_late_delivery_credit_stage_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_late_delivery_credit_stage_check
  CHECK (
    late_delivery_credit_stage IS NULL OR
    late_delivery_credit_stage IN ('vendor_prep', 'pickup_wait', 'transit')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_late_delivery_credit_reference
  ON orders (late_delivery_credit_reference)
  WHERE late_delivery_credit_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_late_delivery_credit_due
  ON orders (delivered_at)
  WHERE promised_ready_at IS NOT NULL
    AND delivered_at IS NOT NULL
    AND late_delivery_credit_applied_at IS NULL
    AND status IN ('DELIVERED', 'COMPLETED');

ALTER TABLE platform_earnings
  DROP CONSTRAINT IF EXISTS platform_earnings_type_check;

ALTER TABLE platform_earnings
  ADD CONSTRAINT platform_earnings_type_check CHECK (type IN (
    'FOOD_MARKUP',
    'DELIVERY_CUT',
    'VENDOR_SUBSCRIPTION',
    'WALLET_TOPUP_FLOAT',
    'RIDER_BONUS_COST',
    'TOPUP_BONUS_COST',
    'REFUND_COST',
    'LATE_DELIVERY_CREDIT_COST'
  ));
