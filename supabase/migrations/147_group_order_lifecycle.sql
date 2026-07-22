-- Normalize host-paid group ordering around one explicit lifecycle.
UPDATE group_orders SET status = 'PLACED' WHERE status = 'CHECKED_OUT';
UPDATE group_orders SET split_enabled = FALSE WHERE split_enabled IS DISTINCT FROM FALSE;

ALTER TABLE group_orders DROP CONSTRAINT IF EXISTS group_orders_status_check;
ALTER TABLE group_orders ADD CONSTRAINT group_orders_status_check CHECK (
  status IN ('DRAFT', 'OPEN', 'LOCKED', 'VALIDATING', 'AWAITING_PAYMENT', 'PLACED', 'CANCELLED', 'EXPIRED', 'FAILED')
);

ALTER TABLE group_orders
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT 'BIKE',
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS per_person_budget_kobo BIGINT,
  ADD COLUMN IF NOT EXISTS participant_limit INT NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS shared_note TEXT,
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS placed_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_one_per_group_order
  ON orders(group_order_id)
  WHERE group_order_id IS NOT NULL;

ALTER TABLE group_orders DROP CONSTRAINT IF EXISTS group_orders_delivery_type_check;
ALTER TABLE group_orders ADD CONSTRAINT group_orders_delivery_type_check
  CHECK (delivery_type IN ('BIKE', 'DOOR', 'PICKUP'));
ALTER TABLE group_orders DROP CONSTRAINT IF EXISTS group_orders_participant_limit_check;
ALTER TABLE group_orders ADD CONSTRAINT group_orders_participant_limit_check
  CHECK (participant_limit BETWEEN 2 AND 20);
ALTER TABLE group_orders DROP CONSTRAINT IF EXISTS group_orders_budget_check;
ALTER TABLE group_orders ADD CONSTRAINT group_orders_budget_check
  CHECK (per_person_budget_kobo IS NULL OR per_person_budget_kobo > 0);

-- Participant identity is independent from permanent accounts. Guest sessions
-- store only a SHA-256 hash; the raw capability remains in an httpOnly cookie.
CREATE TABLE IF NOT EXISTS group_order_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id UUID NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  guest_session_hash TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'JOINED'
    CHECK (status IN ('JOINED', 'EDITING', 'READY', 'REMOVED', 'EXPIRED')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT group_order_participant_identity CHECK (
    (customer_id IS NOT NULL AND guest_session_hash IS NULL) OR
    (customer_id IS NULL AND guest_session_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS group_order_participant_customer_unique
  ON group_order_participants(group_order_id, customer_id)
  WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS group_order_participant_guest_unique
  ON group_order_participants(group_order_id, guest_session_hash)
  WHERE guest_session_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_order_participant_active
  ON group_order_participants(group_order_id, status);

INSERT INTO group_order_participants(group_order_id, customer_id, display_name, status)
  SELECT go.id, go.host_customer_id, COALESCE(c.name, 'Organizer'),
         CASE WHEN EXISTS (SELECT 1 FROM group_order_items i WHERE i.group_order_id = go.id AND i.contributor_id = go.host_customer_id) THEN 'EDITING' ELSE 'JOINED' END
  FROM group_orders go
  JOIN customers c ON c.id = go.host_customer_id
  ON CONFLICT (group_order_id, customer_id) WHERE customer_id IS NOT NULL DO NOTHING;

INSERT INTO group_order_participants(group_order_id, customer_id, display_name, status)
  SELECT DISTINCT i.group_order_id, i.contributor_id, COALESCE(i.contributor_name, c.name, 'Participant'), 'EDITING'
  FROM group_order_items i
  JOIN customers c ON c.id = i.contributor_id
  WHERE i.contributor_id IS NOT NULL
  ON CONFLICT (group_order_id, customer_id) WHERE customer_id IS NOT NULL DO NOTHING;

ALTER TABLE group_order_items
  ALTER COLUMN contributor_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES group_order_participants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS client_item_id UUID,
  ADD COLUMN IF NOT EXISTS unit_price_kobo BIGINT,
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS group_order_item_retry_unique
  ON group_order_items(group_order_id, participant_id, client_item_id)
  WHERE participant_id IS NOT NULL AND client_item_id IS NOT NULL;

UPDATE group_order_items goi
  SET unit_price_kobo = mi.price_kobo
  FROM menu_items mi
  WHERE goi.menu_item_id = mi.id AND goi.unit_price_kobo IS NULL;

UPDATE group_order_items goi
  SET participant_id = p.id
  FROM group_order_participants p
  WHERE p.group_order_id = goi.group_order_id
    AND p.customer_id = goi.contributor_id
    AND goi.participant_id IS NULL;

CREATE TABLE IF NOT EXISTS group_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id UUID NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  actor_participant_id UUID REFERENCES group_order_participants(id) ON DELETE SET NULL,
  actor_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_order_events_group
  ON group_order_events(group_order_id, created_at DESC);

ALTER TABLE group_order_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_order_events ENABLE ROW LEVEL SECURITY;

-- Serializes item insertion against organizer locking. A participant save that
-- acquires the group row first commits before lock; a lock that wins rejects it.
CREATE OR REPLACE FUNCTION group_order_add_item_atomic(
  p_group_id UUID,
  p_participant_id UUID,
  p_contributor_id UUID,
  p_contributor_name TEXT,
  p_menu_item_id UUID,
  p_unit_price_kobo BIGINT,
  p_quantity INT,
  p_notes TEXT,
  p_addons JSONB,
  p_client_item_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group group_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM group_orders WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_group.expires_at <= NOW() THEN
    UPDATE group_orders SET status = 'EXPIRED', version = version + 1 WHERE id = p_group_id;
    RETURN 'expired';
  END IF;
  IF v_group.status <> 'OPEN' THEN RETURN 'locked'; END IF;

  INSERT INTO group_order_items (
    group_order_id, participant_id, contributor_id, contributor_name,
    menu_item_id, unit_price_kobo, quantity, notes, addons, client_item_id
  ) VALUES (
    p_group_id, p_participant_id, p_contributor_id, p_contributor_name,
    p_menu_item_id, p_unit_price_kobo, p_quantity, p_notes, COALESCE(p_addons, '[]'::jsonb), p_client_item_id
  ) ON CONFLICT (group_order_id, participant_id, client_item_id)
    WHERE participant_id IS NOT NULL AND client_item_id IS NOT NULL
    DO NOTHING;

  UPDATE group_order_participants
    SET status = 'EDITING', updated_at = NOW(), last_seen_at = NOW()
    WHERE id = p_participant_id AND status IN ('JOINED', 'EDITING', 'READY');
  INSERT INTO group_order_events(group_order_id, actor_participant_id, actor_customer_id, event_type)
    VALUES (p_group_id, p_participant_id, p_contributor_id, 'item_saved');
  RETURN 'ok';
END;
$$;

-- Compare-and-set makes repeated lock requests and stale organizer tabs safe.
CREATE OR REPLACE FUNCTION group_order_begin_lock(
  p_group_id UUID,
  p_host_customer_id UUID,
  p_expected_version BIGINT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group group_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM group_orders WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_group.host_customer_id <> p_host_customer_id THEN RETURN 'forbidden'; END IF;
  IF v_group.status IN ('LOCKED', 'VALIDATING', 'AWAITING_PAYMENT') THEN RETURN 'already_locked'; END IF;
  IF v_group.status <> 'OPEN' THEN RETURN 'closed'; END IF;
  IF v_group.expires_at <= NOW() THEN
    UPDATE group_orders SET status = 'EXPIRED', version = version + 1 WHERE id = p_group_id;
    RETURN 'expired';
  END IF;
  IF v_group.version <> p_expected_version THEN RETURN 'conflict'; END IF;

  UPDATE group_orders
    SET status = 'VALIDATING', locked_at = NOW(), version = version + 1
    WHERE id = p_group_id;
  INSERT INTO group_order_events(group_order_id, actor_customer_id, event_type)
    VALUES (p_group_id, p_host_customer_id, 'lock_started');
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION group_order_update_item_atomic(
  p_group_id UUID,
  p_item_id UUID,
  p_participant_id UUID,
  p_unit_price_kobo BIGINT,
  p_quantity INT,
  p_notes TEXT,
  p_addons JSONB,
  p_expected_version BIGINT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group group_orders%ROWTYPE;
  v_updated UUID;
BEGIN
  SELECT * INTO v_group FROM group_orders WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_group.expires_at <= NOW() OR v_group.status <> 'OPEN' THEN RETURN 'locked'; END IF;
  UPDATE group_order_items
    SET unit_price_kobo = p_unit_price_kobo, quantity = p_quantity, notes = p_notes, addons = COALESCE(p_addons, '[]'::jsonb),
        version = version + 1, updated_at = NOW()
    WHERE id = p_item_id AND group_order_id = p_group_id
      AND participant_id = p_participant_id AND version = p_expected_version
    RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN RETURN 'conflict'; END IF;
  UPDATE group_order_participants SET status = 'EDITING', updated_at = NOW() WHERE id = p_participant_id;
  INSERT INTO group_order_events(group_order_id, actor_participant_id, event_type)
    VALUES (p_group_id, p_participant_id, 'item_updated');
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION group_order_delete_item_atomic(
  p_group_id UUID,
  p_item_id UUID,
  p_participant_id UUID,
  p_is_host BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group group_orders%ROWTYPE;
  v_deleted UUID;
BEGIN
  SELECT * INTO v_group FROM group_orders WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_group.expires_at <= NOW() OR v_group.status <> 'OPEN' THEN RETURN 'locked'; END IF;
  DELETE FROM group_order_items
    WHERE id = p_item_id AND group_order_id = p_group_id
      AND (participant_id = p_participant_id OR p_is_host)
    RETURNING id INTO v_deleted;
  IF v_deleted IS NULL THEN RETURN 'forbidden'; END IF;
  INSERT INTO group_order_events(group_order_id, actor_participant_id, event_type)
    VALUES (p_group_id, p_participant_id, 'item_removed');
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION group_order_set_ready(
  p_group_id UUID,
  p_participant_id UUID,
  p_ready BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group group_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM group_orders WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_group.expires_at <= NOW() OR v_group.status <> 'OPEN' THEN RETURN 'locked'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM group_order_participants
    WHERE id = p_participant_id AND group_order_id = p_group_id
      AND status IN ('JOINED', 'EDITING', 'READY')
  ) THEN RETURN 'forbidden'; END IF;
  IF p_ready AND NOT EXISTS (
    SELECT 1 FROM group_order_items WHERE group_order_id = p_group_id AND participant_id = p_participant_id
  ) THEN RETURN 'empty'; END IF;
  UPDATE group_order_participants
    SET status = CASE WHEN p_ready THEN 'READY' ELSE 'EDITING' END,
        updated_at = NOW(), last_seen_at = NOW()
    WHERE id = p_participant_id;
  INSERT INTO group_order_events(group_order_id, actor_participant_id, event_type)
    VALUES (p_group_id, p_participant_id, CASE WHEN p_ready THEN 'participant_ready' ELSE 'participant_editing' END);
  RETURN 'ok';
END;
$$;
