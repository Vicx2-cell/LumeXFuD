# Reconciliation Runbook

## Scope

Reconcile:

- Paystack charges
- DVA receipts
- wallet top-ups
- refunds
- transfer reversals
- payout attempts
- order payment state

## Routine checks

1. Compare `processed_webhooks` against Paystack event delivery history.
2. Compare verified transactions against `payments` and order payment state.
3. Compare `virtual_account_receipts` against confirmed deposits.
4. Compare refunds and transfer failures against provider status.
5. Review any rows with ambiguous or missing mapping.

## Escalation

- Quarantine ambiguous transactions instead of guessing ownership.
- Record the reconciliation gap in an audit note.
- Use a compensating journal or repair action only when the evidence is sufficient.

## Current repo status

- The repository has some reconciliation-oriented code paths, but no unified payments reconciliation job yet.
