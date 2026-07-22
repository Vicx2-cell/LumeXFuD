# Product Commerce Loop Tasks

## In Progress

- [ ] Commit the bounded commerce browser harness and required-choice repair.

## Pending

- [ ] Resume 320, 412, 360, 768, and desktop browser execution only after headless Chromium launches reliably; do not claim unexercised viewports.
- [ ] Complete Phase E group ordering.
- [ ] Complete Phase F feed restoration and upgrade.

## Done

- [x] Read attached product-commerce-scale brief.
- [x] Created durable loop state directory.
- [x] Preserved group-order add-ons from cart seed to checkout handoff.
- [x] Added direct group-page add-on picker.
- [x] Added secure guest delivery checkout with hashed order access token.
- [x] Changed vendor share captions to use direct order links first.
- [x] Verified the four preserved commits by inspecting actual commit contents.
- [x] Added product sheet item notes for normal ordering.
- [x] Added cart item images, editable item notes, remove, and undo recovery.
- [x] Added focused cart reducer regression tests.
- [x] Added `/store/[slug]` commerce-first vendor storefront route.
- [x] Added storefront slug normalization and reserved-word tests.
- [x] Added explicit guest terms/privacy acknowledgement enforcement.
- [x] Added cart checkout idempotency key for repeated submission and network retry.
- [x] Added focused guest checkout contract tests.
- [x] Ran phase-boundary full test suite and repaired discovered route-policy/chat regression failures.
- [x] Committed the phase-boundary repair.
- [x] Checked local browser-test capability: Playwright package is installed, but no app Playwright config/specs or seeded commerce fixture is present.
- [x] Added focused group-order add-on helper tests.
- [x] Ran lint and focused tests for first slice.
- [x] Added deterministic, production-isolated Playwright commerce fixture and bounded Chromium configuration.
- [x] Added required menu choices to the canonical add-on model and enforced them in storefront and order validation.
- [x] Fixed public guest cart access, guest-field labels, and Paystack-only checkout rendering when wallet is disabled.
- [x] Passed the complete baseline scenario at 390x844 and reviewed its screenshot and retained failure evidence from earlier iterations.
