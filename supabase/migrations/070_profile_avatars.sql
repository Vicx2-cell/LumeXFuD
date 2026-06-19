-- ============================================================
-- Migration 070: profile avatars for customers and riders
-- ============================================================
-- Vendors already carry logo_url + shop_photo_url (core schema, migration 001),
-- which we reuse as their store logo (avatar) and cover photo. This adds a
-- personal avatar for customers and riders. Images live in the existing public
-- "menu-images" bucket; the URL is written here by /api/profile/image (service
-- role), so no extra column grants are needed for the app's server-side reads.
-- Idempotent.
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE riders    ADD COLUMN IF NOT EXISTS avatar_url TEXT;
