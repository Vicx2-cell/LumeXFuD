-- ============================================================
-- LumeX Fud — Migration 067: group order cancel + optional split
-- ============================================================
-- Two host controls:
--   1) CANCELLED status — the host can call off a group; the link then stops
--      working (adds/checkout refused, everyone notified).
--   2) split_enabled — the host chooses whether the bill is SPLIT (each pays
--      their own food + an equal share of fees) or the host treats everyone
--      (default: split on).
--
-- The app reads split_enabled best-effort (defaults true) and only WRITES
-- CANCELLED / split_enabled from host actions, so the group view never breaks if
-- this migration hasn't run yet. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE group_orders DROP CONSTRAINT IF EXISTS group_orders_status_check;
ALTER TABLE group_orders ADD CONSTRAINT group_orders_status_check
  CHECK (status IN ('OPEN', 'CHECKED_OUT', 'EXPIRED', 'CANCELLED'));

ALTER TABLE group_orders ADD COLUMN IF NOT EXISTS split_enabled BOOLEAN NOT NULL DEFAULT true;
