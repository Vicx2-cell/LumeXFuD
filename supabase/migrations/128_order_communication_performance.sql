-- ============================================================
-- LumeX Fud — Migration 128: order communication hot-path indexes
-- Phase 14.
-- ============================================================

CREATE INDEX IF NOT EXISTS order_messages_unread_scan_idx
  ON order_messages(conversation_id, created_at DESC, sender_id)
  WHERE message_type = 'USER';

CREATE INDEX IF NOT EXISTS order_conversations_active_assignment_idx
  ON order_conversations(order_id, rider_id, channel)
  WHERE is_active;
