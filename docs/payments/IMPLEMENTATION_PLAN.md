# Payments Implementation Plan

## Phase 0: Repository audit and durable state

- Document the current payment state.
- Map existing Paystack, wallet, webhook, payout and refund paths.
- Identify schema, RLS and environment gaps.
- Keep `PROGRESS.md` current as the loop memory.

## Phase 1: Ledger foundation

- Add financial accounts, journals and entries.
- Implement atomic posting and balance reservation.
- Add idempotency and immutability constraints.
- Add focused ledger tests.

## Phase 2: DVA funding

- Add or verify customer Paystack mapping.
- Enable safe DVA provisioning.
- Handle deposit webhooks and server-side verification.
- Add replay and signature tests.

## Phase 3: Wallet-funded checkout

- Persist immutable financial snapshots.
- Reserve internal balance atomically.
- Finalize or release on cancel/delivery.
- Add overspend and duplicate-finalization tests.

## Phase 4: Direct Paystack checkout and split

- Keep all amount and allocation calculation on the server.
- Make payment intent and callback processing authoritative.
- Finalize exactly once from webhook and verification.

## Phase 5: Vendor and rider payouts

- Add payment profiles and payout records.
- Use controlled transfer initiation and reconciliation.
- Add failure and reversal recovery plus admin controls.

## Phase 6: Refunds, disputes and reconciliation

- Implement wallet and direct-Paystack refunds.
- Add reconciliation jobs and discrepancy review.

## Phase 7: Production hardening

- Run targeted tests, typecheck, lint and build.
- Add runbooks and launch checklist docs.
- Verify environment separation and live low-value tests.
