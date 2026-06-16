-- ============================================================
-- LumeX Fud — Migration 056: make audit trails APPEND-ONLY
-- ============================================================
-- Rule #28 / security hardening: the audit log must not be writable (mutable or
-- deletable) by the role that triggered the action — and, in fact, by anyone.
--
-- RLS already denies the anon/authenticated client roles (migration 008), and the
-- app only ever talks to the DB via the service role. But the service role (table
-- owner) BYPASSES RLS, so app code — or a compromised admin acting through it —
-- could still UPDATE or DELETE audit history and erase its tracks.
--
-- A trigger fires regardless of role (including the table owner / service role), so
-- a BEFORE UPDATE OR DELETE trigger that raises is the only thing that truly makes
-- these tables append-only. INSERT (writing new entries) stays allowed; history is
-- now immutable. Idempotent.
--
-- Does NOT touch or migrate any existing row.
-- ============================================================

CREATE OR REPLACE FUNCTION forbid_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit logs are append-only: % is not permitted on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs', 'super_audit_logs', 'pin_reset_audit']
  LOOP
    -- Only attach if the table exists in this environment.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_append_only_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation()',
        'trg_append_only_' || t, t
      );
    END IF;
  END LOOP;
END $$;
