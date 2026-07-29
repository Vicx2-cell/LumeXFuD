# Launch foundation progress

Last reviewed: 2026-07-29

This is a codebase readiness record, not a declaration of launch readiness. The deployed Supabase project, provider accounts and environment values were not mutated or independently verified during this review.

## Completed systems

- Launch promotions are implemented through migration `151_promotions_promo_fund_and_virtual_accounts.sql`, server-side checkout pricing, and Admin → Promotions. Admins can create fixed, percentage, delivery, capped free-delivery, platform-fee, vendor, group-order, referral and ambassador campaigns with vendor/category/campus, first-order, dates, limits, funding and budget eligibility. The form includes a live preview and activation/pausing.
- Admin → Promotions → Promo Fund is an immutable kobo ledger, not customer money. Credits require idempotency keys, provider references, actor/reason/time audit fields; manual reconciled credits require super-admin authorization. Checkout reserves funds under database locks, successful payment commits, failed/deleted/expired checkout releases, vendor-funded campaigns bypass the LumeX fund, and a five-minute cron releases expired reservations. The screen reports available/reserved/spent, funding history, campaign spend, reconciliation difference and a global campaign kill switch.
- Eligible registered customers have a feature- and merchant-capability-gated Paystack Dedicated Virtual Account flow at `/profile/virtual-account`: express versioned consent, verified customer profile requirements, provider-required identity submission, safe Paystack customer create/reuse, asynchronous assignment webhooks, account display and provider requery. Only masked identity validation details are stored. DVA transfers are independently verified and recorded as unallocated receipts; they never create or credit a customer stored-value balance.
- Guest Paystack checkout is constrained to the transaction-specific `bank_transfer` channel, so guests use expiring Pay with Transfer accounts and are never assigned permanent DVAs. Screenshots are not a payment input anywhere.

- Shake-to-report uses the existing rate-limited support-case pipeline without persistent controls covering the customer interface.
- P1 commerce uses the existing validated cart/order flow: feed menu references resolve against live availability, vendor slug storefronts provide public sharing metadata, host-paid group orders enforce one vendor/location and lock edits, and affordable discovery/recommendations are filtered server-side from live menu data. Affordable price bands are edited from Super Admin Pricing and seeded by migration `150_affordable_discovery_settings.sql`.

- Next.js 16.2.6 application compiles as a production build; strict TypeScript and ESLint pass.
- 140 Vitest files / 914 tests pass, covering authz, order creation, cart contracts, delivery pricing, menu add-ons, payment-webhook idempotency, refunds, wallets, promotions, promo-fund locking/reconciliation, virtual-account boundaries, RLS coverage contracts, feeds, email flows and operations.
- Customer storefront, cart, checkout, order tracking, guest checkout, vendor menu/dashboard, rider workflow, admin/super-admin operations and the Feed have implemented routes and server-side authorization layers.
- Checkout recalculates server-side prices, delivery charges, discounts and payment split; order creation uses an idempotency key. Paystack webhook HMAC validation and deduplication are implemented.
- Migration `084_rls_coverage_backstop.sql` provides a database-derived RLS-gap check; migration `048_column_grants_lockdown.sql` limits public columns on sensitive public-read tables.
- Email sends use Resend-oriented transactional workflows and provider-event/retry tables. Vercel cron schedules are declared in `vercel.json`.
- Core order-path code review and focused verification confirm the implemented sequence: approved vendor discovery → slug storefront → single-vendor cart with add-ons → server-side checkout recalculation and idempotency → Paystack initialization/webhook deduplication → vendor/rider state transitions → customer order history/tracking → code-gated delivery completion. The focused suite covers cart isolation, menu selections, tampered order inputs, unauthorized access, webhook replay, rider assignment races and handover completion.

## Broken systems fixed in this review

- Fresh databases could not accept the webhook deduplication insert: the application writes `processed_webhooks.paystack_reference`, but the tracked schema did not create that production column. Migration `148_processed_webhook_schema_reconciliation.sql` adds, backfills and indexes it idempotently.
- Vendor/rider withdrawal limits were repeated in API, validator and client UI. `lib/business-config.ts` is now the shared source for those limits.
- Delivery checkout and estimation use a server-calculated, admin-editable road-distance estimate; no client-provided distance or fee is accepted. The Super Admin Pricing screen now edits the actual launch checkout policy, including the minimum delivery fee, rider payout, margin, platform and guest fees, 3% vendor commission, fuel, efficiency, maintenance and road-distance multiplier. Migration `149_launch_delivery_pricing.sql` stores guest fee/vendor commission snapshots on each order.
- The release audit found that the promo-fund table was not physically append-only and the new security-definer RPCs were not executable by `service_role`. Migration `151` now blocks every ledger update/delete, uses conflict-safe immutable recharge idempotency, and grants only the required table/view/function privileges. A PGlite integration test executes these invariants as `service_role`.
- Vendor-funded discounts previously bypassed the LumeX promo fund but were not deducted from vendor settlement, causing the platform to absorb a vendor campaign. Checkout now requires a scoped vendor, caps the discount to that order's vendor settlement, and payout subtracts the immutable vendor-funded discount after commission. LumeX-funded promotions still leave vendor earnings unchanged.
- Paystack webhooks previously returned `200` before the money handler completed, so a serverless freeze or processing failure could leave a permanent dedup row for an unprocessed event. The route now waits within a 30-second function limit, returns non-2xx when the replay guard or processing fails, and releases a failed processing claim so Paystack can retry. Signature verification now trusts only `PAYSTACK_SECRET_KEY`, matching Paystack's signing contract instead of accepting a second unnecessary trust root.

## Missing or unverified systems

- No reproducible local Supabase bootstrap/seed command is declared in `package.json`; migration application and RLS need verification against the target project before release.
- Migration filenames have duplicate version prefixes (`090`, `098`, `106`). Do not rename historical files blindly: first compare the repository with the deployed Supabase migration history and prepare a controlled reconciliation plan, because migration runners may treat the shared prefix as one applied version.
- Production provider configuration remains unverified: Paystack live keys/webhook endpoint, Resend domain and webhook, Upstash rate-limit credentials, Sentry DSN, and all cron secrets.
- Paystack DVA capability is not verified on the merchant account. Keep both the `customer_virtual_accounts` application feature and `PAYSTACK_DVA_ENABLED=false` until Paystack confirms the registered Nigerian business is eligible, the DVA provider slug is selected, and `PAYSTACK_DVA_COMPLIANCE_REQUIRED` matches the merchant category. Configure `PAYSTACK_DVA_PREFERRED_BANK` only from Paystack's Fetch Providers response.
- There is no CI workflow in `.github/` visible to enforce typecheck, lint, tests, build, migration checks, or deployment environment validation.
- MVP delivery distance uses a server-side straight-line-to-road multiplier (default 1.35×), editable by a super-admin. It is an estimate, not live navigation routing; review it against completed trips and replace it with routing only when justified.
- The initial fuel/efficiency/maintenance values are provisional settings (`₦1,000/litre`, `40 km/litre`, `₦20/km`) and must be approved or edited by a super-admin before launch.

## Security blockers

1. **P0** — Apply and verify every tracked migration, including `148`, in the exact production Supabase project. Run `select * from public.rls_coverage_gaps();` as service role and require zero rows.
2. **P0** — Reconcile the duplicate migration prefixes with the target Supabase migration history before provisioning or rebuilding any database.
3. **P0** — Verify production secrets are set, distinct from examples, server-only where required, and that `SUPABASE_SERVICE_ROLE_KEY` is never exposed to the browser.
4. **P0** — Perform live role/BOLA checks for customer, vendor, rider, admin and super-admin sessions, plus webhook signature/replay checks, against the deployed environment.
5. **P1** — Add CI and a controlled migration/deployment gate so future schema drift cannot recur.

## Payment blockers

1. **P0** — Deploy migration `148` before accepting Paystack payments on a newly provisioned or schema-rebuilt project.
2. **P0** — Configure Paystack live secret key and webhook callback, then run a small live payment/refund/replay test and reconcile the resulting order, ledger and webhook rows.
3. **P1** — Validate the configured payout account, transfer recipient flow and reconciliation cron with a controlled low-value payout.
4. **P0** — Configure and test transaction-specific Pay with Transfer in the Paystack account if it is required for launch. The repository initializes standard Paystack transactions, but provider-side channel enablement is outside source control.
5. **P0** — Apply migration `151`, recharge the promo fund with a traceable provider reference, then run concurrent reservation, paid/failed/expired payment and reconciliation drills before activating a LumeX-funded code.
6. **P0** — Confirm Paystack DVA availability and compliance category on the live merchant account before enabling `PAYSTACK_DVA_ENABLED` and the `customer_virtual_accounts` feature. Exercise assign success/failure, signed `charge.success`, duplicate delivery and requery; confirm receipts remain unallocated and no customer wallet balance changes.

## Exact next implementation order

1. Freeze production schema changes, take a restorable database backup, and compare duplicate migration prefixes with the deployed Supabase migration history. Write and review the smallest reconciliation plan; do not rename or mark migrations applied without matching their SQL effects.
2. Restore a production-like staging database, apply the reconciled migration set through `151`, run `select * from public.rls_coverage_gaps();` as service role, and require zero rows. Verify the promo ledger rejects update/delete and the four promo RPCs execute only through the intended server role.
3. Set and independently review production secrets and callbacks. Keep `PAYSTACK_DVA_ENABLED=false`, keep the `customer_virtual_accounts` feature off, and keep `promo.kill_switch` enabled for the first application deployment.
4. Deploy the exact tested commit, then run a low-value live order, failed payment, refund, duplicate webhook, transfer/reversal, rider payout, vendor commission, platform/guest-fee and reconciliation drill. Stop if any provider amount differs from the stored kobo snapshots.
5. Recharge the promo fund with a traceable provider reference, run concurrent LumeX/vendor campaign reservations plus paid/failed/expired settlement drills, reconcile to zero difference, then disable the kill switch only for one low-budget campaign.
6. Enable guest Pay with Transfer only after Paystack confirms the channel. Enable DVA last, only after Paystack confirms merchant/category/provider eligibility and the signed assignment/charge/requery drills leave receipts unallocated without changing any customer wallet balance.
