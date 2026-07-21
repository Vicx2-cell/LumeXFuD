# Architecture

## Runtime

- Next.js 16.2.6 App Router with React 19.2.4 and TypeScript 5.9.3 (`package.json:12-45`). The baseline had 99 `page.tsx` routes and 231 API route handlers; the approved working tree now has 232 API handlers after adding the Resend webhook. It uses nested role layouts, client/server components, and a Next 16 `proxy` entry point.
- `proxy.ts:7-29` protects customer/vendor/rider/admin/superadmin page prefixes and maps role homes/tables. `proxy.ts:131-154` verifies the session and checks live server-side revocation before protected navigation.
- Global security headers come from `lib/security-headers.ts` through `next.config.ts:3-49`; request-specific CSP is assembled in `proxy.ts:54-77` and attached at `proxy.ts:120-126`.
- Sentry wraps the Next config (`next.config.ts:54-67`); server and edge initialization are in `instrumentation.ts`, `instrumentation-client.ts`, and `sentry.*.config.ts`.

## Authentication and authorization

- Custom PIN/social/WebAuthn flows issue application sessions. JWT signing/verification uses only HS256 (`lib/session.ts:49-79`), with per-role duration, a database `sessions` row, and live revocation/expiry checks (`lib/session.ts:154-276`).
- Session cookies are HttpOnly, production-Secure, SameSite=Lax, and role-duration bounded (`lib/session.ts:217-229`); logout revokes the row and clears the cookie (`app/api/auth/logout/route.ts:11-24`).
- Central role helpers are in `lib/authz.ts`; API classification is in `lib/authz-policy.ts:3-147`. Coverage is test-enforced, but the baseline currently proves two unclassified email routes.

## Data layer

- Hosted Supabase/PostgreSQL. Trusted server code uses a `server-only` service-role client (`lib/supabase/server.ts:1-13`); browser/realtime code uses the public anon key and is subject to RLS (`lib/supabase/client.ts:1-10`).
- The baseline had 129 SQL migration files; the approved working tree added migration 132 for email ownership verification. The set defines the core marketplace, wallets/ledgers, orders, disputes, sessions, audit/security events, feeds, storage buckets, realtime, email operations, and order communications. Core tables and RLS start in `supabase/migrations/001_core_schema.sql:24-224`; initial policies are in `008_rls_policies.sql:43-181`; order-chat authorization/RLS is refined in migrations 122-129.
- The migration set is repository history, not proof of the deployed database state. No migration was applied.

## Business and integrations

- Domains present: vendor/menu/catalog, cart/checkout, order lifecycle, Paystack webhook/refunds, customer/vendor wallets, payout/settlement, rider assignment/handover, order chat, feed/posts, notifications/push, applications/KYC, support/admin/superadmin, study and AI helpers.
- Integrations declared by code/environment: Supabase, Upstash Redis, Paystack, Sendchamp, Resend, Sentry, Google OAuth, Gemini, Anthropic/OpenAI packages, OpenStreetMap/Leaflet, Vercel cron, and Web Push.
- Paystack webhooks verify an HMAC over the raw body and use `processed_webhooks` for idempotency (`app/api/paystack/webhook/route.ts:25-129`); full financial correctness remains unverified.

## PWA and deployment

- Manifest at `public/manifest.json:1-52`; client registration/install/offline UI at `components/pwa.tsx`; hand-written service worker at `public/sw.js:1-150`; offline page at `app/offline/page.tsx`.
- Service worker excludes navigations, APIs, Supabase, Paystack, and Sendchamp from interception (`public/sw.js:35-57`) and caches hashed build assets plus selected public assets (`public/sw.js:59-108`). It calls `skipWaiting` immediately (`public/sw.js:16-24`), so critical-operation update safety requires later adversarial review.
- Vercel is configured with 13 cron schedules (`vercel.json:2-15`). The only visible GitHub workflow runs install/tests and optionally deploys; it does not visibly gate lint/build/security checks (`.github/workflows/lumi-deploy.yml:9-32`).
