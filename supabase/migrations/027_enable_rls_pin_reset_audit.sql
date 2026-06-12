-- ============================================================
-- LumeX Fud — Migration 027: Enable RLS on pin_reset_audit
--
-- SECURITY FIX (pen-test HIGH-1):
--   011_pin_auth.sql created pin_reset_audit but never ran
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY. The
--   "deny anon pin reset audit" policy added in 008 is therefore
--   INERT (Postgres ignores policies on tables without RLS on),
--   leaving a PII/security-event log (user_id, user_role,
--   ip_address, reset_method) readable via the anon key.
--
--   This migration runs last (after the table exists), enables RLS,
--   and re-asserts the deny-anon policy idempotently so the fix is
--   self-contained regardless of 008/011 ordering.
--
-- Verify after running (must return ZERO rows):
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = false;
-- ============================================================

ALTER TABLE pin_reset_audit ENABLE ROW LEVEL SECURITY;

-- Re-assert deny-anon policy (idempotent). Service role bypasses RLS,
-- so API routes that write audit rows are unaffected.
DROP POLICY IF EXISTS "deny anon pin reset audit" ON pin_reset_audit;
CREATE POLICY "deny anon pin reset audit" ON pin_reset_audit
  FOR ALL TO anon USING (false);
