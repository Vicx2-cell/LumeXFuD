-- ============================================================
-- LumeX Fud — Migration 087: refund column relax + subscription idempotency
-- (FORTRESS surface #4 — Paystack webhooks)
-- ============================================================
-- 🔵 1. refunds.amount — VESTIGIAL. Every writer uses amount_kobo (kobo is the
--       platform money rule); `amount` was a NOT NULL legacy column from the
--       original schema bootstrap that NO code populates. It made the first real
--       refund insert fail (NOT NULL violation) and the refund.processed read of
--       it render NaN. Relax the NOT NULL so the amount_kobo-only inserts succeed.
--       The column is NOT dropped here — drop is deferred until the amount_kobo
--       read-fix is deployed and confirmed unread in prod (logged future item).
--
-- 🔵 2. vendor_subscriptions idempotency — the webhook subscription handler did an
--       UNGUARDED insert + revenue booking, with only the route-level dedup as a
--       guard (which was fail-open). This UNIQUE on paystack_reference is the DB
--       backstop so a reprocessed SUBSCRIPTION charge can never double-book a
--       subscription period or platform revenue. NULL references stay unconstrained.
--
-- MONEY SAFETY: relaxing a NOT NULL and adding a UNIQUE only make writes stricter
-- or more permissive on a vestigial column — no balance is touched. Apply-safe:
-- the unique index WARNs (not aborts) if legacy duplicates exist.
-- Idempotent.
-- ============================================================

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── 1. Relax the vestigial refunds.amount NOT NULL ──────────────────────────
ALTER TABLE refunds ALTER COLUMN amount DROP NOT NULL;

-- ─── 2. vendor_subscriptions idempotency on paystack_reference ────────────────
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_subscriptions_ref
    ON vendor_subscriptions (paystack_reference) WHERE paystack_reference IS NOT NULL;
  RAISE NOTICE '[087] vendor_subscriptions(paystack_reference) idempotency index ready.';
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING '[087] vendor_subscriptions has DUPLICATE paystack_reference rows — '
    'idempotency index NOT created. Dedupe, then re-run 087.';
END $$;
