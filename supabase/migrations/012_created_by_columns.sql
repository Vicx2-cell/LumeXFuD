-- Migration 012: Add creator tracking columns
-- vendors.created_by, riders.added_by, admins.added_by
-- These are referenced in the admin account creation API routes.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS added_by UUID;

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS added_by UUID;

CREATE INDEX IF NOT EXISTS idx_vendors_created_by ON vendors(created_by);
