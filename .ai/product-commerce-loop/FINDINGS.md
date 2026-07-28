# Product Commerce Loop Findings

## 2026-07-21

- Product brief supersedes the previous operations loop for new work.
- `CLAUDE.md` says browsing and cart are public, and customers verify phone before checkout.
- `CLAUDE.md` also says guest checkout was removed, while the new brief asks for guest checkout restoration. This must be handled deliberately as a product decision, not assumed.
- `docs/auth.md` and `docs/payments.md` still reference guest-compatible checkout semantics.
- Initial broad search shows existing feed, attribution, group order, storefront, and guest-phone code paths.
- Normal solo checkout already validates add-ons server-side from `menu_item_addons` and snapshots them to `order_items`.
- Group ordering dropped add-ons when starting a group from cart, when displaying group items, when merging into checkout cart, and when computing wallet split readiness/shares.
- Direct add from `/group/[code]` previously added the base item only. It now opens a mobile bottom sheet for add-on selection before posting to the validated API.
- Guest checkout was schema-ready (`orders.guest_phone`) but disabled by an early `/api/orders` authentication gate and by the order page redirecting every unauthenticated viewer.
- Guest order tracking requires a non-enumerable access token because order numbers are sequential.
- Vendor share page preferred `/uturu/vendor/[slug]`, a content-first SEO page. For commerce sharing, the primary link should land directly on `/vendor/[id]` where the live menu/cart flow starts.
- Verified commit `7576ddb` by content: it created durable loop files and preserved group-order add-on snapshots through seeding, display, checkout cart handoff, totals, and split-share math.
- Verified commit `238c138` by content: it added a direct `/group/[code]` add-on picker bottom sheet for group-order participant ordering.
- Verified commit `e3a17c5` by content: it added hashed guest order access tokens, guest-aware order creation, callback tracking links, and token-aware order viewing.
- Verified commit `63af3c7` by content: it changed vendor share copy/actions to prioritize direct `/vendor/[id]` order links while keeping the SEO profile as secondary.
- Normal vendor product selection previously opened the configuration sheet only for items with add-ons, so item notes could not be captured for every product.
- Customer cart lines previously did not show item imagery, did not allow note edits, and removed lines without an immediate undo recovery path.
- Cart reducer already preserves configured add-ons by cart-line key; focused tests now cover configured item separation/merge, note edits without add-on/image loss, and remove behavior.
- There was no `/store/{vendor-slug}` route. Existing live ordering is `/vendor/[id]`, while `/uturu/vendor/[slug]` is a separate content/SEO profile.
- Vendor slugs are backed by migration `089_vendor_slug.sql`, which normalizes and deduplicates database slugs, but the commerce route still needed local guards for reserved platform words and malformed shared URLs.
- The new `/store/[slug]` route resolves only active, non-deleted, non-suspended vendors and delegates rendering to the existing `/vendor/[id]` page so menu, add-ons, cart, checkout, payment, dispatch, and order systems remain canonical.
- Guest checkout already had hashed high-entropy tracking tokens, guest name/phone, normalized phone, rate limits, idempotent order creation, Paystack callback token return, and token-aware order tracking from `e3a17c5`.
- Guest checkout UI required delivery terms before checkout, but the API did not receive or enforce an explicit guest terms/privacy acknowledgement.
- Cart checkout did not send the existing `idempotency-key` header, so the server-side idempotency machinery could not protect ordinary client retries from the cart surface.
- Phase-boundary full suite initially exposed existing route-policy coverage gaps for `admin/orders/[id]/emergency-cancel`, `admin/orders/[id]/reassign-rider`, `admin/support-notes`, and `health`.
- Phase-boundary full suite also exposed a source-level regression test that expected the customer chat actor guard without optional chaining; the runtime guard was kept customer-only and null-safe.
- One full-suite run timed out on `GET admin/feature-flags -> 403 for customer`; the isolated access-control suite passed all 221 tests, and the subsequent full suite passed all 859 tests.
- `npx.cmd playwright --version` reports Playwright 1.60.0, but the repository has no Playwright config/spec files and local durable state does not identify a seeded active vendor/menu/add-on fixture for real viewport walkthroughs.

## 2026-07-22 Browser Verification Resume

- Interrupted changes were classified before rerunning: `.gitignore` Playwright artifacts, the explicitly gated Supabase fixture, and the Playwright config are valid test-fixture fixes; removing `/cart` from the edge `PROTECTED` list is a valid implementation fix because guest checkout already makes the cart page public while order creation remains API-authorized; the broad six-viewport spec is a brittle/incomplete experiment because it includes reload/back behavior outside the requested baseline and never selects a required option. No unrelated accidental changes were found.
- The interrupted run retained no HTML report, trace, screenshot, video, terminal log, or dev-server log. `test-results` exists but is empty, and `playwright-report` does not exist, so no visual state from that run can be claimed.
- Exact blocker before rerun: the canonical storefront model exposes only flat optional `menu_item_addons`; `lib/validators.test.ts` explicitly documents that there is no required option-group/min-max selection model. The current fixture therefore cannot satisfy the required-option baseline without a production-aligned model repair, and the current spec incorrectly labels all available choices as optional.
- Baseline browser iteration 1 reached the cart, edited notes, removed the line, and undid removal. Its retained screenshot, accessibility snapshot, and trace showed the payment button and consent section but no guest identity fields or checkout section. Root cause: when `customer_wallet_enabled` was false or unresolved, `walletLoading` initialized true and was never cleared despite the source comment promising Paystack-only checkout; the exact `Checkout` text assertion was also not a stable readiness signal. The grounded repair clears wallet loading on the disabled-feature branch and waits for the labelled guest-name field instead.
- Baseline browser iteration 2 confirmed the guest checkout fields render after that repair. It failed only because Playwright's fuzzy `getByLabel('Name')` matched the exact guest field plus `Location name` and quantity buttons whose accessible names contain the product name. The final baseline locator uses exact accessible-name matching.
- Baseline browser iteration 3 passed all scenario assertions at 390x844 and produced `guest-terms-390x844.png`. The command still exited 1 because the 90-second global bound elapsed while Playwright attempted to tear down the `npm.cmd`-wrapped Next dev server. This is runner lifecycle behavior after the scenario passed; the harness now launches Next directly and allows a bounded 120 seconds so Playwright can terminate the owned process cleanly during the required 320x700 and 412x915 run.
- The subsequent 320x700 run never entered the test: Chromium headless shell launched as PID 13496 but did not establish its remote debugging pipe, then Playwright exhausted the bounded suite and teardown windows. The process was gone after the command and no owned Node/headless process remained; only pre-existing interactive Chrome processes were present and were not touched. The harness now caps browser launch at 20 seconds. Per the three-iteration limit, 390x844 is the only exercised passing viewport; 320x700 is environment-blocked at browser startup and 412x915 plus remaining viewports were not claimed or rerun.

## 2026-07-22 Phase E Group Ordering

- The preserved group commits added add-on snapshots and a picker, but did not make group ordering complete: API access required permanent customer sessions, participants existed only after adding an item, participant count was hard-coded to three, status was mostly `OPEN/CHECKED_OUT/EXPIRED/CANCELLED`, and add-versus-lock had no transaction boundary.
- The old UI exposed split-wallet controls even though the requested initial model is organizer-paid. Payment collection also had two inconsistent legacy implementations. The supported path now hard-disables split activation; legacy SQL/functions are retained only for migration compatibility and are unreachable.
- Group creation did not capture a name, destination, fulfilment method, deadline choice, participant limit, budget, or shared note. The canonical storefront now captures these fields and the create API verifies an active approved vendor plus a phone-verified organizer.
- Guest participants now receive a 256-bit capability in an httpOnly, same-site cookie; only its SHA-256 hash is stored. Removed, expired, cancelled, and placed groups cannot reuse the capability for mutation.
- Atomic database functions lock the group row before add, update, delete, readiness, or organizer lock transitions. This gives deterministic winner semantics when a participant saves while an organizer locks and gives stale tabs explicit conflict responses.
- Final lock reconciliation checks vendor state, participant readiness, budgets, item availability, base price changes, add-on availability, and add-on price changes. Checkout accepts only the exact reconciled item/add-on/quantity/note multiset and one order per group.
- Guest participants intentionally receive no WhatsApp notification because no verified phone is collected in the participant flow; they can re-enter through their scoped cookie and shared link. Authenticated participants continue to use existing notification infrastructure.

## 2026-07-22 Phase F Feed Restoration

- Vendor publishing was not removed by a schema migration or feature flag. Migration `105_lumex_feed.sql` created the canonical posts, media, menu-link, interaction, attribution, ranking, and moderation tables; migrations `114` through `118` added protected official content, stories, social profiles, and qualified views. `feed_enabled` and `feed_posting_enabled` remain enforced feature flags with enabled defaults.
- Commit `515948b` restricted customers to moderated stories while retaining vendor feed posts; `974c76b` reverted that restriction and `91b6f96` reapplied it. Commit `afafdd2` added feed profiles and vendor experience changes, `c02355c` reverted them, and `397e496` reapplied them. The narrower UI/reliability restoration in `bda7ba9` was reverted by `df3e73b`; current code later recovered several of those reliability changes but not a vendor publishing workspace.
- Current server authorization already allows feed posts only for the protected official profile, approved verified active vendors, and approved ambassadors. Customers are story-only, riders are blocked, vendor menu attachments are ownership-checked, and only admin/super-admin sessions can select the system-owned LumeX author.
- The practical removal is discoverability and incomplete authoring UI: the vendor dashboard has no Feed/Post navigation item, its video manager sends `Create post` to `/feed-v2` instead of `/feed-v2/create`, and the composer publishes only text/media even though the canonical API already supports drafts, edits by `draft_id`, owned menu-item links, and promotions.
- Existing canonical routes already cover likes, bookmarks, follows, replies, reposts, quotes, shares/events, reports, archive, restore, soft-delete, moderation, pagination, and feed profiles. Existing feed rendering currently uses a 55%-visible two-second dwell before sending a qualified impression; event storage deduplicates one viewer/post/day, so render, preload, invisible cards, and rapid same-account refreshes are not counted as new qualified views.

## 2026-07-22 Final Boundary

- All ready local Phase F work is implemented and verified. The second Phase F commit cannot be created in the current environment: unprivileged Git cannot create `.git/index.lock`, and the required escalation request was rejected because the approval service quota is exhausted until 2026-07-28 18:02. No alternate Git-index workaround was attempted.
- This leaves a valid, explained working-tree diff for the feed experience slice and durable records. It is the only reason the repository cannot be left clean.
- Browser evidence remains limited to the passing 390x844 scenario. The 320x700 run was blocked before test execution by Chromium's debugging-pipe startup stall; 360x800, 412x915, 768x1024, and desktop remain unexercised and are not claimed.
- No real payments, production credentials, user data, or production deployment were used.

## 2026-07-28 Browser Completion

- The former Git-index blocker was resolved outside this run: `54292e7` committed the feed experience slice and the repository was clean before the final browser repair.
- A new 320px artifact exposed a real checkout issue: the fixed payment action visually covered guest identity fields. The cart now switches to an inline final action after checkout enters the viewport, and the browser assertion verifies the final action is below consent.
- The first complete viewport run exposed a second real issue only at 768x1024 and desktop: the persistent bottom navigation shared the product-sheet stacking level and intercepted Add to cart. Raising the active product-selection overlay resolves the interaction without changing the navigation.
- An explicitly owned fixture server with `PLAYWRIGHT_REUSE_SERVER=1` allows Playwright to finish cleanly. The final all-viewport run passed 6/6; no browser verification blocker remains.

## 2026-07-28 Guest Entry Repair

- Production verification exposed a product-entry gap rather than a checkout defect: `/cart` and storefronts were public, but the landing page's Start ordering route pointed to registration and the marketplace `/home` was protected by the edge proxy.
- The existing marketplace server component is guest-safe: it already accepts a missing session and only loads customer favorites/location preference for a customer session. The repair therefore opens browse access without widening any authenticated API route.
