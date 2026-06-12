-- ============================================================
-- LumeX Fud — Migration 030: wallet_balances/transactions.user_id -> TEXT
-- ============================================================
-- credit_wallet_held / credit_wallet / debit_wallet_withdrawal all declare
-- p_user_id TEXT, but wallet_balances.user_id (and wallet_transactions.user_id)
-- were UUID. Every credit therefore failed with:
--   "column user_id is of type uuid but expression is of type text"
-- so vendor/rider earnings were NEVER credited.
--
-- user_id here is POLYMORPHIC (vendor id OR rider id, by user_type) so TEXT is
-- the correct type and matches how the app passes session.userId everywhere.
--
-- The column is referenced by RLS policies, so Postgres won't let us alter its
-- type in place — drop the policies, alter, then recreate them verbatim.
-- Idempotent.
-- ============================================================

DROP POLICY IF EXISTS "users see own wallet"              ON wallet_balances;
DROP POLICY IF EXISTS "users see own wallet transactions" ON wallet_transactions;

ALTER TABLE wallet_balances     ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE wallet_transactions ALTER COLUMN user_id TYPE TEXT USING user_id::text;

CREATE POLICY "users see own wallet" ON wallet_balances
  FOR SELECT USING (
    (user_type = 'VENDOR' AND user_id::TEXT IN (
      SELECT id::TEXT FROM vendors WHERE phone = (auth.jwt() ->> 'phone')
    ))
    OR
    (user_type = 'RIDER' AND user_id::TEXT IN (
      SELECT id::TEXT FROM riders WHERE phone = (auth.jwt() ->> 'phone')
    ))
  );

CREATE POLICY "users see own wallet transactions" ON wallet_transactions
  FOR SELECT USING (
    (user_type = 'VENDOR' AND user_id::TEXT IN (
      SELECT id::TEXT FROM vendors WHERE phone = (auth.jwt() ->> 'phone')
    ))
    OR
    (user_type = 'RIDER' AND user_id::TEXT IN (
      SELECT id::TEXT FROM riders WHERE phone = (auth.jwt() ->> 'phone')
    ))
  );
