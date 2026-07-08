-- ============================================================
-- LumeX Fud - Migration 094: Busy-mode prep-time throttle
-- Adds an order-level prep-time snapshot and configurable busy-mode settings.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS prep_time_minutes INT,
  ADD COLUMN IF NOT EXISTS busy_prep_buffer_minutes INT NOT NULL DEFAULT 0;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_prep_time_minutes_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_prep_time_minutes_check
  CHECK (prep_time_minutes IS NULL OR prep_time_minutes >= 1);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_busy_prep_buffer_minutes_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_busy_prep_buffer_minutes_check
  CHECK (busy_prep_buffer_minutes >= 0);

CREATE INDEX IF NOT EXISTS idx_orders_vendor_preparing
  ON orders(vendor_id)
  WHERE status = 'PREPARING';

INSERT INTO settings (id, value) VALUES
  ('busy_mode_preparing_threshold', '{"count": 5}'),
  ('busy_mode_prep_buffer_minutes', '{"minutes": 10}')
ON CONFLICT (id) DO NOTHING;
