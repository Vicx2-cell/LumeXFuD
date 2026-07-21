# Product Commerce Loop Results

## 2026-07-21

- Loop initialized.
- Implemented first commerce slice: group-order add-on persistence and totals.
- Added migration `144_group_order_addons.sql`.
- Added helper `lib/group-order-addons.ts` and tests.
- Verification passed: lint, focused tests, and production build.
- Committed as `7576ddb Preserve group order add-ons`.
- Implemented direct group-page add-on picker.
- Verification passed for picker slice: lint, focused tests, and production build.
- Committed as `238c138 Add group order add-on picker`.
- Implemented secure guest delivery checkout with hashed order access token and token-aware order tracking.
- Verification passed for guest checkout slice: lint, focused tests, and production build.
- Committed as `e3a17c5 Add secure guest checkout`.
- Implemented direct-order vendor share links with secondary public profile link.
- Verification passed for storefront-share slice: build and lint.
- Committed as `63af3c7 Prioritize direct vendor order links`.

## 2026-07-22

- Verified the four preserved commits by inspecting actual commit contents instead of relying on titles.
- Implemented current cart/product selection slice: product configuration sheet opens for all normal vendor menu items, item notes persist to cart, cart lines show item images where available, notes can be edited in cart, and remove has undo recovery.
- Added focused cart reducer regression tests for configured item separation/merge, note editing, image/add-on preservation, and removal.
- Verification passed: focused cart/group tests, lint, production build, and diff whitespace check.
- Committed as `a2aa9c8 Improve cart item editing`.
- Implemented commerce storefront route `/store/[slug]`: resolves normalized vendor slugs to active vendors, rejects reserved words, produces vendor-specific metadata, and reuses the existing live `/vendor/[id]` ordering surface.
- Added focused storefront slug tests for normalization, Unicode/punctuation, malformed encodings, reserved words, and canonical `/store` paths.
- Verification passed: focused storefront/cart tests, lint, and production build.
- Committed as `6c68967 Add commerce storefront route`.
- Implemented guest checkout acknowledgement and retry slice: cart sends a stable `idempotency-key`, guests explicitly send terms/privacy acknowledgement, and `/api/orders` rejects guest checkout without it.
- Added focused guest checkout contract tests and validator coverage.
- Verification passed: focused guest/validator tests, lint, and production build.
- Committed as `bc9eaa9 Require guest checkout acknowledgement`.
- Repaired phase-boundary verification failures by classifying existing admin operational routes and `/api/health` in `ROUTE_POLICY`, and preserving the customer-only chat actor guard in order tracking.
- Verification passed: targeted failing tests, isolated access-control suite, final full suite, lint, and production build.
- Commit pending for phase-boundary repair slice.
