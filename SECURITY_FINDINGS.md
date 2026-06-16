# LumeX Fud — Security Audit Findings (White-box)

**Date:** 2026-06-16
**Scope:** Static white-box review of API routes, auth/session primitives, payment/wallet
logic, config, and dependencies — following the LumeX Security Playbook (Phases 0–K).
**Method:** White-box review, then an approved remediation pass. Findings cite `file:line`.
Remediation (M1/M2/M4 + Phase Y tests) applied in a follow-up session — see the changelog below.

> **Coverage honesty:** Every core security library and ~25 of the 119 API routes were read
> line-by-line — specifically the money, ownership, and auth-critical paths (webhook, wallet
> withdraw, orders create, order status/cancel/dispute, rider/vendor `[id]` actions, menu item
> ownership, login, super-admin withdraw, wallet-adjust). The remaining routes (AI/forecast/study
> endpoints, admin list views, reviews, lodges, addresses) were covered by tree-wide pattern
> sweeps, not individually. **Phase Y automated access-control tests are recommended to lock in
> the routes not individually read.**

---

## Summary table (updated after remediation session)

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 0 in code | Anon-key/RLS gate (G1) **✅ RESOLVED** — live test returned `42501 permission denied` on `vendors` |
| High     | 0     | — |
| Medium   | 4     | M1 re-auth gap **✅ FIXED**; M2 dead verifier **✅ DELETED**; M4 webhook idempotency **✅ FIXED**; M3 CSP `unsafe-inline` (deferred, non-blocker) |
| Low      | 3     | login enumeration (accepted), npm moderates, permissions-policy geolocation |

### What changed in the remediation session (all tests green: 13 files / 292 tests)
- **G1 — RESOLVED.** Live anon-key test returned `42501 permission denied` on `vendors` (RLS denying the public key as intended).
- **M1 — FIXED.** Step-up re-authentication (fresh 6-digit login PIN) now required for any money action ≥ ₦50,000: `super-admin/withdraw`, `admin/wallet-adjust`, `paystack/refund`. New `lib/step-up.ts` (reuses login PIN hash + lockout). Audit trails made **append-only** at the DB level via `056_audit_append_only.sql` (BEFORE UPDATE/DELETE trigger that fires even for the service role) — history can no longer be altered or erased by any role/path.
- **M2 — DELETED.** Dead `lib/auth.ts` (un-pinned verifier) removed.
- **M4 — FIXED (newly found).** `paystack/webhook` idempotency was a no-op: supabase-js *returns* `{error}` (code 23505) on a duplicate insert rather than *throwing*, so the `try/catch` never fired and `processWebhookAsync` re-ran on every Paystack retry. Now inspects the returned error code and stops on 23505. (Double-credit was already prevented downstream; this restores the first-line dedup.)
- **Phase Y — DONE.** `test/access-control.test.ts` + `test/webhook-and-exposure.test.ts` + `test/helpers/kit.ts`: BFLA (wrong-role→403) and unauth (→401/403) across all role-gated routes; IDOR (other-user→403/404) on every id-accepting ownership route; soft-auth routes proven to not leak; bank-column exposure guard on public vendor routes; forged-HMAC rejection; webhook idempotency; M1 step-up. `npm test` script added.
- **Rate limiters — CONFIRMED active** on login (`rateLimitPinLogin` 5/30min/phone), signup (`rateLimitOtpSend` 3/hr/phone fail-closed + `register` 5/hr/IP).

> **⚠️ Apply in live Supabase before relying on it:** migration `056_audit_append_only.sql` (this session) and `048_column_grants_lockdown.sql` (the column lockdown behind G1).

**The codebase is genuinely hardened.** The playbook's highest-risk areas (BOLA/IDOR, webhook
integrity, server-side pricing) are correctly implemented and consistently applied. The findings
below are refinements, not open doors.

---

## 🔴 Go-live gate — ✅ RESOLVED

### G1. Confirm the anon-key / RLS lockdown is APPLIED (Playbook §3) — ✅ RESOLVED
**Verified:** the live Hoppscotch anon-key test returned **`42501 permission denied`** on `vendors` —
RLS is denying the public key as designed. Keep `048_column_grants_lockdown.sql` (and now
`056_audit_append_only.sql`) applied on every environment.

<details><summary>Original finding (kept for the record)</summary>
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

</details>

---

## 🟠 Medium

### M1. No step-up re-authentication on large money actions — ✅ FIXED
**Fixed:** `lib/step-up.ts` requires a fresh login-PIN re-entry for any action ≥ ₦50,000, wired into
`super-admin/withdraw`, `admin/wallet-adjust`, and `paystack/refund` (returns `{reauth_required:true}`
+ 401 without it). Audit trails are now append-only (`056_audit_append_only.sql`). Locked in by the
"Step-up re-auth" tests. Original finding:

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

### M4. Webhook idempotency was a silent no-op — ✅ FIXED (found during Phase Y)
- **Finding:** `app/api/paystack/webhook/route.ts` recorded the dedup key with
  `try { await db.from('processed_webhooks').insert(...) } catch { return 200 }`. supabase-js does
  **not throw** on a unique-constraint violation — it resolves with `{ error: { code: '23505' } }`.
  So the `catch` never fired on a duplicate, and `processWebhookAsync` re-ran on every Paystack retry.
- **Impact:** the reference-level dedup layer did nothing. Double-credit was still prevented by
  downstream idempotency (RPCs keyed on reference, status-guarded `payment_status=PENDING` updates),
  so no money was lost — but the intended first line of defence was inert.
- **Fix:** inspect the returned error — `23505` ⇒ already processed ⇒ 200 with no side effects; other
  insert errors are logged but non-fatal. Locked in by `test/webhook-and-exposure.test.ts`.

### M2. Dead, un-pinned JWT verifier in `lib/auth.ts` — ✅ DELETED
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
  (`lib/security.ts:5-9`); idempotency via `processed_webhooks` unique insert **(now correctly
  detected — see M4)**; independent Paystack re-verification + exact amount check before crediting;
  **not** rate-limited (`app/api/paystack/webhook/route.ts`, `lib/paystack/webhook.ts`).
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

## Status of Playbook Phases Y & Z

- **G1** — ✅ resolved (live anon-key test: `42501 permission denied`).
- **Phase Y** — ✅ done. Access-control suite (`npm test`): BFLA + unauth across all role-gated
  routes, IDOR on every id-accepting ownership route, soft-auth no-leak proof, bank-column exposure
  guard, forged-HMAC rejection, webhook idempotency, M1 step-up. 13 files / 292 tests green.
- **Phase Z** — ✅ M1 (step-up + append-only audit), M2 (deleted), M4 (webhook idempotency) fixed.
  M3 (nonce CSP) intentionally deferred to post-launch per the playbook.

### Remaining (owner action)
1. **Apply migrations in live Supabase:** `056_audit_append_only.sql` (this session) and confirm
   `048_column_grants_lockdown.sql` is applied on every environment.
2. **Wire the UI** to prompt for the login PIN when a money action returns `{ reauth_required: true }`
   (super-admin withdraw, wallet-adjust, refund).
3. **Post-launch:** M3 nonce-based CSP; re-run `npm audit` after each Next.js minor (L2).

_Run the suite any time with `npm test`._
