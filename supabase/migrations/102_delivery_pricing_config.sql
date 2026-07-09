-- ============================================================
-- LumeX Fud - distance-based delivery pricing and rule engine
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'DISTANCE'
    CHECK (pricing_mode IN ('FLAT', 'DISTANCE')),
  ADD COLUMN IF NOT EXISTS base_distance_meters BIGINT NOT NULL DEFAULT 2000
    CHECK (base_distance_meters >= 0),
  ADD COLUMN IF NOT EXISTS distance_increment_meters BIGINT NOT NULL DEFAULT 2000
    CHECK (distance_increment_meters > 0),
  ADD COLUMN IF NOT EXISTS bike_increment_fee BIGINT NOT NULL DEFAULT 0
    CHECK (bike_increment_fee >= 0),
  ADD COLUMN IF NOT EXISTS door_increment_fee BIGINT NOT NULL DEFAULT 0
    CHECK (door_increment_fee >= 0),
  ADD COLUMN IF NOT EXISTS bike_increment_rider_fee BIGINT NOT NULL DEFAULT 0
    CHECK (bike_increment_rider_fee >= 0),
  ADD COLUMN IF NOT EXISTS door_increment_rider_fee BIGINT NOT NULL DEFAULT 0
    CHECK (door_increment_rider_fee >= 0),
  ADD COLUMN IF NOT EXISTS max_delivery_distance_meters BIGINT NOT NULL DEFAULT 10000
    CHECK (max_delivery_distance_meters > 0),
  ADD COLUMN IF NOT EXISTS vendor_delivery_radius_meters BIGINT NOT NULL DEFAULT 10000
    CHECK (vendor_delivery_radius_meters > 0);

CREATE TABLE IF NOT EXISTS delivery_pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME,
  end_time TIME,
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  weather_trigger TEXT,
  customer_adjustment_kind TEXT NOT NULL DEFAULT 'FIXED'
    CHECK (customer_adjustment_kind IN ('FIXED', 'MULTIPLIER')),
  customer_adjustment_value NUMERIC(12,4) NOT NULL DEFAULT 0,
  rider_bonus_kind TEXT NOT NULL DEFAULT 'FIXED'
    CHECK (rider_bonus_kind IN ('FIXED', 'MULTIPLIER')),
  rider_bonus_value NUMERIC(12,4) NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT delivery_pricing_rules_days_ck CHECK (
    days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]
  ),
  CONSTRAINT delivery_pricing_rules_customer_value_ck CHECK (customer_adjustment_value >= 0),
  CONSTRAINT delivery_pricing_rules_rider_value_ck CHECK (rider_bonus_value >= 0)
);

ALTER TABLE delivery_pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read delivery_pricing_rules" ON delivery_pricing_rules;
CREATE POLICY "public read delivery_pricing_rules"
  ON delivery_pricing_rules FOR SELECT
  USING (enabled = true);

DROP POLICY IF EXISTS "svc write delivery_pricing_rules" ON delivery_pricing_rules;
CREATE POLICY "svc write delivery_pricing_rules"
  ON delivery_pricing_rules FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_delivery_pricing_rules_zone_enabled_priority
  ON delivery_pricing_rules(zone_id, enabled, priority, created_at);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_distance_meters BIGINT,
  ADD COLUMN IF NOT EXISTS active_surcharge_total_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (active_surcharge_total_kobo >= 0),
  ADD COLUMN IF NOT EXISTS rider_bonus_total_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (rider_bonus_total_kobo >= 0),
  ADD COLUMN IF NOT EXISTS delivery_pricing_breakdown JSONB;
