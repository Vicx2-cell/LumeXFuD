-- ============================================================
-- LumeX Fud — Migration 048: Column-level lockdown on public-read tables
-- ============================================================
-- SECURITY FIX (pentest finding). The public anon API key ships in the client
-- JS bundle, so anything the `anon` role can SELECT is world-readable. RLS is
-- ROW-level only — it cannot hide columns. Two public-read tables leaked
-- sensitive columns to anon:
--
--   • vendors  — FOR SELECT USING (is_active = true …) exposed EVERY column,
--                including bank_account_number, bank_account_name, bank_code,
--                paystack_subaccount_code, owner_name and the login phone
--                (rule #15/#16 violation). An attacker could dump every active
--                vendor's bank details with one anon query.
--   • ratings  — FOR SELECT USING (true) exposed customer_id, de-anonymising
--                the "Anonymous" public reviews (identity was meant to stay
--                server-side only).
--
-- FIX: keep the row policies, but switch anon/authenticated from table-wide
-- SELECT to COLUMN-level SELECT on the safe display columns only. The service
-- role (all server reads) is untouched and keeps full access. Nothing in the
-- app reads these tables from the browser today (only the leaderboard uses the
-- anon client), so this is behaviour-preserving — and any future vendor
-- realtime still works on the safe columns while bank columns stay sealed.
--
-- Idempotent: REVOKE/GRANT are declarative and safe to re-run.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- ─── VENDORS ─────────────────────────────────────────────────────────────────
-- Drop the firehose, grant only safe display/ranking columns.
REVOKE SELECT ON TABLE vendors FROM anon, authenticated;
GRANT SELECT (
  id, shop_name, logo_url, shop_photo_url, prep_time_minutes,
  status, busy_until, paused_until, category, description,
  subscription_tier, subscription_paid_until,
  avg_rating, total_ratings,
  is_active, approved_at, created_at, updated_at, deleted_at
) ON TABLE vendors TO anon, authenticated;
-- DELIBERATELY NOT granted: phone, owner_name, paystack_subaccount_code,
-- bank_code, bank_account_number, bank_account_name, approved_by.

-- ─── RATINGS ─────────────────────────────────────────────────────────────────
-- Public reviews keep showing stars + text + the chosen first name; the
-- reviewer's identity (customer_id) and the order link stay private.
REVOKE SELECT ON TABLE ratings FROM anon, authenticated;
GRANT SELECT (
  id, vendor_id, stars, review, reviewer_name, created_at
) ON TABLE ratings TO anon, authenticated;
-- DELIBERATELY NOT granted: customer_id, order_id.

-- Note: service_role retains full SELECT (granted at project bootstrap; this
-- migration only narrows anon/authenticated). All API routes use the service
-- role, so server behaviour is unchanged.
