# Findings

## PR-001 — API authorization inventory is incomplete

- Category/severity/confidence: Authorization / High / High
- Affected roles/assets: all roles; email verification/account identity
- Exact files: `app/api/auth/email/send/route.ts`, `app/api/auth/email/verify/route.ts`, `lib/authz-policy.ts:112-121`, `test/authz-coverage.test.ts:34-45`
- Evidence/reproduction: run `npm.cmd test`; coverage reports both routes unclassified.
- Scenario/impact: a new handler is outside the repository's mandatory classification/backstop, so intended access assumptions cannot be proven and release CI fails.
- Root cause: untracked route additions were not added to the central policy.
- Fix/test: inspect both handlers and classify from real behavior, then run targeted coverage plus full access-control tests. Do not assume `auth` means public.
- Migration/rollback/privacy: no expected migration; revert policy entry if classification is wrong; routes handle identity/contact data.
- Status: **Resolved and verified 2026-07-21.** Both auth routes are classified as self-authorizing flows and the concurrently added Resend route as a webhook. Verification: route coverage plus purpose-specific deny tests, 14/14 targeted tests, 721/721 full tests, and production build pass.

## PR-002 — Production build fails

- Category/severity/confidence: Release reliability / High / High
- Affected roles/assets: all users; deployable artifact
- Exact file: `app/api/auth/me/route.ts:149-153`
- Evidence/reproduction: `npm.cmd run build`; `update.email` is `string | boolean | null` but welcome-email helper accepts `string | null | undefined`.
- Impact/root cause: no production artifact can be released; patch update typing/normalization permits a boolean.
- Fix/test: narrow/normalize the field without weakening validation; add regression coverage; rerun typecheck, tests and build.
- Status: **Resolved and verified 2026-07-21.** The account update narrows string fields before welcome-email use. Standalone typecheck, targeted lint, full tests and the exact Next production build pass.

## PR-003 — Security tests time out

- Category/severity/confidence: Test reliability / Medium / High
- Files: `test/handover-flow.test.ts:31`, `test/access-control.test.ts:182`, `vitest.config.ts:11-12`
- Evidence: wrong handover-code rejection and customer denial for admin feature flags each exceeded 10 seconds during the baseline.
- Impact: critical deny-path evidence is nondeterministic/unavailable. Root cause is not yet established; do not merely increase the timeout.
- Status: **Resolved as non-reproducible baseline instability, verified 2026-07-21.** The complete suite passed 721/721. The two affected suites then passed three consecutive stress runs (215/215 each) without timeout; no timeout or assertion was weakened.

## PR-004 — PWA update behavior may interrupt critical work

- Category/severity/confidence: PWA reliability / Medium / Medium
- Files: `public/sw.js:16-32`, `components/pwa.tsx`
- Evidence: install unconditionally calls `skipWaiting`; activation claims clients. A critical-operation deferral proof has not been found.
- Scenario: a new worker can take control while checkout/delivery/message work is active.
- Fix/test: trace controller-change behavior and add transaction-aware update tests before changing it.
- Status: Open hypothesis requiring reproduction.

## PR-005 — Push notification icon path appears stale

- Category/severity/confidence: PWA quality / Low / High
- File/evidence: `public/sw.js:121-126` references `/icons/icon-192.png`; asset inventory contains `/icons/icon-192-v2.png` only.
- Impact: notifications may show a missing/default icon. Verify in browser before repair.
- Status: Open.

## PR-006 — Dependency advisories require compatible upgrades

- Category/severity/confidence: Supply chain / Medium / High
- Files: `package.json`, `package-lock.json`
- Evidence: `npm.cmd audit --omit=dev --audit-level=high` reports seven moderate vulnerabilities in `file-type`, Sentry/OpenTelemetry, and Next's nested PostCSS; no high/critical advisories were reported.
- Impact: malformed media or affected library paths may cause resource exhaustion or unsafe CSS serialization depending on reachable usage. Reachability is not yet proven.
- Fix/test: assess call-path reachability and vendor-compatible patched releases; do not use the suggested breaking `npm audit fix --force` without compatibility evidence.
- Status: Open.

## PR-007 — Verification-email rate limiting failed open

- Category/severity/confidence: Abuse prevention / Medium / High
- File: `app/api/auth/email/send/route.ts`
- Evidence/scenario: the new external-cost email send called `rateLimitGeneric` with its default fail-open behavior, allowing unmetered sends during Redis outage or misconfiguration.
- Fix: pass `failClosed=true`, consistent with the repository's paid OTP control; privileged-purpose authorization still runs before the send.
- Verification: targeted test asserts the fail-closed argument and verifies unauthenticated/customer denial for privileged purposes.
- Status: **Resolved and verified 2026-07-21.** 14/14 targeted tests pass.
