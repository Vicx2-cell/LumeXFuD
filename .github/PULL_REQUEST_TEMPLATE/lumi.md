## Summary

Describe the behavior changed and why it is within the current MVP scope.

## Risk

- [ ] Authentication / authorization / RLS
- [ ] Order state or pricing
- [ ] Payment / promotion / refund / settlement
- [ ] Migration or operational control
- [ ] No money/security behavior changed

List affected source-of-truth modules and migrations:

## Verification

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] Targeted role/money tests added or updated

## Deployment

- [ ] Applied migrations are additive and were not edited
- [ ] Preview role/BOLA checks completed where relevant
- [ ] Provider/cron configuration documented without secret values
- [ ] `PAYSTACK_SECRET_KEY` is server-only and webhook HMAC/replay tested
- [ ] Maintenance, payout, withdrawal, promo, DVA and wallet controls have the
      intended safe state
- [ ] Rollback/forward-fix path and exact tested commit recorded
