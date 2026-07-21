-- Deactivation is a security boundary, not just a visibility flag. A vendor,
-- rider, or admin whose account is deactivated must lose already-issued sessions
-- immediately, the same way a suspension does.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION revoke_sessions_on_subject_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF TG_TABLE_NAME = 'admins' THEN
    IF NEW.is_active IS DISTINCT FROM TRUE
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.phone IS DISTINCT FROM OLD.phone THEN
      UPDATE sessions
         SET revoked_at = coalesce(revoked_at, now())
       WHERE user_id = NEW.id::text
         AND role IN ('admin', 'super_admin')
         AND revoked_at IS NULL;
    END IF;
    RETURN NEW;
  END IF;

  v_role := CASE TG_TABLE_NAME
    WHEN 'vendors' THEN 'vendor'
    WHEN 'riders' THEN 'rider'
    WHEN 'customers' THEN 'customer'
    ELSE NULL
  END;

  IF v_role IS NOT NULL
     AND (NEW.phone IS DISTINCT FROM OLD.phone
          OR (TG_TABLE_NAME IN ('vendors', 'riders') AND NEW.is_active IS DISTINCT FROM TRUE)) THEN
    UPDATE sessions
       SET revoked_at = coalesce(revoked_at, now())
     WHERE user_id = NEW.id::text
       AND role = v_role
       AND revoked_at IS NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customer_phone_revoke_sessions ON customers;
CREATE TRIGGER trg_customer_phone_revoke_sessions
  AFTER UPDATE OF phone ON customers
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_subject_deactivation();

DROP TRIGGER IF EXISTS trg_vendor_deactivation_revoke_sessions ON vendors;
CREATE TRIGGER trg_vendor_deactivation_revoke_sessions
  AFTER UPDATE OF is_active, phone ON vendors
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_subject_deactivation();

DROP TRIGGER IF EXISTS trg_rider_deactivation_revoke_sessions ON riders;
CREATE TRIGGER trg_rider_deactivation_revoke_sessions
  AFTER UPDATE OF is_active, phone ON riders
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_subject_deactivation();

DROP TRIGGER IF EXISTS trg_admin_deactivation_revoke_sessions ON admins;
CREATE TRIGGER trg_admin_deactivation_revoke_sessions
  AFTER UPDATE OF is_active, role, phone ON admins
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_subject_deactivation();

REVOKE ALL ON FUNCTION revoke_sessions_on_subject_deactivation() FROM PUBLIC, anon, authenticated;
