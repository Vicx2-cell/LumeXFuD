-- ============================================================
-- LumeX Fud — Migration 001: Core Schema
-- Run in Supabase SQL Editor in order (001 → 010)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── SEQUENCE for order numbers ───────────────────────────────────────────────
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

-- ─── CUSTOMERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                    TEXT UNIQUE NOT NULL,  -- E.164 normalized
  name                     TEXT,
  hostel                   TEXT,
  room_number              TEXT,
  default_delivery_address TEXT,
  dispute_count            INT DEFAULT 0,
  last_dispute_at          TIMESTAMPTZ,
  dispute_blocked_until    TIMESTAMPTZ,
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- ─── VENDORS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                    TEXT UNIQUE NOT NULL,  -- E.164, used as login
  shop_name                TEXT NOT NULL,
  owner_name               TEXT NOT NULL,
  logo_url                 TEXT,
  shop_photo_url           TEXT,
  prep_time_minutes        INT NOT NULL DEFAULT 25,
  status                   TEXT NOT NULL DEFAULT 'CLOSED'
                             CHECK (status IN ('OPEN','BUSY','CLOSED')),
  busy_until               TIMESTAMPTZ,
  paused_until             TIMESTAMPTZ,
  category                 TEXT NOT NULL,
  description              TEXT,

  -- Paystack split
  paystack_subaccount_code TEXT,
  bank_code                TEXT,
  bank_account_number      TEXT,
  bank_account_name        TEXT,

  -- Subscription
  subscription_tier        TEXT NOT NULL DEFAULT 'STANDARD'
                             CHECK (subscription_tier IN ('FOUNDING','EARLY','STANDARD')),
  subscription_paid_until  TIMESTAMPTZ,

  -- Denormalized ratings (updated by cron)
  avg_rating               DECIMAL(3,2) DEFAULT 0,
  total_ratings            INT DEFAULT 0,

  -- Operational
  is_active                BOOLEAN DEFAULT FALSE,
  approved_at              TIMESTAMPTZ,
  approved_by              TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- ─── MENU ITEMS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  price_kobo    BIGINT NOT NULL CHECK (price_kobo > 0),
  image_url     TEXT,
  category      TEXT NOT NULL
                  CHECK (category IN ('RICE','PROTEIN','DRINKS','SNACKS','OTHER')),
  is_available  BOOLEAN DEFAULT TRUE,
  daily_limit   INT,
  sold_today    INT DEFAULT 0,
  display_order INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- ─── RIDERS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                TEXT UNIQUE NOT NULL,  -- E.164
  full_name            TEXT NOT NULL,
  bike_plate           TEXT,
  bank_code            TEXT,
  bank_account_number  TEXT,
  bank_account_name    TEXT,
  status               TEXT NOT NULL DEFAULT 'OFFLINE'
                         CHECK (status IN ('ONLINE','BUSY','OFFLINE')),
  active_order_id      UUID,
  last_status_update_at TIMESTAMPTZ,
  avg_rating           DECIMAL(3,2) DEFAULT 0,
  total_ratings        INT DEFAULT 0,
  total_deliveries     INT DEFAULT 0,
  acceptance_rate      DECIMAL(5,2) DEFAULT 100,
  is_active            BOOLEAN DEFAULT FALSE,
  approved_at          TIMESTAMPTZ,
  approved_by          TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);
ALTER TABLE riders ENABLE ROW LEVEL SECURITY;

-- ─── ORDERS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number              TEXT UNIQUE NOT NULL,
  customer_id               UUID REFERENCES customers(id),
  guest_phone               TEXT,  -- for guest checkout
  vendor_id                 UUID NOT NULL REFERENCES vendors(id),
  rider_id                  UUID REFERENCES riders(id),
  status                    TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN (
                                'PENDING','VENDOR_ACCEPTED','PREPARING','READY',
                                'RIDER_ASSIGNED','PICKED_UP','DELIVERED','COMPLETED',
                                'CANCELLED','DISPUTED','REFUNDED'
                              )),
  delivery_type             TEXT NOT NULL CHECK (delivery_type IN ('BIKE','DOOR')),
  delivery_address          TEXT NOT NULL,
  delivery_instructions     TEXT,

  -- Amounts (all BIGINT kobo — never DECIMAL)
  subtotal                  BIGINT NOT NULL,
  platform_markup           BIGINT NOT NULL,
  delivery_fee              BIGINT NOT NULL,
  platform_delivery_cut     BIGINT NOT NULL,
  rider_delivery_cut        BIGINT NOT NULL,
  tip_amount                BIGINT NOT NULL DEFAULT 0,
  total_amount              BIGINT NOT NULL,

  -- Payment
  paystack_reference        TEXT UNIQUE NOT NULL,
  idempotency_key           TEXT UNIQUE,
  payment_status            TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (payment_status IN ('PENDING','PAID','FAILED','REFUNDED')),

  -- Rider payout hold
  rider_payment_status      TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (rider_payment_status IN ('PENDING','HELD','RELEASED')),
  rider_auto_release_at     TIMESTAMPTZ,
  rider_payment_released_at TIMESTAMPTZ,

  -- Delivery proof
  delivery_photo_url        TEXT,
  rider_delivery_lat        DECIMAL,
  rider_delivery_lng        DECIMAL,

  -- Timestamps per status
  vendor_accepted_at        TIMESTAMPTZ,
  preparing_at              TIMESTAMPTZ,
  ready_at                  TIMESTAMPTZ,
  rider_assigned_at         TIMESTAMPTZ,
  picked_up_at              TIMESTAMPTZ,
  delivered_at              TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ─── ORDER ITEMS (price snapshot at time of order) ────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id),
  name         TEXT NOT NULL,    -- snapshot
  price        BIGINT NOT NULL,  -- snapshot kobo
  quantity     INT NOT NULL CHECK (quantity > 0),
  subtotal     BIGINT NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ─── DISPUTES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID UNIQUE NOT NULL REFERENCES orders(id),
  customer_id        UUID NOT NULL REFERENCES customers(id),
  reason             TEXT NOT NULL,
  description        TEXT,
  customer_photo_url TEXT,
  status             TEXT NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED_REFUND','RESOLVED_NO_ACTION')),
  resolved_by        TEXT,
  resolved_at        TIMESTAMPTZ,
  refund_id          UUID,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- ─── SETTINGS (live-editable platform config) ────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id         TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
