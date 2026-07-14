-- LumeX Fud - Migration 116: real feed stories
-- Stories are first-class feed content with a 24-hour default expiry.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS feed_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  media_url TEXT NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'image' CHECK (media_kind IN ('image', 'video')),
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'under_review', 'rejected', 'expired', 'deleted')),
  audience_scope TEXT NOT NULL DEFAULT 'all' CHECK (audience_scope IN ('all', 'customers', 'vendors', 'riders', 'staff')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feed_stories_expiry_after_start CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS feed_stories_active_idx
  ON feed_stories(status, starts_at DESC, expires_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS feed_stories_author_idx
  ON feed_stories(author_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS feed_stories_post_idx
  ON feed_stories(post_id)
  WHERE post_id IS NOT NULL;

ALTER TABLE feed_stories ENABLE ROW LEVEL SECURITY;
