-- LumeX Fud - Migration 106: feed-media storage bucket
-- Public bucket for feed composer media. The upload route validates MIME and
-- file signature before writing here.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feed-media',
  'feed-media',
  TRUE,
  104857600,
  ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "feed_media_public_read" ON storage.objects;
CREATE POLICY "feed_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feed-media');

