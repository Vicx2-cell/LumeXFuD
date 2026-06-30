-- ============================================================
-- LumeX Fud — Migration 090: Vendor store location (address + map pinpoint)
-- ============================================================
-- Vendors had NO location data at all — customers and riders could not see
-- where a store physically is. This adds a human address line, a short rider
-- landmark cue, an exact map pin (lat/lng), and an optional storefront photo so
-- the place is recognisable on sight. Surfaced on the customer vendor page and
-- the rider's active-order card, each with a one-tap "directions" deep link.
--
-- All five columns are PUBLIC-safe display data (a shop's location is not
-- sensitive, unlike a customer's home), so anon/authenticated get column-level
-- SELECT on them — consistent with the migration 048 lockdown which switched
-- vendors from table-wide to column-level grants. Server reads use the service
-- role and are unaffected.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + declarative GRANT.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_text        TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS landmark            TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS latitude            DOUBLE PRECISION;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS longitude           DOUBLE PRECISION;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS location_photo_url  TEXT;

-- Keep the pin sane (a half-pin is unmappable; out-of-range is a bad capture).
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_location_latlng_ck;
ALTER TABLE vendors ADD CONSTRAINT vendors_location_latlng_ck CHECK (
  (latitude IS NULL) = (longitude IS NULL)
  AND (latitude  IS NULL OR (latitude  BETWEEN -90  AND 90))
  AND (longitude IS NULL OR (longitude BETWEEN -180 AND 180))
);

-- Public display columns → readable by the anon/authenticated roles too (the
-- bank columns stay sealed; see migration 048). Additive to the existing grant.
GRANT SELECT (address_text, landmark, latitude, longitude, location_photo_url)
  ON TABLE vendors TO anon, authenticated;
