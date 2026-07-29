# LumeX Fud repository map

Last verified: 2026-07-29

This is the navigation guide for the current repository. `app/` contains HTTP
and UI entry points; `lib/` owns reusable business rules; and
`supabase/migrations/` is the append-only database authority. Browser input is
never authoritative for identity, role, price, distance, discount, order state,
or provider payment state.

## Top-level layout

| Area | Purpose and entry points | Dependencies and data | Launch classification |
| --- | --- | --- | --- |
| `app/` | Next.js App Router pages, layouts and 250 `app/api/**/route.ts` handlers. | `components/`, `lib/`, Supabase and external providers. | Active; contains launch and gated post-launch routes. |
| `components/` | Reusable customer, commerce, navigation, feed and role-dashboard UI. | React, client feature context, route APIs. | Active. Components proven unreferenced were removed. |
| `lib/` | Authentication, authorization, pricing, promotion, payment, payout, notification and operational rules. | Server-only Supabase client, provider clients, shared types. | Active and authoritative for business rules. |
| `types/` | Cross-module TypeScript contracts. Co-located `types.ts` files hold route-specific view models. | Database-facing application code. | Active. |
| `supabase/migrations/` | 154 append-only SQL migrations: tables, RPCs, triggers, grants, RLS and reconciliation changes. | Production Supabase PostgreSQL. | Active database authority; never edit applied files. |
| `test/`, `**/*.test.ts` | Contract, unit, security and PGlite database tests. | Vitest and PGlite. | Active. |
| `e2e/` | Browser journeys and role-isolation checks. | Playwright and a configured environment/fixture. | Active but live/provider execution is an external gate. |
| `public/` | PWA assets, icons and static product media. | Next static serving and manifest references. | Active; generated demo artifacts outside this directory were removed. |
| `scripts/` | Explicit operational diagnostics, reconciliation, screenshots and fixture utilities. | Node, Playwright, Supabase/Upstash credentials where documented. | Active/manual; not application imports. |
| `docs/` | Operations, security, product and launch handoff documentation. | Current code and deployment configuration. | Active; `docs/launch/` is release authority. |
| `.ai/` | Historical review artefacts and design/audit working notes. | None at runtime. | Archive/reference only; not release authority. |
| `.github/` | Pull-request guidance and build/deploy workflow. | GitHub Actions, Node 22, optional Vercel secrets. | Active infrastructure. |
| `proxy.ts` | Request security headers, session/role routing, lockdown and privileged-route risk checks. | `lib/session`, controls, security events. | Active security boundary. |
| `vercel.json` | Cron schedules for order, payout, wallet, promotion, feed and monitoring jobs. | `CRON_SECRET`, corresponding API handlers. | Active infrastructure; schedules require deployed verification. |

## Product and system map

| System | UI entry points | API / server entry points | Principal tables / RPCs | State |
| --- | --- | --- | --- | --- |
| Customer product | `/home`, `/store/[slug]`, `/vendor/[id]`, `/cart`, `/orders`, `/order/[orderNumber]`, `/profile` | `/api/vendors`, `/api/orders`, `/api/orders/estimate`, order status/message/rating routes | `customers`, `vendors`, `menu_items`, `orders`, `order_items`, `notifications` | Launch MVP, active; ordering remains maintenance-controlled. |
| Vendor product | `/vendor-dashboard`, `/vendor-dashboard/menu`, `/vendor-dashboard/orders`, finance/settings/store pages | `/api/vendor/menu`, `/api/vendor/orders`, vendor-scoped reviews/settings routes | `vendors`, `menu_items`, `orders`, `wallets`, `wallet_transactions` | Launch MVP, active. Analytics/marketing extras are non-critical. |
| Rider product | `/rider`, `/rider/wallet`, `/rider/settings` | `/api/rider/orders`, `/api/riders/[id]/accept`, status and order collect/deliver routes | `riders`, `orders`, `wallets`, `wallet_transactions` | Launch MVP, active. |
| Admin product | `/admin`, vendors, riders, orders, disputes, promotions and wallets | `/api/admin/**` | Operational tables plus `admins`, `audit_logs`, `security_events` | Launch MVP oversight, active; sensitive actions re-authorize. |
| Super-admin | `/super-admin/controls`, pricing, security, cron and financials | `/api/super-admin/**` | `settings`, controls, incidents, audit and money views | Active operational authority, not a customer feature. |
| Authentication | `/auth`, register/setup/recovery pages | `/api/auth/**`, `proxy.ts`, `lib/session.ts`, `lib/pin-auth.ts` | role tables, `sessions`, PIN/recovery/webauthn records | Active custom JWT + database-session system. Not Supabase Auth UI. |
| Cart | `/cart`, cart context/provider | order estimate and create APIs | no durable cart table for ordinary checkout; validated items become `order_items` | Launch MVP; client enforces one vendor and server revalidates it. |
| Ordering | customer, guest and group checkout pages | `/api/orders`, `/api/group-order/**`, status/cancel/confirm/collect/deliver APIs | `orders`, `order_items`, `order_status_history`, group-order tables | Launch MVP. Idempotency and server recomputation are required. |
| Pricing | cart/checkout display; super-admin pricing editor | `/api/orders/estimate`, `/api/orders`, `/api/super-admin/pricing`; `lib/launch-delivery-pricing.ts` | `settings`, delivery zones/locations, immutable order snapshots | Launch MVP. Launch checkout uses one delivery quote implementation. |
| Payments | Paystack redirect and order status | `/api/paystack/webhook`, `/api/paystack/refund`, `lib/paystack/*` | `orders`, `processed_webhooks`, refund/payment records | Code active; live keys, callback and transaction drills are external gates. |
| Promotions | `/admin/promotions`, `/admin/promotions/fund` | `/api/admin/promotions*`, checkout promotion helpers | `promotions`, promo reservations/redemptions/fund ledger; reserve/commit/release RPCs | Implemented but campaign kill switch must stay on until funded drills pass. |
| Settlements | vendor/rider finance and admin financials | release-payment cron, `lib/order-payout.ts`, reconciliation jobs | order commission/payout snapshots, wallets and wallet transactions | Launch-critical. `lib/order-payout.ts` is the payout authority. |
| Payouts / withdrawals | vendor/rider wallets and admin controls | wallet withdraw/verify routes, release and reconciliation crons | `wallets`, `wallet_transactions`, bank/transfer records | Implemented; frozen/manual controls remain launch gates. |
| Delivery | checkout location/fee, rider workflow, order tracking | estimate, rider accept, collect, handover/deliver APIs | locations/zones, orders, status history, delivery proof | Launch-critical. Handover code is implemented but disabled pending a controlled drill. |
| Notifications | notification bell, order chat/tracking | notification, push and order communication routes; `lib/notify*` | `notifications`, push subscriptions, communication tables | Required order notifications implemented; provider delivery is externally configured. |
| Email | account/order/admin email surfaces | Resend webhook, `lib/email/`, transactional email helpers | email event/delivery/retry records | Active fallback/operational channel; Resend domain/webhook is external. |
| Feed | `/feed-v2` and feed profiles/posts | `/api/feed/**` | feed posts, profiles, reactions, follows, reports and media | Included but not launch-critical. Feature flags gate server actions and UI. |
| Storefronts | `/store/[slug]`, `/vendor/[id]`, `/uturu/vendor/[slug]` | public vendor/menu APIs | approved vendors and available menu items | Launch MVP; multiple URL forms are compatibility entry points, not price authorities. |
| Guest checkout | storefront/cart and order-token tracking | `/api/orders`, guest cookie/token checks | guest identity snapshot on `orders` | Launch MVP; uses transaction-specific Pay with Transfer, never permanent DVA. |
| Group ordering | `/group/[code]`, cart group banner | `/api/group-order/**` | group order/session/item tables, final `orders` | Included and tested; non-essential to a single-customer launch. |
| Refunds / reconciliation | `/refunds`, admin disputes/financials | Paystack refund API/webhook and reconciliation crons | refunds, orders, webhook, wallet and reconciliation records | Launch-critical operational capability; live provider drill required. |
| Security | role surfaces, controls and audit screens | `proxy.ts`, route authz, security/risk modules | RLS-enabled tables, sessions, audit/security events | Launch-critical layered boundary. Service-role access is server-only. |
| Maintenance / monitoring | super-admin controls, sentinel and cron views | controls, health, sentinel and cron APIs | `settings`, health/incidents/audit tables | Launch-critical. Reads fail closed for lockdown/payout controls. |
| DVA | `/profile/virtual-account` | `/api/customer/virtual-account`, Paystack DVA webhook/requery helpers | DVA customer/account/receipt/consent records | Disabled for launch. Receipts are unallocated and never credit a customer wallet. |
| Customer stored value | `/profile/wallet`, sponsor routes | `/api/customer-wallet/**`, `/api/sponsor-wallet/**` | historical customer wallet records | Disabled and excluded from launch MVP. Vendor/rider earnings wallets are separate. |
| AI, Study, WhatsApp bot, Premium | their named pages/routes | AI, study, WhatsApp, premium APIs | feature-specific tables/settings | Disabled for launch. The WhatsApp ordering handler is not a launch pricing path. |

## Dependency direction

The intended direction is `app route/page → lib rule/service → Supabase/provider`.
Client components may call public APIs but must not import the service-role
client. Route handlers authenticate and authorize before privileged database
access. `proxy.ts`, route checks and RLS are complementary boundaries; none is a
substitute for another.

No import cycles remained after route view-model types were moved out of server
pages into co-located `types.ts` files. Large feed and commerce modules remain
safe refactor candidates, but splitting them during release certification would
add unnecessary behavioral risk.
