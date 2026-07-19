-- ============================================================
-- LumeX Growth - Migration 112: feed analytics, premium vendor
-- visibility, referral reward hardening, and campus partner
-- program.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ------------------------------------------------------------
-- Feed analytics and safe ranking inputs
-- ------------------------------------------------------------

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS video_duration_seconds INTEGER CHECK (video_duration_seconds IS NULL OR video_duration_seconds >= 0),
  ADD COLUMN IF NOT EXISTS watch_time_ms BIGINT NOT NULL DEFAULT 0 CHECK (watch_time_ms >= 0),
  ADD COLUMN IF NOT EXISTS completion_rate NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (completion_rate >= 0 AND completion_rate <= 1),
  ADD COLUMN IF NOT EXISTS engagement_score NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (engagement_score >= 0),
  ADD COLUMN IF NOT EXISTS location_relevance_score NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (location_relevance_score >= 0),
  ADD COLUMN IF NOT EXISTS order_conversion_count INTEGER NOT NULL DEFAULT 0 CHECK (order_conversion_count >= 0),
  ADD COLUMN IF NOT EXISTS safe_rank_score NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK (safe_rank_score >= 0),
  ADD COLUMN IF NOT EXISTS last_ranked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS feed_watch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_key TEXT NOT NULL UNIQUE,
  viewer_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  watch_ms BIGINT NOT NULL DEFAULT 0 CHECK (watch_ms >= 0),
  completion_rate NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (completion_rate >= 0 AND completion_rate <= 1),
  location_relevance_score NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (location_relevance_score >= 0),
  order_conversions INTEGER NOT NULL DEFAULT 0 CHECK (order_conversions >= 0),
  source_tab TEXT,
  session_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_watch_events_post_idx ON feed_watch_events(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_watch_events_viewer_idx ON feed_watch_events(viewer_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_watch_events_session_idx ON feed_watch_events(session_id, created_at DESC);

CREATE OR REPLACE FUNCTION feed_record_watch_metrics(
  p_watch_key TEXT,
  p_post_id UUID,
  p_viewer_profile_id UUID,
  p_watch_ms BIGINT,
  p_completion_rate NUMERIC,
  p_location_relevance_score NUMERIC,
  p_order_conversions INTEGER,
  p_source_tab TEXT,
  p_session_id TEXT,
  p_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_created BOOLEAN := FALSE;
  v_affected INTEGER := 0;
BEGIN
  INSERT INTO feed_watch_events (
    watch_key, viewer_profile_id, post_id, watch_ms, completion_rate,
    location_relevance_score, order_conversions, source_tab, session_id, metadata
  )
  VALUES (
    p_watch_key, p_viewer_profile_id, p_post_id, GREATEST(COALESCE(p_watch_ms, 0), 0),
    LEAST(GREATEST(COALESCE(p_completion_rate, 0), 0), 1),
    GREATEST(COALESCE(p_location_relevance_score, 0), 0),
    GREATEST(COALESCE(p_order_conversions, 0), 0),
    p_source_tab, p_session_id, COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (watch_key) DO NOTHING;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  v_created := v_affected > 0;

  UPDATE posts
    SET watch_time_ms = watch_time_ms + GREATEST(COALESCE(p_watch_ms, 0), 0),
        completion_rate = GREATEST(completion_rate, LEAST(GREATEST(COALESCE(p_completion_rate, 0), 0), 1)),
        location_relevance_score = GREATEST(location_relevance_score, GREATEST(COALESCE(p_location_relevance_score, 0), 0)),
        order_conversion_count = order_conversion_count + GREATEST(COALESCE(p_order_conversions, 0), 0),
        engagement_score = ROUND((watch_time_ms + GREATEST(COALESCE(p_watch_ms, 0), 0)) / 60000.0, 4),
        safe_rank_score = ROUND(
          (
            ROUND((watch_time_ms + GREATEST(COALESCE(p_watch_ms, 0), 0)) / 60000.0, 4)
            + (LEAST(GREATEST(COALESCE(p_completion_rate, 0), 0), 1) * 2)
            + (GREATEST(COALESCE(p_location_relevance_score, 0), 0) * 1.25)
            + LEAST(order_conversion_count + GREATEST(COALESCE(p_order_conversions, 0), 0), 25) * 0.5
          )::numeric,
          4
        ),
        last_ranked_at = NOW(),
        updated_at = NOW()
    WHERE id = p_post_id;

  RETURN v_created;
END;
$$;

ALTER TABLE feed_watch_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Premium vendor visibility and admin controls
-- ------------------------------------------------------------

ALTER TABLE social_profiles
  ADD COLUMN IF NOT EXISTS premium_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS premium_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS premium_featured_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_label TEXT,
  ADD COLUMN IF NOT EXISTS premium_comped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS premium_enabled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS premium_vendor_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('enable', 'disable', 'comp', 'revoke')),
  previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  actor TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS premium_vendor_controls_profile_idx ON premium_vendor_controls(profile_id, created_at DESC);

-- ------------------------------------------------------------
-- Referral hardening and cross-role codes
-- ------------------------------------------------------------

ALTER TABLE referral_codes
  ADD COLUMN IF NOT EXISTS owner_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS owner_role TEXT NOT NULL DEFAULT 'customer' CHECK (owner_role IN ('customer', 'vendor', 'rider', 'campus_partner')),
  ADD COLUMN IF NOT EXISTS code_kind TEXT NOT NULL DEFAULT 'customer' CHECK (code_kind IN ('customer', 'vendor', 'rider', 'campus_partner')),
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_owner_role_uidx ON referral_codes(owner_profile_id, owner_role) WHERE owner_profile_id IS NOT NULL;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS referred_role TEXT NOT NULL DEFAULT 'customer' CHECK (referred_role IN ('customer', 'vendor', 'rider', 'campus_partner')),
  ADD COLUMN IF NOT EXISTS device_hash TEXT,
  ADD COLUMN IF NOT EXISTS reward_referrer_kobo BIGINT NOT NULL DEFAULT 0 CHECK (reward_referrer_kobo >= 0),
  ADD COLUMN IF NOT EXISTS reward_referred_kobo BIGINT NOT NULL DEFAULT 0 CHECK (reward_referred_kobo >= 0),
  ADD COLUMN IF NOT EXISTS reward_currency TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS reward_state TEXT NOT NULL DEFAULT 'pending' CHECK (reward_state IN ('pending', 'approved', 'reversed', 'blocked', 'manual_review')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reward_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS referrals_reward_idempotency_uidx ON referrals(reward_idempotency_key) WHERE reward_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS referral_reward_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID REFERENCES referrals(id) ON DELETE CASCADE,
  referrer_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  referred_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('customer', 'vendor', 'rider', 'campus_partner')),
  reward_type TEXT NOT NULL CHECK (reward_type IN ('pending', 'approved', 'reversed', 'manual_review')),
  amount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  idempotency_key TEXT NOT NULL UNIQUE,
  source_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'reversed', 'void')),
  approved_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS referral_reward_ledger_referrer_idx ON referral_reward_ledger(referrer_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referral_reward_ledger_referred_idx ON referral_reward_ledger(referred_profile_id, created_at DESC);

CREATE OR REPLACE FUNCTION referral_code_for_profile(p_profile_id UUID, p_role TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
BEGIN
  SELECT code INTO v_code
  FROM referral_codes
  WHERE owner_profile_id = p_profile_id
    AND owner_role = p_role
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_code;
  END IF;

  INSERT INTO referral_codes (
    owner_profile_id, owner_role, code_kind, customer_id, code, created_by, metadata
  )
  SELECT
    p_profile_id,
    p_role,
    p_role,
    CASE WHEN p_role = 'customer' THEN sp.customer_id ELSE NULL END,
    upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8)),
    'system',
    jsonb_build_object('role', p_role)
  FROM social_profiles sp
  WHERE sp.id = p_profile_id
  ON CONFLICT DO NOTHING;

  SELECT code INTO v_code
  FROM referral_codes
  WHERE owner_profile_id = p_profile_id
    AND owner_role = p_role
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_code;
END;
$$;

-- ------------------------------------------------------------
-- Campus partner program
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campus_partner_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  owner_role TEXT NOT NULL CHECK (owner_role IN ('customer', 'vendor', 'rider', 'campus_partner')),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  campus_id UUID REFERENCES cities(id) ON DELETE SET NULL,
  territory TEXT,
  application_text TEXT,
  target_monthly_orders INTEGER NOT NULL DEFAULT 0 CHECK (target_monthly_orders >= 0),
  proposed_commission_rate NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (proposed_commission_rate >= 0 AND proposed_commission_rate <= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended', 'disputed')),
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS campus_partner_applications_profile_uidx ON campus_partner_applications(profile_id);
CREATE INDEX IF NOT EXISTS campus_partner_applications_status_idx ON campus_partner_applications(status, created_at DESC);

CREATE TABLE IF NOT EXISTS campus_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES campus_partner_applications(id) ON DELETE SET NULL,
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  owner_role TEXT NOT NULL CHECK (owner_role IN ('customer', 'vendor', 'rider', 'campus_partner')),
  campus_id UUID REFERENCES cities(id) ON DELETE SET NULL,
  territory TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  referral_link TEXT NOT NULL,
  commission_rate NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  target_monthly_orders INTEGER NOT NULL DEFAULT 0 CHECK (target_monthly_orders >= 0),
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disputed', 'revoked')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS campus_partners_profile_uidx ON campus_partners(profile_id);
CREATE INDEX IF NOT EXISTS campus_partners_campus_idx ON campus_partners(campus_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS campus_partner_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_partner_id UUID NOT NULL REFERENCES campus_partners(id) ON DELETE CASCADE,
  referred_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  referred_role TEXT NOT NULL CHECK (referred_role IN ('customer', 'vendor', 'rider', 'campus_partner')),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  onboarding_id UUID,
  referral_status TEXT NOT NULL DEFAULT 'pending' CHECK (referral_status IN ('pending', 'approved', 'reversed', 'blocked')),
  completed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  device_hash TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campus_partner_referrals_partner_idx ON campus_partner_referrals(campus_partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campus_partner_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_partner_id UUID NOT NULL REFERENCES campus_partners(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('customers', 'orders', 'vendors', 'riders')),
  target_value INTEGER NOT NULL DEFAULT 0 CHECK (target_value >= 0),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  achieved_value INTEGER NOT NULL DEFAULT 0 CHECK (achieved_value >= 0),
  commission_kobo BIGINT NOT NULL DEFAULT 0 CHECK (commission_kobo >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'achieved', 'closed', 'reversed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campus_partner_targets_partner_idx ON campus_partner_targets(campus_partner_id, period_start DESC);

CREATE TABLE IF NOT EXISTS campus_partner_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_partner_id UUID NOT NULL REFERENCES campus_partners(id) ON DELETE CASCADE,
  target_id UUID REFERENCES campus_partner_targets(id) ON DELETE SET NULL,
  referral_id UUID REFERENCES campus_partner_referrals(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  amount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  commission_rate NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'reversed', 'disputed')),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campus_partner_earnings_partner_idx ON campus_partner_earnings(campus_partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campus_partner_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_partner_id UUID NOT NULL REFERENCES campus_partners(id) ON DELETE CASCADE,
  payout_reference TEXT NOT NULL UNIQUE,
  amount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'failed', 'reversed')),
  payout_method TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (payout_method IN ('bank_transfer', 'wallet', 'paystack_transfer')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campus_partner_payouts_partner_idx ON campus_partner_payouts(campus_partner_id, created_at DESC);

ALTER TABLE campus_partner_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_partner_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_partner_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_partner_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_partner_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_vendor_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_reward_ledger ENABLE ROW LEVEL SECURITY;
