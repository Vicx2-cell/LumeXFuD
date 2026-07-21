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
