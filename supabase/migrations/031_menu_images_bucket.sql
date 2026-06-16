-- ============================================================
-- LumeX Fud — Migration 031: menu-images storage bucket
-- ============================================================
-- Creates the public storage bucket the upload route writes to
-- (app/api/upload/menu-image/route.ts → BUCKET = 'menu-images').
-- Without this, every vendor image upload fails with
-- "make sure the menu-images storage bucket exists and is public".
-- Idempotent: safe to run more than once.
-- ============================================================

-- ─── 1. Bucket ────────────────────────────────────────────────────────────────
-- Public read so customers can view menu images via getPublicUrl().
-- 5MB limit + image mime allowlist mirror the server-side checks.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  TRUE,
  5242880, -- 5MB, matches MAX_IMAGE_BYTES
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 2. Public read policy ────────────────────────────────────────────────────
-- Uploads/deletes go through the service role (createSupabaseAdmin), which
-- bypasses RLS, so we only need a SELECT policy for anonymous public reads.
DROP POLICY IF EXISTS "menu_images_public_read" ON storage.objects;
CREATE POLICY "menu_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-images');
