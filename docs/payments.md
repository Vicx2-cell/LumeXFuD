# Payments, promotions and settlement

Last verified: 2026-07-29

All provider and persisted amounts are integer kobo. Client totals, redirects,
screenshots and webhook JSON are untrusted.

## Checkout

`POST /api/orders` supports a registered customer or guest. It validates one
approved vendor, reloads available menu items/add-ons, obtains the current
server-side delivery quote, calculates platform/guest fees and vendor
commission, evaluates/reserves a promotion, and writes immutable order/item
snapshots under an idempotency key. It then initializes a Paystack transaction.
Guests are restricted to transaction-specific Pay with Transfer and receive an
order-scoped HttpOnly access token; they never receive a permanent DVA.

`POST /api/orders/estimate` uses the same launch delivery quote implementation
for display. The order-create route remains authoritative.

## Payment webhook

`POST /api/paystack/webhook`:

1. reads the raw request body;
2. verifies HMAC-SHA512 with `PAYSTACK_SECRET_KEY`;
3. derives a stable provider resource/event key;
4. inserts the replay claim into `processed_webhooks`;
5. fails closed with non-2xx if that claim cannot be recorded;
6. awaits the idempotent handler;
7. releases a failed claim so Paystack may retry;
8. acknowledges only after successful processing.

The handler verifies the stored reference, amount and payment context before
committing order/payment/promotion state. Webhook reconciliation must continue
during maintenance because an in-flight customer may already have paid.

## Promotion fund

The promo fund is a marketing ledger, not customer stored value. Recharge,
reservation, commit and release use locked database RPCs and idempotency keys.
Credits/debits are immutable. LumeX campaigns reserve available balance and
commit a debit only after payment; failure/expiry releases the reservation.
Vendor-funded campaigns never debit the fund and their discount is deducted
from vendor settlement. Keep the campaign kill switch on until production
funding/reconciliation drills pass.

## Settlement and withdrawals

`lib/order-payout.ts` is the order payout authority:

- vendor = subtotal snapshot − vendor commission snapshot − vendor-funded
  promotion discount;
- rider = delivery-cut snapshot + tip.

It atomically claims `orders.wallet_released`, creates idempotent held earnings
and frees only the rider attached to the completed order. The release-payment
cron and on-demand settlement backstop delegate to it. Payout and withdrawal
controls fail closed and remain frozen until production transfer/reconciliation
gates pass.

## Refunds and DVA

Refund APIs re-authorize the actor, cap against recorded payment/refundable
state, call Paystack and reconcile signed refund events idempotently. A refund
redirect or screenshot is not proof.

Dedicated Virtual Accounts require customer consent, identity/provider
eligibility, the application feature and `PAYSTACK_DVA_ENABLED`. Signed/requeried
transfers become unallocated receipts and never credit a customer wallet. DVA
must remain disabled for launch.

## Production gates

Set live provider configuration outside Git, then execute low-value paid,
failed, duplicate, replay, guest-transfer, refund, settlement and transfer
reconciliation on the exact release commit. Compare every Paystack amount to
the corresponding immutable order/ledger kobo snapshot. See
`docs/launch/MVP_CERTIFICATION.md`.
