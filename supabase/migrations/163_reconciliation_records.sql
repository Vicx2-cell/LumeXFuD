-- Persistent reconciliation runs and discrepancy records for payments.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_reference TEXT NOT NULL UNIQUE,
  run_type TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  source_reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'SHORTFALL', 'FAILED')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reconciliation_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id UUID NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  internal_reference TEXT NOT NULL,
  provider_reference TEXT,
  expected_amount_kobo BIGINT NOT NULL,
  actual_amount_kobo BIGINT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'NGN'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'REPAIRED', 'DISMISSED')),
  investigation_notes TEXT,
  repair_journal_id UUID REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  resolver TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_type_idx
  ON public.reconciliation_runs (run_type, environment, created_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_discrepancies_run_idx
  ON public.reconciliation_discrepancies (reconciliation_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_discrepancies_status_idx
  ON public.reconciliation_discrepancies (status, severity, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_reconciliation_run_misupdates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliation runs are immutable';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.run_reference <> OLD.run_reference
    OR NEW.run_type <> OLD.run_type
    OR NEW.environment <> OLD.environment
    OR COALESCE(NEW.source_reference, '') <> COALESCE(OLD.source_reference, '')
    OR COALESCE(NEW.created_by, '') <> COALESCE(OLD.created_by, '')
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'reconciliation run identity is immutable';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_reconciliation_discrepancy_misupdates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliation discrepancies are immutable';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.reconciliation_run_id <> OLD.reconciliation_run_id
    OR NEW.entity_type <> OLD.entity_type
    OR NEW.internal_reference <> OLD.internal_reference
    OR COALESCE(NEW.provider_reference, '') <> COALESCE(OLD.provider_reference, '')
    OR NEW.expected_amount_kobo <> OLD.expected_amount_kobo
    OR NEW.actual_amount_kobo <> OLD.actual_amount_kobo
    OR NEW.currency <> OLD.currency
    OR NEW.environment <> OLD.environment
    OR NEW.severity <> OLD.severity
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'reconciliation discrepancy identity is immutable';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconciliation_runs_immutable ON public.reconciliation_runs;
CREATE TRIGGER trg_reconciliation_runs_immutable
BEFORE UPDATE OR DELETE ON public.reconciliation_runs
FOR EACH ROW EXECUTE FUNCTION public.prevent_reconciliation_run_misupdates();

DROP TRIGGER IF EXISTS trg_reconciliation_discrepancies_immutable ON public.reconciliation_discrepancies;
CREATE TRIGGER trg_reconciliation_discrepancies_immutable
BEFORE UPDATE OR DELETE ON public.reconciliation_discrepancies
FOR EACH ROW EXECUTE FUNCTION public.prevent_reconciliation_discrepancy_misupdates();

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_discrepancies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reconciliation_runs, public.reconciliation_discrepancies FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_runs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_discrepancies TO service_role;

DROP POLICY IF EXISTS reconciliation_runs_service_role_all ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_service_role_all ON public.reconciliation_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reconciliation_discrepancies_service_role_all ON public.reconciliation_discrepancies;
CREATE POLICY reconciliation_discrepancies_service_role_all ON public.reconciliation_discrepancies
  FOR ALL TO service_role USING (true) WITH CHECK (true);

