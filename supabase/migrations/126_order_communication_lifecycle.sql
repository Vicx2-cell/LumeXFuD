-- ============================================================
-- LumeX Fud — Migration 126: lifecycle + reassignment system messages
-- Phase 11. Rider revocation occurs in the same transaction as orders.rider_id.
-- ============================================================

CREATE OR REPLACE FUNCTION order_communication_system_body(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_status
    WHEN 'VENDOR_ACCEPTED' THEN 'The vendor accepted this order.'
    WHEN 'PREPARING' THEN 'The vendor started preparing this order.'
    WHEN 'READY' THEN 'The order is ready for pickup.'
    WHEN 'RIDER_ASSIGNED' THEN 'A rider was assigned to this order.'
    WHEN 'PICKED_UP' THEN 'The rider picked up this order.'
    WHEN 'DELIVERED' THEN 'The rider marked this order as delivered.'
    WHEN 'COMPLETED' THEN 'This order was completed.'
    WHEN 'CANCELLED' THEN 'This order was cancelled.'
    WHEN 'DISPUTED' THEN 'A dispute was opened for this order.'
    WHEN 'REFUNDED' THEN 'This order was refunded.'
    WHEN 'NO_SHOW' THEN 'This pickup order was closed as a no-show.'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION sync_order_communication_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel TEXT;
  v_version INTEGER;
  v_conversation_id UUID;
  v_body TEXT;
BEGIN
  -- Emit a lifecycle event into the currently active assignment. If a rider is
  -- being replaced, the new assignment gets its own explicit assignment event
  -- below and the former rider never sees the replacement's thread.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.rider_id IS NOT DISTINCT FROM OLD.rider_id OR NEW.rider_id IS NULL)
  THEN
    v_body := order_communication_system_body(NEW.status);
    IF v_body IS NOT NULL THEN
      INSERT INTO order_messages(
        conversation_id, order_id, sender_type, message_type, body,
        system_event_key, metadata
      )
      SELECT
        oc.id, NEW.id, 'SYSTEM', 'SYSTEM', v_body,
        'status:' || NEW.status || ':' || COALESCE(NEW.updated_at::text, transaction_timestamp()::text),
        jsonb_build_object('status', NEW.status)
      FROM order_conversations oc
      WHERE oc.order_id = NEW.id AND oc.is_active
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    UPDATE order_conversations
    SET is_active = FALSE,
        closed_at = transaction_timestamp(),
        updated_at = transaction_timestamp()
    WHERE order_id = NEW.id AND is_active;

    IF NEW.rider_id IS NOT NULL THEN
      FOREACH v_channel IN ARRAY ARRAY['CUSTOMER_RIDER', 'VENDOR_RIDER']
      LOOP
        SELECT COALESCE(MAX(assignment_version), 0) + 1
        INTO v_version
        FROM order_conversations
        WHERE order_id = NEW.id AND channel = v_channel;

        INSERT INTO order_conversations(
          order_id, channel, rider_id, assignment_version
        ) VALUES (
          NEW.id, v_channel, NEW.rider_id, v_version
        )
        RETURNING id INTO v_conversation_id;

        INSERT INTO order_messages(
          conversation_id, order_id, sender_type, message_type, body,
          system_event_key, metadata
        ) VALUES (
          v_conversation_id,
          NEW.id,
          'SYSTEM',
          'SYSTEM',
          'A rider was assigned to this order.',
          'rider-assigned:' || NEW.rider_id::text || ':' || v_version::text,
          jsonb_build_object('status', NEW.status, 'assignment_version', v_version)
        );
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_communication_lifecycle ON orders;
CREATE TRIGGER orders_communication_lifecycle
  AFTER INSERT OR UPDATE OF rider_id, status ON orders
  FOR EACH ROW EXECUTE FUNCTION sync_order_communication_lifecycle();

REVOKE ALL ON FUNCTION order_communication_system_body(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_order_communication_lifecycle() FROM PUBLIC, anon, authenticated;
