## Summary

Adds Lumi — a rule-based in-app chat assistant to help customers browse vendors, view menus, check wallet balance, and prepare order drafts.

## What changed
- `lib/lumi/*` — intents, state, responses, actions
- `app/api/lumi/route.ts` and `app/api/lumi/confirm/route.ts` — server endpoints
- `components/LumiChat.tsx` — client chat UI
- `supabase/migrations/090_create_lumi_unmatched_messages.sql` — migration to log unmatched messages
- `test/lumi-intents.test.ts` — unit tests for intents

## Deployment checklist
1. Run migration: `supabase/migrations/090_create_lumi_unmatched_messages.sql` in Supabase SQL editor.
2. Ensure Vercel env vars are set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, `JWT_SECRET`, `CRON_SECRET`, `TERMII_*`, `SENTRY_*`.
3. (Optional) Add repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` to allow GitHub Actions to trigger Vercel deploy.

## Testing notes
- Unit tests for the intent matcher pass (`test/lumi-intents.test.ts`).
- Manual smoke test recommended after deploy: mount `components/LumiChat` to a customer page and verify ordering flow and wallet top-up redirect.

## Rollout
- Deploy to preview first and verify before promoting to production.

## Reviewers
- @ops @product
