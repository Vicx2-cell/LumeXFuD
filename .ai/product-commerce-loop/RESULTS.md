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
- Committed as `7f9b5d7 Repair phase boundary verification`.
- Checked browser-test tooling: Playwright 1.60.0 is installed, but live viewport walkthroughs remain blocked by absence of configured browser specs and seeded active vendor/menu/add-on fixtures in local state.
- Final loop-state update pending commit.

## 2026-07-22 Browser Verification Resume

- Preserved all interrupted Playwright work after classifying the fixture, config, public cart route, and artifact ignores as valid; removed the broad reload/back experiment from the bounded baseline.
- Added migration `146_required_menu_choices.sql` and reused the canonical menu add-on/order snapshot path for one required-choice group.
- Fixed guest cart edge access, accessible guest labels, and a wallet-disabled loading bug that hid the Paystack-only checkout section.
- Added a deterministic fixture vendor, slug, product image, required choices, optional long-name add-on, and unavailable add-on without real credentials, payments, or production data.
- The 390x844 baseline completed all 12 requested steps. The runner teardown issue was repaired by launching Next directly; subsequent viewport execution was stopped after Chromium itself stalled before the 320x700 test could start.
- Focused tests, typecheck, lint, and diff whitespace verification pass. Additional browser viewport claims remain precisely environment-blocked.

## 2026-07-22 Phase E Group Ordering

- Added migration `147_group_order_lifecycle.sql` with normalized states, participant/session ownership, versioned lines, audit events, atomic mutation/lock/readiness functions, legacy participant backfill, and one-order-per-group enforcement.
- Added guest-compatible join/resume, participant-owned add/edit/remove, readiness, organizer participant removal, compare-and-set locking, final reconciliation, checkout transition, cancellation, and expiry cleanup routes.
- Rebuilt the group page around organizer-paid ordering with clear status, deadline, destination, budget, ownership, conflicts, required choices, optional add-ons, item notes, reconnect messages, share/copy/WhatsApp actions, and mobile sticky actions.
- Added `Start group order` to the canonical storefront with controlled group configuration fields.
- Bound the final order to the organizer, vendor, fulfilment, destination, and exact reconciled contribution lines; repeated placement reuses the existing order even if a later browser session presents a new idempotency key.
- Verification passed: 250 focused tests, TypeScript, lint, and diff whitespace checks. No production deployment or real payment occurred.
