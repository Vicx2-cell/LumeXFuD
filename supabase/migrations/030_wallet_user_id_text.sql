-- ============================================================
-- LumeX Fud — Migration 030: wallet_balances/transactions.user_id -> TEXT
-- ============================================================
-- credit_wallet_held / credit_wallet / debit_wallet_withdrawal all declare
-- p_user_id TEXT, but wallet_balances.user_id (and wallet_transactions.user_id)
-- were UUID. Every credit therefore failed with:
--   "column user_id is of type uuid but expression is of type text"
-- so vendor/rider earnings were NEVER credited (the release-payments cron and
-- order completion both silently failed on this).
--
-- user_id here is POLYMORPHIC — it holds a vendor id OR a rider id depending on
-- user_type — so TEXT is the correct type, and it matches how the app passes
-- session.userId (a string) everywhere. No FK references this column.
--
-- Idempotent: re-running the TEXT->TEXT cast is a no-op.
-- ============================================================

ALTER TABLE wallet_balances     ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE wallet_transactions ALTER COLUMN user_id TYPE TEXT USING user_id::text;
