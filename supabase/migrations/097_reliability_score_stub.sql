-- ============================================================
-- LumeX Fud - Migration 097: reliability score stub
-- ============================================================
-- Adds per-vendor/per-rider reliability score fields and a placeholder
-- calculator that reads the existing security_events spine. The calculator is
-- intentionally conservative and is not scheduled here; current app behavior is
-- unchanged while the event inputs are captured for the later real formula.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS reliability_score NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  ADD COLUMN IF NOT EXISTS reliability_score_updated_at TIMESTAMPTZ;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS reliability_score NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  ADD COLUMN IF NOT EXISTS reliability_score_updated_at TIMESTAMPTZ;

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_reliability_score_range;
ALTER TABLE vendors
  ADD CONSTRAINT vendors_reliability_score_range
  CHECK (reliability_score >= 0 AND reliability_score <= 100);

ALTER TABLE riders DROP CONSTRAINT IF EXISTS riders_reliability_score_range;
ALTER TABLE riders
  ADD CONSTRAINT riders_reliability_score_range
  CHECK (reliability_score >= 0 AND reliability_score <= 100);

COMMENT ON COLUMN vendors.reliability_score IS
  'Placeholder 0-100 reliability score. Later formula is computed from security_events lifecycle timestamps.';
COMMENT ON COLUMN riders.reliability_score IS
  'Placeholder 0-100 reliability score. Later formula is computed from security_events lifecycle timestamps.';

CREATE INDEX IF NOT EXISTS idx_security_events_reliability_vendor
  ON security_events ((detail->>'vendor_id'), created_at DESC)
  WHERE event_type IN ('order_status_transition', 'order_handover_completed', 'late_delivery_credit_issued')
    AND detail ? 'vendor_id';

CREATE INDEX IF NOT EXISTS idx_security_events_reliability_rider
  ON security_events ((detail->>'rider_id'), created_at DESC)
  WHERE event_type IN ('rider_order_accepted', 'order_status_transition', 'order_handover_completed', 'late_delivery_credit_issued')
    AND detail ? 'rider_id';

CREATE OR REPLACE FUNCTION reliability_score_inputs_from_security_events()
RETURNS TABLE (
  entity_role TEXT,
  entity_id UUID,
  reliability_score NUMERIC(5,2),
  event_count BIGINT,
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH inputs AS (
    SELECT
      'vendor'::text AS entity_role,
      (detail->>'vendor_id')::uuid AS entity_id,
      created_at
    FROM security_events
    WHERE event_type IN ('order_status_transition', 'order_handover_completed', 'late_delivery_credit_issued')
      AND detail->>'vendor_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

    UNION ALL

    SELECT
      'rider'::text AS entity_role,
      (detail->>'rider_id')::uuid AS entity_id,
      created_at
    FROM security_events
    WHERE event_type IN ('rider_order_accepted', 'order_status_transition', 'order_handover_completed', 'late_delivery_credit_issued')
      AND detail->>'rider_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  SELECT
    entity_role,
    entity_id,
    100.00::numeric(5,2) AS reliability_score,
    count(*)::bigint AS event_count,
    min(created_at) AS first_event_at,
    max(created_at) AS last_event_at
  FROM inputs
  GROUP BY entity_role, entity_id;
$$;

COMMENT ON FUNCTION reliability_score_inputs_from_security_events() IS
  'Stub reliability calculator. It proves the score source is the security_events timestamp spine, but currently returns the neutral score.';
