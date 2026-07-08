-- ============================================================
-- LumeX Fud - vendor/rider approval state
-- ============================================================
-- New accounts default to pending_review unless an explicit admin path approves
-- them. Existing active vendors/riders are backfilled as approved so current
-- live operators keep working.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS id_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS site_inspected BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS id_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicle_inspected BOOLEAN NOT NULL DEFAULT false;

UPDATE vendors
SET
  approval_state = 'approved',
  id_verified = true,
  site_inspected = true,
  approved_at = COALESCE(approved_at, created_at, NOW())
WHERE is_active = true
  AND approval_state <> 'approved';

UPDATE riders
SET
  approval_state = 'approved',
  id_verified = true,
  vehicle_inspected = true,
  approved_at = COALESCE(approved_at, created_at, NOW())
WHERE is_active = true
  AND approval_state <> 'approved';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_approval_state_ck'
  ) THEN
    ALTER TABLE vendors
      ADD CONSTRAINT vendors_approval_state_ck
      CHECK (approval_state IN ('pending_review', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'riders_approval_state_ck'
  ) THEN
    ALTER TABLE riders
      ADD CONSTRAINT riders_approval_state_ck
      CHECK (approval_state IN ('pending_review', 'approved', 'rejected'));
  END IF;
END $$;

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
  approval_state,
  id_verified,
  site_inspected,
  approved_at,
  approved_by,
  city_id,
  zone_id,
  created_at,
  updated_at,
  deleted_at
FROM vendors;

GRANT SELECT ON merchants TO anon, authenticated;
