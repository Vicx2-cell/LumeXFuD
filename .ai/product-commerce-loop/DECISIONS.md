# Product Commerce Loop Decisions

## 2026-07-21

- Preserve all fraud-security and operational readiness work.
- Do not change production deployment or real payment behavior.
- Treat guest checkout as a scoped restoration/integration task because repository docs disagree.
- Start with mobile add-on/cart correctness because it is a direct conversion blocker and the brief calls it out.
- Use additive `group_order_items.addons` JSONB snapshots to preserve shared cart choices without changing the core order/payment architecture.
- Keep the direct group-page add-on picker as the next focused UX slice rather than overexpanding this commit.
- Guest checkout is delivery-only and Paystack-only for now; account-bound wallet, pickup, group orders, rewards, ratings, and chat remain authenticated.
- Store only `guest_access_token_hash`; raw guest tokens live in the Paystack callback URL and are never persisted.
- Keep the SEO profile link available as a secondary vendor share asset, but make direct ordering the default copy target.
- Open the product configuration sheet for every normal vendor menu item, even when no add-ons exist, so notes and future option controls share one reachable mobile surface.
- Store menu item images on cart lines for cart review, while continuing to use server-authoritative menu and add-on pricing during order creation.
- Use a short-lived client-side undo snapshot for cart removals rather than silently restoring or mutating selections.
- Implement `/store/[slug]` as a commerce entry point that reuses the existing live vendor order page instead of cloning menu/cart/checkout behavior.
- Keep `/uturu/vendor/[slug]` available as the content/SEO profile; `/store/[slug]` is the shareable ordering storefront.
- Reject reserved platform words for storefront slugs at the route-helper layer and rely on the existing vendor visibility filter for inactive, suspended, or deleted vendors.
- Treat guest checkout as identified ordering, not anonymous ordering: guests must provide name, phone, and explicit terms/privacy acknowledgement.
- Reuse the existing order idempotency header contract from the cart and keep the same key across connection errors; clear it after server validation failures so corrected payloads can retry cleanly.
- Classify existing admin operational routes under the admin/super-admin route policy and classify `/api/health` as public so the central coverage backstop remains authoritative.
- Keep customer order chat actor creation explicit (`session && session.role === 'customer' && session.userId`) to preserve the one-order customer-only communication guard.
- Keep `/cart` public at the edge because the product supports identified guest checkout; order creation remains authorized and validated in `/api/orders`.
- Reuse `menu_item_addons` for a single required-choice group via `is_required`: required rows are alternatives and the customer must choose exactly one. This extends the canonical pricing and snapshot path instead of introducing a parallel option engine.
- Gate deterministic Playwright data behind both `PLAYWRIGHT_COMMERCE_FIXTURE=1` and a fixed non-production service key. The fixture never opens a real Supabase connection, uses no real payment, and cannot activate under production credentials.
- Bound Playwright to one Chromium worker, zero retries, explicit route/field assertions, failure traces/screenshots, a 20-second browser-launch cap, and a 120-second global cap.
- Keep group states uppercase to migrate the existing table in place; rename `CHECKED_OUT` data to `PLACED` and add the missing lifecycle states rather than creating a parallel status system.
- Model every organizer/member as a `group_order_participants` row. Permanent customer identity is optional for participants, while organizer identity remains a verified customer account.
- Serialize contribution mutations and locking on the `group_orders` row and use expected versions for stale-tab detection. Final placement has a partial unique index on `orders.group_order_id` in addition to ordinary checkout idempotency.
- Support organizer-paid checkout only. `split_enabled` is migrated false, UI/API toggles are removed, and order creation cannot activate participant wallet collection from stale data.
- Preserve each participant line separately in the organizer cart so notes are not merged or lost; `/api/orders` compares the exact reconciled line multiset before linking the group.
- Expire abandoned groups every 15 minutes through the existing authenticated cron-health framework.
