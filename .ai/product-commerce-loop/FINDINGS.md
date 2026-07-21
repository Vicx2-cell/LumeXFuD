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
