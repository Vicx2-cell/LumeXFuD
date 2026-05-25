# Complete Database Schema

## Migration File Order
1. `001_core_schema.sql` — users, vendors, riders, orders, payments
2. `002_wallet.sql` — wallet_balances, wallet_transactions
3. `003_messaging.sql` — order_messages
4. `004_ratings.sql` — ratings, vendor_scores
5. `005_gamification.sql` — customer_xp, customer_badges, badges
6. `006_admin.sql` — admins, audit_logs, super_audit_logs, admin_devices
7. `007_misc.sql` — settings, notifications, trending_data
8. `008_rls_policies.sql` — RLS on every table
9. `009_indexes.sql` — all performance indexes
10. `010_seed_data.sql` — default settings, badges, etc.

## Core Tables (Migration 001)

### Customers
```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL, -- E.164 normalized
  name TEXT,
  hostel TEXT,
  room_number TEXT,
  default_delivery_address TEXT,
  dispute_count INT DEFAULT 0,
  last_dispute_at TIMESTAMPTZ,
  dispute_blocked_until TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_customers_phone ON customers(phone) WHERE deleted_at IS NULL;
```

### Vendors
```sql
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  shop_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  logo_url TEXT,
  shop_photo_url TEXT,
  prep_time_minutes INT NOT NULL DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN','BUSY','CLOSED')),
  busy_until TIMESTAMPTZ,
  paused_until TIMESTAMPTZ,
  category TEXT NOT NULL,
  description TEXT,

  -- Paystack
  paystack_subaccount_code TEXT,
  bank_code TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,

  -- Subscription
  subscription_tier TEXT NOT NULL DEFAULT 'FOUNDING' CHECK (subscription_tier IN ('FOUNDING','EARLY','STANDARD')),
  subscription_paid_until TIMESTAMPTZ,

  -- Ratings (denormalized for performance)
  avg_rating DECIMAL(3,2) DEFAULT 0,
  total_ratings INT DEFAULT 0,

  -- Operational
  is_active BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_vendors_active_status ON vendors(is_active, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendors_phone ON vendors(phone) WHERE deleted_at IS NULL;
```

### Menu Items
```sql
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  name TEXT NOT NULL,
  description TEXT,
  price_kobo BIGINT NOT NULL CHECK (price_kobo > 0),
  image_url TEXT,
  category TEXT NOT NULL CHECK (category IN ('RICE','PROTEIN','DRINKS','SNACKS','OTHER')),
  is_available BOOLEAN DEFAULT TRUE,
  daily_limit INT,
  sold_today INT DEFAULT 0,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_menu_vendor ON menu_items(vendor_id, is_available) WHERE deleted_at IS NULL;
```

### Riders
```sql
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  bike_plate TEXT,

  -- Paystack
  bank_code TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE','BUSY','OFFLINE')),
  active_order_id UUID,
  last_status_update_at TIMESTAMPTZ,

  -- Ratings
  avg_rating DECIMAL(3,2) DEFAULT 0,
  total_ratings INT DEFAULT 0,
  total_deliveries INT DEFAULT 0,
  acceptance_rate DECIMAL(5,2) DEFAULT 100,

  -- Operational
  is_active BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

## Subsystem Tables

### Wallet Tables (Migration 002)
See [docs/wallet.md](./wallet.md) for full schema.

### Messaging Tables (Migration 003)
See [docs/messaging.md](./messaging.md) for full schema.

### Ratings + Vendor Scores (Migration 004)
See [docs/ratings.md](./ratings.md) and [docs/vendor-ranking.md](./vendor-ranking.md) for full schemas.

### Gamification Tables (Migration 005)
See [docs/gamification.md](./gamification.md) for full schema.

### Admin Tables (Migration 006)
See [docs/admin.md](./admin.md) for full schema.

## Misc Tables (Migration 007)

### OTP Attempts
```sql
CREATE TABLE otp_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_otp_attempts_phone ON otp_attempts(phone, expires_at) WHERE used_at IS NULL;
```

### Sessions
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','vendor','rider','admin','super_admin')),
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address INET,
  user_agent TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
```

### Processed Webhooks (Idempotency)
```sql
CREATE TABLE processed_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,
  event TEXT NOT NULL,
  payload JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reference, event)
);
CREATE INDEX idx_processed_webhooks ON processed_webhooks(reference, event);
```

### Notifications Log
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  template TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL,
  termii_id TEXT,
  error TEXT,
  retry_count INT DEFAULT 0,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
```

### Refunds
```sql
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  paystack_transaction_reference TEXT NOT NULL,
  paystack_refund_reference TEXT,
  amount_kobo BIGINT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### Vendor Subscriptions
```sql
CREATE TABLE vendor_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  amount_kobo BIGINT NOT NULL,
  paystack_reference TEXT UNIQUE NOT NULL,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX idx_vendor_subs ON vendor_subscriptions(vendor_id, period_end DESC);
```

### Trending Data (Single Row Cache)
```sql
CREATE TABLE trending_data (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  orders_last_hour INT,
  top_item_name TEXT,
  top_item_count INT,
  top_vendor_name TEXT,
  new_vendor_name TEXT,
  updated_at TIMESTAMPTZ
);
INSERT INTO trending_data (id) VALUES (1) ON CONFLICT DO NOTHING;
```

## RLS Policies (Migration 008)
ENABLE RLS on EVERY table.

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_badges ENABLE ROW LEVEL SECURITY;

-- Public reads for menu (no PII)
CREATE POLICY "public read menu items" ON menu_items
  FOR SELECT USING (is_available = true AND deleted_at IS NULL);

CREATE POLICY "public read vendors" ON vendors
  FOR SELECT USING (is_active = true AND status != 'CLOSED' AND deleted_at IS NULL);

-- Customers see only their own data
CREATE POLICY "customers see own profile" ON customers
  FOR SELECT USING (phone = auth.jwt() ->> 'phone');

CREATE POLICY "customers see own orders" ON orders
  FOR SELECT USING (
    customer_id IN (SELECT id FROM customers WHERE phone = auth.jwt() ->> 'phone')
    OR guest_phone = auth.jwt() ->> 'phone'
  );

-- Vendors see their own orders
CREATE POLICY "vendors see own orders" ON orders
  FOR SELECT USING (
    vendor_id IN (SELECT id FROM vendors WHERE phone = auth.jwt() ->> 'phone')
  );

-- Riders see assigned orders OR available (READY status)
CREATE POLICY "riders see relevant orders" ON orders
  FOR SELECT USING (
    rider_id IN (SELECT id FROM riders WHERE phone = auth.jwt() ->> 'phone')
    OR (status = 'READY' AND rider_id IS NULL)
  );
```

## Critical Indexes (Migration 009)
Additional composite indexes for hot queries:

```sql
-- Homepage vendor list query
CREATE INDEX idx_homepage_vendors ON vendors(is_active, status, deleted_at)
  WHERE deleted_at IS NULL;

-- Available orders for riders
CREATE INDEX idx_rider_available ON orders(status, rider_id, created_at)
  WHERE status = 'READY' AND rider_id IS NULL;

-- Order release cron query
CREATE INDEX idx_order_release ON orders(status, rider_auto_release_at)
  WHERE status = 'DELIVERED';

-- Vendor auto-cancel cron
CREATE INDEX idx_vendor_cancel ON orders(status, created_at)
  WHERE status = 'PENDING';
```

## Constraints to Add Everywhere
1. All money in **BIGINT kobo**, never DECIMAL or FLOAT.
2. All timestamps **TIMESTAMPTZ**, never TIMESTAMP.
3. All enums via **CHECK constraints**, not ENUM types (more portable).
4. All phone numbers in **E.164 format** only.
5. All foreign keys with proper **ON DELETE** policies.
6. All UUIDs with **DEFAULT gen_random_uuid()**.

  delivery_fee INTEGER NOT NULL,
  payment_status TEXT DEFAULT 'PENDING', -- PENDING, CONFIRMED, FAILED
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX orders_customer_id_idx ON orders(customer_id);
CREATE INDEX orders_vendor_id_idx ON orders(vendor_id);
CREATE INDEX orders_rider_id_idx ON orders(rider_id);
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_created_at_idx ON orders(created_at);
```

#### order_items
```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX order_items_order_id_idx ON order_items(order_id);
```

#### order_messages
```sql
CREATE TABLE order_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL, -- customer, vendor, rider
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'TEXT', -- TEXT, STATUS_UPDATE, DISPUTE_NOTE, CONFIRMATION
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX order_messages_order_id_idx ON order_messages(order_id);
```

### Payments

#### payments
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  amount INTEGER NOT NULL,
  reference TEXT UNIQUE, -- Paystack reference
  status TEXT DEFAULT 'PENDING', -- PENDING, CONFIRMED, FAILED
  payment_method TEXT, -- card, bank_transfer, ussd
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX payments_order_id_idx ON payments(order_id);
CREATE INDEX payments_reference_idx ON payments(reference);
```

#### refunds
```sql
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  initiated_by TEXT, -- customer, admin, system
  status TEXT DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX refunds_order_id_idx ON refunds(order_id);
```

#### processed_webhooks
```sql
CREATE TABLE processed_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id TEXT NOT NULL UNIQUE, -- Paystack event ID
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX processed_webhooks_webhook_id_idx ON processed_webhooks(webhook_id);
```

### Wallet

#### wallet_balances
```sql
CREATE TABLE wallet_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  user_type TEXT NOT NULL, -- vendor, rider
  available_balance INTEGER DEFAULT 0,
  held_balance INTEGER DEFAULT 0, -- 24hr rider hold or 3-day vendor hold
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX wallet_balances_user_id_idx ON wallet_balances(user_id);
```

#### wallet_transactions
```sql
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_type TEXT NOT NULL,
  transaction_type TEXT NOT NULL, -- earn, hold, release, withdraw, refund
  amount INTEGER NOT NULL,
  reference_id UUID, -- order_id or withdrawal_id
  status TEXT DEFAULT 'COMPLETED',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX wallet_transactions_user_id_idx ON wallet_transactions(user_id);
```

#### withdrawal_requests
```sql
CREATE TABLE withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  bank_code TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED
  paystack_transfer_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX withdrawal_requests_user_id_idx ON withdrawal_requests(user_id);
```

#### verified_bank_accounts
```sql
CREATE TABLE verified_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  bank_code TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_number)
);

CREATE INDEX verified_bank_accounts_user_id_idx ON verified_bank_accounts(user_id);
```

### Vendors

#### vendor_subscriptions
```sql
CREATE TABLE vendor_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL UNIQUE REFERENCES vendors(id),
  tier TEXT NOT NULL, -- founding, early, standard
  monthly_fee INTEGER NOT NULL,
  next_billing_date DATE NOT NULL,
  status TEXT DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, CANCELLED
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX vendor_subscriptions_vendor_id_idx ON vendor_subscriptions(vendor_id);
```

#### vendor_scores
```sql
CREATE TABLE vendor_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL UNIQUE REFERENCES vendors(id),
  avg_rating DECIMAL(3,1) DEFAULT 5.0,
  rating_count INTEGER DEFAULT 0,
  order_count_30d INTEGER DEFAULT 0,
  avg_prep_time INTEGER DEFAULT 0, -- in seconds
  order_completion_rate DECIMAL(3,2) DEFAULT 1.0,
  repeat_customer_rate DECIMAL(3,2) DEFAULT 0.0,
  cancel_rate DECIMAL(3,2) DEFAULT 0.0,
  dispute_rate DECIMAL(3,2) DEFAULT 0.0,
  composite_score DECIMAL(3,2) DEFAULT 3.0,
  visibility_tier TEXT DEFAULT 'STANDARD', -- PREMIUM, FEATURED, STANDARD, DECLINING
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX vendor_scores_composite_score_idx ON vendor_scores(composite_score DESC);
```

### Ratings

#### ratings
```sql
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  rider_id UUID REFERENCES riders(id),
  vendor_rating INTEGER NOT NULL, -- 1-5
  vendor_review TEXT,
  rider_rating INTEGER NOT NULL,
  rider_review TEXT,
  would_order_again BOOLEAN,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ratings_vendor_id_idx ON ratings(vendor_id);
CREATE INDEX ratings_rider_id_idx ON ratings(rider_id);
```

### Gamification

#### customer_xp
```sql
CREATE TABLE customer_xp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id),
  total_xp INTEGER DEFAULT 0,
  weekly_xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  current_streak_days INTEGER DEFAULT 0,
  best_streak_days INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX customer_xp_customer_id_idx ON customer_xp(customer_id);
```

#### customer_badges
```sql
CREATE TABLE customer_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  badge_id TEXT NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, badge_id)
);

CREATE INDEX customer_badges_customer_id_idx ON customer_badges(customer_id);
```

#### badges
```sql
CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  unlock_condition TEXT
);
```

### Sessions & Auth

#### sessions
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_type TEXT NOT NULL, -- customer, vendor, rider, admin
  jwt_token TEXT NOT NULL,
  device_id TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
```

#### otp_attempts
```sql
CREATE TABLE otp_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_attempt TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX otp_attempts_phone_idx ON otp_attempts(phone);
```

#### admin_devices
```sql
CREATE TABLE admin_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admins(id),
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(admin_id, device_fingerprint)
);

CREATE INDEX admin_devices_admin_id_idx ON admin_devices(admin_id);
```

### Audit & Logs

#### audit_logs
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admins(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  changes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX audit_logs_admin_id_idx ON audit_logs(admin_id);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);
```

#### super_audit_logs
```sql
CREATE TABLE super_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES admins(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  amount INTEGER, -- for financial actions
  changes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX super_audit_logs_super_admin_id_idx ON super_audit_logs(super_admin_id);
```

### System

#### settings
```sql
CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings
INSERT INTO settings (id, value) VALUES
('platform_fee', '{"amount": 250}'),
('bike_delivery', '{"platform": 100, "rider": 400}'),
('door_delivery', '{"platform": 200, "rider": 800}'),
('min_order', '{"amount": 500}'),
('platform_hours', '{"open": "07:00", "close": "22:00"}');
```

#### notifications
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_type TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_order_id UUID,
  status TEXT DEFAULT 'PENDING', -- PENDING, SENT, DELIVERED, FAILED
  message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX notifications_user_id_idx ON notifications(user_id);
```

#### trending_data
```sql
CREATE TABLE trending_data (
  id INTEGER PRIMARY KEY DEFAULT 1,
  top_vendors JSONB,
  top_categories JSONB,
  avg_delivery_time INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Indexes (Performance Optimization)

```sql
-- Foreign key indexes
CREATE INDEX orders_customer_id_idx ON orders(customer_id);
CREATE INDEX orders_vendor_id_idx ON orders(vendor_id);
CREATE INDEX orders_rider_id_idx ON orders(rider_id);

-- Query optimization
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_created_at_idx ON orders(created_at);
CREATE INDEX customers_phone_idx ON customers(phone);
CREATE INDEX vendors_phone_idx ON vendors(phone);
CREATE INDEX vendors_status_idx ON vendors(status);
CREATE INDEX riders_phone_idx ON riders(phone);
CREATE INDEX riders_status_idx ON riders(status);

-- Analytics
CREATE INDEX payments_created_at_idx ON payments(created_at);
CREATE INDEX wallet_transactions_created_at_idx ON wallet_transactions(created_at);
```

## Row-Level Security (RLS)

All tables must have RLS enabled with appropriate policies:

```sql
-- Example: customers can only see their own data
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_customers ON orders
FOR SELECT USING (auth.uid() = customer_id);

CREATE POLICY orders_select_admins ON orders
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM admins WHERE id = auth.uid()
  )
);
```

Every table should follow this pattern with appropriate conditions.
