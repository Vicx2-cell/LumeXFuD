# Payments Current State

Last updated: 2026-07-30

## What exists now

- Next.js App Router payment flows already exist for:
  - direct Paystack checkout
  - customer wallet top-up
  - customer wallet spend at checkout
  - Paystack webhook handling
  - Paystack refund handling
  - customer virtual-account provisioning
- The code already uses server-side Paystack initialization and a raw-body webhook signature check.
- Customer wallet money movement already uses Postgres RPC helpers in `lib/customer-wallet.ts`.
- Feature flags already gate customer wallet and customer virtual accounts.
- Production Paystack live keys were updated on Vercel earlier in the rollout.
- Live payment feature rows in Supabase were enabled for:
  - `feature.customer_wallet_enabled`
  - `feature.customer_virtual_accounts`
- The DVA route treats `PAYSTACK_DVA_ENABLED=false` as an explicit off-switch; the live feature flag is the main enablement control.
- The webhook route records processed events before delegating to the money handlers.
- The repo already has an append-only promo-fund ledger for promotions, but that is not the general payments ledger required by the launch spec.

## Key audit findings

- `customer_wallet_enabled` exists and gates customer wallet UI and spend paths.
- `customer_virtual_accounts` exists and gates DVA provisioning.
- DVA activation still depends on both the feature flag and `PAYSTACK_DVA_ENABLED=false` not being set.
- The current webhook endpoint verifies HMAC with `PAYSTACK_SECRET_KEY` and stores a dedupe record before processing.
- The repo still relies on the existing wallet model and order payment flow; it does not yet implement the full double-entry ledger architecture from the checklist.
- The schema already contains `processed_webhooks`, `refunds`, `customer_virtual_accounts`, `virtual_account_receipts`, `wallet_balances`, `wallet_transactions`, and customer-wallet tables, but not the launch-required general ledger, financial snapshot, reservation, or payout primitive tables.

## Immediate gaps

- No documented general-ledger foundation yet.
- No immutable order financial snapshot table yet.
- No reservation state machine for wallet-funded checkout yet.
- No complete payouts / reconciliation runbook set existed before this update.
- Full reconciliation and payout hardening from the checklist are not yet implemented.
