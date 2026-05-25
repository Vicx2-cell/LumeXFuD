-- ============================================================
-- LumeX Fud — Migration 004: Ratings + Vendor Scores
-- ============================================================

-- ─── RATINGS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID UNIQUE NOT NULL REFERENCES orders(id),
  customer_id      UUID NOT NULL REFERENCES customers(id),
  vendor_id        UUID NOT NULL REFERENCES vendors(id),
  rider_id         UUID REFERENCES riders(id),
  vendor_rating    INT NOT NULL CHECK (vendor_rating BETWEEN 1 AND 5),
  vendor_review    TEXT,
  rider_rating     INT NOT NULL CHECK (rider_rating BETWEEN 1 AND 5),
  rider_review     TEXT,
  would_order_again BOOLEAN,
  photo_url        TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ratings_vendor ON ratings(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_rider  ON ratings(rider_id, created_at DESC);

-- ─── VENDOR SCORES (computed by weekly cron) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_scores (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id              UUID UNIQUE NOT NULL REFERENCES vendors(id),
  avg_rating             DECIMAL(3,2) DEFAULT 0,
  rating_count           INT DEFAULT 0,
  order_count_30d        INT DEFAULT 0,
  avg_prep_time          INT DEFAULT 0,   -- seconds
  order_completion_rate  DECIMAL(5,4) DEFAULT 1.0,
  repeat_customer_rate   DECIMAL(5,4) DEFAULT 0.0,
  cancel_rate            DECIMAL(5,4) DEFAULT 0.0,
  dispute_rate           DECIMAL(5,4) DEFAULT 0.0,
  composite_score        DECIMAL(4,3) DEFAULT 3.0,
  visibility_tier        TEXT NOT NULL DEFAULT 'STANDARD'
                           CHECK (visibility_tier IN ('PREMIUM','FEATURED','STANDARD','DECLINING')),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vendor_scores ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vendor_scores_composite
  ON vendor_scores(composite_score DESC);
