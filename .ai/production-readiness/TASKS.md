# Prioritized task queue

1. **Completed:** baseline approved; created `audit/production-readiness` without discarding working-tree changes.
2. **Completed:** PR-001/PR-007 authorization and fail-closed email verification controls; route coverage and adversarial tests pass.
3. **Completed:** PR-002 exact production build now passes.
4. **Completed:** PR-003 did not recur in the full suite or three consecutive stress runs; assertions/timeouts unchanged.
5. Assess PR-006 reachability and test compatible dependency upgrades without `--force`.
6. Complete API method/auth/object/RLS inventory and executable role matrix against an isolated Supabase test environment.
7. Audit Paystack amount derivation, raw-body HMAC, idempotency, reconciliation and refund/ledger integrity using test fixtures only.
8. Map and adversarially test order transitions, assignment races, handover-code lifecycle and chat reassignment.
9. Verify PWA install/update/offline behavior and notification assets on supported browsers without interrupting critical flows.
10. Continue privacy/data, forensics/incident response, accessibility, performance, store-readiness, migration and release-gate phases.
