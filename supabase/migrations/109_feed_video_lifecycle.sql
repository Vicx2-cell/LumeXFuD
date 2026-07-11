-- ============================================================
-- LumeX Feed - Migration 109: video lifecycle, quota and cleanup
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS deleted_by_profile_id UUID REFERENCES social_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_by_profile_id UUID REFERENCES social_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_by_profile_id UUID REFERENCES social_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifecycle_lock_token TEXT;

ALTER TABLE post_media
  ADD COLUMN IF NOT EXISTS provider_type TEXT NOT NULL DEFAULT 'native' CHECK (provider_type IN ('native', 'tiktok', 'external', 'shared')),
  ADD COLUMN IF NOT EXISTS external_provider_ref TEXT,
  ADD COLUMN IF NOT EXISTS storage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
  ADD COLUMN IF NOT EXISTS processing_state TEXT NOT NULL DEFAULT 'ready' CHECK (processing_state IN ('pending', 'uploading', 'processing', 'ready', 'failed', 'cleanup_pending', 'cleaning', 'cleaned')),
  ADD COLUMN IF NOT EXISTS cleanup_state TEXT NOT NULL DEFAULT 'none' CHECK (cleanup_state IN ('none', 'pending', 'retrying', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  ADD COLUMN IF NOT EXISTS cleanup_error TEXT,
  ADD COLUMN IF NOT EXISTS cleanup_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleaned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS posts_lifecycle_vendor_idx ON posts(author_profile_id, status, is_archived, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_lifecycle_state_idx ON posts(status, is_archived, deleted_at, published_at DESC);
CREATE INDEX IF NOT EXISTS posts_archived_idx ON posts(author_profile_id, archived_at DESC) WHERE is_archived = true;
CREATE INDEX IF NOT EXISTS posts_deleted_idx ON posts(author_profile_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_provider_ref_idx ON posts(provider_connection_id, provider_video_id);

CREATE INDEX IF NOT EXISTS post_media_provider_idx ON post_media(provider_type, created_at DESC);
CREATE INDEX IF NOT EXISTS post_media_cleanup_idx ON post_media(cleanup_state, cleanup_requested_at DESC);
CREATE INDEX IF NOT EXISTS post_media_post_provider_idx ON post_media(post_id, provider_type, created_at DESC);
CREATE INDEX IF NOT EXISTS post_media_storage_idx ON post_media(storage_bytes DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_media_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error TEXT,
  created_by_profile_id UUID REFERENCES social_profiles(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS feed_media_cleanup_jobs_status_idx ON feed_media_cleanup_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_video_quota_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES social_profiles(id) ON DELETE CASCADE,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('publish_checked', 'publish_blocked', 'archived', 'restored', 'deleted', 'cleanup')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feed_video_quota_events_profile_idx ON feed_video_quota_events(profile_id, created_at DESC);

CREATE OR REPLACE FUNCTION feed_setting_json(p_key TEXT, p_fallback JSONB)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((SELECT value FROM settings WHERE id = p_key), p_fallback)
$$;

CREATE OR REPLACE FUNCTION feed_setting_int(p_key TEXT, p_fallback INTEGER)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF((SELECT value->>'amount' FROM settings WHERE id = p_key), '')::integer, p_fallback)
$$;

CREATE OR REPLACE FUNCTION feed_setting_bool(p_key TEXT, p_fallback BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF((SELECT value->>'enabled' FROM settings WHERE id = p_key), '')::boolean, p_fallback)
$$;

CREATE OR REPLACE FUNCTION feed_vendor_video_quota_usage(p_profile_id UUID)
RETURNS TABLE (
  active_count INTEGER,
  draft_count INTEGER,
  archived_count INTEGER,
  processing_count INTEGER,
  failed_count INTEGER,
  storage_bytes BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) FILTER (WHERE p.status = 'published' AND p.is_archived = false AND p.deleted_at IS NULL AND p.post_kind IN ('VIDEO', 'TIKTOK'))::integer AS active_count,
    COUNT(*) FILTER (WHERE p.status = 'draft' AND p.deleted_at IS NULL)::integer AS draft_count,
    COUNT(*) FILTER (WHERE p.is_archived = true AND p.deleted_at IS NULL)::integer AS archived_count,
    COUNT(*) FILTER (WHERE p.status = 'processing' AND p.deleted_at IS NULL)::integer AS processing_count,
    COUNT(*) FILTER (WHERE p.status = 'rejected' OR p.status = 'deleted')::integer AS failed_count,
    COALESCE(SUM(pm.storage_bytes) FILTER (WHERE pm.deleted_at IS NULL), 0)::bigint AS storage_bytes
  FROM posts p
  LEFT JOIN post_media pm ON pm.post_id = p.id
  WHERE p.author_profile_id = p_profile_id
$$;

CREATE OR REPLACE FUNCTION feed_publish_video_post(p_post_id UUID, p_actor_profile_id UUID)
RETURNS TABLE (ok BOOLEAN, message TEXT, active_count INTEGER, limit_count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_post RECORD;
  v_limit INTEGER;
  v_tiktok_counts BOOLEAN;
  v_premium BOOLEAN;
  v_active INTEGER;
BEGIN
  SELECT p.*, sp.vendor_id, sp.profile_kind
    INTO v_post
  FROM posts p
  JOIN social_profiles sp ON sp.id = p.author_profile_id
  WHERE p.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Post not found', 0, 0;
    RETURN;
  END IF;

  IF v_post.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Deleted posts cannot be published', 0, 0;
    RETURN;
  END IF;

  IF v_post.author_profile_id <> p_actor_profile_id THEN
    RETURN QUERY SELECT FALSE, 'Not found', 0, 0;
    RETURN;
  END IF;

  IF v_post.status = 'published' AND v_post.is_archived = false THEN
    RETURN QUERY SELECT TRUE, 'Already published', 0, 0;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_post.author_profile_id::text));
  v_limit := feed_setting_int('feed_video_quota_free_limit', 60);
  v_tiktok_counts := feed_setting_bool('feed_tiktok_counts_toward_quota', true);
  v_premium := EXISTS (
    SELECT 1
    FROM user_entitlements ue
    JOIN entitlements e ON e.id = ue.entitlement_id
    WHERE ue.profile_id = v_post.author_profile_id
      AND ue.revoked_at IS NULL
      AND (ue.ends_at IS NULL OR ue.ends_at > NOW())
      AND e.entitlement_key = 'premium.unlimited_videos'
  );
  IF v_premium THEN
    v_limit := feed_setting_int('feed_video_quota_premium_limit', 240);
    IF feed_setting_bool('feed_video_quota_premium_unlimited', false) THEN
      v_limit := 2147483647;
    END IF;
  END IF;

  SELECT COUNT(*)::integer INTO v_active
  FROM posts p
  WHERE p.author_profile_id = v_post.author_profile_id
    AND p.status = 'published'
    AND p.deleted_at IS NULL
    AND p.is_archived = false
    AND (
      p.post_kind = 'VIDEO'
      OR (p.post_kind = 'TIKTOK' AND v_tiktok_counts)
    )
    AND p.id <> p_post_id;

  IF v_active >= v_limit THEN
    RETURN QUERY SELECT FALSE, format('Active video limit reached (%s/%s)', v_active, v_limit), v_active, v_limit;
    RETURN;
  END IF;

  UPDATE posts
    SET status = 'published',
        is_archived = false,
        archived_at = NULL,
        deleted_at = NULL,
        published_at = COALESCE(published_at, NOW()),
        lifecycle_locked_at = NULL,
        lifecycle_lock_token = NULL,
        updated_at = NOW()
  WHERE id = p_post_id;

  INSERT INTO feed_video_quota_events(profile_id, post_id, event_type, detail)
  VALUES (v_post.author_profile_id, p_post_id, 'publish_checked', jsonb_build_object('actor_profile_id', p_actor_profile_id, 'active_count', v_active + 1, 'limit_count', v_limit));

  RETURN QUERY SELECT TRUE, 'Published', v_active + 1, v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION feed_restore_video_post(p_post_id UUID, p_actor_profile_id UUID)
RETURNS TABLE (ok BOOLEAN, message TEXT, active_count INTEGER, limit_count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_post RECORD;
  v_limit INTEGER;
  v_active INTEGER;
  v_tiktok_counts BOOLEAN;
BEGIN
  SELECT p.*, sp.vendor_id
    INTO v_post
  FROM posts p
  JOIN social_profiles sp ON sp.id = p.author_profile_id
  WHERE p.id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Post not found', 0, 0; RETURN;
  END IF;
  IF v_post.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Deleted posts cannot be restored', 0, 0; RETURN;
  END IF;
  IF v_post.status = 'rejected' THEN
    RETURN QUERY SELECT FALSE, 'Rejected posts cannot be restored', 0, 0; RETURN;
  END IF;
  IF v_post.author_profile_id <> p_actor_profile_id THEN
    RETURN QUERY SELECT FALSE, 'Not found', 0, 0; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_post.author_profile_id::text));
  v_limit := feed_setting_int('feed_video_quota_free_limit', 60);
  v_tiktok_counts := feed_setting_bool('feed_tiktok_counts_toward_quota', true);
  SELECT COUNT(*)::integer INTO v_active
  FROM posts p
  WHERE p.author_profile_id = v_post.author_profile_id
    AND p.status = 'published'
    AND p.deleted_at IS NULL
    AND p.is_archived = false
    AND (p.post_kind = 'VIDEO' OR (p.post_kind = 'TIKTOK' AND v_tiktok_counts));
  IF v_active >= v_limit THEN
    RETURN QUERY SELECT FALSE, format('Active video limit reached (%s/%s)', v_active, v_limit), v_active, v_limit; RETURN;
  END IF;
  UPDATE posts
    SET status = 'published', is_archived = false, archived_at = NULL, restored_at = NOW(), restored_by_profile_id = p_actor_profile_id, updated_at = NOW()
    WHERE id = p_post_id;
  INSERT INTO feed_video_quota_events(profile_id, post_id, event_type, detail)
  VALUES (v_post.author_profile_id, p_post_id, 'restored', jsonb_build_object('actor_profile_id', p_actor_profile_id));
  RETURN QUERY SELECT TRUE, 'Restored', v_active + 1, v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION feed_archive_video_post(p_post_id UUID, p_actor_profile_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_profile UUID;
BEGIN
  SELECT author_profile_id INTO v_profile FROM posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_profile <> p_actor_profile_id THEN RETURN FALSE; END IF;
  UPDATE posts
    SET is_archived = true,
        archived_at = NOW(),
        archived_by_profile_id = p_actor_profile_id,
        status = CASE WHEN status = 'published' THEN 'archived' ELSE status END,
        updated_at = NOW()
    WHERE id = p_post_id AND deleted_at IS NULL;
  INSERT INTO feed_video_quota_events(profile_id, post_id, event_type, detail)
  VALUES (v_profile, p_post_id, 'archived', jsonb_build_object('actor_profile_id', p_actor_profile_id, 'reason', p_reason));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION feed_delete_video_post(p_post_id UUID, p_actor_profile_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_profile UUID;
BEGIN
  SELECT author_profile_id INTO v_profile FROM posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_profile <> p_actor_profile_id THEN RETURN FALSE; END IF;
  UPDATE posts
    SET deleted_at = NOW(),
        deleted_by_profile_id = p_actor_profile_id,
        deleted_reason = p_reason,
        status = 'deleted',
        is_archived = true,
        updated_at = NOW()
    WHERE id = p_post_id;
  UPDATE post_media
    SET cleanup_state = 'pending', cleanup_requested_at = NOW(), cleanup_attempts = cleanup_attempts + 1
    WHERE post_id = p_post_id AND cleanup_state IN ('none', 'failed');
  INSERT INTO feed_video_quota_events(profile_id, post_id, event_type, detail)
  VALUES (v_profile, p_post_id, 'deleted', jsonb_build_object('actor_profile_id', p_actor_profile_id, 'reason', p_reason));
  RETURN TRUE;
END;
$$;

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_media_cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_video_quota_events ENABLE ROW LEVEL SECURITY;
