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

## 2026-07-22 Phase F Vendor Publishing

- Traced the customer-story restriction and feed/profile revert sequence; confirmed vendor publishing remained in the canonical backend but disappeared from the redesigned vendor dashboard and remained incomplete in the generic composer.
- Restored vendor dashboard create/manage entry points and added preview, draft save, owner-scoped recent-post editing, and owned available menu-item attachment to the existing composer.
- Blocked inactive, suspended, deleted, and unverified vendors from publishing; retained admin-only official author selection and official-account protection.
- Added stable post detail URLs, latest vendor updates on the storefront, exact linked-product opening, live item/vendor availability degradation, and feed menu-click/add-to-cart/checkout/completed-order attribution.
- Added explainable fair vendor rotation and duplicate suppression without fabricated engagement.
- Verification passed: 35 focused tests, TypeScript, lint, and diff whitespace checks.

## 2026-07-22 Phase F Feed Experience

- Added bounded infinite loading from the canonical V2 transformer with deterministic raw offsets for sparse Following/Nearby pages, duplicate suppression, loading/retry UI, and no automatic failure loop.
- Added ten-minute per-tab scroll/post restoration, explicit offline and empty states, and bounded mobile media aspect ratios so flyer/video/image posts do not create giant blank canvases.
- Connected quote, report, not-interested, hide-creator, mute, and block controls to their existing routes; quoted posts now retain a safe detail link and source excerpt.
- Share counts now advance only after a successful Web Share or clipboard operation.
- Verification passed: 74 feed/authorization tests, TypeScript, lint, and diff whitespace checks.
- Final boundary verification passed: the full suite completed with 132 files and 882 tests, lint passed, and the production build exited 0 after compiling, typechecking, and generating 153 static pages.
- The slice remains uncommitted only because `.git/index` is sandbox-read-only and the required escalation was rejected when the approval service reported quota exhaustion until 2026-07-28 18:02. The valid implementation and durable-state changes are preserved; no workaround or production deployment was attempted.

## 2026-07-28 Browser Completion

- The previously pending feed experience slice was committed as `54292e7 Complete feed resilience and mobile experience`; the worktree was clean before the final viewport repair.
- Repaired the 320px checkout overlap by switching from a fixed action to an inline final action once checkout enters view. Repaired tablet/desktop product-sheet interaction by placing the active selection overlay above the persistent bottom navigation.
- Added explicit browser assertions that consent remains above the final disabled payment action. The deterministic commerce flow passed at 320x700, 360x800, 390x844, 412x915, 768x1024, and 1280x900 desktop.
- The reusable local fixture-server mode eliminates the earlier teardown stall without changing ordinary isolated Playwright behavior. Full tests (132 files, 882 tests), TypeScript, lint, and production build (153 static pages) passed. No production deployment occurred.

## 2026-07-28 Guest Entry Repair

- Corrected the production journey gap discovered after deployment: guest checkout existed, but the public landing page sent visitors to registration and `/home` was edge-protected.
- Made `/home` a public browse-first marketplace, changed the landing actions to Browse restaurants, linked vendor cards to canonical storefront slugs where available, and removed guest favorite/account controls that would otherwise call protected APIs.
- Added browser and contract coverage for landing-to-marketplace guest entry. Full tests (133 files, 884 tests), TypeScript, lint, and production build (153 static pages) passed before deployment.
