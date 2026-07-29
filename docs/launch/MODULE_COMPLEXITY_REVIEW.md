# Module complexity review

Date: 2026-07-29

## Decision summary

The feed screen, checkout route, and cart page are long, but their launch-risk boundaries are identifiable. This audit did not split files merely to reduce line counts. Two evidence-backed extractions/cleanups were made:

- malformed delivery-estimate parsing moved to the small, tested `lib/delivery-estimate-response.ts` boundary because unsafe API data caused the confirmed mobile `distanceKm.toFixed` crash;
- static feed demo posts/right-rail data were removed and `app/feed-v2/fixtures.ts` became the accurately named `app/feed-v2/types.ts`, leaving live database loading as the only feed data source.

## Reviewed modules

| Module | Size at review | Responsibilities | Decision |
|---|---:|---|---|
| `components/feed-v2/feed-v2-screen.tsx` | 1,855 lines | Feed presentation, responsive rails, post/story renderers, interaction sheets, client pagination, optimistic counters, reporting and commerce navigation. | Large but presentation-cohesive. Leave unchanged. Splitting the tightly coupled interaction state immediately before launch would create high visual/regression risk. Business eligibility and ranking are not implemented here. |
| `lib/feed/v2.ts` | 896 lines | Loads live feed rows, joins authors/vendors/media/menu snapshots, maps rows to UI contracts, applies tab eligibility, builds stories and right rail. | Cohesive server-side feed projection. Leave unchanged. Static fake posts were removed. Ranking remains in `lib/feed/ranking.ts`; publisher eligibility remains in `lib/feed/permissions.ts`; automatic posts remain in `lib/feed/official-service.ts` and `official-scheduler.ts`. |
| `lib/feed/service.ts` | 605 lines | Alternate feed snapshot loader, viewer context, social profile provisioning, relationship decorations and ranking delegation. | Leave unchanged for compatibility. It delegates ranking and does not duplicate checkout/money rules. Post-launch consolidation with `v2.ts` is advisable, but not safe as a release-audit rewrite. |
| `app/cart/page.tsx` | 1,016 lines | Cart presentation, address/GPS collection, quote display, guest consent, checkout request and Paystack handoff. | Keep as one journey component for launch. The unsafe estimate-response boundary was extracted and tested. Client totals are estimates/display only; the order API recomputes every amount. |
| `components/cart-context.tsx` | 201 lines | One-vendor cart state, line identity, quantities/notes, local persistence and display subtotal. | Authoritative client cart validation. Cross-vendor additions fail before mutation. Server validation remains authoritative at order creation. |
| `app/api/orders/route.ts` | 1,048 lines | Authentication/guest validation, idempotency, feature/maintenance gates, live menu/add-on repricing, delivery quote, promotion reservation, order snapshots and Paystack initialization. | Long but security-sequential and highly regression-sensitive. Do not split during final audit. Each money value is recomputed in one server request, and tests cover client manipulation, duplicate checkout, unavailable items, negative totals and promotion races. |
| `app/api/orders/[id]/status/route.ts` | 593 lines | Ownership check, role transition matrix, timestamps, delivery promises, audit events and completion side effects. | Long but one status-transition boundary. Leave unchanged. Moving side effects without a full state-machine migration would risk double settlement or missed audit events. |
| `lib/order-payout.ts` | 195 lines | Vendor settlement, vendor-funded discount deduction, commission, rider payout/tip, held lots and idempotent release. | Authoritative payout implementation. Keep. Release cron and completion routes delegate here; the source-of-truth architecture test prevents cron arithmetic duplication. |

## Source-of-truth verification

| Concern | Authoritative implementation | Other occurrences and disposition |
|---|---|---|
| Cart vendor boundary | `components/cart-context.tsx` for UI; `app/api/orders/route.ts` for server enforcement | UI prevents mixing; server ignores client prices and binds every item to the selected live vendor. |
| Order subtotal/total | `app/api/orders/route.ts` | Cart and AI/SEO copy compute previews only. WhatsApp has separate direct-pay arithmetic, but WhatsApp commerce remains disabled for launch and therefore is not a competing launch source. |
| Delivery fee and rider payout quote | `lib/launch-delivery-pricing.ts` plus live zone/settings loaders; consumed by `lib/delivery-pricing.ts` and order creation | Cart displays the server estimate. No client value is persisted as authoritative. |
| Platform/guest fee | `app/api/orders/route.ts`, using launch pricing/settings | Cart shows the quote; it cannot submit a fee override. |
| Vendor commission | snapshotted by `app/api/orders/route.ts` from launch pricing | `lib/order-payout.ts` consumes the stored snapshot; it does not recalculate using a current rate. |
| Promotional discount | `lib/promotion.ts` for eligibility/quote and promo-fund database RPCs for reservation/commit/release | Promotions remain disabled/kill-switched for launch. No client discount is trusted. |
| Vendor settlement and rider payout | `lib/order-payout.ts` | Completion/delivery routes and release cron delegate. |
| Refund amount | refund/reconciliation service and stored provider/order snapshots | No UI formula is authoritative. |
| Status transition | transition matrix and ownership checks in `app/api/orders/[id]/status/route.ts`; handover/collect routes cover their specialized completion paths | `lib/order-state.ts` centralizes status-to-state/timing helpers. |
| Feed eligibility | `lib/feed/permissions.ts` and live filters in `lib/feed/v2.ts`/`service.ts` | No static fixture fallback remains. |
| Feed ranking | `lib/feed/ranking.ts` | Feed loaders delegate. |
| Automatic-post generation | `lib/feed/official-service.ts` and `lib/feed/official-scheduler.ts` | Admin UI only invokes/observes these services. |

## Deliberate non-refactors

- The large order route was not decomposed into independently committing services because its current linear transaction/idempotency sequence is easier to audit than a late multi-module rewrite.
- The feed screen was not split into many files because its helpers share one UI state machine and contain no privileged database access.
- The two feed loaders were not merged. Both are active compatibility paths; proving all consumers and response contracts equivalent requires a separate migration.
- Disabled WhatsApp commerce preview arithmetic was not consolidated into the launch checkout path because doing so would modify a prohibited disabled feature. Its server webhook remains kill-switched.

## Remaining non-blocking debt

- Post-launch, extract the order route’s pure validation/snapshot construction behind existing tests without changing transaction order.
- Select one feed loader and migrate consumers with contract tests.
- Move the status transition matrix into a small pure module only when specialized handover/collection transitions can be included in the same tested state machine.
