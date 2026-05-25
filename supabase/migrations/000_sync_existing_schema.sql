-- ============================================================
-- LumeX Fud — Migration 000: Sync Existing Schema
-- Run this FIRST if you already ran the old migration scripts.
-- Safe to run multiple times (all statements are idempotent).
-- ============================================================

-- ─── STEP 1: Rename users → customers ────────────────────────────────────────
-- The code uses "customers" everywhere. Old migration created "users".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customers'
  ) THEN
    ALTER TABLE users RENAME TO customers;
  END IF;
END $$;

-- Ensure customers has all required columns
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS hostel TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS room_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_delivery_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dispute_count INT DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_dispute_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dispute_blocked_until TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- Remove password_hash if it exists (LumeX uses OTP only, no passwords)
ALTER TABLE customers DROP COLUMN IF EXISTS password_hash;
ALTER TABLE customers DROP COLUMN IF EXISTS email;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- ─── STEP 2: Fix vendors table ────────────────────────────────────────────────
-- Old schema used owner_phone + name; code expects phone + shop_name

-- Add phone column (copy from owner_phone if needed)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone TEXT;
UPDATE vendors SET phone = owner_phone WHERE phone IS NULL AND owner_phone IS NOT NULL;
-- Add shop_name column (copy from name if needed)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS shop_name TEXT;
UPDATE vendors SET shop_name = name WHERE shop_name IS NULL AND name IS NOT NULL;
-- Add owner_name column
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS owner_name TEXT;
UPDATE vendors SET owner_name = name WHERE owner_name IS NULL AND name IS NOT NULL;

-- Add remaining missing columns
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS shop_photo_url TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS prep_time_minutes INT DEFAULT 25;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS busy_until TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_account_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS subscription_paid_until TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2) DEFAULT 0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS total_ratings INT DEFAULT 0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add unique constraint on phone (needed for upserts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_phone_key'
  ) THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_phone_key UNIQUE (phone);
  END IF;
END $$;

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- ─── STEP 3: Fix riders table ─────────────────────────────────────────────────
ALTER TABLE riders ADD COLUMN IF NOT EXISTS full_name TEXT;
UPDATE riders SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS bike_plate TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS bank_account_name TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS active_order_id UUID;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS last_status_update_at TIMESTAMPTZ;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2) DEFAULT 0;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS total_ratings INT DEFAULT 0;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS total_deliveries INT DEFAULT 0;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS acceptance_rate DECIMAL(5,2) DEFAULT 100;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE riders ENABLE ROW LEVEL SECURITY;

-- ─── STEP 4: Fix menu_items table ────────────────────────────────────────────
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS price_kobo BIGINT;
-- Copy from existing price column if it exists
UPDATE menu_items SET price_kobo = price WHERE price_kobo IS NULL AND price IS NOT NULL;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- Ensure category column has a default
ALTER TABLE menu_items ALTER COLUMN category SET DEFAULT 'OTHER';

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- ─── STEP 5: Fix orders table ────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_markup BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_delivery_cut BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_delivery_cut BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_payment_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_auto_release_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_payment_released_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_delivery_lat DECIMAL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_delivery_lng DECIMAL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_accepted_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_assigned_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- idempotency unique constraint (check first to avoid error on re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_idempotency_key_unique'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key_unique UNIQUE (idempotency_key);
  END IF;
END $$;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ─── STEP 6: Fix sessions table ───────────────────────────────────────────────
-- Old sessions had different structure. Add missing columns.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
-- Remove old jwt_token column if present (we store JWT in cookie only)
ALTER TABLE sessions DROP COLUMN IF EXISTS jwt_token;
ALTER TABLE sessions DROP COLUMN IF EXISTS device_id;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- ─── STEP 7: Fix otp_attempts table ──────────────────────────────────────────
-- Old otp_attempts had a different structure. Drop and recreate if wrong schema.
-- Or add columns if they're missing.
ALTER TABLE otp_attempts ADD COLUMN IF NOT EXISTS otp_hash TEXT;
ALTER TABLE otp_attempts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE otp_attempts ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
ALTER TABLE otp_attempts ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE otp_attempts ADD COLUMN IF NOT EXISTS user_agent TEXT;
-- Remove old columns from previous schema
ALTER TABLE otp_attempts DROP COLUMN IF EXISTS attempts;
ALTER TABLE otp_attempts DROP COLUMN IF EXISTS last_attempt_at;
ALTER TABLE otp_attempts DROP COLUMN IF EXISTS locked_until;
ALTER TABLE otp_attempts DROP COLUMN IF EXISTS otp_code;

ALTER TABLE otp_attempts ENABLE ROW LEVEL SECURITY;

-- Drop old otp_codes table (replaced by otp_attempts)
DROP TABLE IF EXISTS otp_codes CASCADE;

-- ─── STEP 8: Fix processed_webhooks ──────────────────────────────────────────
ALTER TABLE processed_webhooks ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE processed_webhooks ADD COLUMN IF NOT EXISTS event TEXT;
ALTER TABLE processed_webhooks ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE processed_webhooks ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ DEFAULT NOW();
-- Remove old column names if present
ALTER TABLE processed_webhooks DROP COLUMN IF EXISTS webhook_id;
ALTER TABLE processed_webhooks DROP COLUMN IF EXISTS event_type;

-- Add unique constraint on (reference, event)
DO $$
BEGIN
  BEGIN
    ALTER TABLE processed_webhooks ADD CONSTRAINT processed_webhooks_reference_event_key UNIQUE (reference, event);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;

-- ─── STEP 9: Fix notifications table ─────────────────────────────────────────
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_type TEXT DEFAULT 'CUSTOMER';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS template TEXT DEFAULT 'UNKNOWN';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS termii_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
-- Remove old columns
ALTER TABLE notifications DROP COLUMN IF EXISTS recipient_phone;
ALTER TABLE notifications DROP COLUMN IF EXISTS recipient_type;
ALTER TABLE notifications DROP COLUMN IF EXISTS message;
ALTER TABLE notifications DROP COLUMN IF EXISTS termii_message_id;
ALTER TABLE notifications DROP COLUMN IF EXISTS notification_type;
ALTER TABLE notifications DROP COLUMN IF EXISTS title;
ALTER TABLE notifications DROP COLUMN IF EXISTS related_order_id;
ALTER TABLE notifications DROP COLUMN IF EXISTS message_id;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ─── STEP 10: Fix settings table ─────────────────────────────────────────────
-- Old settings used key/value TEXT. New spec uses id/value JSONB.
-- Rename key → id if needed, convert value to JSONB.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'key'
  ) THEN
    ALTER TABLE settings RENAME COLUMN key TO id;
  END IF;
END $$;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Convert value column from TEXT to JSONB if it's still TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'value'
    AND data_type = 'text'
  ) THEN
    ALTER TABLE settings ALTER COLUMN value TYPE JSONB USING value::JSONB;
  END IF;
END $$;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- ─── STEP 11: Fix wallet tables ───────────────────────────────────────────────
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS total_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS available_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS held_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS trust_tier TEXT NOT NULL DEFAULT 'BRONZE';
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS wallet_pin_hash TEXT;
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS last_bank_added_at TIMESTAMPTZ;
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN DEFAULT FALSE;
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- Remove old column names
ALTER TABLE wallet_balances DROP COLUMN IF EXISTS user_type_old;

ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;

ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_before BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_after BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS paystack_transfer_code TEXT;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- ─── STEP 12: Fix disputes table ─────────────────────────────────────────────
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- ─── STEP 13: Fix refunds table ──────────────────────────────────────────────
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS paystack_transaction_reference TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS paystack_refund_reference TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS amount_kobo BIGINT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS triggered_by TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- ─── STEP 14: Fix order_messages ─────────────────────────────────────────────
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS sender_id UUID;
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS sender_role TEXT DEFAULT 'customer';
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS message_text TEXT;
UPDATE order_messages SET message_text = message WHERE message_text IS NULL AND message IS NOT NULL;
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'TEXT';
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;

-- ─── STEP 15: Fix ratings table ──────────────────────────────────────────────
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS vendor_review TEXT;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS rider_review TEXT;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS would_order_again BOOLEAN;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS photo_url TEXT;

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

-- ─── STEP 16: Fix vendor_subscriptions ───────────────────────────────────────
ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS amount_kobo BIGINT;
ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE vendor_subscriptions ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
-- Remove old column names
ALTER TABLE vendor_subscriptions DROP COLUMN IF EXISTS billing_period_start;
ALTER TABLE vendor_subscriptions DROP COLUMN IF EXISTS billing_period_end;
ALTER TABLE vendor_subscriptions DROP COLUMN IF EXISTS monthly_fee;
ALTER TABLE vendor_subscriptions DROP COLUMN IF EXISTS next_billing_date;

ALTER TABLE vendor_subscriptions ENABLE ROW LEVEL SECURITY;

-- ─── STEP 17: Create NEW tables (didn't exist before) ────────────────────────

-- admins
CREATE TABLE IF NOT EXISTS admins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','super_admin')),
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- super_audit_logs
CREATE TABLE IF NOT EXISTS super_audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_table TEXT,
  target_id    TEXT,
  amount_kobo  BIGINT,
  old_value    JSONB,
  new_value    JSONB,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE super_audit_logs ENABLE ROW LEVEL SECURITY;

-- admin_devices
CREATE TABLE IF NOT EXISTS admin_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name        TEXT,
  first_seen         TIMESTAMPTZ DEFAULT NOW(),
  last_seen          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (admin_id, device_fingerprint)
);
ALTER TABLE admin_devices ENABLE ROW LEVEL SECURITY;

-- vendor_scores
CREATE TABLE IF NOT EXISTS vendor_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id             UUID UNIQUE NOT NULL REFERENCES vendors(id),
  avg_rating            DECIMAL(3,2) DEFAULT 0,
  rating_count          INT DEFAULT 0,
  order_count_30d       INT DEFAULT 0,
  avg_prep_time         INT DEFAULT 0,
  order_completion_rate DECIMAL(5,4) DEFAULT 1.0,
  repeat_customer_rate  DECIMAL(5,4) DEFAULT 0.0,
  cancel_rate           DECIMAL(5,4) DEFAULT 0.0,
  dispute_rate          DECIMAL(5,4) DEFAULT 0.0,
  composite_score       DECIMAL(4,3) DEFAULT 3.0,
  visibility_tier       TEXT NOT NULL DEFAULT 'STANDARD'
                          CHECK (visibility_tier IN ('PREMIUM','FEATURED','STANDARD','DECLINING')),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vendor_scores ENABLE ROW LEVEL SECURITY;

-- badges
CREATE TABLE IF NOT EXISTS badges (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  icon_url         TEXT,
  unlock_condition TEXT
);
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- customer_xp
CREATE TABLE IF NOT EXISTS customer_xp (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID UNIQUE NOT NULL REFERENCES customers(id),
  total_xp            INT NOT NULL DEFAULT 0,
  weekly_xp           INT NOT NULL DEFAULT 0,
  level               INT NOT NULL DEFAULT 1,
  current_streak_days INT NOT NULL DEFAULT 0,
  best_streak_days    INT NOT NULL DEFAULT 0,
  last_order_date     DATE,
  streak_freeze_count INT NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE customer_xp ENABLE ROW LEVEL SECURITY;

-- customer_badges
CREATE TABLE IF NOT EXISTS customer_badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  badge_id    TEXT NOT NULL REFERENCES badges(id),
  earned_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (customer_id, badge_id)
);
ALTER TABLE customer_badges ENABLE ROW LEVEL SECURITY;

-- trending_data
CREATE TABLE IF NOT EXISTS trending_data (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  orders_last_hour INT,
  top_item_name    TEXT,
  top_item_count   INT,
  top_vendor_name  TEXT,
  new_vendor_name  TEXT,
  updated_at       TIMESTAMPTZ
);
ALTER TABLE trending_data ENABLE ROW LEVEL SECURITY;
INSERT INTO trending_data (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ─── STEP 18: Sequences + order number function ──────────────────────────────
CREATE SEQUENCE IF NOT EXISTS order_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  seq_val BIGINT;
  year_str TEXT;
BEGIN
  seq_val := nextval('order_seq');
  year_str := EXTRACT(YEAR FROM NOW())::TEXT;
  RETURN 'LXF-' || year_str || '-' || LPAD(seq_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ─── STEP 19: Seed settings (in correct JSONB format) ────────────────────────
INSERT INTO settings (id, value) VALUES
  ('platform_markup',           '{"amount_kobo": 25000}'),
  ('delivery_fee_bike',         '{"amount_kobo": 50000}'),
  ('delivery_fee_door',         '{"amount_kobo": 100000}'),
  ('platform_delivery_cut_bike','{"amount_kobo": 10000}'),
  ('rider_delivery_cut_bike',   '{"amount_kobo": 40000}'),
  ('platform_delivery_cut_door','{"amount_kobo": 20000}'),
  ('rider_delivery_cut_door',   '{"amount_kobo": 80000}'),
  ('min_order_amount',          '{"amount_kobo": 50000}'),
  ('platform_hours',            '{"open": "07:00", "close": "22:00"}'),
  ('vendor_accept_timeout_minutes', '{"value": 5}'),
  ('dispute_window_minutes',    '{"value": 15}'),
  ('rider_release_hours',       '{"value": 24}'),
  ('vendor_release_days',       '{"value": 3}'),
  ('platform_status',           '{"status": "ACTIVE"}')
ON CONFLICT (id) DO NOTHING;

-- ─── STEP 20: Seed badges ────────────────────────────────────────────────────
INSERT INTO badges (id, name, description, unlock_condition) VALUES
  ('first_bite',       'First Bite',       'Place your first order',          'order_count >= 1'),
  ('consistent',       'Consistent',       '3-day ordering streak',           'streak >= 3'),
  ('weekly_warrior',   'Weekly Warrior',   '7-day ordering streak',           'streak >= 7'),
  ('two_week_legend',  'Two-Week Legend',  '14-day ordering streak',          'streak >= 14'),
  ('monthly_master',   'Monthly Master',   '30-day ordering streak',          'streak >= 30'),
  ('foodie',           'Foodie',           'Order from 10 different vendors', 'unique_vendors >= 10'),
  ('explorer',         'Explorer',         'Order from all food categories',  'all_categories = true'),
  ('rating_master',    'Rating Master',    'Leave 50+ ratings',               'ratings_count >= 50'),
  ('social_butterfly', 'Social Butterfly', 'Refer 3+ friends',                'referrals >= 3'),
  ('loyal_customer',   'Loyal Customer',   'Place 100 orders',                'order_count >= 100'),
  ('midnight_snacker', 'Midnight Snacker', 'Order between 9pm and 6am',       'night_order = true'),
  ('early_bird',       'Early Bird',       'Order before 9am',                'morning_order = true'),
  ('speed_eater',      'Speed Eater',      'Receive order in under 15 min',   'fast_delivery = true'),
  ('big_spender',      'Big Spender',      'Single order over ₦5,000',        'order_total >= 500000')
ON CONFLICT (id) DO NOTHING;

-- ─── STEP 21: Realtime ───────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE order_messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE vendors;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE trending_data;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ─── VERIFICATION ────────────────────────────────────────────────────────────
-- After running, verify with:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Every table should have rowsecurity = true.
