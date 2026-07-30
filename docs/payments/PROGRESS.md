# Payments Progress

## Global objective

Bring the LumeX Fud payments stack to production launch readiness for:

- verified customer deposits through Paystack DVA
- closed-loop LumeX Balance spending
- direct Paystack checkout
- vendor and rider settlement
- refunds and reconciliation

## Current phase

Phase 1 - Foundational financial primitives

## Current bounded task

Land the double-entry ledger, immutable order financial snapshots, and wallet reservation state machine, then continue into the remaining payments flow.

## Completed requirements

- Read the launch loop attachment from top to bottom.
- Verified the existing durable payments docs already present in `docs/payments/`.
- Audited the migration history, current payment routes, webhook handling, wallet code, refund code, and DVA code paths.
- Verified `.env.local` is ignored by Git.
- Ran a committed-secret scan without exposing secret values.
- Confirmed the repo already has:
  - customer wallet flows
  - Paystack webhook handling
  - refund handling
  - customer virtual-account provisioning
  - promo-fund ledger records
  - webhook dedupe storage
- Hardened the customer virtual-account route so it returns only the safe customer-facing subset of fields.
- Added the payments ledger foundation migration with:
  - double-entry financial accounts
  - immutable ledger journals and entries
  - immutable order financial snapshots
  - wallet reservation state machine
  - trusted posting / balance RPCs
- Wired verified DVA deposits into the new ledger with idempotent credit posting.
- Wired checkout, delivery completion, pickup collection, cancellation, webhook split settlement, and dispute refund paths toward the reservation-backed wallet flow.
- Added focused tests for the ledger foundation and DVA deposit linkage.

## Incomplete requirements

- Direct Paystack checkout, payout batches, refunds, reconciliation, and admin hardening still need completion.
- Vendor and rider payable / payout flows still need a full ledger-backed rollout.
- Reconciliation and operational runbooks still need the remaining launch work.

## Files changed

- `docs/payments/CURRENT_STATE.md`
- `docs/payments/TARGET_ARCHITECTURE.md`
- `docs/payments/IMPLEMENTATION_PLAN.md`
- `docs/payments/PROGRESS.md`
- `docs/payments/THREAT_MODEL.md`
- `docs/payments/SCHEMA_INVENTORY.md`
- `docs/payments/MONEY_FLOW.md`
- `docs/payments/PAYSTACK_CONFIGURATION.md`
- `docs/payments/RECONCILIATION_RUNBOOK.md`
- `docs/payments/PAYOUT_RUNBOOK.md`
- `docs/payments/REFUND_RUNBOOK.md`
- `docs/payments/INCIDENT_RESPONSE.md`
- `docs/payments/LAUNCH_CHECKLIST.md`
- `docs/payments/ROLLBACK_PLAN.md`
- `docs/payments/FINAL_AUDIT.md`
- `app/api/customer/virtual-account/route.ts`
- `app/api/customer/virtual-account/route.test.ts`
- `supabase/migrations/158_payments_ledger_foundation.sql`
- `lib/wallet-reservations.ts`
- `lib/paystack/webhook.ts`
- `app/api/orders/route.ts`
- `app/api/orders/[id]/deliver/route.ts`
- `app/api/orders/[id]/collect/route.ts`
- `app/api/orders/[id]/status/route.ts`
- `app/api/orders/[id]/cancel/route.ts`
- `test/payments-ledger-db.test.ts`
- `test/paystack-dva-deposit.test.ts`

## Migrations added

- `supabase/migrations/158_payments_ledger_foundation.sql`

## Tests run

- `git check-ignore .env.local`
- `git status --short`
- `git log --all -- .env.local`
- `git grep -n "sk_live_"`
- `git grep -n "service_role"`
- `npm.cmd exec vitest run app/api/customer/virtual-account/route.test.ts`
- `npm.cmd exec eslint app/api/customer/virtual-account/route.ts app/api/customer/virtual-account/route.test.ts`
- `npm.cmd exec tsc -- --noEmit`
- `npm.cmd exec vitest run test/payments-ledger-db.test.ts test/paystack-dva-deposit.test.ts`
- `npm.cmd exec tsc -- --noEmit`

## Test results

- `.env.local` is ignored by Git.
- No secret values were printed during the scan.
- `git grep` found documentation and code references to secret-related terms, but not committed secret values in the output reviewed here.
- The DVA route test passes with the safe-response assertion in place.
- TypeScript compile check passes after the test typing cleanup.
- The payments ledger foundation test passes.
- The DVA deposit ledger linkage test passes.

## Current failures

- The remaining launch work is direct Paystack checkout, payout batching, refunds, reconciliation, and admin hardening.
- Vendor and rider payout flows still need to be completed on the new ledger.

## External blockers

- None confirmed yet.

## Security findings

- The repository already avoids exposing raw secret values in the current scan output.
- Live/test Paystack separation still needs explicit validation against the live environment before launch.

## Assumptions

- Existing wallet and refund code remains the current production behavior until the new ledger is introduced.
- The repo will keep additive migrations and avoid destructive history changes.

## Next task

- Implement the direct Paystack checkout and callback hardening on top of the new ledger and reservation primitives.
- Continue into vendor and rider payables, payout batching, refunds, reconciliation, and admin controls.

## Latest commit

- `c670ed4` - `payments: harden DVA response and document state`

## Global stop-condition status

- Not satisfied.
