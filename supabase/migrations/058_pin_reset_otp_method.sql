-- Allow OTP (phone) as a PIN-reset method.
--
-- The Sendchamp OTP flow (/api/auth/otp/* + /api/auth/pin/reset) lets a user
-- reset their login PIN after a reset-scoped phone verification. That reset is
-- audited like every other one (lib/pin-auth.logPinResetAudit), so the
-- pin_reset_audit.reset_method CHECK needs to accept 'OTP'.
--
-- Idempotent: drop the existing constraint (auto-named *_reset_method_check)
-- and re-add it with the extra value.

ALTER TABLE pin_reset_audit DROP CONSTRAINT IF EXISTS pin_reset_audit_reset_method_check;

ALTER TABLE pin_reset_audit ADD CONSTRAINT pin_reset_audit_reset_method_check
  CHECK (reset_method IN ('SECURITY_QUESTIONS', 'RECOVERY_CODE', 'ADMIN_OVERRIDE', 'CHANGE_PIN', 'OTP'));
