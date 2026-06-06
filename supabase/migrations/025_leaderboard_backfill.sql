-- ============================================================
-- LumeX Fud — Migration 025: Leaderboard stats — BACKFILL
-- ============================================================
-- One-time seed of leaderboard_stats from orders that were already delivered
-- before the 024 trigger existed. Split out of 024 so the (potentially large)
-- table scan never shares a request with the schema DDL — that pairing is what
-- pushed the combined script past the Supabase SQL-editor gateway timeout and
-- showed up as "Failed to fetch".
--
-- Run order: 024 (schema) → 025 (this).
--
-- delivered_at is set on the DELIVERED transition and persists through
-- COMPLETED/DISPUTED/REFUNDED, so it is the durable "was delivered" marker and
-- stays consistent with the trigger. EXCLUDED overwrite makes this fully
-- idempotent and self-correcting — a full recount is authoritative, so it is
-- safe to re-run any time (e.g. if a prior attempt timed out).
--
-- ⚠ If `orders` is large and this still times out in the web SQL editor, run it
--    from a shell instead — psql has no gateway in front of it:
--      psql "$DATABASE_URL" -f supabase/migrations/025_leaderboard_backfill.sql
-- ============================================================

-- No statement_timeout cap here: let the backfill run to completion under psql.
-- (The web editor's gateway timeout still applies there regardless of this.)
SET statement_timeout = 0;

INSERT INTO leaderboard_stats (entity_type, entity_id, delivered_count, updated_at)
SELECT 'customer', customer_id, COUNT(*), NOW()
FROM orders
WHERE delivered_at IS NOT NULL AND customer_id IS NOT NULL
GROUP BY customer_id
ON CONFLICT (entity_type, entity_id)
DO UPDATE SET delivered_count = EXCLUDED.delivered_count, updated_at = NOW();

INSERT INTO leaderboard_stats (entity_type, entity_id, delivered_count, updated_at)
SELECT 'vendor', vendor_id, COUNT(*), NOW()
FROM orders
WHERE delivered_at IS NOT NULL
GROUP BY vendor_id
ON CONFLICT (entity_type, entity_id)
DO UPDATE SET delivered_count = EXCLUDED.delivered_count, updated_at = NOW();

INSERT INTO leaderboard_stats (entity_type, entity_id, delivered_count, updated_at)
SELECT 'rider', rider_id, COUNT(*), NOW()
FROM orders
WHERE delivered_at IS NOT NULL AND rider_id IS NOT NULL
GROUP BY rider_id
ON CONFLICT (entity_type, entity_id)
DO UPDATE SET delivered_count = EXCLUDED.delivered_count, updated_at = NOW();
