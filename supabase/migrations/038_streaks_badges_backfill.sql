-- ============================================================
-- LumeX Fud — Migration 038: Streaks & badges — BACKFILL
-- ============================================================
-- One-time seed so existing customers don't start the relaunch with an empty
-- trophy case. Only the COUNT/VALUE-based badges can be reconstructed from
-- history (they're a pure function of past orders):
--   • first-bite  — any delivered order
--   • regular     — 10+ delivered orders
--   • loyal       — 100+ delivered orders
--   • foodie      — 10+ distinct vendors
--   • big-spender — any single delivered order ≥ ₦5,000
--
-- STREAKS are intentionally NOT backfilled — they depend on day-by-day ordering
-- cadence and are meant to build forward from now. (night-owl / early-bird are
-- also left to accrue going forward.)
--
-- Run order: 037 (schema+trigger) → 038 (this). Split from 037 so this table
-- scan never shares a request with the schema DDL (mirrors 024→025). Idempotent:
-- award_badge() does ON CONFLICT DO NOTHING.
--
-- ⚠ If `orders` is large and this times out in the web SQL editor, run via psql:
--      psql "$DATABASE_URL" -f supabase/migrations/038_streaks_badges_backfill.sql
-- ============================================================

SET statement_timeout = 0;

-- first-bite + count/diversity badges, computed per customer in one pass.
INSERT INTO customer_badges (customer_id, badge_id)
SELECT customer_id, 'first-bite'
FROM orders
WHERE delivered_at IS NOT NULL AND customer_id IS NOT NULL
GROUP BY customer_id
ON CONFLICT (customer_id, badge_id) DO NOTHING;

INSERT INTO customer_badges (customer_id, badge_id)
SELECT customer_id, 'regular'
FROM orders
WHERE delivered_at IS NOT NULL AND customer_id IS NOT NULL
GROUP BY customer_id
HAVING COUNT(*) >= 10
ON CONFLICT (customer_id, badge_id) DO NOTHING;

INSERT INTO customer_badges (customer_id, badge_id)
SELECT customer_id, 'loyal'
FROM orders
WHERE delivered_at IS NOT NULL AND customer_id IS NOT NULL
GROUP BY customer_id
HAVING COUNT(*) >= 100
ON CONFLICT (customer_id, badge_id) DO NOTHING;

INSERT INTO customer_badges (customer_id, badge_id)
SELECT customer_id, 'foodie'
FROM orders
WHERE delivered_at IS NOT NULL AND customer_id IS NOT NULL
GROUP BY customer_id
HAVING COUNT(DISTINCT vendor_id) >= 10
ON CONFLICT (customer_id, badge_id) DO NOTHING;

INSERT INTO customer_badges (customer_id, badge_id)
SELECT DISTINCT customer_id, 'big-spender'
FROM orders
WHERE delivered_at IS NOT NULL AND customer_id IS NOT NULL
  AND COALESCE(total_amount, 0) >= 500000
ON CONFLICT (customer_id, badge_id) DO NOTHING;
