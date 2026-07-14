-- LumeX Fud - Migration 114: protected official feed + lightweight editorial automation

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE social_profiles
  ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS system_account_key TEXT,
  ADD COLUMN IF NOT EXISTS official_badge_kind TEXT NOT NULL DEFAULT 'vendor',
  ADD COLUMN IF NOT EXISTS profile_locked_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_profiles_official_badge_kind_ck') THEN
    ALTER TABLE social_profiles
      ADD CONSTRAINT social_profiles_official_badge_kind_ck
      CHECK (official_badge_kind IN ('vendor', 'official'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_profiles_one_owner') THEN
    ALTER TABLE social_profiles DROP CONSTRAINT social_profiles_one_owner;
  END IF;
  ALTER TABLE social_profiles
    ADD CONSTRAINT social_profiles_one_owner
    CHECK (is_system_account OR num_nonnulls(customer_id, vendor_id, rider_id, admin_id) = 1);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS social_profiles_system_account_key_uidx
  ON social_profiles(system_account_key)
  WHERE system_account_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_profiles_system_account_uidx
  ON social_profiles((is_system_account))
  WHERE is_system_account = TRUE;

CREATE TABLE IF NOT EXISTS official_feed_area_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID REFERENCES cities(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES delivery_zones(id) ON DELETE CASCADE,
  area_scope TEXT NOT NULL CHECK (area_scope IN ('city', 'zone')),
  area_label TEXT NOT NULL,
  morning_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  evening_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
  morning_cron TEXT NOT NULL DEFAULT '0 7 * * *',
  evening_cron TEXT NOT NULL DEFAULT '0 19 * * *',
  late_night_start TEXT NOT NULL DEFAULT '22:00',
  min_popularity_orders INTEGER NOT NULL DEFAULT 10 CHECK (min_popularity_orders >= 0),
  price_threshold_kobo BIGINT NOT NULL DEFAULT 300000 CHECK (price_threshold_kobo >= 0),
  max_posts_per_day INTEGER NOT NULL DEFAULT 2 CHECK (max_posts_per_day > 0),
  max_collection_items INTEGER NOT NULL DEFAULT 5 CHECK (max_collection_items > 0),
  picks_max_per_day INTEGER NOT NULL DEFAULT 2 CHECK (picks_max_per_day > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  UNIQUE (area_scope, city_id, zone_id)
);

CREATE INDEX IF NOT EXISTS official_feed_area_settings_scope_idx
  ON official_feed_area_settings(area_scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS official_feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  area_setting_id UUID REFERENCES official_feed_area_settings(id) ON DELETE SET NULL,
  area_scope TEXT NOT NULL CHECK (area_scope IN ('city', 'zone')),
  area_id UUID NOT NULL,
  collection_type TEXT NOT NULL CHECK (collection_type IN ('new_on_lumex', 'lumex_picks', 'morning_collection', 'evening_collection', 'sponsored', 'event')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  generation_reason TEXT NOT NULL,
  selection_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  is_auto_published BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS official_feed_posts_area_idx
  ON official_feed_posts(area_scope, area_id, created_at DESC);

CREATE INDEX IF NOT EXISTS official_feed_posts_collection_idx
  ON official_feed_posts(collection_type, created_at DESC);

CREATE INDEX IF NOT EXISTS official_feed_posts_source_idx
  ON official_feed_posts(source_type, source_id);

ALTER TABLE official_feed_area_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE official_feed_posts ENABLE ROW LEVEL SECURITY;

INSERT INTO official_feed_area_settings (
  area_scope, city_id, zone_id, area_label, morning_enabled, evening_enabled, auto_publish,
  morning_cron, evening_cron, late_night_start, min_popularity_orders, price_threshold_kobo,
  max_posts_per_day, max_collection_items, picks_max_per_day, updated_by
)
SELECT
  'city',
  c.id,
  NULL,
  c.name,
  TRUE,
  TRUE,
  FALSE,
  '0 7 * * *',
  '0 19 * * *',
  '22:00',
  10,
  300000,
  2,
  5,
  2,
  'migration-114'
FROM cities c
WHERE c.status = 'ACTIVE'
ON CONFLICT (area_scope, city_id, zone_id) DO NOTHING;
