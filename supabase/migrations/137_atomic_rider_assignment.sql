-- Atomically claim a READY delivery and make the rider BUSY.
CREATE OR REPLACE FUNCTION accept_rider_order(p_rider_id UUID, p_order_id UUID, p_now TIMESTAMPTZ)
RETURNS TABLE(success BOOLEAN, error_code TEXT, order_number TEXT, vendor_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_rider RECORD; v_order RECORD;
BEGIN
  SELECT id, status, active_order_id, is_active, approval_state INTO v_rider
  FROM riders WHERE id = p_rider_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'RIDER_NOT_FOUND', NULL::TEXT, NULL::UUID; RETURN; END IF;
  IF NOT v_rider.is_active OR v_rider.approval_state <> 'approved' THEN
    RETURN QUERY SELECT false, 'RIDER_INACTIVE', NULL::TEXT, NULL::UUID; RETURN;
  END IF;
  IF v_rider.status <> 'ONLINE' OR v_rider.active_order_id IS NOT NULL THEN
    RETURN QUERY SELECT false, 'RIDER_BUSY', NULL::TEXT, NULL::UUID; RETURN;
  END IF;

  SELECT id, orders.order_number, orders.vendor_id INTO v_order
  FROM orders WHERE id = p_order_id AND status = 'READY' AND rider_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'ORDER_UNAVAILABLE', NULL::TEXT, NULL::UUID; RETURN; END IF;

  UPDATE orders SET rider_id = p_rider_id, status = 'RIDER_ASSIGNED',
    order_state = 'ready_for_pickup', rider_assigned_at = p_now, updated_at = p_now
  WHERE id = p_order_id;
  UPDATE riders SET status = 'BUSY', active_order_id = p_order_id, last_status_update_at = p_now
  WHERE id = p_rider_id;
  RETURN QUERY SELECT true, NULL::TEXT, v_order.order_number::TEXT, v_order.vendor_id::UUID;
END $$;

REVOKE ALL ON FUNCTION accept_rider_order(UUID,UUID,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_rider_order(UUID,UUID,TIMESTAMPTZ) TO service_role;

-- Wrong-code accounting must also be assignment-bound; otherwise a rider who is
-- reassigned during a request can lock the new rider's handover code.
CREATE OR REPLACE FUNCTION bump_assigned_rider_handover_attempts(
  p_order_id UUID, p_rider_id UUID, p_limit INT DEFAULT 5
) RETURNS TABLE(attempts INT, locked BOOLEAN, assignment_current BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_count INT;
BEGIN
  SELECT handover_code_attempts INTO v_count FROM orders
  WHERE id = p_order_id AND rider_id = p_rider_id AND status = 'PICKED_UP' FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 0, false, false; RETURN; END IF;
  v_count := v_count + 1;
  UPDATE orders SET handover_code_attempts = v_count,
    handover_code_locked = (v_count >= p_limit), updated_at = now()
  WHERE id = p_order_id AND rider_id = p_rider_id AND status = 'PICKED_UP';
  RETURN QUERY SELECT v_count, (v_count >= p_limit), true;
END $$;

REVOKE ALL ON FUNCTION bump_assigned_rider_handover_attempts(UUID,UUID,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bump_assigned_rider_handover_attempts(UUID,UUID,INT) TO service_role;
