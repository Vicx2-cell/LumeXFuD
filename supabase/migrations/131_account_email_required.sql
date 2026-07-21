-- Require a real email on every newly created account without breaking legacy rows.
-- Existing rows missing email are exposed through accounts_missing_email_admin for backfill;
-- after that view is empty, the columns can be promoted to NOT NULL in a later migration.

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_email_active
  ON vendors (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_riders_email_active
  ON riders (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_admins_email
  ON admins (lower(email)) WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION require_new_account_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  IF NEW.email IS NULL
     OR NEW.email = ''
     OR length(NEW.email) > 254
     OR NEW.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'a valid email address is required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_require_email_on_insert ON customers;
CREATE TRIGGER customers_require_email_on_insert BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION require_new_account_email();
DROP TRIGGER IF EXISTS vendors_require_email_on_insert ON vendors;
CREATE TRIGGER vendors_require_email_on_insert BEFORE INSERT ON vendors
  FOR EACH ROW EXECUTE FUNCTION require_new_account_email();
DROP TRIGGER IF EXISTS riders_require_email_on_insert ON riders;
CREATE TRIGGER riders_require_email_on_insert BEFORE INSERT ON riders
  FOR EACH ROW EXECUTE FUNCTION require_new_account_email();
DROP TRIGGER IF EXISTS admins_require_email_on_insert ON admins;
CREATE TRIGGER admins_require_email_on_insert BEFORE INSERT ON admins
  FOR EACH ROW EXECUTE FUNCTION require_new_account_email();
DROP TRIGGER IF EXISTS vendor_applications_require_email_on_insert ON vendor_applications;
CREATE TRIGGER vendor_applications_require_email_on_insert BEFORE INSERT ON vendor_applications
  FOR EACH ROW EXECUTE FUNCTION require_new_account_email();
DROP TRIGGER IF EXISTS rider_applications_require_email_on_insert ON rider_applications;
CREATE TRIGGER rider_applications_require_email_on_insert BEFORE INSERT ON rider_applications
  FOR EACH ROW EXECUTE FUNCTION require_new_account_email();

CREATE OR REPLACE VIEW accounts_missing_email_admin AS
  SELECT 'customer'::TEXT AS account_type, id, created_at FROM customers WHERE email IS NULL OR trim(email) = ''
  UNION ALL SELECT 'vendor', id, created_at FROM vendors WHERE email IS NULL OR trim(email) = ''
  UNION ALL SELECT 'rider', id, created_at FROM riders WHERE email IS NULL OR trim(email) = ''
  UNION ALL SELECT 'admin', id, created_at FROM admins WHERE email IS NULL OR trim(email) = '';

REVOKE ALL ON accounts_missing_email_admin FROM anon, authenticated;
GRANT SELECT ON accounts_missing_email_admin TO service_role;
