-- ============================================================
-- LumeX Fud — Migration 125: participant-scoped unread aggregate
-- Phase 9. Callable only by service_role after app-session authorization.
-- ============================================================

CREATE OR REPLACE FUNCTION get_order_chat_unread(
  p_participant_type TEXT,
  p_participant_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  order_id UUID,
  channel TEXT,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    oc.id,
    oc.order_id,
    oc.channel,
    COUNT(m.id)::BIGINT AS unread_count
  FROM order_conversations oc
  JOIN orders o ON o.id = oc.order_id AND o.rider_id = oc.rider_id
  LEFT JOIN order_message_reads r
    ON r.conversation_id = oc.id
   AND r.participant_type = p_participant_type
   AND r.participant_id = p_participant_id
  LEFT JOIN order_messages m
    ON m.conversation_id = oc.id
   AND m.message_type = 'USER'
   AND m.sender_id IS DISTINCT FROM p_participant_id
   AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
  WHERE oc.is_active
    AND (
      (p_participant_type = 'CUSTOMER' AND oc.channel = 'CUSTOMER_RIDER' AND o.customer_id = p_participant_id)
      OR
      (p_participant_type = 'VENDOR' AND oc.channel = 'VENDOR_RIDER' AND o.vendor_id = p_participant_id)
      OR
      (p_participant_type = 'RIDER' AND oc.rider_id = p_participant_id AND o.rider_id = p_participant_id)
    )
  GROUP BY oc.id, oc.order_id, oc.channel;
$$;

REVOKE ALL ON FUNCTION get_order_chat_unread(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_order_chat_unread(TEXT, UUID) TO service_role;
