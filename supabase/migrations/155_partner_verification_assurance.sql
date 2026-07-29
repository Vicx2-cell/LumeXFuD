-- Separate evidence verification from the final business approval decision.
-- A partner stays inactive until a super admin approves a fully verified record.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_verification_status_ck;
ALTER TABLE vendors ADD CONSTRAINT vendors_verification_status_ck
  CHECK (verification_status IN ('unverified', 'in_review', 'verified', 'failed'));

ALTER TABLE riders DROP CONSTRAINT IF EXISTS riders_verification_status_ck;
ALTER TABLE riders ADD CONSTRAINT riders_verification_status_ck
  CHECK (verification_status IN ('unverified', 'in_review', 'verified', 'failed'));

CREATE INDEX IF NOT EXISTS idx_vendors_verification_queue
  ON vendors(verification_status, approval_state) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_riders_verification_queue
  ON riders(verification_status, approval_state) WHERE deleted_at IS NULL;
