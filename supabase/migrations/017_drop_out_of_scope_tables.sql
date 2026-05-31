-- ============================================================
-- LumeX Fud — Migration 017: Drop out-of-scope tables (DOWN)
-- ============================================================
-- Removes systems cut from the MVP (see CLAUDE.md "LEGACY NOTES"):
--   • in-app order messaging
--   • vendor/rider ratings
--   • gamification: XP, badges
--
-- DROP ... CASCADE also removes each table's RLS policies, indexes,
-- triggers, and foreign-key references automatically — no need to
-- drop those individually.
--
-- ⚠ DESTRUCTIVE: this deletes data. Confirmed out of MVP scope.
-- ============================================================

DROP TABLE IF EXISTS order_messages   CASCADE;
DROP TABLE IF EXISTS ratings          CASCADE;
DROP TABLE IF EXISTS customer_xp       CASCADE;
DROP TABLE IF EXISTS customer_badges   CASCADE;
DROP TABLE IF EXISTS badges            CASCADE;

-- Belt-and-braces: drop the gamification leaderboard index in case it
-- outlived its table on an older deployment. (CASCADE above normally
-- handles it.)
DROP INDEX IF EXISTS idx_customer_xp_weekly_leaderboard;
