-- ============================================================
-- LumeX Fud — Migration 029: customers.phone_verified stamp
-- ============================================================
-- Supports the phone_verification feature flag (super-admin Feature Toggles).
-- While OTP delivery (Sendchamp) is unavailable a super admin can turn the flag
-- OFF so onboarding isn't blocked; accounts created in that window have an
-- UNVERIFIED phone. Without a marker they'd be indistinguishable from verified
-- accounts, so the "bring OTP back later" plan couldn't force re-verification
-- and the pre-registration risk (registering a number you don't own) would have
-- no cleanup path.
--
-- DEFAULT TRUE: every existing account predates the flag and went through OTP,
-- so they are verified. /api/auth/register stamps FALSE explicitly only when it
-- created the account with the flag off.
--
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT TRUE;

-- Find accounts needing retroactive verification when OTP returns:
--   SELECT id, phone FROM customers WHERE phone_verified = FALSE;
CREATE INDEX IF NOT EXISTS idx_customers_phone_unverified
  ON customers(phone_verified)
  WHERE phone_verified = FALSE;
