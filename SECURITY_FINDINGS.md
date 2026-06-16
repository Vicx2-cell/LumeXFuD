# LumeX Fud — Security Audit Findings (White-box)

**Date:** 2026-06-16
**Scope:** Static white-box review of API routes, auth/session primitives, payment/wallet
logic, config, and dependencies — following the LumeX Security Playbook (Phases 0–K).
**Method:** Analysis only. No code changed. Findings cite `file:line`.

> **Coverage honesty:** Every core security library and ~25 of the 119 API routes were read
> line-by-line — specifically the money, ownership, and auth-critical paths (webhook, wallet
> withdraw, orders create, order status/cancel/dispute, rider/vendor `[id]` actions, menu item
> ownership, login, super-admin withdraw, wallet-adjust). The remaining routes (AI/forecast/study
> endpoints, admin list views, reviews, lodges, addresses) were covered by tree-wide pattern
> sweeps, not individually. **Phase Y automated access-control tests are recommended to lock in
> the routes not individually read.**

---

## Summary table

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 0 in code | 1 **external verification gate** (anon-key/RLS — must confirm in live Supabase) |
| High     | 0     | — |
| Medium   | 3     | re-auth gap (rule #28), dead un-pinned verifier, CSP `unsafe-inline` |
| Low      | 3     | login enumeration (accepted), npm moderates, permissions-policy geolocation |

**The codebase is genuinely hardened.** The playbook's highest-risk areas (BOLA/IDOR, webhook
integrity, server-side pricing) are correctly implemented and consistently applied. The findings
below are refinements, not open doors.

---

## 🔴 Go-live gate — verify in live Supabase (cannot be confirmed from code)

### G1. Confirm the anon-key / RLS lockdown is APPLIED (Playbook §3)
- **Why it's here:** Auth is custom JWT, so Supabase RLS owner-scoping is dormant; the only thing
  stopping the public `anon` key from reading tables directly is **deny-by-default RLS + column
  grants**. Migration `supabase/migrations/048_column_grants_lockdown.sql` exists in the repo, but
  the audit cannot prove it has been **run** against the production project.
- **Action (do from phone, 5 min):** Run the Hoppscotch anon-key test from Playbook §3 against
  `vendors`, `orders`, `customer_wallets`, `wallet_balances`, `customers`. Expected result:
  `401 / permission denied / []`. If any real rows (especially `bank_account_number`) return —
  **launch-blocker**; apply migration 048 and re-test.
- **Status:** Code side is correct (the in-app `vendors/[id]` route already excludes bank columns,
  `app/api/vendors/[id]/route.ts:13-23`). This gate is purely "is the migration live."

---

## 🟠 Medium

### M1. No step-up re-authentication on large money actions — violates own rule #28
- **Rule:** CLAUDE.md non-negotiable #28 — "Admin actions over ₦50,000 require re-authentication."
- **Finding:** No route implements a fresh-PIN / fresh-MFA step-up. The two highest-value money
  actions rely only on session role + rate limit + audit:
  - Founder withdrawal up to ₦100,000/request — `app/api/super-admin/withdraw/route.ts:42-51`
    (has a float-safety `confirmed` flag, but that is a balance warning, not re-auth).
  - Manual wallet adjust up to ±₦500,000 — `app/api/admin/wallet-adjust/route.ts:21-37`.
- **Impact:** A hijacked super-admin session (the top-value target) can move large sums with no
  second proof of presence. Mitigated by: super_admin-only, strict 3/10min rate limit, full
  `super_audit_logs`, per-request caps.
- **Fix:** Require a fresh WebAuthn assertion or PIN re-entry (signed short-TTL token, same pattern
  as `signMfaPending` in `lib/webauthn.ts`) for any money action ≥ ₦50,000.

### M2. Dead, un-pinned JWT verifier in `lib/auth.ts`
- **Finding:** `lib/auth.ts:17-35` defines `verifySessionToken` calling `jwtVerify(token, secret)`
  **without** `{ algorithms: ['HS256'] }`. The live verifier (`lib/session.ts:66`) correctly pins
  HS256. `lib/auth.ts` is imported **nowhere** (confirmed — only `lib/pin-auth` matches importers).
- **Impact:** None today (dead code). Risk is future: if someone imports this by name instead of
  `lib/session`, alg-pinning is silently lost. With a symmetric key jose still rejects `alg:none`
  and won't accept RS256, so practical exploitability is low — but it's a footgun.
- **Fix:** Delete `lib/auth.ts`.

### M3. CSP keeps `'unsafe-inline'` in `script-src` (Playbook Phase K — non-blocker)
- **Finding:** `proxy.ts:47-69`. Documented, deliberate: nonce + `strict-dynamic` previously broke
  hydration on statically-prerendered pages. `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'`, `form-action 'self'` are all present.
- **Impact:** Weakens XSS containment only. Mitigated by React escaping and the absence of
  user-controlled `dangerouslySetInnerHTML` (the only use, `app/page.tsx:47`, is static JSON-LD).
- **Fix (post-launch):** Move security-sensitive routes to dynamic rendering and restore
  nonce + `strict-dynamic` there. Explicitly listed as NOT a launch-blocker in the playbook.

---

## 🟡 Low / Accepted

### L1. Account enumeration on login (accepted product decision)
- `app/api/auth/login/route.ts:71-81` returns `{ unregistered: true }` + 404 for unknown numbers
  to guide signups. Timing is equalized with a dummy bcrypt compare, and the locked-account path is
  made indistinguishable from throttling (`:90-99`). Documented trade-off — accept, or switch to a
  generic message if enumeration becomes a concern.

### L2. npm audit — 9 moderate + 1 low, no critical/high
- `postcss` (via `next`) XSS, `file-type` ASF infinite-loop, `@opentelemetry/*` — all fixable only
  via breaking upgrades that would downgrade Next.js. Correctly deferred per Phase J. Re-check after
  each Next.js minor; none are reachable as a remote exploit in current usage.

### L3. `Permissions-Policy: geolocation=()` blocks the campus lodge map's GPS
- `next.config.ts:12`. Functional, not a security hole — but if "share my location" on checkout is
  wanted, geolocation must be re-allowed for `'self'`.

---

## ✅ Verified strong (record of what's correct)

- **Webhook (Phase D):** HMAC verified on raw bytes before JSON parse, timing-safe
  (`lib/security.ts:5-9`); idempotency via `processed_webhooks` unique insert; independent Paystack
  re-verification + exact amount check before crediting; **not** rate-limited
  (`app/api/paystack/webhook/route.ts`, `lib/paystack/webhook.ts`).
- **Server-side pricing (Phase D):** all prices/add-ons read from DB `settings`, client values never
  trusted; wallet split resolved server-side; idempotency key bound to owner
  (`app/api/orders/route.ts:173-218, 322-325`).
- **BOLA/IDOR (Phase B):** consistent explicit ownership checks binding actor to resource —
  `orders/[id]/status:86-94`, `orders/[id]/cancel:43-52`, `orders/[id]/dispute:53-58`,
  `riders/[id]/accept:33-35`, `vendors/[id]/status:30-32`, `vendor/menu/[id]:10-21`.
- **Wallet (Phase D):** atomic Postgres RPC debit with PIN check, lockout, freeze, cooling period,
  daily/weekly caps enforced under row lock, reverse-on-failure, self-healing held-fund release
  (`app/api/wallet/withdraw/route.ts`).
- **Auth (Phase A):** HS256 pinned on verify; session checked against DB for revocation/expiry;
  cookie `httpOnly` + `Secure`(prod) + `SameSite=Lax`; bcrypt cost 12; 5-attempt lockout; Upstash
  per-phone login limit keyed on normalized E.164; optional WebAuthn MFA (`lib/session.ts`,
  `lib/pin-auth.ts`, `app/api/auth/login/route.ts`).
- **Secrets (Phase F):** `service_role` key server-only (`lib/supabase/server.ts`); no secrets in
  `NEXT_PUBLIC_*` (only the intended anon key); no service-role key in client code.
- **Injection (Phase E):** Supabase query builder parameterizes input; the one `.or()` template
  (`cron/vendor-auto-cancel:48`) interpolates a server-computed timestamp, not user input; image
  upload validates magic bytes (`lib/security.ts:61-73`); SSRF private-IP block present.
- **Framework (Phase C):** Next.js 16.2.6 (> 15.2.3); API excluded from proxy and self-authenticates
  per-route; explicit matcher guards against `.rsc` bypass.
- **Cron (Phase G):** all cron routes gated on `Authorization: Bearer ${CRON_SECRET}`.

---

## Recommended next steps (Playbook Phases Y & Z — need your go-ahead)

1. **G1 first** — run the anon-key test from your phone (5 min). This is the one true launch gate.
2. **Phase Y** — write an automated access-control test suite (owner=200, other-user=403/404,
   wrong-role=403) covering **every** `[id]`-accepting route, plus webhook-forged-HMAC-rejected and
   payment-idempotency. This also covers the routes not individually read in this pass.
3. **Phase Z** — fix M1 (step-up re-auth) and M2 (delete `lib/auth.ts`); defer M3 to post-launch.

I have not changed any code (per the playbook's "read before write" rule). Tell me which to start —
I'd recommend **M2 (1-line delete) + Phase Y tests** now, and **M1 step-up auth** before live payouts.
