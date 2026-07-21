-- Security cases, event timelines, evidence holds, and append-only custody.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS security_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  classification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATING','CONTAINED','RESOLVED','FALSE_POSITIVE')),
  account_id TEXT,
  account_role TEXT,
  primary_event_id BIGINT NOT NULL REFERENCES security_events(id),
  affected_orders JSONB NOT NULL DEFAULT '[]',
  affected_payments JSONB NOT NULL DEFAULT '[]',
  triggered_rules JSONB NOT NULL DEFAULT '[]',
  containment_actions JSONB NOT NULL DEFAULT '[]',
  approximate_location JSONB,
  location_accuracy_warning TEXT NOT NULL DEFAULT 'Approximate network/location indicators are not proof of identity or presence.',
  recommended_action TEXT,
  evidence_hold BOOLEAN NOT NULL DEFAULT false,
  evidence_hold_reason TEXT,
  evidence_held_at TIMESTAMPTZ,
  evidence_held_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_incident_events (
  incident_id UUID NOT NULL REFERENCES security_incidents(id),
  event_id BIGINT NOT NULL REFERENCES security_events(id),
  factual_note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, event_id)
);

CREATE TABLE IF NOT EXISTS security_evidence_custody (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES security_incidents(id),
  action TEXT NOT NULL CHECK (action IN ('CREATED','VIEWED','HOLD_CREATED','EXPORTED')),
  actor_id TEXT NOT NULL,
  request_id TEXT,
  export_hash TEXT,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_incidents_status ON security_incidents(status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_incident_account ON security_incidents(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_custody_incident ON security_evidence_custody(incident_id, created_at DESC);

ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_evidence_custody ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON security_incidents, security_incident_events, security_evidence_custody FROM anon, authenticated;

CREATE OR REPLACE FUNCTION security_custody_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security evidence custody is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS trg_security_custody_no_mutate ON security_evidence_custody;
CREATE TRIGGER trg_security_custody_no_mutate BEFORE UPDATE OR DELETE ON security_evidence_custody
FOR EACH ROW EXECUTE FUNCTION security_custody_block_mutation();

DROP TRIGGER IF EXISTS trg_security_custody_no_truncate ON security_evidence_custody;
CREATE TRIGGER trg_security_custody_no_truncate BEFORE TRUNCATE ON security_evidence_custody
FOR EACH STATEMENT EXECUTE FUNCTION security_custody_block_mutation();

DROP TRIGGER IF EXISTS trg_security_incident_events_no_mutate ON security_incident_events;
CREATE TRIGGER trg_security_incident_events_no_mutate BEFORE UPDATE OR DELETE ON security_incident_events
FOR EACH ROW EXECUTE FUNCTION security_custody_block_mutation();

DROP TRIGGER IF EXISTS trg_security_incident_events_no_truncate ON security_incident_events;
CREATE TRIGGER trg_security_incident_events_no_truncate BEFORE TRUNCATE ON security_incident_events
FOR EACH STATEMENT EXECUTE FUNCTION security_custody_block_mutation();

CREATE OR REPLACE FUNCTION create_security_incident(
  p_incident_id TEXT, p_event_id BIGINT, p_actor_id TEXT,
  p_severity TEXT, p_confidence NUMERIC, p_classification TEXT,
  p_account_id TEXT, p_account_role TEXT, p_rules JSONB, p_actions JSONB,
  p_evidence_hold BOOLEAN, p_hold_reason TEXT, p_recommended_action TEXT,
  p_request_id TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO security_incidents (
    incident_id, primary_event_id, severity, confidence, classification,
    account_id, account_role, triggered_rules, containment_actions,
    evidence_hold, evidence_hold_reason, evidence_held_at, evidence_held_by,
    recommended_action
  ) VALUES (
    p_incident_id, p_event_id, p_severity, p_confidence, p_classification,
    p_account_id, p_account_role, coalesce(p_rules, '[]'), coalesce(p_actions, '[]'),
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

REVOKE ALL ON FUNCTION create_security_incident(TEXT,BIGINT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,JSONB,JSONB,BOOLEAN,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_security_incident(TEXT,BIGINT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,JSONB,JSONB,BOOLEAN,TEXT,TEXT,TEXT) TO service_role;
