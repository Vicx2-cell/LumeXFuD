-- Per-order speed commitments, durable delay incidents, and high-value email kinds.
-- No existing orders are backfilled or emailed by this migration.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS vendor_estimated_prep_minutes INT,
  ADD COLUMN IF NOT EXISTS vendor_estimated_delivery_minutes INT,
  ADD COLUMN IF NOT EXISTS vendor_estimate_reason TEXT,
  ADD COLUMN IF NOT EXISTS speed_target_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promised_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS speed_commitment_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delay_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delay_owner TEXT;

CREATE TABLE IF NOT EXISTS order_speed_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  signal TEXT NOT NULL CHECK (signal IN ('at_risk','overdue')),
  responsible_party TEXT NOT NULL CHECK (responsible_party IN ('vendor','dispatch','rider')),
  status_at_detection TEXT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  projected_delivery_at TIMESTAMPTZ,
  minutes_late INT NOT NULL DEFAULT 0 CHECK (minutes_late >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_speed_watch
  ON orders(payment_status, status, delivery_type, speed_target_at)
  WHERE payment_status = 'PAID' AND delivery_type <> 'PICKUP';

ALTER TABLE order_speed_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE order_speed_incidents FROM anon, authenticated;

ALTER TABLE transactional_email_events DROP CONSTRAINT IF EXISTS transactional_email_events_kind_check;
ALTER TABLE transactional_email_events ADD CONSTRAINT transactional_email_events_kind_check
  CHECK (kind IN ('WELCOME','ORDER_CONFIRMATION','ORDER_STATUS','ORDER_OUT_FOR_DELIVERY','ORDER_DELIVERED','ORDER_DELAYED'));
