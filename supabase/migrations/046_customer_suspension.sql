-- ============================================================
-- LumeX Fud — Migration 046: Account suspension (any role)
-- ============================================================
-- Lets an admin/super-admin suspend ANY single account — customer, vendor or
-- rider — independent of the vendor/rider `is_active` approval flag. A suspended
-- account is blocked at login (and a suspended customer is also blocked from
-- ordering mid-session). `suspended_until` in the future = suspended (set far
-- ahead for indefinite); NULL/past = active. Idempotent.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspend_reason  TEXT;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspend_reason  TEXT;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspend_reason  TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_suspended ON customers (suspended_until) WHERE suspended_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_suspended   ON vendors   (suspended_until) WHERE suspended_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_riders_suspended    ON riders    (suspended_until) WHERE suspended_until IS NOT NULL;
