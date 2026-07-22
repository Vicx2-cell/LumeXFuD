# Product Commerce Loop Tests

## Baseline

- Typecheck: `npm.cmd run typecheck` unavailable because `package.json` has no `typecheck` script.
- Passed: `npm.cmd run lint`.
- Passed: `npm.cmd test -- --run test/group-order-addons.test.ts`.
- Passed: `npm.cmd test -- --run lib/validators.test.ts test/access-control.test.ts test/group-order-addons.test.ts`.
- Passed: `npm.cmd run build`.
- Passed again after direct group-page picker change: `npm.cmd run lint`, `npm.cmd test -- --run test/group-order-addons.test.ts`, and `npm.cmd run build`.
- Passed after guest checkout change: `npm.cmd run lint`, `npm.cmd test -- --run lib/validators.test.ts test/group-order-addons.test.ts`, and `npm.cmd run build`.
- Passed after storefront-share change: `npm.cmd run build`; `npm.cmd run lint` passed on rerun with a longer timeout after the first 120s attempt timed out.
- Passed after cart/product selection change: `npm.cmd test -- --run test/cart-context.test.ts test/group-order-addons.test.ts`.
- Passed after cart/product selection change: `npm.cmd run lint`.
- Passed after cart/product selection change: `npm.cmd run build`.
- Passed after cart/product selection change: `git diff --check` with only existing LF-to-CRLF working-copy warnings.
- Passed after storefront route change: `npm.cmd test -- --run test/storefront.test.ts test/cart-context.test.ts`.
- Passed after storefront route change: `npm.cmd run lint`.
- Passed after storefront route change: `npm.cmd run build`.
- Passed after guest checkout contract change: `npm.cmd test -- --run test/guest-checkout-contract.test.ts lib/validators.test.ts`.
- Passed after guest checkout contract change: `npm.cmd run lint`.
- Passed after guest checkout contract change: `npm.cmd run build`.
- Initial phase-boundary `npm.cmd test` failed: missing route-policy classifications for existing admin operational routes and `/api/health`, plus source-level order chat guard assertion.
- Passed after repair: `npm.cmd test -- --run test/authz-coverage.test.ts test/order-chat-customer.test.ts`.
- First full-suite rerun had a timeout in `test/access-control.test.ts` for `GET admin/feature-flags -> 403 for customer`.
- Passed isolated rerun: `npm.cmd test -- --run test/access-control.test.ts` with 221 tests.
- Passed final full suite: `npm.cmd test` with 126 files and 859 tests.
- Passed after boundary repair: `npm.cmd run lint`.
- Passed after boundary repair: `npm.cmd run build`.
- Checked browser-test tooling: `npx.cmd playwright --version` returned `Version 1.60.0`.
- Not run: live viewport walkthroughs for product configuration because no Playwright harness or seeded active vendor fixture is available in the repository state.

## Browser Harness Slice — 2026-07-22

- Passed: `npm.cmd test -- --run test/menu-addon-selection.test.ts lib/validators.test.ts` — 2 files, 24 tests.
- Passed: `npm.cmd test -- --run test/menu-addon-selection.test.ts lib/validators.test.ts test/cart-context.test.ts test/storefront.test.ts test/guest-checkout-contract.test.ts test/authz-coverage.test.ts` — 6 files, 36 tests.
- Passed: `npx.cmd tsc --noEmit` after the final fixture client typing repair.
- Passed: `npm.cmd run lint` after replacing the explicit-any fixture client type.
- Passed assertions at 390x844: `npx.cmd playwright test test/e2e/commerce-flow.spec.ts --project=chromium --workers=1 --retries=0 --grep "390x844" --timeout=45000 --global-timeout=90000 --reporter=line`. Playwright reported `1 passed`; the process exit was 1 only because the global limit expired during npm-wrapped dev-server teardown after the scenario.
- Reviewed evidence: `guest-terms-390x844.png` shows the configured item, required and optional selections, edited note, guest identity section, final total, consent unchecked, and disabled pay action. Earlier failure traces/screenshots were inspected before each repair.
- Blocked before scenario execution at 320x700: Chromium headless shell launched but did not establish its debugging pipe; Playwright interrupted the unstarted test after the bounded suite/teardown windows. No viewport assertion is claimed.
- Not run after the environment startup blocker: 412x915, 360x800, 768x1024, and desktop.

## Phase E Group Ordering — 2026-07-22

- Passed: `npm.cmd test -- --run test/group-order-state.test.ts test/group-order-reconciliation.test.ts test/group-participant-session.test.ts test/group-order-lifecycle-contract.test.ts test/group-order-addons.test.ts test/menu-addon-selection.test.ts test/authz.test.ts test/authz-coverage.test.ts test/access-control.test.ts test/cart-context.test.ts` — 10 files, 250 tests.
- Passed: `npx.cmd tsc --noEmit` after group checkout signature and storefront boolean repairs.
- Passed: `npm.cmd run lint` with no warnings after removing unused group-page imports.
- Passed: `git diff --check` with only repository line-ending warnings.
- Covered deterministically: terminal state transitions, editability at lock/deadline, budget bounds, readiness reconciliation, vendor/item/add-on/price conflicts, high-entropy participant capabilities, explicit route classification, atomic SQL contract, organizer-only placement, and disabled split activation.
- Not claimed: live group mobile browser screenshots because headless Chromium startup is already precisely blocked in this environment.

## Added During Loop

- `test/group-order-addons.test.ts`
- `test/cart-context.test.ts`
- `test/storefront.test.ts`
- `test/guest-checkout-contract.test.ts`
