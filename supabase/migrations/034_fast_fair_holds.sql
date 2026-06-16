-- ============================================================
-- LumeX Fud — Migration 034: "Fast & Fair" hold policy settings
-- ============================================================
-- Replaces the old blanket holds (rider 24h / vendor 72h, tier-scaled) with a
-- risk-based model: established accounts paid almost instantly, only brand-new
-- accounts held (collusion-fraud window). Durations in MINUTES, read by
-- lib/wallet.ts getHoldPolicy() with code-side fallbacks — seeding here just
-- makes them live-tunable by the super-admin.
--
-- Defaults: rider established 5 min, rider new 6h, vendor established 12h,
-- vendor new 24h, new-account threshold = first 5 completed.
-- Idempotent (ON CONFLICT DO NOTHING).
-- ============================================================

INSERT INTO settings (id, value) VALUES
  ('hold_rider_base_minutes',    '{"minutes": 5}'),     -- established rider ~instant
  ('hold_rider_new_minutes',     '{"minutes": 360}'),   -- 6h for first 5 deliveries
  ('hold_vendor_base_minutes',   '{"minutes": 720}'),   -- 12h same-day for established vendor
  ('hold_vendor_new_minutes',    '{"minutes": 1440}'),  -- 24h for first 5 orders
  ('hold_new_account_threshold', '{"count": 5}')        -- "new" = fewer than 5 completed
ON CONFLICT (id) DO NOTHING;
