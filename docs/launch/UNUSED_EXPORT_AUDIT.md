# Unused export audit

Date: 2026-07-29

Tool: Knip 6.29.0, JSON reporter

## Count reconciliation

Knip’s compact reporter headings count files containing findings, not symbols. The JSON reporter was therefore used for the required symbol totals.

| Stage | Unused value exports | Unused exported types |
|---|---:|---:|
| Reported starting inventory | 166 | 122 |
| Resolved in this audit | 19 | 8 |
| Remaining | 147 | 114 |

The exact counting command parses `issues[*].exports` and `issues[*].types` from `npx.cmd --yes knip --reporter json`. This avoids mistaking the compact output’s current 71/44 file groups for symbol counts.

## Resolved findings

The following were classified `ACTUALLY_UNUSED` and removed:

- stale feed fixture values `feedV2Stories`, `feedV2Posts`, `feedV2SeedPosts`, and `feedV2RightRail`; the misleading `fixtures.ts` module was replaced by `types.ts`, retaining only live feed contracts, tabs, and navigation;
- unused FX barrel exports `Reveal`, `CursorProvider`, `AnimatedHeading`, `HeadingSegment`, and `Sparkline`;
- the unreferenced `animated-heading.tsx` and `sparkline.tsx` components;
- vendor-dashboard-only dead exports and dead implementations: `STATUS_TONE`, `formatClock`, `formatDay`, `orderSummary`, `trendDirection`, `toneForStatus`, and `iconForTone`;
- unnecessary vendor helper export modifiers on `VendorDashboardStatus`, `VendorDashboardCustomer`, and `VendorDashboardOrderItem`; these remain private types required by exported live contracts;
- dead vendor review contracts `VendorDashboardReview` and `VendorDashboardReviewSummary`;
- unused `TrendTone`;
- unnecessary export modifiers on the locally used promotion catalogues `discountTypes` and `promotionKinds`;
- unnecessary export modifier on the locally used `CONTROL_DEFAULTS`.

No framework entry point, route export, metadata export, server action, dynamic import, migration, or string-referenced handler was removed.

## Remaining classifications

### `TEST_ONLY` — 2 values

- `lib/supabase/playwright-commerce-fixture.ts`: `playwrightIdentities`
- `test/helpers/kit.ts`: `ALL_ROLES`

These are imported by test entry points. Knip does not discover the custom Playwright runner’s test graph, so removing either would break test compilation or fixture authentication.

### `CROSS_PACKAGE_API` — 44 types

All 44 exported database-facing contracts in `types/index.ts` are retained as the repository’s explicit schema/handoff surface: `Customer`, `Session`, `OtpAttempt`, `VendorStatus`, `SubscriptionTier`, `TrustTier`, `MerchantCategory`, `Vendor`, `Merchant`, `MenuItem`, `RiderStatus`, `Rider`, `OrderStatus`, `OrderState`, `PaymentStatus`, `DeliveryType`, `Order`, `OrderItem`, `OrderMessage`, `CustomerLocation`, `VerifiedPlace`, `VerifiedPlaceVote`, `OrderStatusEvent`, `Payment`, `ProcessedWebhook`, `Refund`, `WalletUserType`, `WalletTransactionType`, `WalletBalance`, `WalletTransaction`, `VendorSubscription`, `VendorScore`, `Rating`, `CustomerStreak`, `Badge`, `CustomerBadge`, `Admin`, `AuditLog`, `SuperAuditLog`, `AdminDevice`, `Settings`, `Notification`, `TrendingData`, and `Dispute`.

These types are not runtime code and form the intentional database contract described by `AGENTS.md`. Consolidating or deleting them requires a coordinated database-type generation decision, not a launch-audit guess.

### `MANUAL_REVIEW` — 145 values and 70 types

Every remaining Knip value/type finding not explicitly listed in `TEST_ONLY` or `CROSS_PACKAGE_API` above is classified `MANUAL_REVIEW`.

This is an exact set definition: final JSON totals are 147 values and 114 types; subtracting 2 test values gives 145 manual-review values, and subtracting 44 cross-package types gives 70 manual-review types. There is no unclassified residual.

The manual-review set spans active domain modules for authentication, pricing, delivery, feed, payment, payout, promotion, notification, security, onboarding, and validation. Many findings are paired contracts or architecture/version constants whose removal could silently weaken tests, scripts, operational tooling, or future database-type generation. Knip alone does not prove those symbols disposable. They are intentionally not allowlisted or broadly suppressed: each remains visible on every Knip run until an owner can prove its consumer set.

Representative high-risk groups deliberately left visible include:

- payment/webhook contracts in `lib/paystack/*`;
- pricing, delivery, order-state, payout, refund, and promotion contracts;
- authorization, session, security-event, risk, and validation contracts;
- feed ranking/attribution/event rule versions and simulation schemas;
- notification/email templates and operational cron/health exports;
- disabled-for-launch Premium, Study, AI, wallet, and WhatsApp surfaces.

### Empty classifications

No current symbol finding is classified `PUBLIC_FRAMEWORK_ENTRY`, `DYNAMICALLY_REFERENCED`, or `INTENTIONAL_PUBLIC_API`. Framework and dynamic entry points appear in Knip’s separate unused-file analysis rather than its export-symbol list. They are handled as entry-point false positives in the file relevance audit and are not suppressed here.

## Allowlist decision

No Knip allowlist was added. In particular, no route, scripts directory, test directory, or feature directory is broadly ignored. The remaining 215 manual-review symbols stay actionable and auditable.

## Launch disposition

Unused exports are maintainability debt, not a launch blocker by themselves. The 27 proven findings were safely resolved (19 values and 8 types). The remaining symbols do not execute merely because they are exported, and no evidence shows that they alter authorization or money behaviour. Further deletion should be a separate owner-reviewed cleanup after launch, with a targeted test for each affected domain.
