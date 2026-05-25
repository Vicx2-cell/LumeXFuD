-- ============================================================
-- LumeX Fud — Full Database Migration
-- Run this in Supabase SQL Editor (lumex project)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CUSTOMERS (renamed from users — matches CLAUDE.md spec)
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone           TEXT UNIQUE NOT NULL,  -- E.164
  name            TEXT,
  email           TEXT,
  hostel          TEXT,
  room_number     TEXT,
  default_delivery_address TEXT,
  dispute_count   INT DEFAULT 0,
  last_dispute_at TIMESTAMPTZ,
  dispute_blocked_until TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VENDORS
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      TEXT NOT NULL,
  description               TEXT,
  logo_url                  TEXT,
  status                    TEXT DEFAULT 'CLOSED' CHECK (status IN ('OPEN','CLOSED','BUSY')),
  is_active                 BOOLEAN DEFAULT FALSE,
  owner_name                TEXT,
  owner_phone               TEXT UNIQUE NOT NULL,  -- E.164
  bank_account_number       TEXT,
  bank_name                 TEXT,
  paystack_subaccount_code  TEXT,
  tier                      TEXT DEFAULT 'STANDARD' CHECK (tier IN ('FOUNDING','EARLY','STANDARD')),
  monthly_fee               BIGINT DEFAULT 1500000,  -- kobo (₦15,000)
  subscription_paid_until   TIMESTAMPTZ,
  prep_time_minutes         INT DEFAULT 15,
  kyc_verified              BOOLEAN DEFAULT FALSE,
  physical_verified         BOOLEAN DEFAULT FALSE,
  verified_by               TEXT,
  verified_at               TIMESTAMPTZ,
  paused_until              TIMESTAMPTZ,
  busy_until                TIMESTAMPTZ,
  avg_acceptance_minutes    DECIMAL DEFAULT 5,
  acceptance_rate           DECIMAL DEFAULT 1.0,
  avg_prep_actual_minutes   DECIMAL DEFAULT 15,
  dispute_rate              DECIMAL DEFAULT 0.0,
  trust_tier                TEXT DEFAULT 'BRONZE' CHECK (trust_tier IN ('BRONZE','SILVER','GOLD','DIAMOND')),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MENU ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id    UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  price        BIGINT NOT NULL,  -- kobo
  image_url    TEXT,
  category     TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  daily_limit  INT,
  sold_today   INT DEFAULT 0,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RIDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS riders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  phone               TEXT UNIQUE NOT NULL,  -- E.164
  status              TEXT DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE','BUSY','OFFLINE')),
  bank_account_number TEXT,
  bank_name           TEXT,
  paystack_subaccount_code TEXT,
  active_order_id     UUID,
  total_deliveries    INT DEFAULT 0,
  average_rating      DECIMAL DEFAULT 5.0,
  completion_rate     DECIMAL DEFAULT 1.0,
  dispute_rate        DECIMAL DEFAULT 0.0,
  avg_delivery_time   DECIMAL,
  is_active           BOOLEAN DEFAULT FALSE,
  kyc_verified        BOOLEAN DEFAULT FALSE,
  suspension_reason   TEXT,
  suspended_until     TIMESTAMPTZ,
  trust_tier          TEXT DEFAULT 'BRONZE' CHECK (trust_tier IN ('BRONZE','SILVER','GOLD','DIAMOND')),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number            TEXT UNIQUE NOT NULL,
  customer_id             UUID NOT NULL REFERENCES customers(id),
  vendor_id               UUID NOT NULL REFERENCES vendors(id),
  rider_id                UUID REFERENCES riders(id),
  status                  TEXT DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','VENDOR_ACCEPTED','PREPARING','READY',
    'RIDER_ASSIGNED','PICKED_UP','DELIVERED','COMPLETED',
    'CANCELLED','DISPUTED','RESOLVED_REFUND','RESOLVED_NO_ACTION'
  )),
  delivery_type           TEXT NOT NULL CHECK (delivery_type IN ('BIKE','DOOR')),
  delivery_address        TEXT NOT NULL,
  delivery_instructions   TEXT,
  subtotal                BIGINT NOT NULL,
  platform_markup         BIGINT NOT NULL,  -- always set from settings table at order creation
  delivery_fee            BIGINT NOT NULL,
  platform_delivery_cut   BIGINT NOT NULL,
  rider_delivery_cut      BIGINT NOT NULL,
  tip_amount              BIGINT DEFAULT 0,
  total_amount            BIGINT NOT NULL,
  paystack_reference      TEXT UNIQUE NOT NULL,
  idempotency_key         TEXT UNIQUE,
  payment_status          TEXT DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','PAID','FAILED','REFUNDED')),
  rider_payment_status    TEXT DEFAULT 'PENDING' CHECK (rider_payment_status IN ('PENDING','RELEASED','HELD')),
  rider_auto_release_at   TIMESTAMPTZ,
  rider_payment_released_at TIMESTAMPTZ,
  delivery_photo_url      TEXT,
  rider_delivery_lat      DECIMAL,
  rider_delivery_lng      DECIMAL,
  vendor_accepted_at      TIMESTAMPTZ,
  preparing_at            TIMESTAMPTZ,
  ready_at                TIMESTAMPTZ,
  rider_assigned_at       TIMESTAMPTZ,
  picked_up_at            TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ORDER ITEMS (snapshots at time of order)
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id   UUID REFERENCES menu_items(id),
  name           TEXT NOT NULL,    -- snapshot
  price          BIGINT NOT NULL,  -- snapshot kobo
  quantity       INT NOT NULL,
  subtotal       BIGINT NOT NULL,
  notes          TEXT,             -- item-level special instructions
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id               UUID NOT NULL REFERENCES orders(id),
  paystack_reference     TEXT UNIQUE NOT NULL,
  paystack_transaction_id TEXT,
  amount                 BIGINT NOT NULL,
  status                 TEXT DEFAULT 'PENDING',
  channel                TEXT,
  paid_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REFUNDS
-- ============================================================
CREATE TABLE IF NOT EXISTS refunds (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID NOT NULL REFERENCES orders(id),
  payment_id          UUID REFERENCES payments(id),
  paystack_refund_id  TEXT,
  amount              BIGINT NOT NULL,
  reason              TEXT,
  status              TEXT DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','PROCESSING','PROCESSED','FAILED','NEEDS_ATTENTION'
  )),
  initiated_by        TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  processed_at        TIMESTAMPTZ
);

-- ============================================================
-- VENDOR SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_subscriptions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id            UUID NOT NULL REFERENCES vendors(id),
  amount               BIGINT NOT NULL,
  billing_period_start TIMESTAMPTZ,
  billing_period_end   TIMESTAMPTZ,
  status               TEXT DEFAULT 'PENDING' CHECK (status IN ('PAID','PENDING','OVERDUE','CANCELLED')),
  paystack_reference   TEXT,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RATINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ratings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID UNIQUE NOT NULL REFERENCES orders(id),
  customer_id   UUID NOT NULL REFERENCES customers(id),
  vendor_id     UUID REFERENCES vendors(id),
  rider_id      UUID REFERENCES riders(id),
  vendor_rating INT CHECK (vendor_rating BETWEEN 1 AND 5),
  rider_rating  INT CHECK (rider_rating BETWEEN 1 AND 5),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DISPUTES
-- ============================================================
CREATE TABLE IF NOT EXISTS disputes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID UNIQUE NOT NULL REFERENCES orders(id),
  customer_id         UUID NOT NULL REFERENCES customers(id),
  reason              TEXT NOT NULL,
  description         TEXT,
  customer_photo_url  TEXT,
  status              TEXT DEFAULT 'OPEN' CHECK (status IN (
    'OPEN','INVESTIGATING','RESOLVED_REFUND','RESOLVED_NO_ACTION'
  )),
  resolved_by         TEXT,
  resolved_at         TIMESTAMPTZ,
  refund_id           UUID REFERENCES refunds(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id          UUID REFERENCES orders(id),
  recipient_phone   TEXT,
  recipient_type    TEXT,
  message           TEXT,
  channel           TEXT DEFAULT 'sms',
  status            TEXT DEFAULT 'PENDING',
  termii_message_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SETTINGS (key-value store for platform config)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('platform_markup', '25000'),
  ('delivery_fee_bike', '50000'),
  ('delivery_fee_door', '100000'),
  ('platform_delivery_cut_bike', '10000'),
  ('platform_delivery_cut_door', '20000'),
  ('rider_delivery_cut_bike', '40000'),
  ('rider_delivery_cut_door', '80000'),
  ('min_order_amount', '50000'),
  ('auto_cancel_minutes', '5'),
  ('dispute_window_minutes', '15'),
  ('rider_release_minutes', '15')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     TEXT,
  actor_role   TEXT,
  action       TEXT NOT NULL,
  target_table TEXT,
  target_id    TEXT,
  old_value    JSONB,
  new_value    JSONB,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OTP CODES (stores hashed OTPs)
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,  -- SHA-256 hash
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY,
  phone      TEXT NOT NULL,
  role       TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROCESSED WEBHOOKS (idempotency)
-- ============================================================
CREATE TABLE IF NOT EXISTS processed_webhooks (
  paystack_reference TEXT PRIMARY KEY,
  event_type         TEXT,
  processed_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OTP ATTEMPTS (rate limiting backup store)
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_attempts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone           TEXT UNIQUE NOT NULL,
  attempts        INT DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ORDER MESSAGES (in-app messaging)
-- ============================================================
CREATE TABLE IF NOT EXISTS order_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID NOT NULL REFERENCES orders(id),
  sender_type  TEXT NOT NULL CHECK (sender_type IN ('CUSTOMER','RIDER','VENDOR')),
  message      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WALLET BALANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_balances (
  user_id           UUID PRIMARY KEY,
  user_type         TEXT NOT NULL CHECK (user_type IN ('VENDOR','RIDER')),
  total_balance     BIGINT DEFAULT 0,
  available_balance BIGINT DEFAULT 0,
  held_balance      BIGINT DEFAULT 0,
  trust_tier        TEXT DEFAULT 'BRONZE' CHECK (trust_tier IN ('BRONZE','SILVER','GOLD','DIAMOND')),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WALLET TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL,
  user_type      TEXT NOT NULL CHECK (user_type IN ('VENDOR','RIDER')),
  type           TEXT NOT NULL CHECK (type IN ('CREDIT','DEBIT','HOLD','RELEASE','FREEZE','WITHDRAWAL')),
  amount         BIGINT NOT NULL,
  balance_before BIGINT,
  balance_after  BIGINT,
  reference      TEXT,
  order_id       UUID REFERENCES orders(id),
  status         TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ORDER SEQUENCE (for human-readable order numbers)
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS order_seq START 1;

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_vendor_status ON orders(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status_rider ON orders(status, rider_id);
CREATE INDEX IF NOT EXISTS idx_orders_auto_release ON orders(rider_auto_release_at) WHERE rider_auto_release_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_menu_items_vendor_available ON menu_items(vendor_id, is_available);
CREATE INDEX IF NOT EXISTS idx_riders_status ON riders(status) WHERE status = 'ONLINE';
CREATE INDEX IF NOT EXISTS idx_otp_attempts_phone ON otp_attempts(phone);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_order ON notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ============================================================
-- ROW LEVEL SECURITY (defense in depth — service_role bypasses)
-- ============================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- service_role full access policies (backend uses service role, bypasses RLS anyway)
-- But we need at minimum one policy or anon gets blocked
-- Allow service_role to do everything (it bypasses RLS by default in Supabase)
-- For anon/authenticated roles, deny all (our API uses service_role key)
CREATE POLICY "deny_anon_customers" ON customers FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_vendors" ON vendors FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_menu_items" ON menu_items FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_riders" ON riders FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_orders" ON orders FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_order_items" ON order_items FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_payments" ON payments FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_refunds" ON refunds FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_vendor_subscriptions" ON vendor_subscriptions FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_ratings" ON ratings FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_disputes" ON disputes FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_notifications" ON notifications FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_settings" ON settings FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_audit_logs" ON audit_logs FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_otp_codes" ON otp_codes FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_sessions" ON sessions FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_processed_webhooks" ON processed_webhooks FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_otp_attempts" ON otp_attempts FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_order_messages" ON order_messages FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_wallet_balances" ON wallet_balances FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_wallet_transactions" ON wallet_transactions FOR ALL TO anon USING (false);

-- ============================================================
-- REALTIME (enable for live order tracking)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE order_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ============================================================
-- HELPER: generate order number function
-- ============================================================
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

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Migration complete. Tables created: '
  || (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public')::TEXT
  || ' total tables in public schema.' AS result;
