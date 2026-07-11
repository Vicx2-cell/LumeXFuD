-- LumeX Fud - Migration 105: LumeX Feed foundation
-- Additive schema for the commerce-first social feed, provider sync, premium,
-- ranking, boosts, moderation, and analytics.

-- ---------------------------------------------------------------------------
-- Social identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS social_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  vendor_id UUID UNIQUE REFERENCES vendors(id) ON DELETE CASCADE,
  rider_id UUID UNIQUE REFERENCES riders(id) ON DELETE CASCADE,
  admin_id UUID UNIQUE REFERENCES admins(id) ON DELETE CASCADE,
  profile_kind TEXT NOT NULL CHECK (profile_kind IN ('customer', 'vendor', 'rider', 'admin')),
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  cover_url TEXT,
  campus_id UUID REFERENCES cities(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES delivery_zones(id) ON DELETE SET NULL,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT social_profiles_one_owner CHECK (
    num_nonnulls(customer_id, vendor_id, rider_id, admin_id) = 1
  )
);

CREATE INDEX IF NOT EXISTS social_profiles_kind_idx ON social_profiles(profile_kind, deleted_at);
CREATE INDEX IF NOT EXISTS social_profiles_vendor_idx ON social_profiles(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_profiles_rider_idx ON social_profiles(rider_id) WHERE rider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_profiles_customer_idx ON social_profiles(customer_id) WHERE customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Social graph
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  followed_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT follows_no_self CHECK (follower_profile_id <> followed_profile_id),
  UNIQUE (follower_profile_id, followed_profile_id)
);
CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows(followed_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  blocked_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blocks_no_self CHECK (blocker_profile_id <> blocked_profile_id),
  UNIQUE (blocker_profile_id, blocked_profile_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks(blocked_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muter_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  muted_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mutes_no_self CHECK (muter_profile_id <> muted_profile_id),
  UNIQUE (muter_profile_id, muted_profile_id)
);
CREATE INDEX IF NOT EXISTS mutes_muted_idx ON mutes(muted_profile_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  related_menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  related_promotion_ref TEXT,
  provider_connection_id UUID,
  provider_video_id UUID,
  post_kind TEXT NOT NULL DEFAULT 'TEXT' CHECK (post_kind IN ('TEXT', 'IMAGE', 'VIDEO', 'TIKTOK', 'MENU_ITEM', 'PROMOTION', 'QUOTE', 'REPOST', 'POLL')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'published', 'limited', 'under_review', 'rejected', 'archived', 'deleted')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private', 'unlisted')),
  audience_scope TEXT NOT NULL DEFAULT 'all' CHECK (audience_scope IN ('all', 'customers', 'vendors', 'riders', 'staff')),
  body TEXT,
  content_warning TEXT,
  campus_id UUID REFERENCES cities(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES delivery_zones(id) ON DELETE SET NULL,
  location_text TEXT,
  hashtags_cached TEXT[] NOT NULL DEFAULT '{}',
  mention_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  repost_count INTEGER NOT NULL DEFAULT 0,
  bookmark_count INTEGER NOT NULL DEFAULT 0,
  impression_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  save_count INTEGER NOT NULL DEFAULT 0,
  share_count INTEGER NOT NULL DEFAULT 0,
  menu_click_count INTEGER NOT NULL DEFAULT 0,
  cart_add_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  revenue_kobo BIGINT NOT NULL DEFAULT 0 CHECK (revenue_kobo >= 0),
  is_sponsored BOOLEAN NOT NULL DEFAULT FALSE,
  is_boosted BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT posts_provider_ref_consistency CHECK (
    (post_kind = 'TIKTOK' AND provider_connection_id IS NOT NULL AND provider_video_id IS NOT NULL)
    OR (post_kind <> 'TIKTOK')
  )
);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts(author_profile_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_vendor_idx ON posts(vendor_id, created_at DESC) WHERE vendor_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_feed_idx ON posts(status, visibility, published_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS post_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'embed', 'cover')),
  storage_path TEXT,
  public_url TEXT,
  provider_name TEXT,
  provider_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_seconds INTEGER,
  alt_text TEXT,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS post_media_post_idx ON post_media(post_id, sort_order ASC);

CREATE TABLE IF NOT EXISTS post_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  parent_reply_id UUID REFERENCES post_replies(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  repost_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'limited', 'under_review', 'rejected', 'deleted')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS post_replies_post_idx ON post_replies(post_id, created_at ASC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, profile_id)
);
CREATE INDEX IF NOT EXISTS post_likes_profile_idx ON post_likes(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reposts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  quote_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, profile_id)
);
CREATE INDEX IF NOT EXISTS reposts_profile_idx ON reposts(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, profile_id)
);
CREATE INDEX IF NOT EXISTS bookmarks_profile_idx ON bookmarks(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  hashtag_id UUID NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, hashtag_id)
);
CREATE INDEX IF NOT EXISTS post_hashtags_hashtag_idx ON post_hashtags(hashtag_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  mentioned_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, mentioned_profile_id)
);
CREATE INDEX IF NOT EXISTS mentions_profile_idx ON mentions(mentioned_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  menu_item_name_snapshot TEXT NOT NULL,
  menu_item_price_kobo_snapshot BIGINT NOT NULL CHECK (menu_item_price_kobo_snapshot >= 0),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  order_label TEXT,
  is_available_snapshot BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, menu_item_id)
);
CREATE INDEX IF NOT EXISTS post_menu_items_post_idx ON post_menu_items(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  campaign_price_kobo BIGINT NOT NULL CHECK (campaign_price_kobo >= 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  landing_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'expired', 'rejected', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS post_promotions_vendor_idx ON post_promotions(vendor_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Feed events and impressions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feed_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impression_key TEXT NOT NULL UNIQUE,
  viewer_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  impression_type TEXT NOT NULL DEFAULT 'impression' CHECK (impression_type IN ('impression', 'qualified_impression')),
  source_tab TEXT,
  dwell_ms INTEGER NOT NULL DEFAULT 0 CHECK (dwell_ms >= 0),
  watched_ms INTEGER NOT NULL DEFAULT 0 CHECK (watched_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_impressions_post_idx ON feed_impressions(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_impressions_viewer_idx ON feed_impressions(viewer_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  viewer_profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'impression', 'qualified_impression', 'video_start', 'video_25', 'video_50',
    'video_75', 'video_100', 'rewatch', 'dwell', 'like', 'unlike', 'reply',
    'repost', 'save', 'share', 'profile_visit', 'follow', 'menu_click',
    'add_to_cart', 'checkout_start', 'completed_order', 'refunded_order',
    'cancelled_order', 'report', 'not_interested', 'hide_creator', 'block'
  )),
  source_tab TEXT,
  currency TEXT NOT NULL DEFAULT 'NGN',
  amount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_events_post_idx ON feed_events(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_events_viewer_idx ON feed_events(viewer_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_events_type_idx ON feed_events(event_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Ranking and audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS algorithm_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  label TEXT NOT NULL,
  weights JSONB NOT NULL,
  max_premium_uplift NUMERIC(8, 4) NOT NULL DEFAULT 0,
  max_sponsored_uplift NUMERIC(8, 4) NOT NULL DEFAULT 0,
  premium_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ,
  rolled_back_from UUID REFERENCES algorithm_configs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS algorithm_configs_active_idx ON algorithm_configs(is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS algorithm_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  algorithm_config_id UUID NOT NULL REFERENCES algorithm_configs(id) ON DELETE CASCADE,
  change_summary TEXT NOT NULL,
  diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS algorithm_versions_config_idx ON algorithm_versions(algorithm_config_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Provider sync
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS social_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('tiktok', 'google')),
  provider_account_id TEXT NOT NULL,
  provider_username TEXT,
  provider_display_name TEXT,
  provider_profile_url TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired', 'revoked', 'error', 'disabled')),
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS social_connections_profile_idx ON social_connections(profile_id, provider);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_connection_id UUID NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  state_hash TEXT,
  pkce_verifier_hash TEXT,
  last_refreshed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oauth_tokens_connection_idx ON oauth_tokens(social_connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_connection_id UUID NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('tiktok', 'google', 'instagram', 'youtube', 'facebook')),
  provider_video_id TEXT NOT NULL,
  provider_url TEXT NOT NULL,
  thumbnail_url TEXT,
  cover_url TEXT,
  caption TEXT,
  duration_seconds INTEGER,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'private', 'deleted', 'unavailable', 'draft')),
  selection_status TEXT NOT NULL DEFAULT 'unselected' CHECK (selection_status IN ('unselected', 'selected', 'draft', 'published', 'archived', 'removed')),
  last_synced_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (social_connection_id, provider_video_id)
);
CREATE INDEX IF NOT EXISTS provider_videos_connection_idx ON provider_videos(social_connection_id, selection_status, created_at DESC);

CREATE TABLE IF NOT EXISTS imported_post_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  provider_video_id UUID NOT NULL REFERENCES provider_videos(id) ON DELETE CASCADE,
  import_mode TEXT NOT NULL CHECK (import_mode IN ('manual', 'draft', 'auto_discovered')),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  UNIQUE (post_id, provider_video_id)
);
CREATE INDEX IF NOT EXISTS imported_post_references_post_idx ON imported_post_references(post_id, imported_at DESC);

CREATE TABLE IF NOT EXISTS connected_data_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('tiktok', 'google')),
  data_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS connected_data_consents_profile_idx ON connected_data_consents(profile_id, provider, created_at DESC);

CREATE TABLE IF NOT EXISTS connected_data_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id UUID NOT NULL REFERENCES connected_data_consents(id) ON DELETE CASCADE,
  provider_item_id TEXT NOT NULL,
  reference_url TEXT,
  storage_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (consent_id, provider_item_id)
);

-- ---------------------------------------------------------------------------
-- Premium and entitlements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS premium_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  monthly_price_kobo BIGINT NOT NULL CHECK (monthly_price_kobo >= 0),
  yearly_price_kobo BIGINT NOT NULL CHECK (yearly_price_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  trial_duration_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_duration_days >= 0),
  grace_period_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_period_days >= 0),
  audience TEXT NOT NULL DEFAULT 'vendor' CHECK (audience IN ('customer', 'vendor', 'rider', 'admin', 'all')),
  included_benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  paystack_plan_reference TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  effective_from TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS premium_plans_active_idx ON premium_plans(is_active, display_order ASC, created_at DESC);

CREATE TABLE IF NOT EXISTS plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  premium_plan_id UUID NOT NULL REFERENCES premium_plans(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  change_summary TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (premium_plan_id, version)
);

CREATE TABLE IF NOT EXISTS entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  entitlement_id UUID NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('plan', 'override', 'trial', 'campaign', 'admin')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (profile_id, entitlement_id, source)
);
CREATE INDEX IF NOT EXISTS user_entitlements_profile_idx ON user_entitlements(profile_id, revoked_at, ends_at);

-- ---------------------------------------------------------------------------
-- Boosts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS boost_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  budget_kobo BIGINT NOT NULL CHECK (budget_kobo >= 0),
  geographic_radius_km INTEGER NOT NULL DEFAULT 0 CHECK (geographic_radius_km >= 0),
  max_uplift NUMERIC(8, 4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  boost_package_id UUID REFERENCES boost_packages(id) ON DELETE SET NULL,
  target_city_id UUID REFERENCES cities(id) ON DELETE SET NULL,
  target_zone_id UUID REFERENCES delivery_zones(id) ON DELETE SET NULL,
  budget_kobo BIGINT NOT NULL CHECK (budget_kobo >= 0),
  spend_kobo BIGINT NOT NULL DEFAULT 0 CHECK (spend_kobo >= 0),
  estimated_reach_min INTEGER NOT NULL DEFAULT 0,
  estimated_reach_max INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_payment', 'pending_approval', 'active', 'paused', 'rejected', 'completed', 'cancelled')),
  approval_state TEXT NOT NULL DEFAULT 'not_submitted' CHECK (approval_state IN ('not_submitted', 'pending', 'approved', 'rejected', 'paused')),
  paystack_reference TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS boost_campaigns_vendor_idx ON boost_campaigns(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS boost_campaigns_post_idx ON boost_campaigns(post_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS moderation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('spam', 'harassment', 'impersonation', 'misleading_food', 'copyright', 'privacy', 'explicit', 'dangerous', 'scam', 'prohibited_goods', 'fake_promotion', 'other')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'under_review', 'resolved', 'dismissed', 'escalated')),
  assigned_to TEXT,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS moderation_reports_status_idx ON moderation_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_reports_post_idx ON moderation_reports(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES moderation_reports(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('warn', 'remove', 'limit_reach', 'suspend_posting', 'suspend_account', 'restore', 'archive', 'reject', 'escalate')),
  reason TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'super_admin', 'moderator')),
  actor_reference TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS moderation_actions_post_idx ON moderation_actions(post_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS backstop
-- ---------------------------------------------------------------------------

ALTER TABLE social_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reposts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_impressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE algorithm_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE algorithm_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE imported_post_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_data_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_data_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE boost_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE boost_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Seed defaults
-- ---------------------------------------------------------------------------

INSERT INTO entitlements (entitlement_key, description, default_enabled)
VALUES
  ('tiktok.connection', 'Connect a TikTok account and import selected videos', FALSE),
  ('premium.visibility_boost', 'Premium visibility uplift in feed ranking', FALSE),
  ('premium.analytics', 'Access advanced creator analytics', FALSE),
  ('premium.scheduling', 'Schedule feed posts', FALSE),
  ('premium.badge', 'Show a premium badge on the profile', FALSE),
  ('premium.unlimited_videos', 'Remove the active video cap', FALSE),
  ('premium.selected_tiktok_videos', 'Select approved TikTok videos', FALSE),
  ('vendor.boosts', 'Create and run paid boosts', FALSE),
  ('rider.creator_rewards', 'Earn creator rewards from verified social content', FALSE),
  ('customer.creator_rewards', 'Earn customer creator rewards from verified social content', FALSE)
ON CONFLICT (entitlement_key) DO NOTHING;

INSERT INTO premium_plans (
  plan_key, name, description, monthly_price_kobo, yearly_price_kobo, currency,
  trial_duration_days, grace_period_days, audience, included_benefits, display_order,
  paystack_plan_reference, version, effective_from, is_active
)
VALUES
  (
    'vendor-premium',
    'Vendor Premium',
    'Premium visibility, TikTok selection, analytics, and scheduling for eligible vendors.',
    0,
    0,
    'NGN',
    0,
    0,
    'vendor',
    '{"tiktok.connection": true, "premium.analytics": true, "premium.scheduling": true, "premium.badge": true, "premium.visibility_boost": true}'::jsonb,
    0,
    NULL,
    1,
    NOW(),
    FALSE
  )
ON CONFLICT (plan_key) DO NOTHING;

INSERT INTO boost_packages (package_key, name, description, duration_days, budget_kobo, geographic_radius_km, max_uplift, is_active, display_order)
VALUES
  ('boost-1d', 'One day boost', 'A short campaign for a single campus push.', 1, 0, 0, 0.0000, TRUE, 1),
  ('boost-3d', 'Three day boost', 'A medium campaign for a weekend push.', 3, 0, 0, 0.0000, TRUE, 2),
  ('boost-7d', 'Seven day boost', 'A longer campaign for a sustained push.', 7, 0, 0, 0.0000, TRUE, 3)
ON CONFLICT (package_key) DO NOTHING;
