-- ============================================================
-- LumeX Fud — Migration 003: Messaging
-- ============================================================

CREATE TABLE IF NOT EXISTS order_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer','vendor','rider')),
  message_text TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'TEXT'
                 CHECK (message_type IN ('TEXT','STATUS_UPDATE','DISPUTE_NOTE','CONFIRMATION')),
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_order_messages_order
  ON order_messages(order_id, created_at);

-- Enable realtime for messaging
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
