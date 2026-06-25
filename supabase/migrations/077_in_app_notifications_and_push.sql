-- ============================================================
-- LumeX Fud — Migration 077: In-app notification center + Web Push
-- ============================================================
-- Until now `notifications` was a write-only OUTBOUND log (WhatsApp/SMS records).
-- This migration turns it into the backing store for an in-app notification
-- CENTER (bell + list) that customers, vendors and riders read inside the app,
-- and adds a `push_subscriptions` table for real Web Push (alerts even when the
-- tab/PWA is closed — critical for vendors accepting orders and riders grabbing
-- jobs fast).
--
-- DESIGN
--  • Reuse `notifications` rather than a parallel table — it already has
--    (user_id, user_type, created_at DESC) indexed and is in the realtime
--    publication. We add the human-readable in-app fields (title/body/link) and
--    a READ marker (read_at), plus the 'in_app' channel.
--  • All access stays SERVICE-ROLE ONLY (auth enforced in API-route code), like
--    the rest of the platform — the existing "deny anon notifications" RLS holds.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS, guarded
-- constraint swap.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ─── 1. In-app columns on notifications ───────────────────────────────────────
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title   TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body    TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link    TEXT;          -- deep-link, e.g. /order/LXF-2026-000123
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;   -- NULL = unread

-- Allow the 'in_app' channel (was whatsapp|sms|push only). Swap the inline
-- CHECK for a named one so future migrations can find it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check
  CHECK (channel IN ('whatsapp','sms','push','in_app'));

-- Fast unread-badge + list queries: newest first, in-app rows only.
CREATE INDEX IF NOT EXISTS idx_notifications_inapp
  ON notifications (user_id, created_at DESC)
  WHERE channel = 'in_app';

-- Unread count is the hot path for the bell — keep it cheap.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id)
  WHERE channel = 'in_app' AND read_at IS NULL;

-- ─── 2. Web Push subscriptions ────────────────────────────────────────────────
-- One row per browser/device push endpoint a user has granted. user_id is TEXT to
-- match notifications.user_id (phone-or-uuid) and the wallet tables (migration 030).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  user_type   TEXT NOT NULL
                CHECK (user_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN','SUPER_ADMIN')),
  endpoint    TEXT NOT NULL UNIQUE,   -- the push service URL (unique per device)
  p256dh      TEXT NOT NULL,          -- client public key (payload encryption)
  auth        TEXT NOT NULL,          -- client auth secret (payload encryption)
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON push_subscriptions (user_id, created_at DESC);

-- Service-role only (auth enforced in code), like notifications.
DROP POLICY IF EXISTS "deny anon push_subscriptions" ON push_subscriptions;
CREATE POLICY "deny anon push_subscriptions" ON push_subscriptions
  FOR ALL USING (auth.role() = 'service_role');


