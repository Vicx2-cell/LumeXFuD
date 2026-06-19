-- ============================================================
-- LumeX Fud — Migration 059: Vendor & rider opening / closing time
-- ============================================================
-- Lets a vendor (shop) and a rider record the hours they normally operate, so
-- customers know when to expect them. Stored as plain "HH:MM" 24-hour strings in
-- Africa/Lagos local time; NULL means "not set" (no change in behaviour).
--
-- These are DISPLAY/INFORMATIONAL fields only — they do NOT auto open/close the
-- shop or block orders. The vendor OPEN/BUSY/CLOSED status and the platform-wide
-- hours window (settings table) remain the source of truth for order gating.
-- Keeping this purely additive means nothing breaks if the app ships before the
-- migration runs (the columns are simply absent and the UI shows blanks).
--
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_time TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS closing_time TEXT;

ALTER TABLE riders ADD COLUMN IF NOT EXISTS opening_time TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS closing_time TEXT;

-- Defensive format guard: only accept "HH:MM" (00:00–23:59) or NULL. Written by
-- the API after Zod validation, but the DB constraint keeps junk out regardless.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_opening_time_fmt') THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_opening_time_fmt
      CHECK (opening_time IS NULL OR opening_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_closing_time_fmt') THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_closing_time_fmt
      CHECK (closing_time IS NULL OR closing_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'riders_opening_time_fmt') THEN
    ALTER TABLE riders ADD CONSTRAINT riders_opening_time_fmt
      CHECK (opening_time IS NULL OR opening_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'riders_closing_time_fmt') THEN
    ALTER TABLE riders ADD CONSTRAINT riders_closing_time_fmt
      CHECK (closing_time IS NULL OR closing_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;
