-- Session issuance is the final authority boundary before a bearer token exists.
-- Route-level checks can race or be missed by future callers, so the sessions
-- table must reject restricted, inactive, or role-mismatched subjects itself.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION assert_session_subject_is_eligible()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  IF NEW.user_id IS NULL OR NEW.user_id = '' OR NEW.phone IS NULL OR NEW.phone = '' THEN
    RAISE EXCEPTION 'session subject is incomplete'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.role = 'customer' THEN
    SELECT EXISTS (
      SELECT 1 FROM customers
       WHERE id::text = NEW.user_id
         AND phone = NEW.phone
         AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until <= now())
    ) INTO v_ok;
  ELSIF NEW.role = 'vendor' THEN
    SELECT EXISTS (
      SELECT 1 FROM vendors
       WHERE id::text = NEW.user_id
         AND phone = NEW.phone
         AND is_active = TRUE
         AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until <= now())
    ) INTO v_ok;
  ELSIF NEW.role = 'rider' THEN
    SELECT EXISTS (
      SELECT 1 FROM riders
       WHERE id::text = NEW.user_id
         AND phone = NEW.phone
         AND is_active = TRUE
         AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until <= now())
    ) INTO v_ok;
  ELSIF NEW.role IN ('admin', 'super_admin') THEN
    SELECT EXISTS (
      SELECT 1 FROM admins
       WHERE id::text = NEW.user_id
         AND phone = NEW.phone
         AND role = NEW.role
         AND is_active = TRUE
    ) OR EXISTS (
      SELECT 1 FROM customers
       WHERE id::text = NEW.user_id
         AND phone = NEW.phone
         AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until <= now())
    ) INTO v_ok;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'session subject is not eligible'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sessions_subject_integrity ON sessions;
CREATE TRIGGER trg_sessions_subject_integrity
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION assert_session_subject_is_eligible();

REVOKE ALL ON FUNCTION assert_session_subject_is_eligible() FROM PUBLIC, anon, authenticated;
