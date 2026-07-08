# VERIFY

## Test Runs

- Stage 1 item 1 full suite: 441 passing tests.
- Stage 1 item 2 full suite: 441 passing tests.
- Stage 2 merged full suite: 444 passing tests.
- Stage 3 item 3 full suite: 448 passing tests.
- Stage 3 item 5 full suite: 452 passing tests across 34 test files.

## Item 1 - Cities And Delivery Zones

Implemented and tested. Added `cities` and `delivery_zones`, seeded the current Uturu zone from existing settings values, and added nullable `city_id` / `zone_id` FKs on vendors, riders, and orders. Live order pricing and public/admin fee reads now use `delivery_zones` through `lib/delivery-zones.ts`.

The WhatsApp path now also reads delivery-zone pricing and refuses to continue if live pricing is not configured, instead of falling back to hardcoded fee values. Non-pricing Uturu strings remain in SEO/content routes and seed migrations as explicit transition exceptions.

The transitional public `merchants` view is defined with `WITH (security_invoker = on)` so callers use the underlying table RLS instead of a security-definer view.

## Item 2 - Merchants And Categories

Implemented and tested. `vendors` remains the live table, `merchant_category` supports `restaurant`, `supermarket`, and `pharmacy`, and the `merchants` view aliases the vendor table for transition. Existing vendor routes/imports continue to work. Pharmacy-specific `prescription_required` is optional on menu items.

## Item 3 - Order State Machine And 2-Hour Ceiling

Implemented and tested. Added `order_state`, `placed_at`, `promised_ready_at`, extension fields, and auto-cancel metadata. Paid-live time is the authoritative clock: immediate paid orders stamp `placed_at` at payment confirmation, and scheduled orders stamp it when released live.

The 2-hour cron cancellation is race-safe: it claims only unpicked statuses with `picked_up_at IS NULL`, and refunds only after that conditional update returns a row. If the cron wins and a rider later tries `PICKED_UP`, the API returns `ORDER_AUTO_CANCELLED` and the rider UI shows the explicit auto-cancel message.

## Item 4 - Busy-Mode Throttle

Implemented and tested. Busy mode reads configurable threshold/buffer settings, counts current `PREPARING` orders, and adds the buffer to new order prep-time snapshots without touching payment logic.

## Item 5 - Late-Delivery Credit

Implemented and tested. Lateness is measured against the current `orders.promised_ready_at` value. If a vendor uses the allowed prep-time extension, that extension overwrites `promised_ready_at`, and late-delivery credit uses the extended value.

Credit formula: `min(platform_margin, max(10000, ceil(late_minutes / 10) * 5000))`, where platform margin is `platform_markup + platform_delivery_cut`. Transit estimate is 8 minutes, matching the existing customer ETA after pickup.

Idempotency uses the existing customer wallet ledger reference `LATE-<order_id>` plus `orders.late_delivery_credit_applied_at` / `late_delivery_credit_reference`. The customer receives an in-app notification, platform cost is recorded as `LATE_DELIVERY_CREDIT_COST`, and a `late_delivery_credit_issued` security event is logged.

Decision note: late-delivery attribution (`vendor_prep`, `pickup_wait`, `transit`) is intentionally used for `security_events` logging and future reliability scoring only. The platform absorbs the customer credit regardless of fault for now; this is a documented product/accounting decision, not an omitted clawback.

## Item 6 - Reliability Score Stub

Implemented and tested. Merchants/vendors and riders have neutral reliability score fields, and the stub calculator reads lifecycle timestamps from `security_events`. Late-delivery credit events now include vendor/rider ids and are included in the reliability event inputs.

## Item 7 - Approval State

Implemented and tested. Merchants and riders have `pending_review`, `approved`, and `rejected` states plus checklist fields. Existing active operators are backfilled approved; new/non-approved operators are gated from receiving live orders.

## Remaining Hardcoded Strings / Values

- Remaining `Uturu` strings are present in public SEO/content pages, route names, comments, and seed data. They are not all removed in this pass because route renames and historical migration rewrites would be destructive transition work.
- Canonical seed values remain in historical/settings migrations, wallet limits, rewards, tests, and admin examples.
- `lib/whatsapp-handler.ts` remains intentionally untouched for manual WhatsApp ordering after the user objected to WhatsApp manual-order changes.
