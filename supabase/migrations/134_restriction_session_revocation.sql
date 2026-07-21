-- A restriction must invalidate already-issued sessions in the SAME database
-- transaction. Login-only checks leave stolen or stale tokens usable until exp.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION revoke_sessions_on_account_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.suspended_until IS NOT NULL
     AND NEW.suspended_until > now()
     AND NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
    UPDATE sessions
       SET revoked_at = coalesce(revoked_at, now())
     WHERE user_id = NEW.id::text
       AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customer_restriction_revoke_sessions ON customers;
CREATE TRIGGER trg_customer_restriction_revoke_sessions
  AFTER UPDATE OF suspended_until ON customers
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_account_restriction();

DROP TRIGGER IF EXISTS trg_vendor_restriction_revoke_sessions ON vendors;
CREATE TRIGGER trg_vendor_restriction_revoke_sessions
  AFTER UPDATE OF suspended_until ON vendors
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_account_restriction();

DROP TRIGGER IF EXISTS trg_rider_restriction_revoke_sessions ON riders;
CREATE TRIGGER trg_rider_restriction_revoke_sessions
  AFTER UPDATE OF suspended_until ON riders
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_account_restriction();

REVOKE ALL ON FUNCTION revoke_sessions_on_account_restriction() FROM PUBLIC, anon, authenticated;
