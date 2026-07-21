-- Email ownership is mandatory for every account and application created after
-- this migration. Existing legacy rows remain readable and are backfilled via
-- accounts_missing_email_admin before a future NOT NULL promotion.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION require_verified_account_email()
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
  IF NEW.email_verified IS DISTINCT FROM TRUE OR NEW.email_verified_at IS NULL THEN
    RAISE EXCEPTION 'email ownership must be verified';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_require_email_on_insert ON customers;
DROP TRIGGER IF EXISTS vendors_require_email_on_insert ON vendors;
DROP TRIGGER IF EXISTS riders_require_email_on_insert ON riders;
DROP TRIGGER IF EXISTS admins_require_email_on_insert ON admins;
DROP TRIGGER IF EXISTS vendor_applications_require_email_on_insert ON vendor_applications;
DROP TRIGGER IF EXISTS rider_applications_require_email_on_insert ON rider_applications;
DROP TRIGGER IF EXISTS customers_require_verified_email ON customers;
DROP TRIGGER IF EXISTS vendors_require_verified_email ON vendors;
DROP TRIGGER IF EXISTS riders_require_verified_email ON riders;
DROP TRIGGER IF EXISTS admins_require_verified_email ON admins;
DROP TRIGGER IF EXISTS vendor_applications_require_verified_email ON vendor_applications;
DROP TRIGGER IF EXISTS rider_applications_require_verified_email ON rider_applications;

CREATE TRIGGER customers_require_verified_email BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION require_verified_account_email();
CREATE TRIGGER vendors_require_verified_email BEFORE INSERT ON vendors
  FOR EACH ROW EXECUTE FUNCTION require_verified_account_email();
CREATE TRIGGER riders_require_verified_email BEFORE INSERT ON riders
  FOR EACH ROW EXECUTE FUNCTION require_verified_account_email();
CREATE TRIGGER admins_require_verified_email BEFORE INSERT ON admins
  FOR EACH ROW EXECUTE FUNCTION require_verified_account_email();
CREATE TRIGGER vendor_applications_require_verified_email BEFORE INSERT ON vendor_applications
  FOR EACH ROW EXECUTE FUNCTION require_verified_account_email();
CREATE TRIGGER rider_applications_require_verified_email BEFORE INSERT ON rider_applications
  FOR EACH ROW EXECUTE FUNCTION require_verified_account_email();

CREATE OR REPLACE VIEW accounts_unverified_email_admin AS
  SELECT 'customer'::TEXT AS account_type, id, email, created_at FROM customers WHERE email_verified IS NOT TRUE
  UNION ALL SELECT 'vendor', id, email, created_at FROM vendors WHERE email_verified IS NOT TRUE
  UNION ALL SELECT 'rider', id, email, created_at FROM riders WHERE email_verified IS NOT TRUE
  UNION ALL SELECT 'admin', id, email, created_at FROM admins WHERE email_verified IS NOT TRUE;

REVOKE ALL ON accounts_unverified_email_admin FROM anon, authenticated;
GRANT SELECT ON accounts_unverified_email_admin TO service_role;

-- Provider acceptance is not final delivery. Resend webhooks advance these
-- terminal states without making hard bounces eligible for automatic retry.
ALTER TABLE transactional_email_events DROP CONSTRAINT IF EXISTS transactional_email_events_status_check;
ALTER TABLE transactional_email_events ADD CONSTRAINT transactional_email_events_status_check CHECK (status IN (
  'PROCESSING','SENT','DELIVERED','DELIVERY_DELAYED','BOUNCED','SUPPRESSED','COMPLAINED','FAILED','SKIPPED'
));
ALTER TABLE transactional_email_events ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE transactional_email_events ADD COLUMN IF NOT EXISTS provider_event_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION record_email_provider_event(
  p_resend_id TEXT,
  p_status TEXT,
  p_error_code TEXT DEFAULT NULL,
  p_event_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_rank INT;
BEGIN
  v_new_rank := CASE p_status
    WHEN 'SENT' THEN 1 WHEN 'DELIVERY_DELAYED' THEN 2 WHEN 'DELIVERED' THEN 3
    WHEN 'FAILED' THEN 3 WHEN 'BOUNCED' THEN 4 WHEN 'SUPPRESSED' THEN 4
    WHEN 'COMPLAINED' THEN 5 ELSE 0 END;
  IF v_new_rank = 0 THEN RAISE EXCEPTION 'invalid provider status'; END IF;
  UPDATE transactional_email_events
     SET status = p_status,
         error_code = left(p_error_code, 100),
         delivered_at = CASE WHEN p_status = 'DELIVERED' THEN COALESCE(delivered_at, p_event_at) ELSE delivered_at END,
         provider_event_at = GREATEST(COALESCE(provider_event_at, p_event_at), p_event_at),
         updated_at = NOW()
   WHERE resend_id = p_resend_id
     AND v_new_rank >= CASE status
       WHEN 'PROCESSING' THEN 0 WHEN 'SENT' THEN 1 WHEN 'DELIVERY_DELAYED' THEN 2
       WHEN 'DELIVERED' THEN 3 WHEN 'FAILED' THEN 3 WHEN 'BOUNCED' THEN 4
       WHEN 'SUPPRESSED' THEN 4 WHEN 'COMPLAINED' THEN 5 ELSE 0 END;
END;
$$;
REVOKE ALL ON FUNCTION record_email_provider_event(TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_email_provider_event(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE VIEW email_operations_admin AS
SELECT id, event_key, kind, recipient, status, attempt_count, resend_id, error_code,
       next_retry_at, sent_at, delivered_at, provider_event_at, created_at, updated_at
FROM transactional_email_events;
REVOKE ALL ON email_operations_admin FROM anon, authenticated;
GRANT SELECT ON email_operations_admin TO service_role;
