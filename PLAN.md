# LumeX Fud Expansion Plan

Step 1 repository read completed on 2026-07-08. This file is the implementation contract for the requested 7 items. Anything not listed here is out of scope unless a listed change cannot be made without it.

## Repository Notes

- Package metadata currently uses Next `16.2.6` in `package.json`, while the prompt describes Next.js 15. I will follow the codebase as installed.
- Current money path is double-entry kobo based. The HIGH RISK modules are `lib/paystack/webhook.ts`, `app/api/paystack/webhook/route.ts`, `lib/order-refund.ts`, `lib/order-payout.ts`, `lib/wallet.ts`, `lib/customer-wallet.ts`, `lib/platform-earnings.ts`, `app/api/orders/route.ts`, `app/api/orders/[id]/status/route.ts`, `app/api/orders/[id]/deliver/route.ts`, `app/api/orders/[id]/collect/route.ts`, `app/api/orders/[id]/cancel/route.ts`, `lib/pickup.ts`, `lib/order-settle.ts`, `app/api/cron/vendor-auto-cancel/route.ts`, `app/api/cron/release-payments/route.ts`, `app/api/cron/release-scheduled/route.ts`, and `app/api/admin/disputes/[id]/resolve/route.ts`.

## Hardcoded City And Fee Checklist

### City or Uturu strings

- `app/page.tsx:13`, `29`, `30`, `209` - homepage metadata/content hardcodes ABSU/Uturu.
- `app/layout.tsx:35`, `47` - site description/keywords hardcode Uturu.
- `app/contact/page.tsx:49` - contact page location hardcodes ABSU campus, Uturu.
- `app/admin/live/ops-map.tsx:25` - map fallback comment says ABSU, Uturu campus centre.
- `components/lodge-map.tsx:18` - map default centre comment says ABSU main campus, Uturu.
- `components/structured-data.tsx:3`, `35`, `38`, `47`, `61`, `69`, `75` - JSON-LD hardcodes ABSU/Uturu.
- `components/vendor-location-editor.tsx:127` - placeholder uses Uturu market road.
- `lib/seo/config.ts:1`, `2`, `11`, `15`, `16`, `28` - public SEO config and `/uturu` path hardcode Uturu.
- `lib/seo/guides.ts:1`, `28`, `29`, `32`, `40`, `56`, `69` - guide content/path hardcodes Uturu.
- `lib/seo/jsonld.ts:97`, `122` - JSON-LD references `/uturu`.
- `lib/seo/vendor-data.ts:6` - `/uturu/vendor/[slug]` dataset comment.
- `app/uturu/layout.tsx:4`, `11` - route-level layout is explicitly Uturu.
- `app/uturu/vendor/[slug]/page.tsx:18`, `76` - `/uturu` public vendor page comments/breadcrumb.
- `app/uturu/guides/[slug]/guide-content.tsx:21`, `64`, `135`, `198`, `231`, `256` - guide copy/links hardcode Uturu.
- `app/sitemap.ts:13`, `27`, `app/robots.ts:18`, `components/seo/seo-header.tsx:3`, `lib/vendor-visibility.ts:4` - `/uturu` SEO route references.
- `lib/whatsapp-kb.ts:17`, `20` - WhatsApp knowledge base hardcodes ABSU/Uturu service area.
- `supabase/migrations/089_vendor_slug.sql:5`, `17` - migration comments mention `/uturu`.

### Delivery fee, platform markup, and delivery split constants

- `supabase/migrations/010_seed_settings.sql:8-15` - current canonical seed values: platform markup 25000, bike fee 50000, door fee 100000, rider cuts 40000/80000, min order 50000. These are existing values, not new invented values.
- `app/cart/page.tsx:127`, `129` - checkout UI falls back to BIKE 50000, DOOR 100000, markup 25000.
- `app/api/orders/route.ts:22-24`, `236-244`, `255`, `461` - order creation uses delivery/platform/rider/min-profit fallbacks. HIGH RISK because this computes totals before wallet/Paystack.
- `app/api/settings/fees/route.ts:14-16` - fee endpoint maps settings keys for client.
- `app/api/super-admin/pricing/route.ts:14-28` - super-admin pricing maps and fallback constants.
- `app/api/chow-ai/route.ts:230-243` - AI cart quote reads settings with fee fallbacks.
- `lib/whatsapp-handler.ts:176`, `185-190`, `703`, `818-821` - WhatsApp manual-order flow reads settings with hardcoded fee/rider-cut fallbacks and creates manual orders.
- `lib/seo/pricing.ts:17-20`, `37-42` - public SEO pricing fallbacks.
- `app/refunds/page.tsx:17`, `26-29` - refund policy reads settings with fallbacks.
- `app/terms/page.tsx:16` - minimum order fallback 50000.
- `docs/payments.md:34-37`, `lib/whatsapp-kb.ts:39-41`, `lib/platform-earnings.ts:15-16` - docs/copy describe current fee amounts.
- Related non-delivery monetary constants found but out of scope unless affected: wallet min/topup/withdrawal limits, reward amounts, subscription prices, tip cap.

## Current Vendor Schema And Food-Only Assumptions

- `supabase/migrations/001_core_schema.sql` defines `vendors` with `phone`, `shop_name`, `owner_name`, `logo_url`, `shop_photo_url`, `prep_time_minutes`, `status`, `busy_until`, `paused_until`, `category TEXT NOT NULL`, Paystack bank/subaccount columns, subscription fields, ratings, `is_active`, approval timestamps, soft delete.
- `supabase/migrations/001_core_schema.sql` defines `menu_items` with `vendor_id`, `name`, `description`, `price_kobo`, `image_url`, `category CHECK ('RICE','PROTEIN','DRINKS','SNACKS','OTHER')`, availability/daily limits/display order. This is the primary food-only schema.
- `types/index.ts` mirrors `Vendor`, `MenuItem`, and `Order` with vendor terminology and food menu categories.
- Food-only UI/copy lives in `app/vendor-dashboard/menu/page.tsx`, `app/vendor/[id]/page.tsx`, `app/vendor/[id]/vendor-menu-client.tsx`, `app/cart/page.tsx`, `components/chow-ai.tsx`, `lib/whatsapp-handler.ts`, `lib/whatsapp-kb.ts`, `lib/seo/*`, and public `/uturu` pages.
- Existing `vendors.category` is a free text business/menu category, not a strict merchant category enum. Item 2 must add `merchant_category` or a controlled enum while keeping current `category` behavior until migrated.

## Current Order State Machine

Current states from schema/types/code:

- Payment/queue states: `PENDING_PAYMENT`, `SCHEDULED`, `PENDING`.
- Main delivery states: `VENDOR_ACCEPTED`, `PREPARING`, `READY`, `RIDER_ASSIGNED`, `PICKED_UP`, `DELIVERED`, `COMPLETED`.
- Terminal/problem states: `CANCELLED`, `DISPUTED`, `REFUNDED`, `NO_SHOW`.

Files that transition or rely on transitions:

- `app/api/orders/route.ts` creates `PENDING_PAYMENT`; wallet/group paid paths update to `SCHEDULED` or `PENDING`. HIGH RISK payment entry.
- `lib/paystack/webhook.ts` updates paid Paystack orders to `SCHEDULED` or `PENDING`; failed charges to `CANCELLED`; split-wallet failure to `CANCELLED`. HIGH RISK webhook.
- `app/api/orders/[id]/status/route.ts` has the main whitelist: `PENDING -> VENDOR_ACCEPTED -> PREPARING -> READY -> RIDER_ASSIGNED -> PICKED_UP -> DELIVERED -> COMPLETED`, plus cancellations and disputed resolutions. HIGH RISK because `COMPLETED` releases escrow to held wallets.
- `app/api/riders/[id]/accept/route.ts` race-safely claims `READY -> RIDER_ASSIGNED` and sets rider `BUSY`.
- `app/api/orders/[id]/deliver/route.ts` handover path claims `PICKED_UP -> COMPLETED`, sets `delivered_at/completed_at`, and runs payout. HIGH RISK.
- `app/api/orders/[id]/collect/route.ts` pickup collection path claims pickup `READY -> COMPLETED` and runs payout. HIGH RISK.
- `app/api/orders/[id]/cancel/route.ts` claims cancellable states to `CANCELLED` and calls `refundOrderPayments`. HIGH RISK refund.
- `app/api/orders/[id]/dispute/route.ts` and `app/api/admin/disputes/[id]/resolve/route.ts` move orders into/out of `DISPUTED`; refund resolution calls refund/clawback. HIGH RISK.
- `lib/pickup.ts` handles pickup `READY -> NO_SHOW` and vendor-side fail `PENDING/VENDOR_ACCEPTED/PREPARING -> CANCELLED` with refund. HIGH RISK.
- `lib/order-settle.ts`, `app/api/cron/vendor-auto-cancel/route.ts` auto-cancel pending orders and refund. HIGH RISK.
- `app/api/cron/release-scheduled/route.ts` releases scheduled orders to `PENDING`. HIGH RISK because paid orders become live.
- `app/api/cron/release-payments/route.ts`, `lib/order-payout.ts` settle `DELIVERED/COMPLETED` payouts. HIGH RISK.
- UI/status consumers: `app/vendor-dashboard/page.tsx`, `app/rider/page.tsx`, `app/orders/page.tsx`, `app/order/[orderNumber]/page.tsx`, `app/order/[orderNumber]/order-status-client.tsx`, `lib/live-ops.ts`, admin/live pages, tests.

Requested new explicit machine maps as:

- `placed` should be an alias/adapter for existing paid-live `PENDING`.
- `vendor_ack` should be an alias/adapter for `VENDOR_ACCEPTED`.
- `ready_for_pickup` should be an alias/adapter for `READY`.
- `in_transit` should be an alias/adapter for `PICKED_UP`.
- `delivered` maps to `DELIVERED` or direct handover `COMPLETED` depending feature path.
- `late_delivered` is new and must not break existing payout settlement.
- `cancelled` maps to `CANCELLED`.

## Current Rider Assignment Logic

- Available orders are `READY` with `rider_id IS NULL` (`supabase/migrations/009_indexes.sql`, `app/api/rider/orders/route.ts`, `app/rider/page.tsx`, `lib/live-ops.ts`).
- Rider accepts via `app/api/riders/[id]/accept/route.ts`: requires rider/admin/super_admin role, rider self-ownership when role is rider, `is_active`, verified bank, `status === ONLINE`, no `active_order_id`, then optimistic update `orders.status = READY AND rider_id IS NULL` to set `rider_id`, `RIDER_ASSIGNED`, `rider_assigned_at`; then rider becomes `BUSY`.
- Rider gets freed in `lib/order-payout.ts` when completed payout runs, or in dispute resolution for refund/no-action paths.

## In-Code Ownership Checks To Preserve

The real auth perimeter is in handlers, with RLS as backstop. Ownership checks found include:

- `app/api/orders/[id]/status/route.ts` - role whitelist plus owner binding: vendor must match `vendor_id`, rider must match `rider_id`, customer must match `customer_id`; staff exempt.
- `app/api/orders/[id]/cancel/route.ts` - customer owns order via customer row looked up by session phone; vendor matches `vendor_id`; staff exempt.
- `app/api/orders/[id]/deliver/route.ts` - only assigned rider may confirm delivery; staff exempt.
- `app/api/orders/[id]/collect/route.ts` - pickup code owner gating for customer/vendor/staff.
- `app/api/orders/[id]/handover-code/route.ts` - owner-only code materialization.
- `app/api/orders/[id]/delivery-photo/route.ts` - assigned rider/upload gating.
- `app/api/orders/[id]/dispute/route.ts`, `rate/route.ts`, `reorder/route.ts` - customer/order ownership checks.
- `app/api/riders/[id]/accept/route.ts` and `app/api/riders/[id]/status/route.ts` - rider self binding and active-order restrictions.
- `app/api/vendors/[id]/status/route.ts`, `pause/route.ts`, `pickup-settings/route.ts`, `hours/route.ts`, `location/route.ts` - vendor self/staff binding.
- `app/api/vendor/menu/route.ts`, `app/api/vendor/menu/[id]/route.ts`, `app/api/vendor/orders/route.ts`, `app/api/vendor/reviews/route.ts` - vendor-session scoped reads/writes.
- `app/api/customer/*`, `app/api/customer-wallet/*`, `app/api/group-order/*`, `app/api/lumi/memory/route.ts`, `app/api/auth/export/route.ts`, `app/api/auth/account/route.ts`, `lib/rewards.ts`, `lib/saved-places.ts` - customer/session ownership checks.
- `app/api/wallet/*` - vendor/rider wallet operations scoped by `session.userId` and role.
- Admin/super-admin routes use role gates, often via explicit `session.role` checks or `lib/authz.ts` `requireRole`, which logs `authz_deny`.

No ownership check may be removed unless an equivalent or stronger check is added in the same patch.

## Security Events Spine

- Schema: `supabase/migrations/085_security_events.sql` creates append-only `security_events` with `id`, `created_at`, `actor_id`, `actor_role`, `session_id`, `ip`, `user_agent`, `event_type`, `severity`, `surface`, `detail`, `prev_hash`, `row_hash`.
- Hash chain: trigger computes `prev_hash` from prior row and `row_hash` over canonical fields; update/delete/truncate blocked even for service role.
- App writer: `lib/security-events.ts` redacts secrets and never throws.
- Current event types: `auth_fail`, `authz_deny`, `ratelimit_hit`, `webhook_reject`, `stepup_fail`, `ledger_anomaly`, `handover_bruteforce`, `ai_injection`, `session_revoked`, `rls_coverage_gap`, `chain_tamper`.
- Current logging call sites: `lib/authz.ts` (`authz_deny`), `app/api/paystack/webhook/route.ts` and `lib/paystack/webhook.ts` (`webhook_reject`), `app/api/auth/login/route.ts` (`auth_fail`), `app/api/auth/webauthn/login-verify/route.ts` (`stepup_fail`), `app/api/super-admin/revoke-sessions/route.ts` (`session_revoked`), sentinel reads for auth/webhook/authz/tamper.
- Item 5/6 must extend this existing type union and writer usage, not create a second log.

## Existing Onboarding And Approval Flow

- Core tables already have `is_active`, `approved_at`, `approved_by` on vendors/riders.
- Admin creation pages/routes: `app/admin/vendors/new/page.tsx`, `app/api/admin/vendors/create/route.ts`, `app/admin/riders/new/page.tsx`, `app/api/admin/riders/create/route.ts`.
- Admin management routes/pages: `app/admin/vendors/page.tsx`, `app/api/admin/vendors/route.ts`, `app/api/admin/vendors/[id]/route.ts`, `app/admin/riders/page.tsx`, `app/api/admin/riders/route.ts`, `app/api/admin/riders/[id]/route.ts`.
- WhatsApp application capture in `lib/whatsapp-handler.ts` intentionally never inserts into `vendors`/`riders`; it captures applications and tells admins to verify/provision.
- Operational gates already check `is_active` in order creation, rider acceptance, rider/vendor dashboards/status endpoints. Item 7 should add explicit `approval_state` and checklist fields while preserving existing active accounts.

## Implementation Order

1. Add cities/delivery zones and zone/city FKs additively. Seed Uturu/Abia with existing settings values. Replace delivery fee/markup/rider split reads in live order creation, checkout fee endpoint, pricing/admin views, WhatsApp ordering, refund/terms/SEO quote surfaces with zone-backed reads. HIGH RISK only in `app/api/orders/route.ts` and `lib/whatsapp-handler.ts`.
2. Add merchant aliases and merchant category enum additively. Keep `vendors` table/imports/routes operational. Prefer new columns/views/types over destructive rename. Add category-specific optional item fields such as `prescription_required`.
3. Add explicit state machine helpers and DB columns (`promised_ready_at`, extension counters/timestamps, placed aliases). Before touching refund/webhook/payout files, state the exact intended change. Hard 2h cancel must reuse `refundOrderPayments`.
4. Add busy-mode prep buffer using current `PREPARING` count and configurable settings. No payment code changes.
5. Add late-delivery customer credit through existing customer wallet ledger/RPC path or a new idempotent RPC in the same ledger schema, plus security event logging for delay stage. No second ledger/log.
6. Add merchant/rider reliability score fields and event logging needed to compute later. Formula can be placeholder.
7. Add explicit approval state and checklist fields; preserve current active vendors/riders as approved via migration backfill. Gate only new pending/rejected accounts from receiving live orders.

## Test Contract

- Run `npm test` after PLAN.md, then after each implementation item.
- If an existing test must be modified, stop and report why before changing it.
- Add focused tests for new helpers/migrations where practical; do not weaken money-path tests.
