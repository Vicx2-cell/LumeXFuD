-- ============================================================
-- LumeX Fud — Migration 080: structured delivery address (lodge / block / room)
-- ============================================================
-- A campus address that's vague to a rider ("Chinaza Lodge") wastes minutes per
-- drop and breeds disputes — which block? which room? Checkout now collects the
-- address as STRUCTURED parts that adapt to the delivery shape:
--   • BIKE — rider brings it to the lodge and calls you down (lodge + meet cue).
--   • DOOR — rider walks to your actual room (lodge + block + room number).
--
-- The canonical, human-readable string still lives in orders.delivery_address
-- (composed "Lodge · Block B · Room 12 · landmark"), so every existing consumer
-- keeps working untouched. These columns hold the same parts split out, so the
-- rider app can render them as bold/scannable chips. All nullable — pickup and
-- legacy orders simply leave them NULL.
--
-- Written non-fatally from the orders route (a fire-and-forget UPDATE, never the
-- insert), so checkout never fails if this migration is still pending.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lodge TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_block TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_room  TEXT;
