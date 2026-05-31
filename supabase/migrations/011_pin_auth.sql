-- Add PIN auth fields to all user tables and pin reset audit history

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS login_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS security_question_1 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_1_hash TEXT,
  ADD COLUMN IF NOT EXISTS security_question_2 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_2_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_locked_until TIMESTAMPTZ;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS login_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS security_question_1 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_1_hash TEXT,
  ADD COLUMN IF NOT EXISTS security_question_2 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_2_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_locked_until TIMESTAMPTZ;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS login_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS security_question_1 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_1_hash TEXT,
  ADD COLUMN IF NOT EXISTS security_question_2 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_2_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_locked_until TIMESTAMPTZ;

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS login_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS security_question_1 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_1_hash TEXT,
  ADD COLUMN IF NOT EXISTS security_question_2 TEXT,
  ADD COLUMN IF NOT EXISTS security_answer_2_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_reset_pending BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pin_reset_requested_at TIMESTAMPTZ;

-- pin_reset_pending needed on vendors + riders (admin creates them with temp PINs)
-- and customers (admin override can also force a reset)
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS pin_reset_pending BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pin_reset_requested_at TIMESTAMPTZ;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS pin_reset_pending BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pin_reset_requested_at TIMESTAMPTZ;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pin_reset_pending BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pin_reset_requested_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pin_reset_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('customer', 'vendor', 'rider', 'admin', 'super_admin')),
  reset_method TEXT NOT NULL CHECK (reset_method IN ('SECURITY_QUESTIONS', 'RECOVERY_CODE', 'ADMIN_OVERRIDE', 'CHANGE_PIN')),
  ip_address INET,
  user_agent TEXT,
  succeeded BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pin_reset_audit_user ON pin_reset_audit(user_id, created_at DESC);
