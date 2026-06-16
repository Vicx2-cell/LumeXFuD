-- ============================================================
-- LumeX Fud — Migration 052: Delivery coordinates (crowdsourced from students)
-- ============================================================
-- Captures GPS for a delivery (with the student's browser permission) so riders
-- get a precise drop point and we build real ABSU location data over time. Two
-- sinks:
--   • orders.delivery_latitude/longitude — this specific delivery (rider nav).
--   • customer_addresses.latitude/longitude — pins the customer's remembered
--     lodge (the dataset an admin can later use to place official lodges).
--
-- PRIVACY: these are precise personal locations — kept service-role only, shown
-- to the rider/admin handling the order, NEVER exposed publicly or plotted on the
-- customer-facing map (which only shows admin-verified lodges).
--
-- Coordinates are written by NON-fatal post-insert updates in the orders route,
-- so an order never fails if this migration hasn't run yet. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude  DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION;

ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Replace the 2-arg remember helper (migration 050) with a coords-aware version.
DROP FUNCTION IF EXISTS remember_customer_address(UUID, TEXT);

CREATE OR REPLACE FUNCTION remember_customer_address(
  p_customer_id UUID,
  p_address     TEXT,
  p_lat         DOUBLE PRECISION DEFAULT NULL,
  p_lng         DOUBLE PRECISION DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  IF p_address IS NULL OR length(btrim(p_address)) < 3 THEN
    RETURN;
  END IF;
  INSERT INTO customer_addresses (customer_id, address, latitude, longitude)
  VALUES (p_customer_id, btrim(p_address), p_lat, p_lng)
  ON CONFLICT (customer_id, address)
  DO UPDATE SET
    use_count    = customer_addresses.use_count + 1,
    last_used_at = NOW(),
    -- keep an existing pin unless a fresh one is supplied
    latitude     = COALESCE(EXCLUDED.latitude,  customer_addresses.latitude),
    longitude    = COALESCE(EXCLUDED.longitude, customer_addresses.longitude);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
