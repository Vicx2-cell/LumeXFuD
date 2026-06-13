-- ============================================================
-- LumeX — Migration 041: catalog verification status model
-- ============================================================
-- Evolves the study catalog tables (040) from a naked `verified BOOLEAN` +
-- `confidence TEXT` to the two-engine verification model:
--
--   status: national_verified | corroborated | draft | absu_verified
--     • AI may set national_verified / corroborated / draft.
--     • ONLY a human (the in-app student/course-rep gate) sets absu_verified.
--   confidence: NUMERIC 0–1   (AI raises confidence; humans grant truth)
--   last_checked: TIMESTAMPTZ (when the row was last checked against its source)
--
-- INTEGRITY RULE, enforced in the DB: `verified` becomes a GENERATED column
-- (verified = status = 'absu_verified'). No writer can set verified=true except
-- by setting status to absu_verified — the rule can't be bypassed in code.
--
-- ⚠️  NEEDS HUMAN APPROVAL — LOCKED LANE (database migration). Review, then run
--     in the Supabase SQL editor. Safe + idempotent: additive ALTERs guarded by
--     information_schema; the only DROP is the plain `verified` column, which is
--     immediately re-added as a generated column (no data loss — these catalog
--     tables are unpopulated until the gated ingestion runs).
--
-- Applies to study_faculties, study_programmes, study_catalog_courses.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY['study_faculties', 'study_programmes', 'study_catalog_courses'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- 1) status column + check (default draft).
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT %L', t, 'draft');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_status_check');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (status IN (''national_verified'',''corroborated'',''draft'',''absu_verified''))',
      t, t || '_status_check'
    );

    -- 2) last_checked.
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS last_checked TIMESTAMPTZ', t);

    -- 3) Backfill status from the old boolean while it is still a plain column
    --    (true → absu_verified). No-op on empty tables.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'verified' AND is_generated = 'NEVER'
    ) THEN
      EXECUTE format('UPDATE %I SET status = ''absu_verified'' WHERE verified = TRUE AND status = ''draft''', t);
    END IF;

    -- 4) confidence: TEXT (low/medium/high) → NUMERIC 0–1. Guarded so it runs once.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'confidence' AND data_type = 'text'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN confidence DROP DEFAULT', t);
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_confidence_check');
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN confidence TYPE NUMERIC USING (CASE confidence WHEN ''low'' THEN 0.45 WHEN ''high'' THEN 0.9 ELSE 0.7 END)',
        t
      );
      EXECUTE format('ALTER TABLE %I ALTER COLUMN confidence SET DEFAULT 0.5', t);
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (confidence >= 0 AND confidence <= 1)', t, t || '_confidence_check');
    END IF;

    -- 5) verified → GENERATED column (status = 'absu_verified'). Drop the plain
    --    boolean (safe: unpopulated, and status already backfilled in step 3).
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'verified' AND is_generated = 'NEVER'
    ) THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN verified', t);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'verified'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN verified BOOLEAN GENERATED ALWAYS AS (status = ''absu_verified'') STORED',
        t
      );
    END IF;

    -- Index the review queue: rows still needing a human (everything not absu_verified).
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (status)', 'idx_' || t || '_status', t);
  END LOOP;
END $$;
