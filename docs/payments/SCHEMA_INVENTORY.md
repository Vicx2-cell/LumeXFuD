# Payments Schema Inventory

Last updated: 2026-07-30

## Existing money-related tables

- `orders`
- `payments`
- `refunds`
- `processed_webhooks`
- `wallet_balances`
- `wallet_transactions`
- `customer_wallets`
- `customer_wallet_transactions`
- `customer_virtual_accounts`
- `virtual_account_receipts`
- `promo_fund_ledger`
- `promo_redemptions`
- `vendor_subscriptions`
- `wallet_payout_lots`

## Existing supporting tables and views

- `platform_earnings`
- `billing_ledger_entries`
- `paystack_billing_diagnostics`
- `settings`
- `feature_flags`
- `delivery_zones`
- `orders` state columns from reconciliation migrations
- `promo_fund_summary`

## Current gaps against the launch spec

- No general double-entry ledger account table.
- No general journal table.
- No general journal entry table.
- No atomic ledger posting function for the main payments domain.
- No immutable order financial snapshot table.
- No wallet reservation state machine table for the new closed-loop balance model.
- No payout batch / settlement batch schema dedicated to the main payments launch loop.

## Notes

- The repo already has some append-only financial structures, but they are domain-specific and not yet the unified payments ledger required for launch.
- Existing legacy balance columns should be treated as transitional data until the ledger foundation exists.
