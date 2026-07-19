-- Reliable feed views and the protected, automatically-followed official account.

CREATE OR REPLACE FUNCTION public.increment_post_qualified_view(p_post_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_count INTEGER;
BEGIN
  UPDATE posts
  SET view_count = view_count + 1
  WHERE id = p_post_id
  RETURNING view_count INTO next_count;
  RETURN COALESCE(next_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_post_qualified_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_post_qualified_view(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_lumex_official_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  official_id UUID;
BEGIN
  SELECT id INTO official_id
  FROM social_profiles
  WHERE system_account_key = 'lumex_fud'
  LIMIT 1;

  IF official_id IS NOT NULL AND NEW.id <> official_id THEN
    INSERT INTO follows (follower_profile_id, followed_profile_id)
    VALUES (NEW.id, official_id)
    ON CONFLICT (follower_profile_id, followed_profile_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_profiles_auto_follow_lumex ON social_profiles;
CREATE TRIGGER social_profiles_auto_follow_lumex
AFTER INSERT ON social_profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_lumex_official_follow();

INSERT INTO follows (follower_profile_id, followed_profile_id)
SELECT profile.id, official.id
FROM social_profiles profile
CROSS JOIN social_profiles official
WHERE official.system_account_key = 'lumex_fud'
  AND profile.id <> official.id
ON CONFLICT (follower_profile_id, followed_profile_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.protect_lumex_official_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM social_profiles
    WHERE id = OLD.followed_profile_id
      AND system_account_key = 'lumex_fud'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS follows_protect_lumex ON follows;
CREATE TRIGGER follows_protect_lumex
BEFORE DELETE ON follows
FOR EACH ROW EXECUTE FUNCTION public.protect_lumex_official_follow();
