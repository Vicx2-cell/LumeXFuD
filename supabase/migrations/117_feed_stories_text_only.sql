ALTER TABLE public.feed_stories
  ALTER COLUMN media_url DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feed_stories_has_media_or_caption_ck'
      AND conrelid = 'public.feed_stories'::regclass
  ) THEN
    ALTER TABLE public.feed_stories
      ADD CONSTRAINT feed_stories_has_media_or_caption_ck
      CHECK (
        media_url IS NOT NULL
        OR NULLIF(BTRIM(COALESCE(caption, '')), '') IS NOT NULL
      );
  END IF;
END $$;
