# Payments Threat Model

## Primary threats

- Forged Paystack webhook
- Replayed webhook
- Duplicate payment event
- Callback without webhook
- Webhook before callback
- Concurrent wallet spend
- Duplicate order submission
- Price tampering
- Split-code tampering
- Customer identity mismatch
- Reused payment reference
- Underpayment
- Overpayment
- Wrong currency
- Cross-environment transaction mix-up
- Duplicate payout
- Payout bank-account replacement
- Transfer failure
- Transfer reversal
- Refund replay
- Refund amount overflow
- Malicious metadata
- Unauthorized admin action
- Mutable balance or mutable snapshot corruption

## Required controls

- Raw-body webhook signature verification
- Server-side transaction verification
- Idempotency keys and database uniqueness constraints
- Atomic balance reservation and spend
- Immutable ledger postings
- RLS and service-role-only financial writes
- Environment separation between test and live objects
- Structured audit logs and reconciliation records
- Admin authorization for dangerous actions
- Append-only repair journals instead of in-place balance edits
