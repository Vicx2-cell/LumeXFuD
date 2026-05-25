-- ============================================================
-- LumeX Fud — Migration 010: Seed Default Settings
-- All prices in BIGINT kobo (₦1 = 100 kobo)
-- ============================================================

-- Platform fees (locked — only super_admin can change)
INSERT INTO settings (id, value) VALUES
  ('platform_markup',          '{"amount_kobo": 25000}'),   -- ₦250
  ('delivery_fee_bike',        '{"amount_kobo": 50000}'),   -- ₦500
  ('delivery_fee_door',        '{"amount_kobo": 100000}'),  -- ₦1,000
  ('platform_delivery_cut_bike','{"amount_kobo": 10000}'),  -- ₦100 (platform share of bike fee)
  ('rider_delivery_cut_bike',  '{"amount_kobo": 40000}'),   -- ₦400 (rider share of bike fee)
  ('platform_delivery_cut_door','{"amount_kobo": 20000}'),  -- ₦200 (platform share of door fee)
  ('rider_delivery_cut_door',  '{"amount_kobo": 80000}'),   -- ₦800 (rider share of door fee)
  ('min_order_amount',         '{"amount_kobo": 50000}'),   -- ₦500 minimum order

  -- Platform hours
  ('platform_hours',           '{"open": "07:00", "close": "22:00"}'),

  -- Auto-timers
  ('vendor_accept_timeout_minutes', '{"value": 5}'),
  ('dispute_window_minutes',        '{"value": 15}'),
  ('rider_release_hours',           '{"value": 24}'),
  ('vendor_release_days',           '{"value": 3}'),

  -- Vendor subscription tiers (in kobo)
  ('subscription_founding',    '{"setup_kobo": 0,       "monthly_kobo": 1000000}'),  -- ₦10,000/mo
  ('subscription_early',       '{"setup_kobo": 2500000, "monthly_kobo": 1200000}'),  -- ₦25k setup + ₦12k/mo
  ('subscription_standard',    '{"setup_kobo": 5000000, "monthly_kobo": 1500000}'),  -- ₦50k setup + ₦15k/mo

  -- Wallet limits (in kobo)
  ('wallet_min_withdrawal',    '{"amount_kobo": 50000}'),   -- ₦500
  ('wallet_max_per_tx',        '{"amount_kobo": 2500000}'), -- ₦25,000
  ('wallet_max_per_day',       '{"amount_kobo": 5000000}'), -- ₦50,000
  ('wallet_max_per_week',      '{"amount_kobo": 20000000}'),-- ₦200,000
  ('wallet_max_per_month',     '{"amount_kobo": 50000000}'),-- ₦500,000

  -- Platform status
  ('platform_status',          '{"status": "ACTIVE"}')     -- ACTIVE | FROZEN_RECONCILIATION
ON CONFLICT (id) DO NOTHING;

-- ─── VERIFICATION QUERY ───────────────────────────────────────────────────────
-- Run this to confirm everything is in order:
--
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public' AND rowsecurity = false;
-- -- Expected: 0 rows
--
-- SELECT tablename, COUNT(*) as policy_count
-- FROM pg_policies WHERE schemaname = 'public'
-- GROUP BY tablename ORDER BY tablename;
-- -- Every table should appear
