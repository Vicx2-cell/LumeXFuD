# Product Commerce Loop Tasks

## Remaining

- None. All ready local commerce, group-order, and feed tasks are complete.

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
- [x] Committed browser harness and commerce fixes as `1949f72`.
- [x] Normalized group states to draft/open/validating/locked/awaiting-payment/placed/cancelled/expired/failed.
- [x] Added guest-compatible participant sessions, explicit readiness, owned edits, participant limits, deadlines, budgets, and reconnect-safe re-entry.
- [x] Added atomic add/edit/delete-versus-lock functions, lock version checks, server-authoritative reconciliation, and exact final basket validation.
- [x] Added storefront group creation and organizer/participant mobile controls with required choices, add-ons, notes, share, removal, lock, reconciliation, and checkout.
- [x] Added abandoned-group expiry cron and group lifecycle audit events.
- [x] Disabled participant-paid split billing for the supported organizer-paid model.
- [x] Committed Phase E group ordering as `33211a0`.
- [x] Traced the feed restriction/revert history and current authorization model.
- [x] Restored vendor dashboard feed authoring and lifecycle entry points.
- [x] Added vendor preview, draft, recent-post editing, owned menu links, post detail, storefront updates, live availability degradation, attribution, and fair rotation.
- [x] Committed vendor feed publishing as `b49d10c`.
- [x] Added bounded infinite loading, sparse-tab offset advancement, session scroll restoration, and offline/empty/retry states.
- [x] Connected quote, report, not-interested, hide, mute, and block UI to canonical routes; added quoted-post rendering and success-only share counting.
- [x] Completed all ready local Phase F feed restoration and upgrade work.
- [x] Passed the final full suite (132 files, 882 tests), lint, and production build.
- [x] Committed the feed resilience and mobile experience slice as `54292e7`.
- [x] Repaired checkout and product-sheet sticky-action overlap and passed all six requested browser viewports.
