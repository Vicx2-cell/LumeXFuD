-- ============================================================
-- LumeX Fud — Add Missing Columns to Existing Tables
-- Run this in Supabase SQL Editor if migration was run before.
-- All statements use IF NOT EXISTS / safe defaults.
-- ============================================================

-- USERS — add missing columns
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS hostel TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS room_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dispute_count INT DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_dispute_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dispute_blocked_until TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- VENDORS — add all missing columns
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'STANDARD';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS monthly_fee BIGINT DEFAULT 1500000;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS subscription_paid_until TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS prep_time_minutes INT DEFAULT 15;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS physical_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS busy_until TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS avg_acceptance_minutes DECIMAL DEFAULT 5;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS acceptance_rate DECIMAL DEFAULT 1.0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS avg_prep_actual_minutes DECIMAL DEFAULT 15;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS dispute_rate DECIMAL DEFAULT 0.0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS trust_tier TEXT DEFAULT 'BRONZE';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- RIDERS — add missing columns
ALTER TABLE riders ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS active_order_id UUID;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS total_deliveries INT DEFAULT 0;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS average_rating DECIMAL DEFAULT 5.0;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS completion_rate DECIMAL DEFAULT 1.0;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS dispute_rate DECIMAL DEFAULT 0.0;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS avg_delivery_time DECIMAL;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS trust_tier TEXT DEFAULT 'BRONZE';
ALTER TABLE riders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ORDERS — add missing columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_amount BIGINT DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_payment_status TEXT DEFAULT 'PENDING';
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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_delivery_cut BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_delivery_cut BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ORDER ITEMS — add missing columns
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- Make sure idempotency_key is unique (add constraint if missing)
DO $$
BEGIN
  BEGIN
    ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key_unique UNIQUE (idempotency_key);
  EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
  END;
END $$;

-- SESSIONS — ensure columns exist
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Create order_seq if not exists
CREATE SEQUENCE IF NOT EXISTS order_seq START 1;

-- Create/replace the order number function
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

-- NOTE: LumeX uses phone OTP only. Password auth is NOT supported.
-- password_hash column intentionally excluded.

-- Verify
SELECT
  column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
ORDER BY ordinal_position;
