-- ============================================================
-- LumeX Fud — Migration 084: RLS coverage backstop (FORTRESS surface #1)
-- ============================================================
-- THREAT (🔴): the public anon API key ships in the browser JS bundle, so the
-- ONLY wall between that key and every row in the database is Row-Level Security.
-- Server code uses the service role (which bypasses RLS), so RLS coverage is the
-- sole second layer for the direct-to-PostgREST/Realtime path. Coverage today is
-- maintained by hand — every one of 30+ migrations must remember to
-- `ENABLE ROW LEVEL SECURITY` on each new table. A single forgotten line =
-- that table is silently world-readable (and possibly writable) to anyone who
-- extracts the anon key. There was no central assertion, no test, no alert.
--
-- FIX (🔵): self-healing backstop. This migration:
--   1. Loops EVERY base table in `public` and enables RLS on any that lack it.
--      (On today's schema every table already has RLS, so this is a no-op now;
--      its job is forward protection for tables added later.)
--   2. Ships `public.rls_coverage_gaps()` — the authoritative, catalog-derived
--      list of tables that are NOT RLS-protected. This is what the security
--      probe and the Sentinel cron call so the guarantee can't drift from the 8
--      tables the old probe happened to know about.
--
-- HARDEN (🟣): the coverage function reads the live system catalog (pg_class),
-- so it cannot be faked by an app-layer allowlist going stale — the database
-- reports its own truth. Execute is granted to service_role ONLY and revoked
-- from anon/authenticated, so the anon key cannot use it to enumerate the schema.
--
-- MONEY PATH: untouched. No ledger table, function, balance or constraint is
-- modified. Enabling RLS on a table the service role already reads changes
-- nothing (service_role has BYPASSRLS).
--
-- Idempotent: the loop only enables where missing; CREATE OR REPLACE FUNCTION.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── 1. Self-healing: enable RLS on any public base table that lacks it ────────
-- relkind='r' = ordinary table (skips views, matviews, partitioned parents we
-- don't want to touch blindly, sequences, etc.). We only ever ENABLE — never
-- disable — so this can never weaken an existing posture.
DO $$
DECLARE
  rec RECORD;
  healed INT := 0;
BEGIN
  FOR rec IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.relname);
    healed := healed + 1;
    RAISE NOTICE '[084] enabled RLS on previously-unprotected table: %', rec.relname;
  END LOOP;
  RAISE NOTICE '[084] RLS backstop complete — % table(s) healed.', healed;
END $$;

-- ─── 2. Authoritative coverage function ───────────────────────────────────────
-- Returns one row per public base table that is NOT RLS-protected. An empty
-- result = full coverage. SECURITY DEFINER so it can read the catalog regardless
-- of caller; STABLE because it only reads catalog state.
CREATE OR REPLACE FUNCTION public.rls_coverage_gaps()
RETURNS TABLE (table_name TEXT, has_rls BOOLEAN, policy_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    c.relname::TEXT AS table_name,
    c.relrowsecurity AS has_rls,
    (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false   -- only the gaps; '' = healthy
  ORDER BY c.relname;
$$;

-- Keep the schema map server-side only: the anon key must NOT be able to call
-- this and learn every table name. Service role (all server code) only.
REVOKE ALL ON FUNCTION public.rls_coverage_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_coverage_gaps() TO service_role;

-- ─── Verify after running (must return ZERO rows) ─────────────────────────────
--   SELECT * FROM public.rls_coverage_gaps();
-- Any row = a table reachable by the public anon key. Investigate immediately.
