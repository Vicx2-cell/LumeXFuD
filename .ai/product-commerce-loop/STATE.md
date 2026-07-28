# Product Commerce Loop State

Date: 2026-07-28
Branch: audit/production-readiness
Starting commit: 13e22e6 Add admin rider reassignment
Latest verified commit: 54292e7 Complete feed resilience and mobile experience

## Scope

Active loop: product experience, commerce readiness, mobile usability, role mode clarity, dashboards, feed commerce, storefronts, group ordering, and scale readiness.

Out of scope: repeating fraud-security or operational readiness audits, architecture rewrites, unrelated UI redesigns, production deploys, real payments, and production credentials.

## Current State

- Durable loop state created.
- Prior fraud-security and operations work is preserved.
- Initial repository discovery started.
- First product-commerce improvement committed: group orders preserve add-on selections through seed, shared basket display, cart handoff, checkout totals, and split-share math.
- Second product-commerce improvement implemented: direct `/group/[code]` menu adds now support a mobile bottom-sheet add-on picker.
- Third product-commerce improvement implemented: guest delivery checkout with Paystack callback access tokens.
- Fourth product-commerce improvement implemented: vendor share tools now lead with the direct order link instead of the content-first SEO profile.
- Cart, storefront, guest checkout, boundary repair, and prior loop-state commits are preserved through `bc17b1e`.
- Browser verification slice committed as `1949f72`: deterministic test-only commerce data, a bounded Playwright harness, a public guest-compatible cart route, labelled guest fields, required menu choices on the existing add-on model, storefront selection enforcement, and server-authoritative required-choice validation.
- Browser verification is complete at 320x700, 360x800, 390x844, 412x915, 768x1024, and 1280x900 desktop. The fixture server is explicitly reusable for local runs so Playwright no longer hangs while tearing down Next's dev-server process tree.
- The final viewport repair prevents the fixed checkout action from covering checkout/consent fields and raises the product selection sheet above the persistent bottom navigation.
- Guest ordering now has a public entry path: the landing page links to the public marketplace at `/home`, guest marketplace cards lead to canonical vendor storefronts when a slug exists, and account-only favorite/profile affordances are withheld until sign-in.
- Phase E group ordering is committed as `33211a0`: explicit lifecycle and participant records, hashed guest participant sessions, organizer-paid checkout, atomic writes versus lock, optimistic item versions, readiness, limits, budgets, deadline expiry, final reconciliation, exact group-to-order validation, one-order uniqueness, audit events, and storefront/mobile controls.
- Participant-paid wallet splitting is disabled and explicitly deferred. Existing legacy split functions remain unreachable; the supported group model has one authenticated organizer payer and one resulting order.

## Baseline

- Worktree at loop start appeared clean except Git config ignore permission warnings.
- Project uses Next.js 16.2.6, React 19.2.4, Vitest, Supabase, and Sentry.
- Baseline typecheck script is absent in `package.json`.
- Focused tests, lint, and build passed for group-order, guest-checkout, and storefront-share slices.
- Current slice verification passed: focused cart/group tests, lint, production build, and diff whitespace check.
- Storefront slice verification passed: focused storefront/cart tests, lint, and production build.
- Guest checkout slice verification passed: focused guest/validator tests, lint, and production build.
- Phase boundary verification passed after repair: full Vitest suite, focused access-control rerun, lint, and production build.
- Browser data/harness gap is closed and all requested viewport scenarios are exercised and passing.
- Phase E focused boundary passed 250 tests, TypeScript, lint, and diff whitespace checks. Browser-based group mobile execution remains under the already-recorded Chromium startup blocker; no new viewport claim is made.
- Phase F vendor publishing is committed as `b49d10c`: restored vendor dashboard authoring/management entry points, vendor menu-linked compose/preview/draft/edit, live vendor/item purchase-state validation, stable post detail links, storefront vendor updates, feed-to-order event attribution, and fair vendor rotation.
- Phase F mobile/interaction slice is committed as `54292e7`: bounded infinite loading with sparse-page offsets, scroll restoration, offline/empty/retry states, mobile media ratios, successful-share counting, quote context, and connected report/preference/mute/block actions.
- Final boundary verification passed again after the viewport repairs: 132 Vitest files and 882 tests, lint, and a production build covering TypeScript plus 153 static pages. No production deployment occurred.
