# Results

## Iteration 0 — baseline and architecture discovery

- Task: execute Phase 0 and Phase 1 only.
- Priority: required prerequisite for every security/reliability change and prevents misclassifying existing failures.
- Evidence: branch/SHA/status captured; package/deployment/environment names inspected; 99 pages, 231 API routes, 129 migrations, 91 tests and 34 public assets inventoried; lint/typecheck/tests/build/dependency audit run.
- Affected users: none directly; documentation-only change.
- Files changed by this iteration: `.ai/production-readiness/*` only.
- Expected behavior/security/privacy: no runtime behavior or data flow changes.
- Migration/rollback: no migration; remove the new audit directory to roll back.
- Verification commands: `git status --short --branch`; `npm.cmd run lint`; `npx.cmd tsc --noEmit`; `npm.cmd test`; `npm.cmd run build`.

Outcome: lint and standalone typecheck pass; tests and production build fail as recorded in `BASELINE.md`. The workspace remains unsuitable for release or remediation commits until the user-owned dirty changes are resolved.

Final inspection also found two source files created concurrently after the initial status snapshot. They are recorded in `BASELINE.md`; no audit claim treats them as validated.

## Iteration 1 — authorization coverage and deployable auth/email integration

- Task: resolve PR-001, PR-002, PR-003 and the adversarially discovered PR-007 as one tightly coupled auth/release-gate batch.
- Priority: unclassified identity routes and a failed production build were the highest proven release blockers.
- Evidence/root cause: new email and Resend handlers were missing from `ROUTE_POLICY`; account update used a broad record union without narrowing; email sending used a fail-open generic limiter; baseline timeouts occurred while the approved workspace was still changing.
- Affected users: signup/applicants, customers changing email, staff creating accounts, and all users dependent on a deployable build.
- Expected behavior: public signup/application email proof remains available; admin-create/account-change sends require the appropriate authenticated actor; signed proofs are email-and-purpose bound; external-cost sends stop when rate limiting is unavailable.
- Security/privacy: closes route-inventory gaps and unmetered-send exposure; no raw verification code, secret, or full request body is logged.
- Migration: approved additive migration 132 supplies email verification fields; deployment parity is still unverified and no database was changed in this iteration.
- Rollback: revert the route classifications, fail-closed argument, and associated email integration as a unit before migration 132 is relied upon.
- Verification: targeted lint and typecheck pass; 14/14 targeted auth tests pass; full suite 721/721 passes; access-control/handover 215/215 pass three consecutive times; `npm.cmd run build` passes and generates 149 pages.

Adversarial attempts covered missing session, wrong customer role, public versus privileged purpose, wrong email/purpose replay, malformed proof, incorrect/expired code, rate-limit denial, and repeat security-suite execution. Status: verified, ready for a scoped commit.

**NEEDS_HUMAN_REVIEW — authorize the first remediation and decide how the existing uncommitted work should be preserved/committed before creating `audit/production-readiness`.**
