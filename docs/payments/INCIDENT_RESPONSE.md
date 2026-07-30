# Payments Incident Response

## Trigger examples

- unexpected duplicate credit
- forged webhook
- payout reversal
- refund mismatch
- wrong-customer DVA mapping
- live/test contamination

## First actions

1. Freeze new money movement at the smallest safe boundary.
2. Preserve evidence: request IDs, order IDs, references, and timestamps.
3. Check whether the issue is isolated, replayable, or systemic.
4. Quarantine ambiguous transactions.
5. Escalate any provider-side or dashboard-side action that cannot be done safely in code.

## Evidence to collect

- webhook payload hash
- provider reference
- verification response
- internal order or wallet IDs
- idempotency key
- audit event IDs

## Do not

- do not edit posted money in place
- do not guess customer ownership
- do not clear a replay guard without recording why
- do not mix test and live evidence
