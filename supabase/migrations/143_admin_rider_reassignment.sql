-- LumeX Fud - Migration 143: admin rider reassignment
-- Locked operational function for dispatch/admin reassignment. Keeps orders and
-- rider active_order_id state consistent in one transaction.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION admin_reassign_order_rider(
  p_order_id UUID,
  p_new_rider_id UUID,
  p_now TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE(
  success BOOLEAN,
  error_code TEXT,
  order_number TEXT,
  previous_rider_id UUID
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_rider RECORD;
BEGIN
  SELECT id, order_number, status, payment_status, rider_id
    INTO v_order
    FROM orders
   WHERE id = p_order_id
     AND status IN ('READY', 'RIDER_ASSIGNED')
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'ORDER_NOT_REASSIGNABLE', NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_order.payment_status <> 'PAID' THEN
    RETURN QUERY SELECT FALSE, 'ORDER_NOT_PAID', v_order.order_number::TEXT, v_order.rider_id::UUID;
    RETURN;
  END IF;

  IF v_order.rider_id IS NOT NULL AND v_order.rider_id = p_new_rider_id THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT, v_order.order_number::TEXT, v_order.rider_id::UUID;
    RETURN;
  END IF;

  SELECT id, status, active_order_id, is_active, approval_state
    INTO v_rider
    FROM riders
   WHERE id = p_new_rider_id
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'RIDER_NOT_FOUND', v_order.order_number::TEXT, v_order.rider_id::UUID;
    RETURN;
  END IF;

  IF v_rider.is_active IS NOT TRUE OR COALESCE(v_rider.approval_state, 'approved') <> 'approved' THEN
    RETURN QUERY SELECT FALSE, 'RIDER_INACTIVE', v_order.order_number::TEXT, v_order.rider_id::UUID;
    RETURN;
  END IF;

  IF v_rider.status <> 'ONLINE' THEN
    RETURN QUERY SELECT FALSE, 'RIDER_NOT_ONLINE', v_order.order_number::TEXT, v_order.rider_id::UUID;
    RETURN;
  END IF;

  IF v_rider.active_order_id IS NOT NULL AND v_rider.active_order_id <> p_order_id THEN
    RETURN QUERY SELECT FALSE, 'RIDER_BUSY', v_order.order_number::TEXT, v_order.rider_id::UUID;
    RETURN;
  END IF;

  IF v_order.rider_id IS NOT NULL THEN
    UPDATE riders
       SET active_order_id = NULL,
           status = 'ONLINE',
           updated_at = p_now
     WHERE id = v_order.rider_id
       AND active_order_id = p_order_id;
  END IF;

  UPDATE riders
     SET active_order_id = p_order_id,
         status = 'BUSY',
         updated_at = p_now
   WHERE id = p_new_rider_id;

  UPDATE orders
     SET rider_id = p_new_rider_id,
         status = 'RIDER_ASSIGNED',
         rider_assigned_at = p_now,
         updated_at = p_now
   WHERE id = p_order_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_order.order_number::TEXT, v_order.rider_id::UUID;
END;
$$;

REVOKE ALL ON FUNCTION admin_reassign_order_rider(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_reassign_order_rider(UUID, UUID, TIMESTAMPTZ) TO service_role;
