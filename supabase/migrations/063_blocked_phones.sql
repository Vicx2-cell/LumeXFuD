-- ============================================================
-- LumeX Fud — Migration 063: phone blocklist (ban / restrict a number)
-- ============================================================
-- Lets a super-admin permanently bar a phone number from the platform: a banned
-- number can never register a new account again (enforced in /api/auth/register,
-- /api/auth/social/complete and /api/auth/otp/send). Banning also suspends any
-- existing account for that number (handled in API code).
--
-- We deliberately do NOT hard-delete user rows — that would orphan wallet
-- balances, break daily reconciliation, and erase the audit trail. A ban =
-- suspend (blocks login + ordering) + blocklist (blocks re-registration), and is
-- fully reversible (unban).
--
-- RLS enabled, deny-by-default (no policy) — all access is via the service-role
-- admin client in API routes, where the super-admin role is enforced in code.
-- Consistent with feature_flags / vendor_scores. Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS blocked_phones (
  phone      TEXT PRIMARY KEY,                 -- E.164, e.g. +2348012345678
  reason     TEXT,
  blocked_by TEXT,                             -- super-admin phone
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE blocked_phones ENABLE ROW LEVEL SECURITY;
-- No policy: anon/authenticated get zero rows; the service-role client bypasses RLS.



