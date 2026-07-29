# MVP certification V2

Last verified: 2026-07-29

Baseline: `ced5af9ca074e988fdc683e462171bc0ae508def`

Audit branch: `audit/mvp-certification-v2`

## Executive conclusion

MVP_CERTIFIED_CODE_COMPLETE_EXTERNAL_CONFIGURATION_REQUIRED

The previously blocking browser-process leak and reachable production Sharp
advisory are resolved. The clean repository verification passes unit/integration
tests, all required Playwright scenarios, strict TypeScript, ESLint, production
build, production dependency audit, circular-dependency analysis, route
inventory, current/history secret scan, internal link check, and diff
whitespace check.

This does **not** authorize launch. Ordering remains closed. The code-complete
result is externally blocked on live Paystack/payment/refund/transfer
reconciliation, deployed role/RLS probes, a real delivery/handover/settlement
drill, provider observability, and approval of production pricing inputs. DVA,
customer stored value, pickup, promotions, sponsor top-up, WhatsApp commerce,
Study, AI, Premium, and paid/sponsored features remain disabled.

## Exact reason

- Playwright now directly owns and bounds the Next worker and closes its complete
  process tree; 13/13 browser scenarios pass with no retry.
- Next resolves to patched `sharp@0.35.3` / libvips 8.18.3; the production audit
  reports zero vulnerabilities.
- The full npm audit retains one unreachable dev-only ESLint glob advisory,
  expanded into nine package entries. It cannot receive runtime/user input and
  is omitted from production; forcing npm's major/reversal fixes is less safe.
- No usable historical credential remains. Two committed Vercel OIDC tokens
  expired by signed claim on 2026-07-09.
- Code evidence cannot establish the behaviour of live Paystack, Resend,
  Sendchamp, Upstash, Sentry, cron delivery, production RLS data, or external
  settlement accounts. Those drills remain mandatory.

## Test-count reconciliation

Final result: **139 files / 900 tests passed**.

```text
914
- 22 removed obsolete/disabled-implementation cases
+  3 fail-closed feature-flag cases
+  1 payout source-of-truth case
+  4 delivery-estimate/mobile-crash cases
= 900
```

`TEST_COVERAGE_RECONCILIATION.md` names every removed file/test group, the
production behaviour it exercised, its classification, and retained equivalent
coverage. No removed case is `COVERAGE_LOST_RESTORE_REQUIRED`.

## Playwright result

`npm.cmd run test:e2e`: **PASS**, 13/13, one Chromium worker, zero failures,
zero retries, 1.7-minute Playwright duration and 123.8-second command duration.
It covers:

- registered customer feed/storefront/cart, cross-vendor boundary, checkout,
  and maintenance-mode payment denial;
- guest storefront/cart/checkout and scoped tracking rejection;
- vendor authentication, own menu creation, own orders, and foreign-resource
  rejection;
- rider eligible work/handover UI and unassigned-delivery rejection;
- ordinary-admin dashboard/intervention and super-admin denial;
- six responsive storefront sizes and an iPhone checkout receiving a malformed
  distance response without `distanceKm.toFixed`, stack, or overflow failure.

No failure screenshot/trace exists because no case failed. Retain-on-failure
configuration remains active. See `PLAYWRIGHT_RESULTS.md`.

## Dependency-security decision

- Sharp/libvips runtime advisory: `PATCH_AVAILABLE_APPLY`, remediated by exact
  Sharp 0.35.3 resolution. No broad framework change was made.
- `npm.cmd audit --omit=dev --json`: **PASS**, 0 vulnerabilities.
- Full npm audit: one `brace-expansion` DoS advisory reachable only through
  development ESLint globs, represented as 9 high effect entries:
  `NOT_REACHABLE_ACCEPT_WITH_EVIDENCE`.
- Production installs omit development tooling; CI supplies only trusted
  repository paths and is resource bounded.

See `DEPENDENCY_SECURITY_DECISION.md` for advisory IDs, paths, reachability,
primary sources, remediation options, and rejected unsafe resolutions.

## Unused-export result

Starting Knip inventory: 166 unused value exports and 122 unused exported types.
Final inventory: 147 values and 114 types. Resolved: 19 values and 8 types.

The remaining 2 test-only values, 44 cross-package database contract types, and
145 value/70 type manual-review findings are individually classed by exact set
in `UNUSED_EXPORT_AUDIT.md`. No broad allowlist or directory suppression was
added. Knip also reports Playwright/custom-runner/framework/operational entry
points as unused files and reports `playwright` as an unused dev dependency
because it cannot infer the child CLI launched by the runner; the passing 13-case
suite proves that dependency and entries are active.

This is visible maintainability debt, not executing code or an authorization/
money failure. Automated deletion would be less safe than retaining the
owner-review queue.

## Module-complexity result

The cart, feed, and order modules were reviewed by responsibility and
source-of-truth boundary, not line count.

- The checkout delivery-response parser was extracted into
  `lib/delivery-estimate-response.ts` with four regression tests.
- Stale static feed records/right rail were removed; the remaining contracts
  moved from misleading `fixtures.ts` to `types.ts`.
- Two dead motion components and dead vendor-dashboard helpers were removed.
- Large feed screen, cart page, order creation route, order-status route, and
  orders page remain deliberately unchanged where their responsibilities are
  cohesive or splitting would cross a security/money boundary.
- Authoritative implementations remain server order creation/pricing,
  launch-delivery pricing, order payout, status-transition route, feed
  permissions/ranking, and official automatic-post generation.

No pricing, settlement, payout, or transition formula was duplicated. See
`MODULE_COMPLEXITY_REVIEW.md`.

## Historical-secret status

`ALL_HISTORICAL_CREDENTIALS_CONFIRMED_REVOKED`

The only real credentials in reachable history were two Vercel OIDC workload
tokens in commit `9e0d7213642b`. Their redacted fingerprints and signed issue/
expiry times are in `HISTORICAL_SECRET_RESPONSE.md`; both expired on 2026-07-09.
No live Paystack, Supabase service-role, Upstash, email, messaging, GitHub, or
Sentry credential was found. No history rewrite is recommended.

## Complete launch MVP inventory

Available only after every external launch gate passes:

- registered and guest approved-vendor/storefront discovery;
- live menu and add-on selection with single-vendor cart enforcement;
- server-side integer-kobo subtotal, delivery, platform/guest fee, vendor
  commission, provider amount, and safe disabled-promotion handling;
- idempotent order creation and per-order Paystack payment;
- signed/replay-safe webhook processing and server verification;
- vendor own-menu and own-order acceptance/preparation/ready operations;
- race-safe rider eligibility/assignment, collection, delivery, and release;
- private customer handover-code completion and status audit trail;
- scoped registered/guest order history/tracking and order notifications;
- refunds, disputes, held vendor/rider liabilities, payout and reconciliation
  records;
- admin user/vendor/rider/order/dispute/security observation and intervention;
- maintenance, payout/withdrawal controls, health/cron/Sentry hooks;
- feed and host-paid one-vendor group ordering as included non-critical features;
- reviews, referrals, push, chat, analytics, and public partner application
  surfaces where their existing flags permit.

Not in launch inventory: promotions, DVA, customer stored value/wallet payment,
sponsor top-up, pickup, WhatsApp commerce, Study, AI, Premium, boosts/paid feed,
or live navigation routing.

## Remaining external drills

All steps and rollback criteria are in `EXTERNAL_LAUNCH_DRILLS.md`:

1. Paystack low-value success, failure, abandonment, invalid/duplicate/delayed/
   replayed event, refund, supported reversal, guest Pay with Transfer, and
   dashboard reconciliation.
2. Vendor commission, vendor-funded campaign only in separately authorized
   staging, LumeX promotion denial while kill-switched, rider payout, hold,
   failed payout, retry, and accounting-total reconciliation.
3. Live BOLA/IDOR for customer, guest, vendor, rider, admin, and super-admin.
4. Assignment, pickup transition (without enabling pickup ordering), correct/
   incorrect/reused handover code, completion, and post-completion dispute.
5. Resend, Sendchamp, Upstash, Sentry, cron health, and webhook monitoring.
6. Owner approval of delivery fuel, efficiency, maintenance, road multiplier,
   commission/fee inputs, and production payout controls.

## Exact verification record

| Check | Command | Result |
|---|---|---|
| Clean install | `npm.cmd ci --no-audit --no-fund` | PASS; 618 packages, 111.8s |
| Unit/integration | `npm.cmd test -- --reporter=default` | PASS; 139 files / 900 tests, Vitest 53.29s, command 58.6s |
| Browser E2E | `npm.cmd run test:e2e` | PASS; 13/13, 0 retries, 123.8s |
| Strict TypeScript | `npm.cmd exec tsc -- --noEmit --pretty false --incremental false` | PASS; 63.6s after repairing one stale feed import |
| ESLint | `npm.cmd run lint` | PASS; no findings, 84.4s |
| Production build | `npm.cmd run build` | PASS; Next 16.2.12, 250 API routes, 157 pages, 136.1s |
| Diff whitespace | `git diff --check` | PASS |
| Production audit | `npm.cmd audit --omit=dev --json` | PASS; 0 findings |
| Full audit | `npm.cmd audit --json` | REVIEWED; one unreachable dev-only advisory / 9 effect entries |
| Knip | `npx.cmd --yes knip --reporter json` | REVIEWED; 147 value exports, 114 types; justified/manual set documented |
| Madge | `npx.cmd --yes madge --circular --extensions ts,tsx app components lib` | PASS; 748 files, no circular dependency |
| Route manifest | `node scripts/gen-route-manifest.mjs` | PASS; 250 manifest entries / 250 route files |
| Secret scan | full-history assignment/provider-prefix scan plus current-tree strong-prefix scan | PASS; no usable credential |
| Temporary files | repository search for backup/temp/reject patterns | PASS; none |
| Documentation links | relative Markdown target checker | PASS; no broken internal links |

## Removed irrelevant content

- `app/feed-v2/fixtures.ts`: static fake posts/stories/right rail; live type and
  navigation contracts moved to `app/feed-v2/types.ts`.
- `components/fx/animated-heading.tsx`: unreferenced component.
- `components/fx/sparkline.tsx`: unreferenced component.
- dead FX barrel exports, vendor-dashboard helper implementations/contracts, and
  unnecessary local export modifiers listed in `UNUSED_EXPORT_AUDIT.md`.

No dependency was removed. Sharp was constrained to the already-declared patched
version. No production route, migration, server action, framework entry point,
credential, feature flag, or database authorization rule was removed.

## Remaining manual review

Non-blocking:

- 145 unused value exports and 70 exported types awaiting domain-owner proof,
  plus 44 intentionally retained database-contract types and 2 test-only values;
- operational scripts that Knip cannot infer and that require an operator/owner
  archive decision;
- existing Next Image performance warnings for icons and disabled Premium assets;
- large but cohesive feed/cart/order modules documented for future targeted
  extraction;
- disabled/post-launch route inventory must continue to be checked whenever
  feature controls change.

Launch-blocking external work is the drill list above. There is no remaining
confirmed code, build, browser, payment-calculation, RLS-contract, or exploitable
production dependency blocker in this audit.

## Exact launch gates

1. Deploy the exact reviewed commit to preview only; maintenance stays on and
   withdrawals/payouts stay frozen.
2. Independently verify server-only production secrets and callbacks without
   writing them to Git.
3. Pass deployed customer/guest/vendor/rider/admin/super-admin BOLA and RLS
   drills.
4. Pass Paystack success/failure/abandon/replay/refund/guest-transfer drills and
   reconcile every integer-kobo amount/reference.
5. Pass one complete vendor → rider → handover-code → settlement journey and the
   incorrect/reused-code cases.
6. Reconcile commission, vendor net, rider payout, holds, failed/retried payout,
   and refunds to zero unexplained variance.
7. Verify Resend, Sendchamp, Upstash, Sentry, cron auth/overlap, and webhook
   monitoring/alerts.
8. Obtain technical and operations sign-off on pricing inputs and all drill
   records.
9. Keep promo kill switch on, DVA/customer wallet/pickup/AI/Study/WhatsApp/
   Premium/sponsor features off. Reopening ordering requires a separate
   controlled owner-authorized change after gates 1–8.

No deployment, credential change, feature enablement, or ordering change was
performed by this audit.
