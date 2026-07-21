-- ============================================================
-- LumeX Fud — Migration 123: order communication RLS
-- Phase 2. Writes are server-only; direct clients can only read their current,
-- active order-assignment threads.
-- ============================================================

REVOKE ALL ON order_conversations, order_messages, order_message_reads FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON order_conversations, order_messages, order_message_reads FROM authenticated;
GRANT SELECT ON order_conversations, order_messages, order_message_reads TO authenticated;

-- The participant lookup crosses other RLS-protected tables. A narrow
-- security-definer predicate prevents those tables' policies from accidentally
-- turning valid chat reads off while still deriving identity solely from the
-- signed Supabase JWT and current orders.rider_id.
CREATE OR REPLACE FUNCTION can_read_order_conversation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM order_conversations oc
    JOIN orders o ON o.id = oc.order_id AND o.rider_id = oc.rider_id
    WHERE oc.id = p_conversation_id
      AND oc.is_active
      AND (
        (oc.channel = 'CUSTOMER_RIDER' AND (
          EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.phone = (auth.jwt() ->> 'phone'))
          OR EXISTS (SELECT 1 FROM riders r WHERE r.id = oc.rider_id AND r.phone = (auth.jwt() ->> 'phone'))
        ))
        OR
        (oc.channel = 'VENDOR_RIDER' AND (
          EXISTS (SELECT 1 FROM vendors v WHERE v.id = o.vendor_id AND v.phone = (auth.jwt() ->> 'phone'))
          OR EXISTS (SELECT 1 FROM riders r WHERE r.id = oc.rider_id AND r.phone = (auth.jwt() ->> 'phone'))
        ))
      )
  );
$$;
REVOKE ALL ON FUNCTION can_read_order_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_read_order_conversation(UUID) TO authenticated;

DROP POLICY IF EXISTS order_conversations_participant_read ON order_conversations;
CREATE POLICY order_conversations_participant_read ON order_conversations
FOR SELECT TO authenticated
USING (can_read_order_conversation(order_conversations.id));

DROP POLICY IF EXISTS order_messages_participant_read ON order_messages;
CREATE POLICY order_messages_participant_read ON order_messages
FOR SELECT TO authenticated
USING (can_read_order_conversation(order_messages.conversation_id));

DROP POLICY IF EXISTS order_message_reads_participant_read ON order_message_reads;
CREATE POLICY order_message_reads_participant_read ON order_message_reads
FOR SELECT TO authenticated
USING (can_read_order_conversation(order_message_reads.conversation_id));
