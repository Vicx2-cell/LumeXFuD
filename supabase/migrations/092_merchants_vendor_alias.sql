-- ============================================================
-- LumeX Fud - merchant category aliasing
-- ============================================================
-- Additive only: keep `vendors` as the live table and expose a `merchants`
-- compatibility view for the gradual naming transition.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'merchant_category') THEN
    CREATE TYPE merchant_category AS ENUM ('restaurant', 'supermarket', 'pharmacy');
  END IF;
END $$;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS merchant_category merchant_category NOT NULL DEFAULT 'restaurant';

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS prescription_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_category TEXT;

-- `prescription_required` is meaningful only for pharmacy items. Existing
-- restaurant items keep the default false value, so current food ordering
-- behavior is unchanged; category-specific validation can be tightened in app
-- code without changing the order/payment pipeline.

DROP VIEW IF EXISTS merchants;

CREATE OR REPLACE VIEW merchants
WITH (security_invoker = on) AS
SELECT
  id,
  phone,
  shop_name,
  owner_name,
  logo_url,
  shop_photo_url,
  prep_time_minutes,
  status,
  busy_until,
  paused_until,
  merchant_category AS category,
  category AS legacy_category,
  description,
  paystack_subaccount_code,
  bank_code,
  bank_account_number,
  bank_account_name,
  subscription_tier,
  subscription_paid_until,
  avg_rating,
  total_ratings,
  is_active,
  approved_at,
  approved_by,
  city_id,
  zone_id,
  created_at,
  updated_at,
  deleted_at
FROM vendors;

GRANT SELECT ON merchants TO anon, authenticated;
