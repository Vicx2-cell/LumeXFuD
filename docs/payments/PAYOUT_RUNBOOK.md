# Payout Runbook

## Scope

This runbook covers vendor and rider payouts from completed orders and wallet obligations.

## Preconditions

- Payouts are enabled.
- The recipient profile is verified.
- The source payable is confirmed and not already settled.
- The transfer kill switch is not active.

## Current flow

- The repo currently supports wallet-backed payout and transfer initiation patterns.
- Transfer completion is still confirmed asynchronously through Paystack webhook events.

## Safe operating steps

1. Select only payable rows created from authoritative order or wallet state.
2. Create one idempotent payout attempt.
3. Initiate the Paystack transfer from the server.
4. Wait for webhook confirmation before marking success.
5. On failure or reversal, restore eligibility through compensating entries.

## Current gap

- The launch spec still requires a dedicated payout foundation with stronger ledger backing.
