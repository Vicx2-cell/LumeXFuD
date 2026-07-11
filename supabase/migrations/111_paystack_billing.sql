-- ============================================================
-- LumeX Paystack - Migration 111: premium and boost billing
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS premium_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  premium_plan_id UUID REFERENCES premium_plans(id) ON DELETE SET NULL,
  premium_plan_version_id UUID REFERENCES plan_versions(id) ON DELETE SET NULL,
  paystack_reference TEXT NOT NULL UNIQUE,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'initialized' CHECK (status IN ('initialized', 'pending', 'verified', 'active', 'failed', 'canceled', 'expired', 'refunded')),
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS premium_payment_events_profile_idx ON premium_payment_events(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS premium_payment_events_status_idx ON premium_payment_events(status, created_at DESC);

CREATE TABLE IF NOT EXISTS boost_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  boost_campaign_id UUID REFERENCES boost_campaigns(id) ON DELETE SET NULL,
  boost_package_id UUID REFERENCES boost_packages(id) ON DELETE SET NULL,
  paystack_reference TEXT NOT NULL UNIQUE,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'initialized' CHECK (status IN ('initialized', 'pending', 'verified', 'active', 'failed', 'canceled', 'expired', 'refunded')),
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS boost_payment_events_vendor_idx ON boost_payment_events(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS boost_payment_events_status_idx ON boost_payment_events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS boost_payment_events_campaign_idx ON boost_payment_events(boost_campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_domain TEXT NOT NULL CHECK (billing_domain IN ('premium', 'boost')),
  payment_event_id UUID NOT NULL,
  payment_reference TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('initialized', 'verified', 'activated', 'failed', 'renewed', 'expired', 'canceled', 'refunded')),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  actor TEXT,
  actor_role TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS billing_ledger_domain_idx ON billing_ledger_entries(billing_domain, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_ledger_payment_idx ON billing_ledger_entries(payment_reference, created_at DESC);

CREATE TABLE IF NOT EXISTS paystack_billing_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL CHECK (domain IN ('premium', 'boost')),
  event_type TEXT NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS paystack_billing_diagnostics_domain_idx ON paystack_billing_diagnostics(domain, created_at DESC);

ALTER TABLE premium_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE boost_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE paystack_billing_diagnostics ENABLE ROW LEVEL SECURITY;
