-- ============================================================
-- LumeX Fud — Migration 081: lodge blocks (multi-block lodges)
-- ============================================================
-- Many ABSU lodges are split into blocks (Block A, Block B, …) or houses. A bare
-- "Chinaza Lodge" leaves the rider hunting. Admins can now list a lodge's blocks,
-- and checkout turns that list into a DROPDOWN for the customer — they pick their
-- exact block instead of free-typing (or mistyping) it.
--
-- `blocks` is an ordered TEXT[] (e.g. '{"Block A","Block B"}'). Empty = the lodge
-- has no blocks, and checkout falls back to the optional free-text block field.
--
-- Read/written through the service-role API routes (consistent with 051). The
-- routes degrade gracefully if this column is missing, so deploying the code
-- before this runs is safe.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE lodges ADD COLUMN IF NOT EXISTS blocks TEXT[] NOT NULL DEFAULT '{}';
