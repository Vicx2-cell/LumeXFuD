# Payments Target Architecture

This repository should converge on a two-rail payments model.

## Rail A: LumeX Balance funded through Paystack DVA

- A registered customer receives a Paystack Dedicated Virtual Account.
- Incoming deposits credit internal LumeX Balance only after:
  - raw-body signature verification
  - event-type validation
  - server-to-server transaction verification
  - amount/currency/customer validation
  - dedupe against prior credits
  - balanced ledger posting in a database transaction
- Wallet-funded orders must not use Paystack split logic at checkout.
- Vendor and rider settlement happens through internal payables and controlled payout rails.

## Rail B: Direct Paystack checkout

- Checkout is initialized server-side only.
- Amounts and allocation are computed on the server.
- Transaction split or subaccount logic is used only where supported and configured.
- Webhooks and transaction verification finalize payment exactly once.
- The client only receives safe checkout data.

## Core accounting principles

- Use append-only double-entry ledger records as the source of truth.
- Do not rely on a mutable wallet balance as the financial source of truth.
- Use integer kobo only.
- Enforce idempotency and immutability at the database layer where feasible.
- Keep order financial snapshots immutable after checkout creation.
- Separate customer available/reserved balances from payout-clearing and payable accounts.

## Operational requirements

- One canonical Paystack webhook endpoint.
- One safe DVA provisioning flow.
- One controlled payout/settlement system.
- Reconciliation for deposits, orders, payouts, refunds and transfer reversals.
- Strict RLS and server-only privileged access.
- Additive migrations only, with explicit rollback notes and no historical money rewrite.
