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
