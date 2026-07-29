-- Complete automatic-feed sources: authoritative menu bundles and fail-closed
-- geographic eligibility for scheduled official collections.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE official_feed_area_settings
  ADD COLUMN IF NOT EXISTS coverage_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS coverage_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS coverage_radius_meters INTEGER;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_test_order BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fraud_flagged BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE feed_automation_settings
  ADD COLUMN IF NOT EXISTS vendor_reopen_minimum_hours INTEGER NOT NULL DEFAULT 48
    CHECK (vendor_reopen_minimum_hours BETWEEN 1 AND 2160);

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS feed_closed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION track_vendor_feed_closure()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED' THEN
    NEW.feed_closed_at := NOW();
  ELSIF NEW.status = 'OPEN' AND OLD.status = 'CLOSED' THEN
    NEW.feed_closed_at := OLD.feed_closed_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS vendors_track_feed_closure ON vendors;
CREATE TRIGGER vendors_track_feed_closure
BEFORE UPDATE OF status ON vendors
FOR EACH ROW EXECUTE FUNCTION track_vendor_feed_closure();

ALTER TABLE official_feed_area_settings DROP CONSTRAINT IF EXISTS official_feed_area_coverage_pair_ck;
ALTER TABLE official_feed_area_settings ADD CONSTRAINT official_feed_area_coverage_pair_ck CHECK (
  (coverage_latitude IS NULL AND coverage_longitude IS NULL AND coverage_radius_meters IS NULL)
  OR (
    coverage_latitude BETWEEN -90 AND 90
    AND coverage_longitude BETWEEN -180 AND 180
    AND coverage_radius_meters BETWEEN 1 AND 200000
  )
);

CREATE TABLE IF NOT EXISTS menu_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  description TEXT,
  price_kobo BIGINT NOT NULL CHECK (price_kobo > 0),
  image_url TEXT,
  primary_menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS menu_bundles_vendor_idx
  ON menu_bundles(vendor_id, is_active, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS menu_bundle_items (
  bundle_id UUID NOT NULL REFERENCES menu_bundles(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bundle_id, menu_item_id)
);

CREATE OR REPLACE FUNCTION validate_menu_bundle()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE primary_price BIGINT;
BEGIN
  SELECT price_kobo INTO primary_price FROM menu_items
  WHERE id = NEW.primary_menu_item_id AND vendor_id = NEW.vendor_id AND deleted_at IS NULL;
  IF primary_price IS NULL THEN
    RAISE EXCEPTION 'Bundle primary item must belong to the bundle vendor';
  END IF;
  IF primary_price <> NEW.price_kobo THEN
    RAISE EXCEPTION 'Bundle advertised price must match its orderable primary menu item';
  END IF;
  IF NEW.is_active AND (
    NOT EXISTS (SELECT 1 FROM menu_bundle_items WHERE bundle_id = NEW.id)
    OR EXISTS (
      SELECT 1 FROM menu_bundle_items parts
      JOIN menu_items items ON items.id = parts.menu_item_id
      WHERE parts.bundle_id = NEW.id
        AND (items.vendor_id <> NEW.vendor_id OR NOT items.is_available OR items.deleted_at IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION 'Active bundles require available items owned by the vendor';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS menu_bundles_validate ON menu_bundles;
CREATE TRIGGER menu_bundles_validate
BEFORE INSERT OR UPDATE ON menu_bundles
FOR EACH ROW EXECUTE FUNCTION validate_menu_bundle();

CREATE OR REPLACE FUNCTION validate_menu_bundle_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE expected_vendor UUID;
BEGIN
  SELECT vendor_id INTO expected_vendor FROM menu_bundles WHERE id = NEW.bundle_id;
  IF expected_vendor IS NULL OR NOT EXISTS (
    SELECT 1 FROM menu_items
    WHERE id = NEW.menu_item_id AND vendor_id = expected_vendor AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Bundle items must belong to the bundle vendor';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS menu_bundle_items_validate_owner ON menu_bundle_items;
CREATE TRIGGER menu_bundle_items_validate_owner
BEFORE INSERT OR UPDATE ON menu_bundle_items
FOR EACH ROW EXECUTE FUNCTION validate_menu_bundle_ownership();

CREATE OR REPLACE FUNCTION enqueue_menu_bundle_feed_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE vendor_city UUID; vendor_zone UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NOT NEW.is_active
     OR (TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, FALSE)) THEN
    RETURN NEW;
  END IF;
  SELECT city_id, zone_id INTO vendor_city, vendor_zone FROM vendors WHERE id = NEW.vendor_id;
  INSERT INTO feed_automation_outbox (
    event_key, event_type, source_entity_type, source_entity_id,
    vendor_id, city_id, zone_id, payload
  ) VALUES (
    'menu_bundles:new_bundle:' || NEW.id::text,
    'new_bundle', 'menu_bundles', NEW.id::text,
    NEW.vendor_id, vendor_city, vendor_zone,
    jsonb_build_object('name', NEW.name, 'price_kobo', NEW.price_kobo)
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'feed outbox enqueue failed for menu bundle %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS menu_bundles_feed_automation_event ON menu_bundles;
CREATE TRIGGER menu_bundles_feed_automation_event
AFTER INSERT OR UPDATE OF is_active ON menu_bundles
FOR EACH ROW EXECUTE FUNCTION enqueue_menu_bundle_feed_event();

ALTER TABLE menu_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_bundle_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON menu_bundles, menu_bundle_items FROM anon, authenticated;
GRANT ALL ON menu_bundles, menu_bundle_items TO service_role;
