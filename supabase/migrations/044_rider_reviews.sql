-- ============================================================
-- LumeX Fud — Migration 044: Rider ratings (extends 043)
-- ============================================================
-- Adds an optional RIDER rating to the same per-order ratings row created in
-- 043. One order → one ratings row that can carry BOTH a vendor rating (stars/
-- review) and a rider rating (rider_stars/rider_review). Rider ratings are
-- private to the rider + admin (not shown publicly like vendor reviews).
--
-- The riders table already has denormalized avg_rating / total_ratings columns
-- (migration 001). The recalc trigger is upgraded to keep BOTH the vendor and
-- the rider aggregates in sync on insert/delete. Idempotent — safe to re-run.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE ratings
  ADD COLUMN IF NOT EXISTS rider_id     UUID REFERENCES riders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rider_stars  INT  CHECK (rider_stars IS NULL OR rider_stars BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rider_review TEXT CHECK (rider_review IS NULL OR char_length(rider_review) <= 500);

-- Rider's own reviews list, newest first (only rows where they were rated).
CREATE INDEX IF NOT EXISTS idx_ratings_rider
  ON ratings (rider_id, created_at DESC)
  WHERE rider_stars IS NOT NULL;

-- ─── Recalc BOTH vendor and rider aggregates ─────────────────────────────────
-- Replaces 043's vendor-only function. Recomputes from scratch so the
-- denormalized columns are always exactly the average of the ratings rows.
CREATE OR REPLACE FUNCTION recalc_rating_aggregates()
RETURNS TRIGGER AS $$
DECLARE
  v_vendor UUID := COALESCE(NEW.vendor_id, OLD.vendor_id);
  v_rider  UUID := COALESCE(NEW.rider_id,  OLD.rider_id);
  v_count  INT;
  v_avg    NUMERIC;
BEGIN
  -- Vendor: every rating row counts (vendor stars are always present).
  IF v_vendor IS NOT NULL THEN
    SELECT COUNT(*), COALESCE(AVG(stars), 0)
      INTO v_count, v_avg
      FROM ratings WHERE vendor_id = v_vendor;
    UPDATE vendors
       SET avg_rating = ROUND(v_avg, 2), total_ratings = v_count, updated_at = NOW()
     WHERE id = v_vendor;
  END IF;

  -- Rider: only rows where this rider was actually rated.
  IF v_rider IS NOT NULL THEN
    SELECT COUNT(*), COALESCE(AVG(rider_stars), 0)
      INTO v_count, v_avg
      FROM ratings WHERE rider_id = v_rider AND rider_stars IS NOT NULL;
    UPDATE riders
       SET avg_rating = ROUND(v_avg, 2), total_ratings = v_count, updated_at = NOW()
     WHERE id = v_rider;
  END IF;

  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Point the trigger at the upgraded function (043 created the old one).
DROP TRIGGER IF EXISTS trg_recalc_vendor_rating ON ratings;
DROP TRIGGER IF EXISTS trg_recalc_rating_aggregates ON ratings;
CREATE TRIGGER trg_recalc_rating_aggregates
AFTER INSERT OR DELETE ON ratings
FOR EACH ROW
EXECUTE FUNCTION recalc_rating_aggregates();

-- The old function is now unused; drop it if present (trigger already repointed).
DROP FUNCTION IF EXISTS recalc_vendor_rating();
