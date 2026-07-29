# MVP certification

Last reviewed: 2026-07-29

## Executive conclusion

MVP_NOT_CERTIFIED_BLOCKERS_REMAIN

The repository contains a traceable core MVP and its unit, type, lint and
production-build verification passes. Certification cannot be granted because
the latest Next release still installs a high-severity vulnerable Sharp line,
the Playwright suite does not terminate reliably in this Windows environment,
and external launch drills are incomplete. Ordering must remain in maintenance.

## Verified customer journey

Automated contracts exercise approved vendor/menu discovery, one-vendor cart
isolation, live price/add-on reload, tampered input rejection, registered/guest
checkout contracts, idempotent creation, signed/replayed payment events,
scoped order access and delivery handover authorization. No screenshot or DVA
receipt can mark an order paid. A real live-provider journey remains a gate.

## Verified vendor journey

Contracts cover own-menu and own-order access, cross-vendor rejection, order
status operations, commission snapshots and settlement. The completion cron now
delegates to `lib/order-payout.ts`, which subtracts commission and only the
vendor-funded promotion discount. A production role and settlement drill
remains.

## Verified rider journey

Contracts cover rider isolation, race-safe acceptance/reassignment, stale-rider
rejection, collection/delivery authority and payout snapshots. Completion frees
only the rider assigned to that order. A real handover and transfer/hold/release
drill remains.

## Verified admin journey

Route/authz contracts cover admin vendor, rider, order, dispute, wallet and
promotion operations and super-admin-only controls. Promo manual reconciled
credits require elevated authorization and ledger entries are immutable.
Deployed sessions still require BOLA/reauth verification.

## External blockers

- Paystack live key/callback and Pay with Transfer capability confirmation.
- Low-value paid, failed, duplicate-webhook, refund and replay reconciliation.
- Preview end-to-end delivery code, vendor commission, vendor/rider held earning
  and recipient transfer drill.
- Production Resend/notification, Upstash, Sentry and every Vercel cron-secret
  health check.
- Approval of initial delivery fuel, efficiency, maintenance and road multiplier.
- Production role/BOLA probes for all five roles.
- Paystack DVA eligibility is intentionally unresolved and is not a launch gate
  while both DVA gates remain off.

## Codebase quality

The architecture and money boundaries are now documented and import cycles were
removed by extracting co-located view-model types. Dead components, superseded
helpers, snapshots and credential captures were removed. The repository is
understandable to a competent Next.js/Supabase developer, though several large
modules and historical audit documents remain non-blocking navigation debt.

## Removed irrelevant content

See `FILE_RELEVANCE_AUDIT.md` for the exact file list. The sole removed package
is `@supabase/ssr`; `@types/leaflet` was moved to development dependencies.

## Remaining technical debt

Launch-blocking:

- two high production advisories: latest Next 16.2.12 requires Sharp `^0.34.5`;
- Playwright fixture-runner setup/teardown must be made reliable and pass in CI;
- all external payment, role, delivery and settlement drills listed above.

Non-blocking:

- split oversized feed/cart/order modules;
- centralize remaining order transition presentation helpers;
- review unused exports incrementally;
- archive historical `.ai/` and root audit notes;
- reconcile the disabled WhatsApp pricing path before ever enabling it.

## Final MVP inventory

If and only if launch gates pass: registered/guest storefront discovery,
single-vendor cart, server pricing, Paystack per-order payment, vendor menu/order
operations, rider assignment/collection/delivery, private delivery handover,
customer/guest tracking, notifications, refunds/disputes, held vendor/rider
settlements, admin operations, maintenance controls and production monitoring.
Feed, group ordering, reviews and referrals may remain as non-critical included
features. Promotions, DVA, customer stored value, pickup, AI, Study, WhatsApp
commerce and Premium are not launch inventory.

## Exact launch gates

1. Full test, strict TypeScript, ESLint, production build and repository static
   checks pass on the exact deploy commit.
2. Production secrets are independently reviewed; current tree/history secret
   findings are dispositioned.
3. Preview role/BOLA probes pass for customer, vendor, rider, admin and
   super-admin.
4. Paystack paid/failed/replay/refund/guest-transfer drills reconcile provider
   amounts to immutable order/ledger kobo values.
5. Delivery handover is enabled in preview and one complete customer→vendor→
   rider→code→settlement journey passes.
6. Vendor commission, vendor-funded discount, rider cut/tip, held release and
   transfer recipient values reconcile exactly.
7. Health, Sentry, rate limiting, notification providers and every money/order
   cron are operational.
8. Maintenance remains on and payouts/withdrawals remain frozen until gates
   1–7 are signed off. Promo kill switch stays on; DVA and customer wallet stay
   off. Only then may ordering be reopened through the normal controlled change.

## Verification record

- `npm.cmd ci`: PASS, 622 packages installed from lockfile.
- `npm.cmd test`: PASS, 138 files / 896 tests.
- `npm.cmd run typecheck`: PASS from a clean `.next` state.
- `npm.cmd run lint`: PASS, no findings.
- `npm.cmd run build`: PASS, Next 16.2.12; 250 API routes inventoried and 157
  static pages generated.
- `npm.cmd run test:e2e`: BLOCKED. Two runs exceeded Playwright plugin
  setup/teardown budgets and an extended run did not terminate; no browser case
  result is claimed.
- `git diff --check`: PASS before final documentation update; rerun at commit.
- Madge: PASS, 752 files processed, zero circular dependencies.
- Knip: reviewed; remaining 18 file findings are framework/service-worker,
  operational-script or Playwright entry points. It reports 166 unused value
  exports and 122 exported types for incremental review.
- Internal Markdown links: PASS, no broken local targets.
- Route manifest: PASS, 250 manifest entries / 250 route files, no duplicates.
- Current-tree secret scan: PASS except an intentional redaction-test fixture.
- `npm.cmd audit --omit=dev`: FAIL, two high findings from Next's required
  Sharp 0.34 dependency. The npm registry confirms 16.2.12 is the latest release
  and declares `sharp: ^0.34.5`.
