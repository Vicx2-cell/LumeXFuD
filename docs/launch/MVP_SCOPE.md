# Launch MVP scope

Last verified: 2026-07-29

The actual MVP is the smallest controlled flow that can take a recomputed,
paid order from an approved storefront through vendor preparation, rider
delivery, auditable completion and correct settlement.

## Required for launch

- Registered and guest discovery of approved, available vendors and live menu
  items through public storefronts.
- A single-vendor cart with live item/add-on availability validation.
- Server-side subtotal, delivery fee, platform/guest fee, vendor commission,
  promotion and provider-amount calculation in integer kobo.
- Idempotent order creation, Paystack initialization, signed webhook handling,
  server verification/requery where needed, and replay-safe payment commitment.
- Vendor receipt, accept/reject/preparation/ready workflow with order history.
- Rider onboarding/approval, availability, race-safe assignment or acceptance,
  collection, delivery and release from the active order.
- A private customer delivery code (or explicitly controlled proof path) and an
  immutable order-status audit trail. Code exists but must be enabled and drilled
  before ordering is reopened.
- Vendor commission, vendor-funded promotion deduction, rider payout, held
  earnings, settlement idempotency and reconciliation.
- Refund/dispute operations and Paystack refund-event reconciliation.
- Customer/guest scoped order tracking and required in-app/provider
  notifications.
- Admin visibility and intervention for users, vendors, riders, orders,
  disputes, wallets and incidents.
- Layered authentication, route authorization, RLS, role/vendor/rider
  isolation, maintenance mode, payout/withdrawal controls and production
  observability.

## Included but not launch-critical

- Feed discovery and publishing where its granular flags remain enabled.
- Group ordering; it resolves to the same host-paid, one-vendor checkout.
- Reviews, referrals, leaderboards, loyalty presentation, push notifications,
  vendor analytics/marketing pages and order chat.
- Public partner applications and additional storefront aliases.
- Admin promotion tooling; no LumeX-funded campaign is required to complete a
  normal launch order.

## Disabled for launch

- Dedicated Virtual Accounts: both `customer_virtual_accounts` and
  `PAYSTACK_DVA_ENABLED` must remain false.
- Customer stored-value wallet, sponsor top-up and wallet payment.
- Promotion campaigns funded by LumeX: keep `promo.kill_switch` enabled until
  the fund and concurrent paid/failed/expired flows reconcile.
- Pickup, AI master features, Study, WhatsApp bot ordering, Premium,
  paid/sponsored feed and external connected-data integrations.
- Delivery handover must remain off only while ordering is closed; it is an
  explicit gate to enable and test before a controlled launch.

## Post-launch

- AI assistants and menu digitization, Study, WhatsApp commerce, Premium,
  boosts, creator rewards, missions and connected Google/TikTok data.
- Customer stored value and sponsor funding, if separately regulated and
  designed; it is not implied by DVA receipts.
- Permanent DVA rollout after Paystack confirms merchant/customer eligibility
  and signed assignment/charge/requery drills.
- Routing-provider distance in place of the calibrated road multiplier.
- Refactoring oversized feed/cart/order modules and centralizing the remaining
  status-transition presentation helpers.
