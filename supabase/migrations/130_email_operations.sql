-- Central email operations: contact-case loop, application references and delivery observability.
ALTER TABLE transactional_email_events DROP CONSTRAINT IF EXISTS transactional_email_events_kind_check;
ALTER TABLE transactional_email_events ADD CONSTRAINT transactional_email_events_kind_check CHECK (kind IN (
  'WELCOME','ORDER_CONFIRMATION','ORDER_STATUS','ORDER_OUT_FOR_DELIVERY','ORDER_DELIVERED','ORDER_DELAYED',
  'CONTACT_ACKNOWLEDGEMENT','CASE_UPDATE','APPLICATION_RECEIVED','APPLICATION_APPROVED','APPLICATION_REJECTED','VENDOR_WELCOME','RIDER_WELCOME'
));
ALTER TABLE transactional_email_events ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE transactional_email_events ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_transactional_email_failures ON transactional_email_events(status, updated_at DESC) WHERE status = 'FAILED';

ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS reference_number TEXT UNIQUE;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS owner_queue TEXT NOT NULL DEFAULT 'careers';
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS acknowledgement_status TEXT NOT NULL DEFAULT 'pending' CHECK (acknowledgement_status IN ('pending','sent','failed','skipped'));
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS acknowledgement_sent_at TIMESTAMPTZ;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS applicant_notified_at TIMESTAMPTZ;
ALTER TABLE vendor_applications ADD COLUMN IF NOT EXISTS escalation_due_at TIMESTAMPTZ;

ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS reference_number TEXT UNIQUE;
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS owner_queue TEXT NOT NULL DEFAULT 'careers';
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS acknowledgement_status TEXT NOT NULL DEFAULT 'pending' CHECK (acknowledgement_status IN ('pending','sent','failed','skipped'));
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS acknowledgement_sent_at TIMESTAMPTZ;
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS applicant_notified_at TIMESTAMPTZ;
ALTER TABLE rider_applications ADD COLUMN IF NOT EXISTS escalation_due_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS contact_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT NOT NULL UNIQUE,
  intent TEXT NOT NULL CHECK (intent IN ('general','support','complaint','refund','partnership','sponsorship','security','fraud','press','privacy','deletion','legal')),
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  related_reference TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','reviewing','awaiting_user','resolved','rejected','escalated')),
  owner_queue TEXT NOT NULL,
  submission_hash TEXT NOT NULL UNIQUE,
  acknowledgement_status TEXT NOT NULL DEFAULT 'pending' CHECK (acknowledgement_status IN ('pending','sent','failed','skipped')),
  acknowledgement_sent_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  escalation_due_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE contact_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE contact_cases FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_contact_cases_queue_status ON contact_cases(owner_queue, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_cases_escalation ON contact_cases(escalation_due_at) WHERE status NOT IN ('resolved','rejected');

CREATE OR REPLACE VIEW email_operations_admin AS
SELECT id, event_key, kind, recipient, status, attempt_count, resend_id, error_code, next_retry_at, sent_at, created_at, updated_at
FROM transactional_email_events;
REVOKE ALL ON email_operations_admin FROM anon, authenticated;
GRANT SELECT ON email_operations_admin TO service_role;
