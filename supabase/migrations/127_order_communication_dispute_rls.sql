-- ============================================================
-- LumeX Fud — Migration 127: read-only admin dispute transcript RLS
-- Phase 12. Direct authenticated admins can read only disputed-order history.
-- ============================================================

CREATE OR REPLACE FUNCTION can_admin_read_dispute_order_chat(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins a
    WHERE a.phone = (auth.jwt() ->> 'phone') AND a.is_active
  ) AND EXISTS (
    SELECT 1 FROM disputes d WHERE d.order_id = p_order_id
  );
$$;

CREATE OR REPLACE FUNCTION can_admin_read_dispute_conversation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM order_conversations oc
    JOIN disputes d ON d.order_id = oc.order_id
    WHERE oc.id = p_conversation_id
  ) AND EXISTS (
    SELECT 1 FROM admins a
    WHERE a.phone = (auth.jwt() ->> 'phone') AND a.is_active
  );
$$;

REVOKE ALL ON FUNCTION can_admin_read_dispute_order_chat(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION can_admin_read_dispute_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_admin_read_dispute_order_chat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_admin_read_dispute_conversation(UUID) TO authenticated;

DROP POLICY IF EXISTS order_conversations_admin_dispute_read ON order_conversations;
CREATE POLICY order_conversations_admin_dispute_read ON order_conversations
FOR SELECT TO authenticated
USING (can_admin_read_dispute_order_chat(order_conversations.order_id));

DROP POLICY IF EXISTS order_messages_admin_dispute_read ON order_messages;
CREATE POLICY order_messages_admin_dispute_read ON order_messages
FOR SELECT TO authenticated
USING (can_admin_read_dispute_order_chat(order_messages.order_id));

DROP POLICY IF EXISTS order_message_reads_admin_dispute_read ON order_message_reads;
CREATE POLICY order_message_reads_admin_dispute_read ON order_message_reads
FOR SELECT TO authenticated
USING (can_admin_read_dispute_conversation(order_message_reads.conversation_id));
