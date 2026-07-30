# Refund Runbook

## Scope

This runbook covers:

- wallet refunds
- direct Paystack refunds
- duplicate refund protection

## Current flow

- Refund requests are reserved server-side before external money movement.
- Paystack refund initiation is then triggered.
- The webhook later marks the refund completed or failed.

## Safe steps

1. Verify the original order and refund eligibility.
2. Check cumulative refunded amount against the original charge.
3. Reserve the refund with an idempotency key.
4. Initiate the provider refund from the server.
5. Let the webhook complete the state transition.

## Current gap

- Refund settlement is still tied to the existing wallet and order model rather than the new unified payments ledger.
