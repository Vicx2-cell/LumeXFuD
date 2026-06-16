-- ============================================================
-- LumeX Fud — Migration 033: wallet_transactions.order_id -> TEXT
-- ============================================================
-- credit_wallet_held / release_held_batch declare p_order_id / store order_id
-- as TEXT (migration 002 and docs/wallet.md both define order_id TEXT), but the
-- live wallet_transactions.order_id column is UUID. Every credit therefore fails
-- inside the RPC with:
--   "column order_id is of type uuid but expression is of type text"
-- so completeOrderPayout's credit throws and unwinds wallet_released to false —
-- vendor/rider earnings are never credited (e.g. order LXF-2026-000009).
--
-- This is the sibling of migration 030 (which fixed user_id UUID->TEXT but not
-- order_id). order_id is stored as the order's id string and is also used for a
-- rider-id placeholder on milestone bonuses, so TEXT is the correct type.
--
-- A foreign key (wallet_transactions_order_id_fkey -> orders.id UUID) blocks the
-- type change and must be dropped first. Dropping it is correct, not a
-- compromise: the code stores a rider-id PLACEHOLDER in order_id for milestone
-- bonuses (release-payments awardMilestoneBonus passes orderId: riderId), so
-- order_id is polymorphic and a FK to orders would itself reject those rows.
-- We do NOT re-add the FK (TEXT order_id cannot reference UUID orders.id).
--
-- No RLS policy references order_id, so no policy drop/recreate is needed.
-- The idx_wallet_tx_order_id index is rebuilt automatically by the type change.
-- Idempotent: altering an already-TEXT column to TEXT is a no-op.
-- ============================================================

ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_order_id_fkey;

ALTER TABLE wallet_transactions
  ALTER COLUMN order_id TYPE TEXT USING order_id::text;
