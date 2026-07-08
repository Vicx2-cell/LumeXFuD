-- ============================================================
-- LumeX Fud - cities and delivery zones
-- ============================================================
-- Additive multi-city foundation. Existing Uturu behavior is preserved by
-- seeding a default Uturu zone from the already-live settings rows; no new
-- pricing numbers are introduced here.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS cities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  state      TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS delivery_zones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id          UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  base_bike_fee    BIGINT NOT NULL CHECK (base_bike_fee >= 0),
  base_door_fee    BIGINT NOT NULL CHECK (base_door_fee >= 0),
  platform_markup  BIGINT NOT NULL DEFAULT 0 CHECK (platform_markup >= 0),
  rider_split      JSONB NOT NULL DEFAULT '{}'::jsonb,
  platform_split   JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','INACTIVE')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_id, name)
);
ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;

-- Zone metadata is public-safe display/config data, but writes stay server-side.
DROP POLICY IF EXISTS "public read cities" ON cities;
CREATE POLICY "public read cities" ON cities FOR SELECT USING (status = 'ACTIVE');
DROP POLICY IF EXISTS "svc write cities" ON cities;
CREATE POLICY "svc write cities" ON cities FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "public read delivery_zones" ON delivery_zones;
CREATE POLICY "public read delivery_zones" ON delivery_zones FOR SELECT USING (status = 'ACTIVE');
DROP POLICY IF EXISTS "svc write delivery_zones" ON delivery_zones;
CREATE POLICY "svc write delivery_zones" ON delivery_zones FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES cities(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES delivery_zones(id);
ALTER TABLE riders ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES cities(id);
ALTER TABLE riders ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES delivery_zones(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES cities(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES delivery_zones(id);

CREATE INDEX IF NOT EXISTS idx_vendors_city_zone ON vendors(city_id, zone_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_riders_city_zone ON riders(city_id, zone_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_city_zone ON orders(city_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_city_status ON delivery_zones(city_id, status);

DO $$
DECLARE
  v_city UUID;
  v_zone UUID;
  v_platform_markup BIGINT;
  v_bike_fee BIGINT;
  v_door_fee BIGINT;
  v_rider_bike BIGINT;
  v_rider_door BIGINT;
  v_platform_bike BIGINT;
  v_platform_door BIGINT;
BEGIN
  SELECT (value->>'amount_kobo')::bigint INTO v_platform_markup FROM settings WHERE id = 'platform_markup';
  SELECT (value->>'amount_kobo')::bigint INTO v_bike_fee FROM settings WHERE id = 'delivery_fee_bike';
  SELECT (value->>'amount_kobo')::bigint INTO v_door_fee FROM settings WHERE id = 'delivery_fee_door';
  SELECT (value->>'amount_kobo')::bigint INTO v_rider_bike FROM settings WHERE id = 'rider_delivery_cut_bike';
  SELECT (value->>'amount_kobo')::bigint INTO v_rider_door FROM settings WHERE id = 'rider_delivery_cut_door';
  SELECT (value->>'amount_kobo')::bigint INTO v_platform_bike FROM settings WHERE id = 'platform_delivery_cut_bike';
  SELECT (value->>'amount_kobo')::bigint INTO v_platform_door FROM settings WHERE id = 'platform_delivery_cut_door';

  INSERT INTO cities (name, state, slug, status)
  VALUES ('Uturu', 'Abia', 'uturu', 'ACTIVE')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state, status = EXCLUDED.status
  RETURNING id INTO v_city;

  INSERT INTO delivery_zones (
    city_id, name, base_bike_fee, base_door_fee, platform_markup,
    rider_split, platform_split, status
  )
  VALUES (
    v_city, 'Uturu Default',
    COALESCE(v_bike_fee, 0), COALESCE(v_door_fee, 0), COALESCE(v_platform_markup, 0),
    jsonb_build_object('BIKE', COALESCE(v_rider_bike, 0), 'DOOR', COALESCE(v_rider_door, 0)),
    jsonb_build_object('BIKE', COALESCE(v_platform_bike, 0), 'DOOR', COALESCE(v_platform_door, 0)),
    'ACTIVE'
  )
  ON CONFLICT (city_id, name) DO UPDATE SET
    base_bike_fee = EXCLUDED.base_bike_fee,
    base_door_fee = EXCLUDED.base_door_fee,
    platform_markup = EXCLUDED.platform_markup,
    rider_split = EXCLUDED.rider_split,
    platform_split = EXCLUDED.platform_split,
    status = EXCLUDED.status,
    updated_at = now()
  RETURNING id INTO v_zone;

  UPDATE vendors SET city_id = COALESCE(city_id, v_city), zone_id = COALESCE(zone_id, v_zone)
    WHERE deleted_at IS NULL;
  UPDATE riders SET city_id = COALESCE(city_id, v_city), zone_id = COALESCE(zone_id, v_zone)
    WHERE deleted_at IS NULL;
  UPDATE orders SET city_id = COALESCE(city_id, v_city), zone_id = COALESCE(zone_id, v_zone)
    WHERE city_id IS NULL OR zone_id IS NULL;
END $$;
