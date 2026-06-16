-- ============================================================
-- LumeX Fud — Migration 045: Fast payout holds + release stuck funds
-- ============================================================
-- Founder decision: payouts were "overheld". Switch to a FAST policy and free
-- the money already sitting in Held.
--
--   • Established accounts (≥5 completed orders/deliveries): INSTANT release.
--   • Brand-new accounts (first 5):                          1-hour hold.
--
-- Holds are read live by lib/wallet.ts getHoldPolicy() (≈20s cache), so this
-- takes effect within seconds — NO redeploy needed. The vendor "experience"
-- count was also just fixed in code to use COMPLETED ORDERS (not ratings), so
-- established vendors are finally recognised as established.
-- ============================================================

-- ── 1. Retune the hold policy (idempotent: upsert overrides the 034 seeds) ────
INSERT INTO settings (id, value) VALUES
  ('hold_rider_base_minutes',    '{"minutes": 0}'),    -- established rider: instant
  ('hold_rider_new_minutes',     '{"minutes": 60}'),   -- new rider: 1h
  ('hold_vendor_base_minutes',   '{"minutes": 0}'),    -- established vendor: instant
  ('hold_vendor_new_minutes',    '{"minutes": 60}'),   -- new vendor: 1h
  ('hold_new_account_threshold', '{"count": 5}')       -- "new" = fewer than 5 completed
ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- ── 2. ONE-TIME: release funds already sitting in Held ───────────────────────
-- Make every pending HOLD due now. The wallet-release-held cron (every 5 min)
-- then moves held → available atomically via release_held_batch(), inserts the
-- RELEASE ledger rows, and notifies each user. So within ~5 minutes the stuck
-- vendor/rider money becomes withdrawable.
--
-- NOTE: this also frees money for orders still inside their 24h dispute window,
-- so a later refund on those specific orders can't be auto-clawed from the
-- wallet. Accepted as a one-time cleanup of the backlog. Safe to skip the
-- re-run of this statement once the backlog is cleared.
UPDATE wallet_transactions
SET release_at = NOW()
WHERE type = 'HOLD'
  AND status = 'PENDING'
  AND release_at > NOW();
