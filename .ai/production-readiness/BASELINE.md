# Baseline

Date: 2026-07-21 (Africa/Lagos)

## Repository state

- Starting branch: `feature/order-communication-system`.
- Starting commit: `32d90cb44919f0119f7b0bed386b180a65ffa026` (`fix: normalize sentry environment DSN`).
- Initial workspace: 84 status entries: 65 tracked files changed (696 insertions, 389 deletions) plus untracked files/directories. This is pre-existing user work and was not modified.
- Final status inspection contained 86 entries including this audit directory. During the audit, two source artifacts not present in the initial status listing appeared: `lib/email-verify.test.ts` (created 17:27 local) and `supabase/migrations/132_email_ownership_verification.sql` (created 17:21, modified 17:27 local). They were not created or edited by this audit. The workspace is therefore a moving target and baseline commands describe the earlier captured working-tree state, not those later additions.
- A dedicated `audit/production-readiness` branch was not created because the working tree is not clean and prior feature/UI work is not confirmed committed. Branching would carry unrelated work contrary to the safety rule.
- `.git` global-ignore lookup produced a host permission warning; repository commands otherwise worked.

## Toolchain and commands

`package.json:5-11` defines `dev`, `build`, `start`, `lint`, `test`, and `test:watch`. There is no explicit typecheck or Playwright script. Node dependencies are already installed.

| Check | Result | Evidence |
|---|---|---|
| `npm.cmd run lint` | PASS | ESLint exit 0 in 75.9s |
| `npx.cmd tsc --noEmit` | PASS | TypeScript exit 0 in 31.9s |
| `npm.cmd test` | FAIL | 88 files passed, 3 failed; 698/702 tests passed |
| `npm.cmd run build` | FAIL | compilation passed, Next build typecheck failed |
| `npm.cmd audit --omit=dev --audit-level=high` | PASS at requested threshold; advisories present | 7 moderate vulnerabilities; no high/critical advisories |

The initial `npm` invocation was blocked by Windows PowerShell execution policy (`npm.ps1`); rerunning through `npm.cmd` executed the real project commands.

## Proven pre-existing failures

1. `test/authz-coverage.test.ts:34-45`: `auth/email/send` and `auth/email/verify` are absent from `ROUTE_POLICY`; two assertions fail. The routes are untracked pre-existing workspace files.
2. `test/handover-flow.test.ts:31`: wrong-code pickup test exceeded the 10,000ms timeout.
3. `test/access-control.test.ts:182`: customer denial for `GET admin/feature-flags` exceeded the 10,000ms timeout.
4. `next build`: `app/api/auth/me/route.ts:151` passes `string | boolean | null` where `string | null | undefined` is required. Compilation completed before Next's typecheck rejected the build.
5. npm reports seven moderate advisories: `file-type` malformed-ASF infinite loop, `@opentelemetry/core` baggage allocation through `@sentry/nextjs`, and nested PostCSS escaping through Next. Suggested automatic fixes cross declared ranges or are breaking; none was applied.

## Environment and external proof gaps

Only variable names/presence were inspected; no values were printed. `.env.local` declares most names in `.env.example`. `ADMIN_PHONE` and `SUPER_ADMIN_EMAIL` are not declared locally. Presence does not prove that credentials are test-mode, valid, least-privileged, or safe to exercise.

Missing or unconfirmed for end-to-end proof: isolated Supabase test project/reset procedure, applied-migration parity, seeded customer/vendor/rider/admin/superadmin fixtures, Paystack test-mode confirmation and replay fixtures, Redis isolation, Sendchamp/Resend suppression, Vercel preview authority, production-domain configuration, supported-device/browser lab, and backup/restore evidence. No real payment, notification, production mutation, preview deployment, or production deployment was attempted.

Workspace stability is also a blocker: owner/background edits continued during discovery. Freeze or commit that work before treating a subsequent validation run as a comparable remediation baseline.
