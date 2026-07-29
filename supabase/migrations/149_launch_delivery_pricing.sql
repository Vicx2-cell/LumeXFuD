-- Launch delivery economics. Settings are JSON values so the existing
-- super-admin settings surface can edit them without exposing server secrets.
INSERT INTO settings (id, value) VALUES
  ('launch_minimum_customer_delivery_fee_kobo', '{"value":40000}'),
  ('launch_minimum_rider_payout_kobo', '{"value":30000}'),
  ('launch_delivery_margin_kobo', '{"value":10000}'),
  ('launch_customer_platform_fee_kobo', '{"value":10000}'),
  ('launch_vendor_commission_bps', '{"value":300}'),
  ('launch_guest_fee_kobo', '{"value":5000}'),
  ('launch_fuel_price_kobo_per_litre', '{"value":100000}'),
  ('launch_bike_efficiency_metres_per_litre', '{"value":40000}'),
  ('launch_maintenance_kobo_per_km', '{"value":2000}'),
  ('launch_road_distance_multiplier_bps', '{"value":13500}')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS vendor_commission_kobo BIGINT NOT NULL DEFAULT 0 CHECK (vendor_commission_kobo >= 0),
  ADD COLUMN IF NOT EXISTS guest_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (guest_fee_kobo >= 0);
