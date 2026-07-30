# Payments Money Flow

Last updated: 2026-07-30

## Direct Paystack checkout

1. The server calculates the payable amount from the order snapshot.
2. The browser receives only safe checkout metadata.
3. Paystack confirms the charge through webhook and server-side verification.
4. The order transitions to paid once the server verifies the event.
5. Vendor and rider obligations are created from server-side order data.

## Customer wallet top-up

1. The customer initializes a top-up on the server.
2. Paystack collects the funds.
3. The webhook verifies the charge server-side.
4. The wallet receives credit through the existing wallet RPC flow.
5. A corresponding transaction row is stored for auditability.

## Customer virtual-account deposit

1. A registered customer requests a DVA.
2. The server provisions or reuses the mapped Paystack customer and account.
3. Incoming transfers are recorded as receipts after verification.
4. The current code persists receipts for reconciliation.
5. The launch spec still requires the next step: convert verified deposits into the new closed-loop balance ledger.

## Wallet-funded checkout

1. The server should reserve available balance atomically.
2. The reservation should hold spendable value until completion or release.
3. Order completion should consume the reservation once.
4. Vendor and rider payables should be created from frozen financial snapshots.

## Refunds

1. The server reserves or creates a refund record.
2. Paystack refund initiation is triggered from the server.
3. The webhook marks the refund completed or failed.
4. The order and ledger state are updated exactly once.

## Payouts

1. Payables are collected from completed orders.
2. A payout batch or transfer is initiated from server-side data.
3. Paystack transfer events confirm success or failure asynchronously.
4. Reversals restore eligibility through compensating entries.
