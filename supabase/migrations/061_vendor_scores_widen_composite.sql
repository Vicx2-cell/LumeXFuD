-- ============================================================
-- LumeX Fud — Migration 061: widen vendor_scores.composite_score
-- ============================================================
-- The live vendor_scores table is the legacy (000_sync) rich-ranking shape, where
-- composite_score was sized for a small normalized value — it overflows at ≥ 10
-- ("numeric field overflow"). The simplified MVP cron
-- (app/api/cron/recalculate-vendor-scores) writes a RAW score
-- (completed_orders*2 − cancelled_orders, +1 for fast prep), which is ≥ 10 for any
-- vendor with ~5+ completed orders — so every run failed at the upsert and the
-- table never populated (homepage ranking ran with no real scores).
--
-- Widen to NUMERIC(10,4) — the precision migration 018 intended. Widening only
-- (no narrowing), so existing values are preserved. Idempotent: re-running just
-- re-asserts the same type.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE vendor_scores ALTER COLUMN composite_score TYPE NUMERIC(10,4);
