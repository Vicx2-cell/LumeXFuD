# Authentication and authorization

Last verified: 2026-07-29

LumeX Fud uses an application-managed identity system. It does not use
`@supabase/ssr` or Supabase Auth sessions.

## Session model

- Login/setup routes verify PIN, OTP or social completion as appropriate.
- `lib/session.ts` signs a JWT containing the session subject and role using
  `JWT_SECRET`.
- The JWT is stored only in the role-aware HttpOnly cookie defined by
  `lib/session-cookie.ts`.
- Every authenticated request verifies both the signature and corresponding
  database session. Logout, restriction, deactivation and super-admin revocation
  invalidate database sessions.
- Roles are `customer`, `vendor`, `rider`, `admin` and `super_admin`. A client
  claim never grants a role.

## Boundaries

`proxy.ts` provides coarse page/API role routing, lockdown enforcement, request
context and security headers. Route handlers still authenticate, authorize the
resource, validate input and use scoped queries. Supabase RLS/column grants are
the final boundary. Service-role access is restricted to server modules and
cannot replace a route resource check.

Customer orders are owner-scoped. Guest access is an order-specific signed token
stored in an HttpOnly cookie, not a phone match or guessable order number.
Vendors are restricted to their vendor ID and riders to their assigned/current
order. Admin and super-admin are separate roles; platform controls and team
escalation are super-admin only.

## Entry points

- UI: `/auth`, `/auth/register`, `/auth/setup`, `/auth/forgot-pin`
- Session: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Registration/verification: `/api/auth/register`, `/api/auth/otp/*`,
  `/api/auth/email/*`, `/api/auth/social/complete`
- Recovery/security: `/api/auth/forgot-pin/*`, change/reset PIN, recovery-code
  and WebAuthn routes under `/api/auth`
- Core modules: `lib/session.ts`, `lib/session-cookie.ts`, `lib/pin-auth.ts`,
  `lib/phone-verify.ts`, `lib/webauthn.ts`, `proxy.ts`

Google, Face ID/WebAuthn and other optional login surfaces additionally require
their feature flag/provider configuration. Unknown feature flags fail closed.

## Rules for changes

- Never store a session token in local storage or expose `JWT_SECRET`.
- Never authorize from a request role, phone or resource ID alone.
- Keep session-live/revocation checks and sensitive step-up checks.
- Preserve generic anti-enumeration responses and OTP/rate-limit controls.
- Add route/resource and RLS tests for every new authenticated mutation.
- Use the deployed role/BOLA checklist in
  `docs/launch/MVP_CERTIFICATION.md` before launch.
