-- ============================================================
-- LumeX Fud — Migration 122: order-scoped communication schema
-- Phase 1 (database only). Policies are installed by migration 123.
-- ============================================================

INSERT INTO settings (id, value)
VALUES ('order_chat_grace_period', '{"minutes": 60}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS order_conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel            TEXT NOT NULL CHECK (channel IN ('CUSTOMER_RIDER', 'VENDOR_RIDER')),
  rider_id           UUID NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  assignment_version INTEGER NOT NULL CHECK (assignment_version > 0),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_conversations_assignment_unique
    UNIQUE (order_id, channel, assignment_version),
  CONSTRAINT order_conversations_id_order_unique UNIQUE (id, order_id)
);
ALTER TABLE order_conversations ENABLE ROW LEVEL SECURITY;

-- At most one live thread for each allowed relationship on an order. A rider
-- reassignment archives these rows and creates a new assignment version.
CREATE UNIQUE INDEX IF NOT EXISTS order_conversations_one_active_channel_idx
  ON order_conversations(order_id, channel)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS order_conversations_order_created_idx
  ON order_conversations(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_conversations_rider_active_idx
  ON order_conversations(rider_id, is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS order_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL,
  order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id          UUID,
  sender_type        TEXT NOT NULL CHECK (sender_type IN ('CUSTOMER', 'VENDOR', 'RIDER', 'SYSTEM')),
  message_type       TEXT NOT NULL DEFAULT 'USER' CHECK (message_type IN ('USER', 'SYSTEM')),
  body               TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  client_message_id  UUID,
  system_event_key   TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_messages_sender_shape CHECK (
    (message_type = 'SYSTEM' AND sender_type = 'SYSTEM' AND sender_id IS NULL)
    OR
    (message_type = 'USER' AND sender_type <> 'SYSTEM' AND sender_id IS NOT NULL)
  ),
  CONSTRAINT order_messages_conversation_order_fk
    FOREIGN KEY (conversation_id, order_id)
    REFERENCES order_conversations(id, order_id) ON DELETE CASCADE,
  CONSTRAINT order_messages_id_conversation_unique UNIQUE (id, conversation_id)
);
ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS order_messages_conversation_created_idx
  ON order_messages(conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS order_messages_order_created_idx
  ON order_messages(order_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS order_messages_client_idempotency_idx
  ON order_messages(conversation_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS order_messages_system_event_idx
  ON order_messages(conversation_id, system_event_key)
  WHERE system_event_key IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_order_message_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'order messages are immutable';
END;
$$;

DROP TRIGGER IF EXISTS order_messages_immutable ON order_messages;
CREATE TRIGGER order_messages_immutable
  BEFORE UPDATE OR DELETE ON order_messages
  FOR EACH ROW EXECUTE FUNCTION reject_order_message_mutation();

CREATE TABLE IF NOT EXISTS order_message_reads (
  conversation_id     UUID NOT NULL REFERENCES order_conversations(id) ON DELETE CASCADE,
  participant_type    TEXT NOT NULL CHECK (participant_type IN ('CUSTOMER', 'VENDOR', 'RIDER')),
  participant_id      UUID NOT NULL,
  last_read_message_id UUID,
  last_read_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, participant_type, participant_id),
  CONSTRAINT order_message_reads_message_conversation_fk
    FOREIGN KEY (last_read_message_id, conversation_id)
    REFERENCES order_messages(id, conversation_id)
);
ALTER TABLE order_message_reads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS order_message_reads_participant_idx
  ON order_message_reads(participant_type, participant_id, last_read_at DESC);

COMMENT ON TABLE order_conversations IS
  'Order-owned, rider-assignment-scoped conversations. No customer/vendor channel exists.';
COMMENT ON TABLE order_messages IS
  'Immutable order communication and server-generated lifecycle events.';
COMMENT ON TABLE order_message_reads IS
  'Per-participant read cursors used for unread counts and receipts.';
