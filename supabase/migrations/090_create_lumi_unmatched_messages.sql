-- Create table for storing unmatched Lumi messages for later analysis
CREATE TABLE IF NOT EXISTS lumi_unmatched_messages (
  id bigserial PRIMARY KEY,
  user_id text,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Optional: index for lookup by user
CREATE INDEX IF NOT EXISTS idx_lumi_unmatched_user ON lumi_unmatched_messages(user_id);
