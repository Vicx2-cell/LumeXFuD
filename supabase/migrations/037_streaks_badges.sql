-- ============================================================
-- LumeX Fud — Migration 037: Streaks & badges (cosmetic revival)
-- ============================================================
-- Brings back order STREAKS and achievement BADGES that migration 017 dropped
-- with the rest of gamification. Deliberately scoped:
--   • NO XP / levels  (that part stays cut — see CLAUDE.md LEGACY NOTES)
--   • NO money rewards (badges/streaks are purely cosmetic, so DAILY WALLET
--     RECONCILIATION — a non-negotiable rule — is untouched)
--
-- Like the leaderboard (024), awarding is driven by a DB trigger on the
-- DELIVERED transition. A trigger fires once per order regardless of which code
-- path performs the transition (status route, early-confirm, auto-complete
-- cron), so streaks/badges can never drift from the orders table.
--
-- Streaks are campus-LOCAL calendar days (Africa/Lagos): one qualifying delivery
-- per day keeps the flame; a missed day resets to 1 on the next order.
--
-- Single campus (ABSU). Idempotent — safe to re-run.
-- ============================================================

-- CREATE TRIGGER below takes a lock on the busy `orders` table; bound the wait so
-- a contended run returns a clear lock_timeout you can simply re-run, rather than
-- hanging past the SQL-editor gateway. (Mirrors 024.)
SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ─── Streak state: one row per customer ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_streaks (
  customer_id         UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  current_streak_days INT  NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
  best_streak_days    INT  NOT NULL DEFAULT 0 CHECK (best_streak_days >= 0),
  last_order_date     DATE,                       -- last qualifying day (Africa/Lagos)
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE customer_streaks ENABLE ROW LEVEL SECURITY;

-- ─── Badge catalog (static definitions) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id          TEXT PRIMARY KEY,                   -- slug, referenced by trigger
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '🏅',
  sort_order  INT  NOT NULL DEFAULT 100
);
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- ─── Earned badges: one row per (customer, badge) ────────────────────────────
CREATE TABLE IF NOT EXISTS customer_badges (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  badge_id    TEXT NOT NULL REFERENCES badges(id)    ON DELETE CASCADE,
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, badge_id)
);
ALTER TABLE customer_badges ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_customer_badges_customer
  ON customer_badges (customer_id, earned_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- App reads go through server components via the service role; these policies
-- also let a customer read their own rows directly (mirrors lumi_memory, 035).

-- badges: a public, non-PII catalog (like settings) — safe to read openly.
DROP POLICY IF EXISTS "public read badges" ON badges;
CREATE POLICY "public read badges" ON badges
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "service_role_badges_all" ON badges;
CREATE POLICY "service_role_badges_all" ON badges
  FOR ALL USING (auth.role() = 'service_role');

-- customer_streaks: owner-read + service role.
DROP POLICY IF EXISTS "customer_sees_own_streak" ON customer_streaks;
CREATE POLICY "customer_sees_own_streak" ON customer_streaks
  FOR SELECT USING (
    customer_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
  );
DROP POLICY IF EXISTS "service_role_streaks_all" ON customer_streaks;
CREATE POLICY "service_role_streaks_all" ON customer_streaks
  FOR ALL USING (auth.role() = 'service_role');

-- customer_badges: owner-read + service role.
DROP POLICY IF EXISTS "customer_sees_own_badges" ON customer_badges;
CREATE POLICY "customer_sees_own_badges" ON customer_badges
  FOR SELECT USING (
    customer_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
  );
DROP POLICY IF EXISTS "service_role_customer_badges_all" ON customer_badges;
CREATE POLICY "service_role_customer_badges_all" ON customer_badges
  FOR ALL USING (auth.role() = 'service_role');

-- ─── Seed the catalog ────────────────────────────────────────────────────────
-- ON CONFLICT keeps copy/sort edits authoritative on re-run, without disturbing
-- already-earned customer_badges rows.
INSERT INTO badges (id, name, description, emoji, sort_order) VALUES
  ('first-bite',      'First Bite',       'Placed your first order',                 '🍴', 10),
  ('consistent',      'Consistent',       '3-day order streak',                      '🔥', 20),
  ('weekly-warrior',  'Weekly Warrior',   '7-day order streak',                      '🗓️', 30),
  ('two-week-legend', 'Two-Week Legend',  '14-day order streak',                     '⚡', 40),
  ('monthly-master',  'Monthly Master',   '30-day order streak',                     '👑', 50),
  ('regular',         'Regular',          'Completed 10 orders',                     '🍲', 60),
  ('foodie',          'Foodie',           'Ordered from 10 different vendors',       '🌍', 70),
  ('loyal',           'Loyal Customer',   'Completed 100 orders',                    '💎', 80),
  ('big-spender',     'Big Spender',      'A single order over ₦5,000',              '💸', 90),
  ('night-owl',       'Night Owl',        'Ordered between 9pm and 6am',             '🌙', 100),
  ('early-bird',      'Early Bird',       'Ordered before 9am',                      '🌅', 110)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      emoji = EXCLUDED.emoji, sort_order = EXCLUDED.sort_order;

-- ─── Award helper: insert-if-absent (badge_id must exist in `badges`) ─────────
CREATE OR REPLACE FUNCTION award_badge(p_customer UUID, p_badge TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO customer_badges (customer_id, badge_id, earned_at)
  VALUES (p_customer, p_badge, NOW())
  ON CONFLICT (customer_id, badge_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Trigger: update streak + award badges when an order enters DELIVERED ─────
CREATE OR REPLACE FUNCTION award_streaks_and_badges_on_delivered()
RETURNS TRIGGER AS $$
DECLARE
  v_cust    UUID := NEW.customer_id;
  v_moment  TIMESTAMPTZ := COALESCE(NEW.delivered_at, NOW());
  v_today   DATE;
  v_hour    INT;
  v_last    DATE;
  v_cur     INT;
  v_best    INT;
  v_orders  INT;
  v_vendors INT;
BEGIN
  IF v_cust IS NULL THEN
    RETURN NEW;  -- guest order: nothing to attribute
  END IF;

  -- Campus-local calendar day + hour from the moment of delivery.
  v_today := (v_moment AT TIME ZONE 'Africa/Lagos')::date;
  v_hour  := EXTRACT(HOUR FROM (v_moment AT TIME ZONE 'Africa/Lagos'))::int;

  -- ── Streak ──────────────────────────────────────────────────────────────
  SELECT current_streak_days, best_streak_days, last_order_date
    INTO v_cur, v_best, v_last
    FROM customer_streaks WHERE customer_id = v_cust;

  IF NOT FOUND THEN
    v_cur := 1; v_best := 1;
    INSERT INTO customer_streaks (customer_id, current_streak_days, best_streak_days, last_order_date)
    VALUES (v_cust, 1, 1, v_today);
  ELSE
    IF v_last = v_today THEN
      NULL;                       -- already counted a delivery today
    ELSIF v_last = v_today - 1 THEN
      v_cur := v_cur + 1;         -- consecutive day → extend
    ELSE
      v_cur := 1;                 -- gap (or first ever) → restart
    END IF;
    v_best := GREATEST(v_best, v_cur);
    UPDATE customer_streaks
       SET current_streak_days = v_cur,
           best_streak_days    = v_best,
           last_order_date     = v_today,
           updated_at          = NOW()
     WHERE customer_id = v_cust;
  END IF;

  -- ── Badges ──────────────────────────────────────────────────────────────
  PERFORM award_badge(v_cust, 'first-bite');

  IF v_cur >= 3  THEN PERFORM award_badge(v_cust, 'consistent');      END IF;
  IF v_cur >= 7  THEN PERFORM award_badge(v_cust, 'weekly-warrior');  END IF;
  IF v_cur >= 14 THEN PERFORM award_badge(v_cust, 'two-week-legend'); END IF;
  IF v_cur >= 30 THEN PERFORM award_badge(v_cust, 'monthly-master');  END IF;

  SELECT COUNT(*), COUNT(DISTINCT vendor_id)
    INTO v_orders, v_vendors
    FROM orders
   WHERE customer_id = v_cust AND delivered_at IS NOT NULL;

  IF v_orders  >= 10  THEN PERFORM award_badge(v_cust, 'regular'); END IF;
  IF v_orders  >= 100 THEN PERFORM award_badge(v_cust, 'loyal');   END IF;
  IF v_vendors >= 10  THEN PERFORM award_badge(v_cust, 'foodie');  END IF;

  -- total_amount is stored in kobo → ₦5,000 = 500000.
  IF COALESCE(NEW.total_amount, 0) >= 500000 THEN PERFORM award_badge(v_cust, 'big-spender'); END IF;

  IF v_hour >= 21 OR v_hour < 6 THEN PERFORM award_badge(v_cust, 'night-owl');  END IF;
  IF v_hour < 9                 THEN PERFORM award_badge(v_cust, 'early-bird'); END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_streaks_badges_on_delivered ON orders;
CREATE TRIGGER trg_streaks_badges_on_delivered
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'DELIVERED' AND OLD.status IS DISTINCT FROM 'DELIVERED')
EXECUTE FUNCTION award_streaks_and_badges_on_delivered();
