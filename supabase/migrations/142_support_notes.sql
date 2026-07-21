-- LumeX Fud - Migration 142: support notes / internal comments
-- Operator-facing notes for daily support. These are internal-only records used
-- to avoid ad hoc database edits or out-of-band support memory.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS support_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'customer', 'vendor', 'rider', 'order', 'payment', 'dispute', 'contact_case', 'phone'
  )),
  subject_id TEXT,
  phone TEXT,
  note TEXT NOT NULL CHECK (char_length(trim(note)) BETWEEN 3 AND 2000),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'super_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE support_notes FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_support_notes_subject
  ON support_notes(subject_type, subject_id, created_at DESC)
  WHERE subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_notes_phone
  ON support_notes(phone, created_at DESC)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_notes_recent
  ON support_notes(created_at DESC);

DROP POLICY IF EXISTS "service_role_support_notes_all" ON support_notes;
CREATE POLICY "service_role_support_notes_all" ON support_notes
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
