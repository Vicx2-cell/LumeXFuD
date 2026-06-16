-- ============================================================
-- LumeX Fud — Migration 032: wallet_balances (user_id, user_type) UNIQUE
-- ============================================================
-- The live wallet_balances table is missing a unique constraint on
-- (user_id, user_type), so every upsert with
--   .upsert(..., { onConflict: 'user_id,user_type' })
-- fails with "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification". This broke POST /api/wallet/set-pin for
-- every vendor and rider — the route swallowed the error and returned
-- success, so the PIN never saved and users were re-prompted forever.
--
-- Migration 002 declared this as the composite PRIMARY KEY, but the live
-- table predates it (002's CREATE TABLE IF NOT EXISTS was a no-op), and
-- 030's ALTER COLUMN TYPE did not add it. This restores the intended
-- uniqueness — also the only thing preventing duplicate balance rows
-- per user (a serious wallet-integrity risk).
--
-- Verified 0 duplicate (user_id, user_type) rows before creating.
-- Idempotent.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS wallet_balances_user_type_uniq
  ON wallet_balances (user_id, user_type);
