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

## Added During Loop

- `test/group-order-addons.test.ts`
- `test/cart-context.test.ts`
- `test/storefront.test.ts`
- `test/guest-checkout-contract.test.ts`
