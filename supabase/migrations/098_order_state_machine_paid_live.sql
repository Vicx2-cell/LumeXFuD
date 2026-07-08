-- Explicit order-state overlay and paid-live timestamps for the 2-hour pickup ceiling.
-- Legacy orders.status remains in place during transition; order_state records the
-- normalized lifecycle without breaking existing routes/imports.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS placed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_state TEXT,
  ADD COLUMN IF NOT EXISTS promised_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promised_ready_extended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promised_ready_extension_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_cancel_reason TEXT;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_order_state_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_order_state_check
  CHECK (
    order_state IS NULL OR order_state IN (
      'placed',
      'vendor_ack',
      'preparing',
      'ready_for_pickup',
      'picked_up',
      'in_transit',
      'delivered',
      'late_delivered',
      'cancelled'
    )
  );

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_promised_ready_extension_count_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_promised_ready_extension_count_check
  CHECK (promised_ready_extension_count >= 0);

UPDATE orders
SET
  placed_at = COALESCE(placed_at, pending_since),
  order_state = COALESCE(
    order_state,
    CASE status
      WHEN 'PENDING' THEN 'placed'
      WHEN 'VENDOR_ACCEPTED' THEN 'vendor_ack'
      WHEN 'PREPARING' THEN 'preparing'
      WHEN 'READY' THEN 'ready_for_pickup'
      WHEN 'RIDER_ASSIGNED' THEN 'ready_for_pickup'
      WHEN 'PICKED_UP' THEN 'picked_up'
      WHEN 'DELIVERED' THEN 'delivered'
      WHEN 'COMPLETED' THEN 'delivered'
      WHEN 'CANCELLED' THEN 'cancelled'
      WHEN 'REFUNDED' THEN 'cancelled'
      WHEN 'NO_SHOW' THEN 'cancelled'
      ELSE order_state
    END
  )
WHERE placed_at IS NULL OR order_state IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_paid_live_unpicked
  ON orders (placed_at)
  WHERE payment_status = 'PAID'
    AND picked_up_at IS NULL
    AND status IN ('PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED');
