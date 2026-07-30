# Paystack Configuration

Last updated: 2026-07-30

## Required environment variables

- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_DVA_ENABLED`
- `PAYSTACK_DVA_COMPLIANCE_REQUIRED`
- `NEXT_PUBLIC_APP_URL`

## Current configuration notes

- The code uses the secret key for server-side transaction initialization and webhook HMAC verification.
- The DVA route treats `PAYSTACK_DVA_ENABLED=false` as a hard off-switch.
- Live and test objects must never be mixed in a single payment flow.
- Secret values should remain server-only and must not move into `NEXT_PUBLIC_*` variables.

## Operational notes

- Webhooks must use the raw request body for signature verification.
- Live Paystack account capabilities still need to be validated against the real provider dashboard before pilot use.
- If a live secret or service-role key is ever found committed, it requires immediate rotation outside this repo.
