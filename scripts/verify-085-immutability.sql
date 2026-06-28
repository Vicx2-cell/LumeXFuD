-- Live proof that security_events (migration 085) is append-only and tamper-evident.
-- Run in the Supabase SQL editor (which executes as a privileged role). Each
-- mutation below MUST raise an error; the chain check MUST return zero rows.

-- 1. Seed one row through the normal (trigger-hashed) insert path.
INSERT INTO security_events (event_type, severity, surface, detail)
VALUES ('auth_fail', 'info', 'verify-085', '{"note":"immutability probe"}'::jsonb);

-- 2. UPDATE must RAISE 'security_events is append-only' (even for this role).
DO $$
BEGIN
  UPDATE security_events SET severity = 'critical'
   WHERE surface = 'verify-085';
  RAISE EXCEPTION 'FAIL: UPDATE was allowed — append-only guard is missing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: UPDATE blocked (%).', SQLERRM;
END $$;

-- 3. DELETE must RAISE.
DO $$
BEGIN
  DELETE FROM security_events WHERE surface = 'verify-085';
  RAISE EXCEPTION 'FAIL: DELETE was allowed — append-only guard is missing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: DELETE blocked (%).', SQLERRM;
END $$;

-- 4. TRUNCATE must RAISE.
DO $$
BEGIN
  TRUNCATE security_events;
  RAISE EXCEPTION 'FAIL: TRUNCATE was allowed — append-only guard is missing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: TRUNCATE blocked (%).', SQLERRM;
END $$;

-- 5. Chain integrity — MUST return zero rows.
SELECT * FROM security_events_verify_chain();
