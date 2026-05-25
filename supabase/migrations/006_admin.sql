-- ============================================================
-- LumeX Fud — Migration 006: Admin System
-- ============================================================

-- ─── ADMINS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT UNIQUE NOT NULL,  -- E.164
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'admin'
               CHECK (role IN ('admin','super_admin')),
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- ─── AUDIT LOGS (admin actions) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_table TEXT,
  target_id    TEXT,
  old_value    JSONB,
  new_value    JSONB,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);

-- ─── SUPER AUDIT LOGS (super admin only) ─────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_super_audit_created
  ON super_audit_logs(created_at DESC);

-- ─── ADMIN DEVICES (new device alerts) ───────────────────────────────────────
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
