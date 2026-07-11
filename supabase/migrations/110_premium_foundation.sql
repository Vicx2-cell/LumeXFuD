-- ============================================================
-- LumeX Premium - Migration 110: entitlement foundation
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE plan_versions
  ADD COLUMN IF NOT EXISTS monthly_price_kobo BIGINT CHECK (monthly_price_kobo IS NULL OR monthly_price_kobo >= 0),
  ADD COLUMN IF NOT EXISTS yearly_price_kobo BIGINT CHECK (yearly_price_kobo IS NULL OR yearly_price_kobo >= 0),
  ADD COLUMN IF NOT EXISTS trial_duration_days INTEGER CHECK (trial_duration_days IS NULL OR trial_duration_days >= 0),
  ADD COLUMN IF NOT EXISTS grace_period_days INTEGER CHECK (grace_period_days IS NULL OR grace_period_days >= 0),
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS audience TEXT,
  ADD COLUMN IF NOT EXISTS included_entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS entitlement_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS display_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS effective_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE TABLE IF NOT EXISTS premium_plan_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  premium_plan_id UUID NOT NULL REFERENCES premium_plans(id) ON DELETE CASCADE,
  plan_version_id UUID REFERENCES plan_versions(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  entitlement_value JSONB NOT NULL DEFAULT 'true'::jsonb,
  source TEXT NOT NULL DEFAULT 'plan' CHECK (source IN ('plan', 'version', 'override', 'trial', 'campaign', 'admin')),
  created_by TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (premium_plan_id, plan_version_id, entitlement_key, source)
);
CREATE INDEX IF NOT EXISTS premium_plan_entitlements_plan_idx ON premium_plan_entitlements(premium_plan_id, entitlement_key);
CREATE INDEX IF NOT EXISTS premium_plan_entitlements_version_idx ON premium_plan_entitlements(plan_version_id, entitlement_key);

CREATE TABLE IF NOT EXISTS premium_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  premium_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  new_subscriptions_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trials_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  premium_ui_visible BOOLEAN NOT NULL DEFAULT TRUE,
  preserve_existing_until_expiry BOOLEAN NOT NULL DEFAULT TRUE,
  immediate_disable_existing_benefits BOOLEAN NOT NULL DEFAULT FALSE,
  premium_fallback_policy TEXT NOT NULL DEFAULT 'preserve_existing_until_expiry' CHECK (premium_fallback_policy IN ('deny_all_premium_features', 'grant_all_premium_features', 'preserve_existing_until_expiry')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  updated_by TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS premium_config_enabled_idx ON premium_config(premium_enabled, new_subscriptions_enabled);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  premium_plan_id UUID REFERENCES premium_plans(id) ON DELETE SET NULL,
  premium_plan_version_id UUID REFERENCES plan_versions(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'none' CHECK (state IN ('none', 'trialing', 'active', 'grace_period', 'past_due', 'canceled', 'expired', 'paused', 'manually_granted', 'manually_revoked')),
  started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  period_starts_at TIMESTAMPTZ,
  period_ends_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  manually_granted_at TIMESTAMPTZ,
  manually_revoked_at TIMESTAMPTZ,
  price_kobo BIGINT NOT NULL DEFAULT 0 CHECK (price_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  entitlement_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  updated_by TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_subscriptions_profile_idx ON user_subscriptions(profile_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_subscriptions_plan_idx ON user_subscriptions(premium_plan_id, premium_plan_version_id);

CREATE TABLE IF NOT EXISTS entitlement_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('grant', 'deny', 'value')),
  entitlement_value JSONB,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  actor TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS entitlement_overrides_profile_idx ON entitlement_overrides(profile_id, entitlement_key, starts_at DESC);
CREATE INDEX IF NOT EXISTS entitlement_overrides_active_idx ON entitlement_overrides(profile_id, revoked_at, ends_at);

CREATE TABLE IF NOT EXISTS premium_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS premium_audit_log_target_idx ON premium_audit_log(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS premium_audit_log_action_idx ON premium_audit_log(action, created_at DESC);

INSERT INTO premium_config (
  config_key, premium_enabled, new_subscriptions_enabled, trials_enabled, premium_ui_visible,
  preserve_existing_until_expiry, immediate_disable_existing_benefits, premium_fallback_policy,
  metadata
)
VALUES (
  'global', FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, 'preserve_existing_until_expiry', '{}'::jsonb
)
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_audit_log ENABLE ROW LEVEL SECURITY;
