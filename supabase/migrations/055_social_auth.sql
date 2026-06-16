-- ============================================================
-- LumeX Fud — Migration 055: Google (social) sign-in columns
-- ============================================================
-- Adds a SOCIAL front door to the existing phone-keyed identity model. Phone
-- stays the canonical identity for every account (delivery, WhatsApp, Paystack,
-- RLS, role detection all still key on it). "Continue with Google" just lets a
-- customer prove identity via Google and then collect + verify a phone, so we
-- end up with the exact same data as a phone sign-up — only the entry point
-- differs.
--
-- Scope: CUSTOMERS ONLY. Vendors/riders/admins are provisioned and log in with
-- phone + PIN; they never sign up through Google, so they get no social columns.
--
-- Columns (all nullable — existing phone+PIN accounts are unaffected):
--   • email          — the verified Google email (lowercased), also usable later
--   • email_verified — Google told us the email is verified
--   • google_sub     — Google's STABLE per-user subject id (the real join key;
--                      an email can change, `sub` does not)
--
-- UNIQUE on email and google_sub so one Google account maps to exactly one
-- customer. Partial unique indexes (WHERE NOT NULL) so the many existing rows
-- with NULLs don't collide.
--
-- NOTE on exposure: these columns are read SERVER-SIDE ONLY (service role, which
-- bypasses RLS). They are deliberately NOT added to any anon/authenticated
-- column grant, so they never reach the browser bundle. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email          TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS google_sub     TEXT;

-- One Google identity ↔ one customer. Partial so NULLs (phone-only accounts)
-- never conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_google_sub
  ON customers (google_sub)
  WHERE google_sub IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_email
  ON customers (lower(email))
  WHERE email IS NOT NULL;
