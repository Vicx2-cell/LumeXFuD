-- ============================================================
-- LumeX Fud — Migration 005: Gamification
-- ============================================================

-- ─── BADGES (static catalogue) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  icon_url         TEXT,
  unlock_condition TEXT
);
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- ─── CUSTOMER XP + STREAKS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_xp (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID UNIQUE NOT NULL REFERENCES customers(id),
  total_xp             INT NOT NULL DEFAULT 0,
  weekly_xp            INT NOT NULL DEFAULT 0,
  level                INT NOT NULL DEFAULT 1,
  current_streak_days  INT NOT NULL DEFAULT 0,
  best_streak_days     INT NOT NULL DEFAULT 0,
  last_order_date      DATE,
  streak_freeze_count  INT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE customer_xp ENABLE ROW LEVEL SECURITY;

-- ─── CUSTOMER BADGES (earned) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  badge_id    TEXT NOT NULL REFERENCES badges(id),
  earned_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (customer_id, badge_id)
);
ALTER TABLE customer_badges ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_customer_badges_customer
  ON customer_badges(customer_id);

-- Weekly leaderboard index (Monday cron resets weekly_xp)
CREATE INDEX IF NOT EXISTS idx_customer_xp_weekly
  ON customer_xp(weekly_xp DESC);

-- ─── BADGE SEED DATA ──────────────────────────────────────────────────────────
INSERT INTO badges (id, name, description, unlock_condition) VALUES
  ('first_bite',        'First Bite',       'Place your first order',            'order_count >= 1'),
  ('consistent',        'Consistent',       '3-day ordering streak',             'streak >= 3'),
  ('weekly_warrior',    'Weekly Warrior',   '7-day ordering streak',             'streak >= 7'),
  ('two_week_legend',   'Two-Week Legend',  '14-day ordering streak',            'streak >= 14'),
  ('monthly_master',    'Monthly Master',   '30-day ordering streak',            'streak >= 30'),
  ('foodie',            'Foodie',           'Order from 10 different vendors',   'unique_vendors >= 10'),
  ('explorer',          'Explorer',         'Order from all food categories',    'all_categories = true'),
  ('rating_master',     'Rating Master',    'Leave 50+ ratings',                 'ratings_count >= 50'),
  ('social_butterfly',  'Social Butterfly', 'Refer 3+ friends',                  'referrals >= 3'),
  ('loyal_customer',    'Loyal Customer',   'Place 100 orders',                  'order_count >= 100'),
  ('midnight_snacker',  'Midnight Snacker', 'Order between 9pm and 6am',         'night_order = true'),
  ('early_bird',        'Early Bird',       'Order before 9am',                  'morning_order = true'),
  ('speed_eater',       'Speed Eater',      'Receive order in under 15 minutes', 'fast_delivery = true'),
  ('big_spender',       'Big Spender',      'Single order over ₦5,000',          'order_total >= 500000')
ON CONFLICT (id) DO NOTHING;
