-- ============================================================
-- LumeX Fud — Migration 129: atomic order-chat authorization
-- Security hardening: closes reassignment TOCTOU races in service-role routes.
-- ============================================================

CREATE OR REPLACE FUNCTION order_chat_ensure_authorized(
  p_order_id UUID,
  p_channel TEXT,
  p_actor_type TEXT,
  p_actor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_conversation_id UUID;
  v_version INTEGER;
BEGIN
  SELECT id, customer_id, vendor_id, rider_id
  INTO v_order FROM orders WHERE id = p_order_id FOR SHARE;
  IF NOT FOUND OR v_order.rider_id IS NULL THEN RETURN NULL; END IF;

  IF NOT (
    (p_actor_type = 'CUSTOMER' AND p_channel = 'CUSTOMER_RIDER' AND v_order.customer_id = p_actor_id)
    OR (p_actor_type = 'VENDOR' AND p_channel = 'VENDOR_RIDER' AND v_order.vendor_id = p_actor_id)
    OR (p_actor_type = 'RIDER' AND p_channel IN ('CUSTOMER_RIDER', 'VENDOR_RIDER') AND v_order.rider_id = p_actor_id)
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE order_conversations
  SET is_active = FALSE, closed_at = transaction_timestamp(), updated_at = transaction_timestamp()
  WHERE order_id = p_order_id AND is_active AND rider_id <> v_order.rider_id;

  SELECT id INTO v_conversation_id
  FROM order_conversations
  WHERE order_id = p_order_id
    AND channel = p_channel
    AND rider_id = v_order.rider_id
    AND is_active
  ;

  IF v_conversation_id IS NULL THEN
    SELECT COALESCE(MAX(assignment_version), 0) + 1 INTO v_version
    FROM order_conversations WHERE order_id = p_order_id AND channel = p_channel;
    BEGIN
      INSERT INTO order_conversations(order_id, channel, rider_id, assignment_version)
      VALUES (p_order_id, p_channel, v_order.rider_id, v_version)
      RETURNING id INTO v_conversation_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_conversation_id
      FROM order_conversations
      WHERE order_id = p_order_id
        AND channel = p_channel
        AND rider_id = v_order.rider_id
        AND is_active;
    END;
  END IF;
  RETURN v_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_order_chat_page_authorized(
  p_order_id UUID,
  p_channel TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_after TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_conversation_id UUID;
  v_messages JSONB;
  v_reads JSONB;
  v_count INTEGER;
  v_next_cursor TIMESTAMPTZ;
  v_grace INTEGER := 60;
  v_terminal_at TIMESTAMPTZ;
  v_writable BOOLEAN;
BEGIN
  v_conversation_id := order_chat_ensure_authorized(p_order_id, p_channel, p_actor_type, p_actor_id);
  IF v_conversation_id IS NULL THEN RETURN NULL; END IF;
  SELECT id, status, delivered_at, cancelled_at
  INTO v_order FROM orders WHERE id = p_order_id FOR SHARE;
  SELECT LEAST(1440, GREATEST(0, COALESCE((value->>'minutes')::int, 60))) INTO v_grace
  FROM settings WHERE id = 'order_chat_grace_period';
  v_grace := COALESCE(v_grace, 60);

  WITH page AS (
    SELECT id, sender_id, sender_type, message_type, body, metadata, created_at
    FROM order_messages
    WHERE conversation_id = v_conversation_id
      AND (p_before IS NULL OR created_at < p_before)
      AND (p_after IS NULL OR created_at > p_after)
    ORDER BY created_at DESC, id DESC
    LIMIT LEAST(100, GREATEST(1, p_limit))
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'sender_id', sender_id, 'sender_type', sender_type,
      'message_type', message_type, 'body', body, 'metadata', metadata,
      'created_at', created_at
    ) ORDER BY created_at, id), '[]'::jsonb),
    COUNT(*)::int,
    MIN(created_at)
  INTO v_messages, v_count, v_next_cursor
  FROM page;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'participant_type', participant_type,
    'participant_id', participant_id,
    'last_read_at', last_read_at,
    'last_read_message_id', last_read_message_id
  )), '[]'::jsonb)
  INTO v_reads
  FROM order_message_reads WHERE conversation_id = v_conversation_id;

  IF v_order.status IN ('DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'NO_SHOW') THEN
    v_terminal_at := COALESCE(v_order.cancelled_at, v_order.delivered_at);
    v_writable := v_terminal_at IS NOT NULL
      AND statement_timestamp() <= v_terminal_at + make_interval(mins => v_grace);
  ELSE
    v_writable := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'channel', p_channel,
    'messages', v_messages,
    'reads', v_reads,
    'writable', v_writable,
    'closes_at', CASE WHEN v_terminal_at IS NULL THEN NULL ELSE v_terminal_at + make_interval(mins => v_grace) END,
    'has_more', v_count = LEAST(100, GREATEST(1, p_limit)),
    'next_cursor', v_next_cursor
  );
END;
$$;

CREATE OR REPLACE FUNCTION send_order_chat_message_authorized(
  p_order_id UUID,
  p_channel TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_body TEXT,
  p_client_message_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_conversation_id UUID;
  v_message RECORD;
  v_grace INTEGER := 60;
  v_terminal_at TIMESTAMPTZ;
  v_recent INTEGER;
BEGIN
  v_conversation_id := order_chat_ensure_authorized(p_order_id, p_channel, p_actor_type, p_actor_id);
  IF v_conversation_id IS NULL THEN RETURN NULL; END IF;
  SELECT id, status, delivered_at, cancelled_at
  INTO v_order FROM orders WHERE id = p_order_id FOR SHARE;
  -- Serialize sends within a conversation. This makes the database fallback
  -- rate limit authoritative even when Redis is unavailable or under a burst.
  PERFORM id FROM order_conversations WHERE id = v_conversation_id FOR UPDATE;

  SELECT id, sender_id, sender_type, message_type, body, metadata, created_at
  INTO v_message FROM order_messages
  WHERE conversation_id = v_conversation_id
    AND sender_id = p_actor_id
    AND client_message_id = p_client_message_id;
  IF FOUND THEN
    RETURN jsonb_build_object('message', to_jsonb(v_message), 'replayed', TRUE);
  END IF;

  IF v_order.status IN ('DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'NO_SHOW') THEN
    SELECT LEAST(1440, GREATEST(0, COALESCE((value->>'minutes')::int, 60))) INTO v_grace
    FROM settings WHERE id = 'order_chat_grace_period';
    v_grace := COALESCE(v_grace, 60);
    v_terminal_at := COALESCE(v_order.cancelled_at, v_order.delivered_at);
    IF v_terminal_at IS NULL OR statement_timestamp() > v_terminal_at + make_interval(mins => v_grace) THEN
      RAISE EXCEPTION 'chat_read_only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COUNT(*)::int INTO v_recent FROM order_messages
  WHERE conversation_id = v_conversation_id
    AND sender_id = p_actor_id
    AND message_type = 'USER'
    AND created_at >= statement_timestamp() - INTERVAL '1 minute';
  IF v_recent >= 12 THEN RAISE EXCEPTION 'chat_rate_limited' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO order_messages(
    conversation_id, order_id, sender_id, sender_type, message_type, body, client_message_id
  ) VALUES (
    v_conversation_id, p_order_id, p_actor_id, p_actor_type, 'USER', p_body, p_client_message_id
  )
  ON CONFLICT (conversation_id, sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL DO NOTHING
  RETURNING id, sender_id, sender_type, message_type, body, metadata, created_at INTO v_message;
  IF NOT FOUND THEN
    SELECT id, sender_id, sender_type, message_type, body, metadata, created_at
    INTO v_message FROM order_messages
    WHERE conversation_id = v_conversation_id
      AND sender_id = p_actor_id
      AND client_message_id = p_client_message_id;
  END IF;
  RETURN jsonb_build_object('message', to_jsonb(v_message), 'replayed', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION mark_order_chat_read_authorized(
  p_order_id UUID,
  p_channel TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_message_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id UUID;
  v_message_id UUID;
BEGIN
  v_conversation_id := order_chat_ensure_authorized(p_order_id, p_channel, p_actor_type, p_actor_id);
  IF v_conversation_id IS NULL THEN RETURN NULL; END IF;
  IF p_message_id IS NULL THEN
    SELECT id INTO v_message_id FROM order_messages
    WHERE conversation_id = v_conversation_id ORDER BY created_at DESC, id DESC LIMIT 1;
  ELSE
    SELECT id INTO v_message_id FROM order_messages
    WHERE id = p_message_id AND conversation_id = v_conversation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_message' USING ERRCODE = 'P0001'; END IF;
  END IF;
  INSERT INTO order_message_reads(
    conversation_id, participant_type, participant_id, last_read_message_id, last_read_at
  ) VALUES (
    v_conversation_id, p_actor_type, p_actor_id, v_message_id, statement_timestamp()
  )
  ON CONFLICT (conversation_id, participant_type, participant_id)
  DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id, last_read_at = EXCLUDED.last_read_at;
  RETURN jsonb_build_object('marked_read', TRUE, 'last_read_message_id', v_message_id);
END;
$$;

REVOKE ALL ON FUNCTION order_chat_ensure_authorized(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_order_chat_page_authorized(UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION send_order_chat_message_authorized(UUID, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_order_chat_read_authorized(UUID, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION order_chat_ensure_authorized(UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_order_chat_page_authorized(UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION send_order_chat_message_authorized(UUID, TEXT, TEXT, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION mark_order_chat_read_authorized(UUID, TEXT, TEXT, UUID, UUID) TO service_role;
