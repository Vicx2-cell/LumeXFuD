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

## Added During Loop

- `test/group-order-addons.test.ts`
