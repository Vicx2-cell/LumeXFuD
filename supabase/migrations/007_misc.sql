-- ============================================================
-- LumeX Fud — Migration 007: Misc Tables
-- ============================================================

-- ─── OTP ATTEMPTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  otp_hash   TEXT NOT NULL,  -- SHA-256 hash
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,    -- NULL = unused; set when verified
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE otp_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_otp_attempts_phone
  ON otp_attempts(phone, expires_at)
  WHERE used_at IS NULL;

-- ─── SESSIONS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL
               CHECK (role IN ('customer','vendor','rider','admin','super_admin')),
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address INET,
  user_agent TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

-- ─── PROCESSED WEBHOOKS (idempotency) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_webhooks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference    TEXT NOT NULL,
  event        TEXT NOT NULL,
  payload      JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reference, event)
);
ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_lookup
  ON processed_webhooks(reference, event);

-- ─── NOTIFICATIONS LOG ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  user_type   TEXT NOT NULL
                CHECK (user_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN','SUPER_ADMIN')),
  channel     TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','push')),
  template    TEXT NOT NULL,
  payload     JSONB,
  status      TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','SENT','DELIVERED','READ','FAILED')),
  provider_message_id TEXT,
  error       TEXT,
  retry_count INT DEFAULT 0,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON notifications(status, retry_count)
  WHERE status = 'PENDING';

-- ─── REFUNDS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refunds (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                      UUID NOT NULL REFERENCES orders(id),
  paystack_transaction_reference TEXT NOT NULL,
  paystack_refund_reference      TEXT,
  amount_kobo                    BIGINT NOT NULL,
  reason                         TEXT NOT NULL,
  status                         TEXT NOT NULL
                                   CHECK (status IN ('PROCESSING','COMPLETED','FAILED','NEEDS_ATTENTION')),
  triggered_by                   TEXT NOT NULL,
  failure_reason                 TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  completed_at                   TIMESTAMPTZ
);
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- ─── VENDOR SUBSCRIPTIONS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID NOT NULL REFERENCES vendors(id),
  amount_kobo       BIGINT NOT NULL,
  paystack_reference TEXT UNIQUE NOT NULL,
  paid_at           TIMESTAMPTZ DEFAULT NOW(),
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL
                      CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED'))
);
ALTER TABLE vendor_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vendor_subs_vendor
  ON vendor_subscriptions(vendor_id, period_end DESC);

-- ─── TRENDING DATA (single-row cache, realtime) ───────────────────────────────
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

-- Enable realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE vendors;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE trending_data;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
