-- ============================================================
-- LumeX Fud — Migration 043: Vendor reviews (public ratings)
-- ============================================================
-- Brings back customer → vendor RATINGS that migration 017 dropped, scoped to
-- what the product needs now: a customer rates the vendor 1–5 stars and may
-- leave a short PUBLIC written review after their order. Riders are NOT rated
-- here (rider ratings stay out of MVP scope).
--
-- The vendors table already carries denormalized `avg_rating` / `total_ratings`
-- columns (migration 001). A trigger keeps them in sync on every insert, so the
-- homepage card and menu page read them directly with no extra query — and the
-- numbers can never drift from the ratings table.
--
-- One review per order (order_id UNIQUE). Reviews are immutable once written
-- (needed for trust + dispute history). Single campus (ABSU). Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ─── Ratings: one row per order ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID UNIQUE NOT NULL REFERENCES orders(id)    ON DELETE CASCADE,
  customer_id   UUID NOT NULL        REFERENCES customers(id) ON DELETE CASCADE,
  vendor_id     UUID NOT NULL        REFERENCES vendors(id)   ON DELETE CASCADE,
  stars         INT  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  -- Public written review. Length bounded here as a backstop to the Zod check.
  review        TEXT CHECK (review IS NULL OR char_length(review) <= 500),
  -- Snapshot of the reviewer's first name at submission time, for public display
  -- without joining back to customers (and so a later profile edit can't rewrite
  -- history). NULL → the UI shows a neutral fallback ("Student").
  reviewer_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

-- Public reviews list per vendor, newest first.
CREATE INDEX IF NOT EXISTS idx_ratings_vendor ON ratings (vendor_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Reviews are deliberately PUBLIC (the whole point — students read them before
-- ordering). They carry no PII beyond a first name the reviewer chose to attach,
-- so an open SELECT is acceptable (mirrors the public badge catalog in 037).
-- All writes go through the service role in the /rate API route, which enforces
-- ownership + "order completed" + one-per-order.
DROP POLICY IF EXISTS "public read reviews" ON ratings;
CREATE POLICY "public read reviews" ON ratings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "service_role_ratings_all" ON ratings;
CREATE POLICY "service_role_ratings_all" ON ratings
  FOR ALL USING (auth.role() = 'service_role');

-- ─── Keep vendors.avg_rating / total_ratings in sync ─────────────────────────
-- Recompute from scratch on the affected vendor so the denormalized columns are
-- always exactly the average of the ratings rows (no incremental drift). Fires
-- on INSERT (reviews are immutable) and on DELETE (e.g. an order/vendor removed).
CREATE OR REPLACE FUNCTION recalc_vendor_rating()
RETURNS TRIGGER AS $$
DECLARE
  v_vendor UUID := COALESCE(NEW.vendor_id, OLD.vendor_id);
  v_count  INT;
  v_avg    NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(AVG(stars), 0)
    INTO v_count, v_avg
    FROM ratings WHERE vendor_id = v_vendor;

  UPDATE vendors
     SET avg_rating    = ROUND(v_avg, 2),
         total_ratings = v_count,
         updated_at    = NOW()
   WHERE id = v_vendor;

  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recalc_vendor_rating ON ratings;
CREATE TRIGGER trg_recalc_vendor_rating
AFTER INSERT OR DELETE ON ratings
FOR EACH ROW
EXECUTE FUNCTION recalc_vendor_rating();
