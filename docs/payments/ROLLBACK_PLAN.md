# Payments Rollback Plan

## Safe rollback levers

- disable customer wallet feature flag
- disable customer virtual-account feature flag
- disable direct payment or payout features if a future flag exists
- revert the last deployment to the previous known-good commit

## Rollback principles

- prefer feature-flag rollback before code rollback
- never rewrite historical financial rows in place
- use compensating entries or reversal flows for money that has already moved
- preserve webhook and audit records

## If a migration causes trouble

1. stop the offending rollout
2. document the incompatible rows
3. add an additive follow-up migration rather than editing history
4. use the smallest safe compensating repair

## Current note

- No rollback beyond code and feature flags was executed in this cycle.
