-- ============================================================
-- LumeX Fud — Migration 085: security_events spine (FORTRESS DETECT backbone)
-- ============================================================
-- The hash-chained, APPEND-ONLY event log that every defensive layer writes to.
-- Built during surface #2 (JWT auth) because it is the first surface that emits
-- events; later surfaces reuse it.
--
-- HARDEN (🟣): each row's `row_hash` = sha256(prev_hash || canonical fields), so
-- the log is a tamper-evident chain. UPDATE / DELETE / TRUNCATE all RAISE — and
-- the guard has NO role check, so it blocks the `service_role` too (an attacker
-- who steals the service key still cannot quietly rewrite history; a broken chain
-- is itself a detectable, SEV1 event via security_events_verify_chain()).
--
-- MONEY PATH: untouched. New table only; no ledger/balance/constraint changes.
-- Idempotent: IF NOT EXISTS + CREATE OR REPLACE; safe to re-run.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    TEXT,
  actor_role  TEXT,
  session_id  TEXT,
  ip          TEXT,
  user_agent  TEXT,
  event_type  TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
  surface     TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   TEXT,
  row_hash    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_created  ON security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type     ON security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_actor    ON security_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_ip       ON security_events(ip, created_at DESC);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
-- Deny anon/authenticated entirely (service role bypasses RLS and is the only
-- writer). Belt-and-suspenders: also drop default table privileges.
REVOKE ALL ON TABLE security_events FROM anon, authenticated;
DROP POLICY IF EXISTS "svc security_events" ON security_events;
CREATE POLICY "svc security_events" ON security_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─── Canonical fields → deterministic string for hashing ──────────────────────
CREATE OR REPLACE FUNCTION security_events_canonical(
  p_prev TEXT, p_created TIMESTAMPTZ, p_event TEXT, p_sev TEXT,
  p_actor TEXT, p_role TEXT, p_surface TEXT, p_detail JSONB
) RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    coalesce(p_prev,'')
    || '|' || to_char(p_created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || '|' || p_event
    || '|' || p_sev
    || '|' || coalesce(p_actor,'')
    || '|' || coalesce(p_role,'')
    || '|' || p_surface
    || '|' || coalesce(p_detail::text, '{}');
$$;

-- ─── BEFORE INSERT: link + hash this row to the chain head ────────────────────
CREATE OR REPLACE FUNCTION security_events_chain_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_canon TEXT;
BEGIN
  -- Serialize concurrent appends so two inserts can't read the same chain head
  -- and fork the chain. Transaction-scoped advisory lock, constant key.
  PERFORM pg_advisory_xact_lock(4242424242);

  NEW.created_at := coalesce(NEW.created_at, now());
  SELECT row_hash INTO NEW.prev_hash
    FROM security_events ORDER BY id DESC LIMIT 1;  -- NULL for the first row

  v_canon := security_events_canonical(
    NEW.prev_hash, NEW.created_at, NEW.event_type, NEW.severity,
    NEW.actor_id, NEW.actor_role, NEW.surface, NEW.detail
  );
  NEW.row_hash := encode(sha256(convert_to(v_canon, 'UTF8')), 'hex');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_security_events_chain ON security_events;
CREATE TRIGGER trg_security_events_chain
  BEFORE INSERT ON security_events
  FOR EACH ROW EXECUTE FUNCTION security_events_chain_link();

-- ─── Append-only guard: block UPDATE / DELETE / TRUNCATE for EVERYONE ─────────
-- No auth.role() check on purpose — this fires for service_role too, so even a
-- stolen service key cannot rewrite or erase the trail without raising an error.
CREATE OR REPLACE FUNCTION security_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'security_events is append-only — % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS trg_security_events_no_mutate ON security_events;
CREATE TRIGGER trg_security_events_no_mutate
  BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION security_events_block_mutation();

DROP TRIGGER IF EXISTS trg_security_events_no_truncate ON security_events;
CREATE TRIGGER trg_security_events_no_truncate
  BEFORE TRUNCATE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION security_events_block_mutation();

-- ─── Chain verifier: returns the first broken link, or zero rows if intact ────
CREATE OR REPLACE FUNCTION security_events_verify_chain()
RETURNS TABLE (broken_id BIGINT, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  r RECORD;
  expected_prev TEXT := NULL;
  recomputed TEXT;
BEGIN
  FOR r IN SELECT * FROM security_events ORDER BY id ASC LOOP
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN
      broken_id := r.id; reason := 'prev_hash mismatch (row deleted or reordered)'; RETURN NEXT; RETURN;
    END IF;
    recomputed := encode(sha256(convert_to(security_events_canonical(
      r.prev_hash, r.created_at, r.event_type, r.severity,
      r.actor_id, r.actor_role, r.surface, r.detail), 'UTF8')), 'hex');
    IF recomputed IS DISTINCT FROM r.row_hash THEN
      broken_id := r.id; reason := 'row_hash mismatch (row content tampered)'; RETURN NEXT; RETURN;
    END IF;
    expected_prev := r.row_hash;
  END LOOP;
  RETURN; -- no rows = intact
END $$;

-- Keep the schema/forensics surface server-side only.
REVOKE ALL ON FUNCTION security_events_verify_chain() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security_events_verify_chain() TO service_role;

-- ─── Verify after running ─────────────────────────────────────────────────────
--   SELECT * FROM security_events_verify_chain();   -- must return ZERO rows
--   -- and prove immutability (both must ERROR, even as service_role):
--   UPDATE security_events SET severity='info' WHERE id = 1;   -- expect: append-only error
--   DELETE FROM security_events WHERE id = 1;                  -- expect: append-only error
