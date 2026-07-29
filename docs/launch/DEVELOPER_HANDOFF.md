# Developer handoff

Last verified: 2026-07-29

## Architecture and request flow

LumeX Fud is a strict-TypeScript Next.js App Router application backed by
Supabase PostgreSQL. Pages and route handlers live in `app/`; reusable decisions
live in `lib/`; `components/` is presentation; and
`supabase/migrations/` is the append-only database history. A normal mutation is:

1. validate the request (usually Zod),
2. resolve the signed application session,
3. confirm the database session is live and authorize the role/resource,
4. load authoritative records with a server client,
5. execute a business helper or locked RPC,
6. write snapshots/audit state,
7. return only the role-safe projection.

The application uses custom JWT cookies plus database session revocation, not
Supabase Auth UI. `proxy.ts` handles coarse route roles, lockdown and headers;
every API still performs resource authorization; RLS and column grants are the
database backstop. The service-role key is server-only.

## Order lifecycle

The cart is client state, but checkout is not. `POST /api/orders` reloads menu
items/add-ons, enforces one vendor and availability, calculates delivery and
fees, reserves an eligible promotion, snapshots every kobo component and creates
the order under an idempotency key. Paystack initialization follows. A signed
`charge.success` webhook verifies the reference and amount before committing
payment/promotion and notifying the vendor.

The operational path is pending → accepted/preparing → ready → rider assigned →
collected → delivered → completed. Status changes are actor/resource checked and
recorded in status history. The delivery handover routes own the private
customer code/proof path. The completion cron and on-demand backstop both
delegate money movement to `lib/order-payout.ts`.

## Payment and promotion lifecycles

`app/api/paystack/webhook/route.ts` reads the raw body, verifies Paystack HMAC
with `PAYSTACK_SECRET_KEY`, records `(reference,event)` before processing, waits
for processing, and releases a failed claim for provider retry. Never acknowledge
money based on a redirect, screenshot or client status.

Promotion eligibility is calculated in `lib/promotion.ts`; locked database RPCs
reserve, commit or release usage/funds. The promo fund is an immutable integer-
kobo marketing ledger. LumeX-funded orders reserve then debit it; vendor-funded
discounts do not touch it and are deducted from vendor settlement. Keep the kill
switch on until the documented drills reconcile.

## Settlement rules

Order snapshots are the settlement record. `lib/order-payout.ts` calculates:

- vendor earning = subtotal − vendor commission snapshot − vendor-funded promo,
- rider earning = rider delivery-cut snapshot + tip,
- platform records retain the snapshotted platform/guest/commission components.

Credits are held wallet transactions and claimed with `orders.wallet_released`.
Do not recreate these formulas in a cron or UI. Refunds must reconcile provider,
order and ledger state; never derive a refund solely from a displayed total.

## Roles and permissions

- Customer: own profile, orders and addresses; guests get one order-scoped
  HttpOnly token.
- Vendor: own menu, storefront, orders, finance and settings.
- Rider: own profile/wallet and currently assigned order.
- Admin: operational tools only; cannot assume platform-wide super-admin powers.
- Super-admin: controls, pricing, security, team and exceptional reconciliations.

Use helpers in `lib/session.ts`, `lib/pin-auth.ts` and the existing route patterns.
Never weaken proxy, session-live checks, RLS, grants or sensitive reauthorization.

## Feature flags and controls

Catalog flags are in `lib/features.ts`, stored as `settings.id =
feature.<key>`, cached briefly and unknown keys fail closed. Client fallback
flags in `lib/use-features.ts` hide optional capabilities until fetched.
Operational controls in `lib/controls.ts` are separate: maintenance, lockdown,
ordering hours, payouts, withdrawals and notification state. Control read
failure intentionally freezes sensitive operations.

Launch defaults/requirements are recorded in `MVP_SCOPE.md`; DVA, customer
stored value, Study, AI, WhatsApp bot commerce, Premium and pickup stay off.

## Environment and deployment

Node 22+ and npm are required. `.env.example` is the variable-name authority.
Core production variables are Supabase URL/anon/service-role keys, `JWT_SECRET`,
application URL, Paystack public/secret keys, `CRON_SECRET`, `ENCRYPTION_KEY`,
admin bootstrap identity, Upstash and the selected notification providers.
Optional systems require their named flags as well as provider variables.

Safe deployment order:

1. keep maintenance enabled, payouts/withdrawals frozen, promo kill switch on,
   DVA/customer wallet off;
2. back up the database and compare migration history;
3. run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`,
   `npm run build`, and `git diff --check`;
4. deploy the exact tested commit to preview;
5. run role/BOLA, low-value Paystack, failure/replay/refund and complete
   customer→vendor→rider→handover→settlement drills;
6. reconcile provider, order and ledger kobo values;
7. promote that exact commit; reopen ordering only after every launch gate in
   `MVP_CERTIFICATION.md` is signed off.

The GitHub workflow verifies test/typecheck/lint/build before its optional
Vercel deploy. CI placeholder variables are scoped only to the build step and
cannot become deployment configuration.

## Debugging paths

- Checkout mismatch: compare `/api/orders/estimate`, `POST /api/orders`,
  `lib/launch-delivery-pricing.ts`, live menu/settings and order snapshots.
- Paid but pending: inspect `processed_webhooks`, the Paystack reference/amount,
  webhook logs and payment handler. Do not manually mark paid.
- Missing earnings: inspect `orders.wallet_released`, commission/promo
  snapshots, `lib/order-payout.ts`, held wallet transactions and cron health.
- Stuck rider: inspect assignment, `active_order_id`, current status and order
  history; completion should free only the rider bound to that order.
- Promotion mismatch: inspect eligibility, reservation expiry, funding source,
  immutable fund ledger and reconciliation view.
- Access issue: follow proxy → session/live check → route resource check → RLS.
- Notification issue: inspect committed order status, notification/email event
  rows and provider delivery event; notifications must not drive money state.

## Dangerous areas

Money and authorization changes require focused regression tests and migration
review. Applied migrations are immutable. Beware service-role queries, webhook
claim ordering, wallet-release idempotency, guest/group tokens, vendor/rider
resource IDs, cached controls, order snapshot fields and notification retries.
The disabled WhatsApp ordering handler contains an older pricing path and must
be reconciled with launch pricing before that feature is ever enabled.
