-- Complete security-case facts and append-only, human-reviewed status transitions.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE security_evidence_custody
  DROP CONSTRAINT IF EXISTS security_evidence_custody_action_check;
ALTER TABLE security_evidence_custody
  ADD CONSTRAINT security_evidence_custody_action_check
  CHECK (action IN ('CREATED','VIEWED','HOLD_CREATED','EXPORTED','STATUS_CHANGED'));

CREATE OR REPLACE FUNCTION create_security_incident_v2(
  p_incident_id TEXT, p_event_id BIGINT, p_actor_id TEXT,
  p_severity TEXT, p_confidence NUMERIC, p_classification TEXT,
  p_account_id TEXT, p_account_role TEXT, p_orders JSONB, p_payments JSONB,
  p_rules JSONB, p_actions JSONB, p_location JSONB,
  p_evidence_hold BOOLEAN, p_hold_reason TEXT, p_recommended_action TEXT,
  p_request_id TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_id UUID;
BEGIN
  IF jsonb_typeof(coalesce(p_orders, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_actions, '[]'::jsonb)) <> 'array'
     OR (p_location IS NOT NULL AND jsonb_typeof(p_location) <> 'object') THEN
    RAISE EXCEPTION 'invalid incident facts';
  END IF;

  INSERT INTO security_incidents (
    incident_id, primary_event_id, severity, confidence, classification,
    account_id, account_role, affected_orders, affected_payments,
    triggered_rules, containment_actions, approximate_location,
    evidence_hold, evidence_hold_reason, evidence_held_at, evidence_held_by,
    recommended_action
  ) VALUES (
    p_incident_id, p_event_id, p_severity, p_confidence, p_classification,
    p_account_id, p_account_role, coalesce(p_orders, '[]'), coalesce(p_payments, '[]'),
    coalesce(p_rules, '[]'), coalesce(p_actions, '[]'), p_location,
    p_evidence_hold, CASE WHEN p_evidence_hold THEN p_hold_reason END,
    CASE WHEN p_evidence_hold THEN now() END, CASE WHEN p_evidence_hold THEN p_actor_id END,
    p_recommended_action
  ) RETURNING id INTO v_id;

  INSERT INTO security_incident_events (incident_id, event_id) VALUES (v_id, p_event_id);
  INSERT INTO security_evidence_custody (incident_id, action, actor_id, request_id)
    VALUES (v_id, 'CREATED', p_actor_id, p_request_id);
  IF p_evidence_hold THEN
    INSERT INTO security_evidence_custody (incident_id, action, actor_id, request_id, detail)
      VALUES (v_id, 'HOLD_CREATED', p_actor_id, p_request_id, jsonb_build_object('reason', p_hold_reason));
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION create_security_incident_v2(TEXT,BIGINT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,BOOLEAN,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_security_incident_v2(TEXT,BIGINT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,BOOLEAN,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION update_security_incident_case(
  p_incident_id UUID, p_status TEXT, p_event_id BIGINT,
  p_actor_id TEXT, p_request_id TEXT, p_factual_note TEXT,
  p_actions JSONB DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('INVESTIGATING','CONTAINED','RESOLVED','FALSE_POSITIVE')
     OR length(btrim(coalesce(p_factual_note, ''))) < 3
     OR (p_actions IS NOT NULL AND jsonb_typeof(p_actions) <> 'array') THEN
    RAISE EXCEPTION 'invalid case transition';
  END IF;

  UPDATE security_incidents
     SET status = p_status,
         containment_actions = coalesce(p_actions, containment_actions),
         updated_at = now()
   WHERE id = p_incident_id;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO security_incident_events (incident_id, event_id, factual_note)
    VALUES (p_incident_id, p_event_id, btrim(p_factual_note));
  INSERT INTO security_evidence_custody (incident_id, action, actor_id, request_id, detail)
    VALUES (p_incident_id, 'STATUS_CHANGED', p_actor_id, p_request_id,
      jsonb_build_object('status', p_status, 'factual_note', btrim(p_factual_note)));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION update_security_incident_case(UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_security_incident_case(UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,JSONB) TO service_role;
