# LumeX Fud contributor guide

## Architecture

- `app/` is the Next.js App Router UI and HTTP API. Keep business decisions in `lib/`; route handlers validate input, authenticate, authorize, then delegate.
- `components/` contains client and server UI. `types/` holds shared database-facing types.
- `lib/supabase/` creates database clients. `supabase/migrations/` is the authoritative, append-only database history; never alter an applied migration.
- Commerce: cart UI submits to `app/api/orders`; that route recomputes menu prices, delivery pricing, discounts and payment split server-side. Paystack webhook handling is in `app/api/paystack/webhook` and `lib/paystack/`.
- Role surfaces are customer (`/home`, `/cart`, `/orders`), vendor (`/vendor-dashboard`), rider (`/rider`), admin (`/admin`) and super-admin (`/super-admin`). `proxy.ts`, route-level checks and RLS are all required layers.

## Conventions and commands

- TypeScript is strict. Use `@/` imports outside a module's immediate siblings. Prefer small named helpers and Zod schemas at API boundaries.
- Use `npm.cmd exec tsc -- --noEmit`, `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build` on Windows.
- Do not trust client price, role, order state, identity, wallet balance, webhook body, or uploaded MIME type. Keep privileged database access server-only.
- Make additive, idempotent migrations. If production drift is discovered, add a reconciliation migration rather than changing history.

## Money rules

- Persist, calculate and send provider amounts as integer kobo. Convert to naira only at validated input and display boundaries; do not use floating-point totals.
- Recompute checkout totals from live menu/pricing data on the server. Preserve order snapshots and idempotency keys.
- Payment, wallet debit, refund, payout and webhook operations must be idempotent, auditable and fail closed when their replay guard cannot be recorded.
- Shared operational limits belong in `lib/business-config.ts`; live fees and delivery pricing belong in database settings/zones, not UI constants.

## Role boundaries

- Customers can create and view only their own orders; guests use a scoped order token.
- Vendors operate only their own menus, orders, finance and storefront.
- Riders act only on assigned orders and their own wallet.
- Admins operate assigned administrative tools; only super-admins change platform-wide controls, pricing, security and team access.
- Never weaken `proxy.ts`, RLS, column grants, session revocation, or webhook signature checks to unblock a feature.

## Definition of done

- Change is scoped, reviewed for authz/RLS/money effects, and has targeted tests when behaviour changes.
- Typecheck, lint, tests and production build pass.
- Required migrations, environment variables, provider configuration and operational follow-up are documented before release.
