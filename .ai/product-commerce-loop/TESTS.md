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

## Added During Loop

- `test/group-order-addons.test.ts`
- `test/cart-context.test.ts`
- `test/storefront.test.ts`
- `test/guest-checkout-contract.test.ts`
