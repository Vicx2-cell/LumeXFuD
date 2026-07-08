-- Create table for storing unmatched Lumi messages for later analysis.
-- These rows are internal moderation/ops data; service-role code writes them and
-- admins inspect them through service-role routes, never direct client table RLS.
CREATE TABLE IF NOT EXISTS lumi_unmatched_messages (
  id bigserial PRIMARY KEY,
  user_id text,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lumi_unmatched_user
  ON lumi_unmatched_messages(user_id);

ALTER TABLE lumi_unmatched_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE lumi_unmatched_messages FROM anon, authenticated;
REVOKE ALL ON SEQUENCE lumi_unmatched_messages_id_seq FROM anon, authenticated;

DROP POLICY IF EXISTS lumi_unmatched_messages_service_role_all ON lumi_unmatched_messages;
CREATE POLICY lumi_unmatched_messages_service_role_all
  ON lumi_unmatched_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
