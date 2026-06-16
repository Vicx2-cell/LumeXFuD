-- ============================================================
-- LumeX Fud — Migration 053: kyc-faces storage bucket (PRIVATE)
-- ============================================================
-- Stores each user's KYC selfie (fraud record) at <userId>.webp. Written by
-- POST /api/auth/face; viewed by admins via short-lived signed URLs
-- (GET /api/admin/face). PRIVATE — biometric/personal data (NDPR): NO public
-- read policy. All access goes through the service role (createSupabaseAdmin),
-- which bypasses RLS and mints the signed URLs.
--
-- NOTE: already created live via scripts/create-kyc-bucket.mjs; this migration
-- just records it for reproducibility. Idempotent.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-faces',
  'kyc-faces',
  FALSE,
  5242880,
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Deliberately NO storage.objects SELECT policy: nothing may read these except
-- the service role. Do not add a public-read policy.
