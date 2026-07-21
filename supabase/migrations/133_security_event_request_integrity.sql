-- Bind request metadata and every incident indicator into the event hash.
-- Existing migration-085 rows retain v1 verification; new rows use v2.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE security_events
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS resource_type TEXT,
  ADD COLUMN IF NOT EXISTS resource_id TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS integrity_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_security_events_request
  ON security_events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_events_correlation
  ON security_events(correlation_id, created_at DESC) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_events_resource
  ON security_events(resource_type, resource_id, created_at DESC) WHERE resource_id IS NOT NULL;

CREATE OR REPLACE FUNCTION security_events_integrity_payload(p security_events)
RETURNS JSONB
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'actor_id', p.actor_id,
    'actor_role', p.actor_role,
    'session_id', p.session_id,
    'ip', p.ip,
    'user_agent', p.user_agent,
    'request_id', p.request_id,
    'correlation_id', p.correlation_id,
    'route', p.route,
    'method', p.method,
    'resource_type', p.resource_type,
    'resource_id', p.resource_id,
    'outcome', p.outcome
  );
$$;

CREATE OR REPLACE FUNCTION security_events_canonical_v2(
  p_prev TEXT, p_created TIMESTAMPTZ, p_event TEXT, p_sev TEXT,
  p_surface TEXT, p_detail JSONB, p_integrity JSONB
) RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    coalesce(p_prev,'')
    || '|' || to_char(p_created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || '|v2|' || p_event
    || '|' || p_sev
    || '|' || p_surface
    || '|' || coalesce(p_detail::text, '{}')
    || '|' || coalesce(p_integrity::text, '{}');
$$;

CREATE OR REPLACE FUNCTION security_events_chain_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(4242424242);
  NEW.created_at := coalesce(NEW.created_at, now());
  SELECT row_hash INTO NEW.prev_hash
    FROM security_events ORDER BY id DESC LIMIT 1;
  NEW.integrity_payload := security_events_integrity_payload(NEW);
  NEW.row_hash := encode(sha256(convert_to(security_events_canonical_v2(
    NEW.prev_hash, NEW.created_at, NEW.event_type, NEW.severity,
    NEW.surface, NEW.detail, NEW.integrity_payload
  ), 'UTF8')), 'hex');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION security_events_verify_chain()
RETURNS TABLE (broken_id BIGINT, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  r security_events%ROWTYPE;
  expected_prev TEXT := NULL;
  recomputed TEXT;
  expected_integrity JSONB;
BEGIN
  FOR r IN SELECT * FROM security_events ORDER BY id ASC LOOP
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN
      broken_id := r.id; reason := 'prev_hash mismatch (row deleted or reordered)'; RETURN NEXT; RETURN;
    END IF;
    IF r.integrity_payload IS NULL THEN
      recomputed := encode(sha256(convert_to(security_events_canonical(
        r.prev_hash, r.created_at, r.event_type, r.severity,
        r.actor_id, r.actor_role, r.surface, r.detail), 'UTF8')), 'hex');
    ELSE
      expected_integrity := security_events_integrity_payload(r);
      IF r.integrity_payload IS DISTINCT FROM expected_integrity THEN
        broken_id := r.id; reason := 'integrity payload mismatch (request or actor metadata tampered)'; RETURN NEXT; RETURN;
      END IF;
      recomputed := encode(sha256(convert_to(security_events_canonical_v2(
        r.prev_hash, r.created_at, r.event_type, r.severity,
        r.surface, r.detail, r.integrity_payload), 'UTF8')), 'hex');
    END IF;
    IF recomputed IS DISTINCT FROM r.row_hash THEN
      broken_id := r.id; reason := 'row_hash mismatch (row content tampered)'; RETURN NEXT; RETURN;
    END IF;
    expected_prev := r.row_hash;
  END LOOP;
  RETURN;
END $$;

REVOKE ALL ON FUNCTION security_events_integrity_payload(security_events) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_events_canonical_v2(TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_events_verify_chain() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security_events_verify_chain() TO service_role;
