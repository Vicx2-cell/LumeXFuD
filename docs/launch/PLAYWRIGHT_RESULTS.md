# Playwright repair and results

Date: 2026-07-29

Result: **PASS**

## Root cause

The hang was a Windows child-process ownership problem in Playwright's built-in
`webServer` integration, not a Supabase, Redis, browser, fixture-cleanup, auth
state, or database handle. `next dev` launches a separate Next worker. Terminating
the shell/CLI process after a run did not reliably terminate that descendant, so
the port remained occupied and the outer `npm.cmd` process waited indefinitely.
Repeated readiness attempts could also overlap Turbopack startup/compilation.

The fixture uses in-process deterministic Supabase doubles and no Redis or
database socket. Browser processes exited when directly inspected. Removing those
suspects did not fix the orphaned Next process; directly owning the Next worker
did.

## Repair

`scripts/run-playwright.mjs` now:

- chooses a dedicated loopback port and refuses to start if it is occupied;
- forks Next's worker entry directly with an IPC channel instead of nesting
  `npm.cmd` and the Next CLI under Playwright;
- bounds server readiness at 60 seconds, with every `/ping` request bounded at
  30 seconds;
- runs the Playwright child with a 330-second suite ceiling;
- forwards termination signals;
- closes Playwright, browser workers, Next worker, IPC, and remaining port owner;
- bounds graceful teardown at 10 seconds before force termination;
- propagates the real test or startup exit code.

`playwright.config.ts` retains per-test, assertion, navigation, action, and global
timeouts but no longer delegates child-process ownership to `webServer`. The
timeouts are intentionally modest (30-second tests and 300-second suite), and no
critical scenario is skipped.

The test-only commerce fixture provides deterministic identities and rows for
customer, guest, vendor, rider, and ordinary-admin boundaries. A narrowly
guarded test-fixture rate-limit path avoids opening an external Upstash handle;
it is unavailable unless the server is running in the explicit Playwright fixture
environment with the exact fixture credentials.

## Final environment

| Item | Value |
|---|---|
| OS | Windows, PowerShell execution environment |
| Node requirement | repository engine `>=22` |
| Next.js | 16.2.12, development server with Turbopack |
| Playwright | 1.60.0 |
| Browser | bundled Chromium 148 |
| Workers | 1 |
| Base URL | ephemeral `http://127.0.0.1:<port>` (final run used 3187) |
| External database/Redis | none; deterministic fixture |
| Retries | 0 locally; no retry was needed |

## Commands and results

Targeted diagnosis:

```text
npm.cmd run test:e2e -- test/e2e/mvp-roles.spec.ts test/e2e/guest-entry.spec.ts
7 passed in 55.5s (command 80.6s), 0 failed, 0 retried
```

Final complete run after clean install:

```text
npm.cmd run test:e2e
13 passed in 1.7m (command 123.8s), 0 failed, 0 retried
```

The command returned normally and the owned server/browser processes closed.
Because there were no failures, Playwright produced no failure screenshot or
trace. Trace capture remains `retain-on-failure` and screenshots remain
`only-on-failure`, so a future failure will retain evidence without accumulating
successful-run artifacts.

## Scenario evidence

| Role / scenario | Evidence | Status |
|---|---|---|
| Customer: load storefront feed | authenticated `/home` rendered live fixture vendor content | PASS |
| Customer: open storefront | campaign/store link opened `/store/playwright-campus-kitchen` | PASS |
| Customer: add valid item | product sheet added fixture item and `/cart` rendered it | PASS |
| Customer: cross-vendor injection | UI showed the replace-cart boundary; server cart/order contract is also covered by Vitest | PASS |
| Customer: checkout and maintenance gate | cart reached checkout state; direct `/api/orders` initiation returned 503 under maintenance | PASS |
| Guest: storefront/cart/checkout | public storefront and guest cart rendered through all six storefront viewport cases | PASS |
| Guest: scoped tracking | invalid token could not read the order and was redirected to scoped authentication | PASS |
| Vendor: authenticate and own menu | fixture session opened menu and created a menu item through `POST /api/vendor/menu` | PASS |
| Vendor: own orders | `/vendor-dashboard/orders` and own order endpoint returned successfully | PASS |
| Vendor: foreign resource | foreign menu item mutation returned 404 | PASS |
| Rider: eligible delivery | rider dashboard rendered eligible/current work and handover controls | PASS |
| Rider: foreign private delivery | unassigned order status mutation returned 403 | PASS |
| Rider: handover UI | code flow controls rendered; server code/reuse transitions retain dedicated integration coverage | PASS |
| Admin: authenticate/dashboard | ordinary admin loaded `/admin` and dashboard data | PASS |
| Admin: order intervention | authorized status intervention returned 200 | PASS |
| Admin: super-admin boundary | super-admin API denied the ordinary admin and protected route returned to `/admin` | PASS |
| Mobile: `distanceKm.toFixed` | malformed delivery estimate at iPhone viewport was rejected by the typed parser without page error | PASS |
| Mobile: critical layouts | storefront/cart exercised 320×700, 360×800, 390×844, 412×915, 768×1024, and desktop | PASS |
| Mobile: safe errors | no internal stack text or horizontal overflow appeared after malformed response | PASS |

The final browser output contained only Next Image sizing/quality performance
warnings for existing icon/Premium assets. Premium remains disabled for launch;
the warnings are not browser failures, security failures, or core-journey
failures. They remain non-blocking presentation debt and were not hidden.

## Remaining blocker

There is no remaining local Playwright blocker. These deterministic tests cannot
substitute for the live provider, RLS, delivery, and BOLA drills in
`EXTERNAL_LAUNCH_DRILLS.md`.
