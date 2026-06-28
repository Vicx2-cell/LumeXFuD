# LUMEX FORTRESS — Security Log

A running scoreboard of the security hardening loop. One entry per surface pass.
See `CLAUDE.md` → docs/security.md for the full methodology.

## Status board (as of 2026-06-28)

| # | Surface | Status |
|---|---------|--------|
| 1 | Authorization backstop (RLS) | ✅ done & armed (migration 084 applied, `gaps=0`) |
| 2 | Custom JWT cookie auth | ✅ done & armed (migration 085 applied + immutability verified) |
| 3 | The money path (ledger) | ✅ done & armed (migration 086 applied, constraints **VALIDATED**) |
| 4 | Paystack webhooks | ✅ done & armed (migration 087 applied) |
| 5 | Cross-role authz | ✅ done (code + tests, no migration) |
| 6 | Handover codes | ⬜ not started |
| 7 | OTP / auth flows (Sendchamp) | ⬜ not started |
| 8 | Rate-limit integrity | ⬜ not started |
| 9 | AI surfaces | ⬜ not started |
| 10 | PII at rest | ⬜ not started |

Full test suite: **424/424**. Detection spine: hash-chained `security_events`
(migration 085) with three live consumers — `auth_fail`/`session_revoked` (#2),
`webhook_reject` (#4), `authz_deny` (#5).

### Open backlog (carried forward)
- **Surface #5:** migrate the remaining ~85 routes from inline checks to
  `requireRole`/`canActOn*`; make `test/access-control.test.ts` ENTRIES consume
  `lib/authz-policy.ts` `ROUTE_POLICY` (kill the duplication).
- **Surface #4:** unify the split-refund through `reserve_order_refund()`; drop the
  vestigial `refunds.amount` column once the `amount_kobo` read-fix is confirmed
  unread in prod.
- **Surface #3:** (done — audits returned 0, four `VALIDATE CONSTRAINT` run.)

---

## 2026-06-28 — Surface #5: Cross-role privilege escalation

- 🔴 **Exploit found:** No central authz gate — 355 inline `session.role` checks
  across 139 files, enforced only by a hand-maintained test catalog (~90 of 161
  routes). Structural BFLA hole: the next privileged route shipped without the
  3-line check is open to every logged-in user and **nothing fails**. IDOR-by-
  omission: object-level ownership is duplicated ~30× by hand. No detection of
  role-probing (a 403 emitted nothing). *(No currently-exploitable un-gated route
  found — the inline checks are uniformly correct; the gap is the absence of a
  guarantee + detection.)*
- 🔵 **Fix:** `lib/authz.ts` — central `requireRole(session, roles, surface)`
  (identical 401/403 codes) + `canActOn{Vendor,Rider,Customer}` ownership helpers
  (staff bypass). `lib/authz-policy.ts` — **ROUTE_POLICY**, one registry classifying
  ALL 158 routes (role / self / auth / public / cron / webhook). Adoption (a):
  refactored admin/stats, admin/feature-flags (GET+POST), super-admin/financials to
  the gate; remaining routes migrate incrementally (the BFLA suite + coverage test
  guard the migration).
- 🟣 **Hardening:** **Authz coverage backstop** — `test/authz-coverage.test.ts`
  enumerates every `app/api/**/route.ts` and FAILS CI if any is absent from
  ROUTE_POLICY. A new un-gated route can no longer ship unnoticed (the #1
  RLS-coverage idea applied to authz). Proven: a synthetic `admin/secret-backdoor`
  is caught by `unclassifiedRoutes()`.
- 🟢 **Detection:** `requireRole` denial writes **`authz_deny`** to the **same
  hash-chained `security_events` spine from #2** (its 3rd consumer, alongside
  `auth_fail` and `webhook_reject`). Sentinel rule: ≥10 `authz_deny` from one
  actor/IP in 5 min → **SEV2 `AUTHZ_DENY_BURST`** (role-probing signal).
- ✅ **Test:** `test/authz.test.ts` — `requireRole` emits `authz_deny` on wrong role,
  401/no-event on no session, ok on right role; ownership helpers both directions.
  `test/authz-coverage.test.ts` — every route classified + the catch proven. The
  415-route BFLA/IDOR/step-up suite stays green (identical codes after refactor).
  **Suite: 424/424.** No migration (code + tests only).

**Future items (logged, not done this pass):**
- Migrate the remaining ~85 routes to `requireRole`/`canActOn*` (incremental).
- Promote the access-control suite ENTRIES to consume ROUTE_POLICY (kill the duplication).

---

## 2026-06-28 — Surface #4: Paystack webhooks

- 🔴 **Exploit found:** (1) **Fail-OPEN dedup (root cause):** the route logged a
  non-`23505` `processed_webhooks` insert error and **kept processing** with no
  replay guard → every Paystack retry re-ran the money handlers; the unguarded
  `vendor_subscriptions` insert + `VENDOR_SUBSCRIPTION` earning (order_id NULL, not
  covered by #3's index) would double-book. (2) **Refund subsystem broken in prod:**
  inserts omit the NOT NULL vestigial `refunds.amount` (fail), and `refund.processed`
  read `amount` (never written) → `NaN`/₦0 in the customer SMS. (3) **No detection:**
  a forged-signature 400 emitted nothing.
- 🔵 **Fix:** Route now **FAILS CLOSED** — if the dedup key can't be recorded it does
  NOT process (200 so Paystack retries; processed exactly once on a later success),
  same principle as #2's `isSessionLive`. `handleSubscriptionPayment` gains a
  handler-level check-then-insert idempotency, backstopped by a DB `UNIQUE`. Refund
  read switched to `amount_kobo` via a NaN-safe `refundNaira()` helper. Split-refund
  insert guarded against re-insert. *(Signature was already correct: raw body read
  before parse — route.ts:17 → verify route.ts:33 → parse route.ts:42 — and
  `verifyHMAC` uses `timingSafeEqual` with a length pre-check = constant-time.)*
- 🟣 **Hardening (migration 087):** `refunds.amount` `NOT NULL` relaxed (vestigial;
  column drop deferred). `UNIQUE(paystack_reference) WHERE NOT NULL` on
  `vendor_subscriptions` — the race backstop making subscription booking exactly-once.
- 🟢 **Detection:** every reject path writes **`webhook_reject`** to the **same
  hash-chained `security_events` spine built in #2** (its 2nd consumer): bad
  signature → **critical**, dedup-record failure → warn, payment shortfall → warn.
  Sentinel rule: any `webhook_reject` in 5 min → **SEV2 `WEBHOOK_REJECT`** + names the
  source IP.
- ✅ **Test:** `test/webhook-route.test.ts` — forged sig → 400 + critical event +
  processor NOT run; **fail-open-path-closed** (non-23505 dedup error → processor NOT
  run); replay → not run; first → runs once. `test/webhook-idempotency.test.ts`
  (REAL Postgres, runs 087) — replayed charge.success can't double-credit
  (`processed_webhooks` UNIQUE + orders PENDING-guard 1→0 rows); subscription
  check-then-insert once + 087 UNIQUE rejects dup ref / allows NULL repeat; refund
  insert omitting `amount` succeeds. `test/refund-naira.test.ts` — correct naira, no
  NaN. **Suite: 415/415.**
- ⚠️ **Action required:** Run migration `087_refund_amount_and_subscription_idempotency.sql`
  (watch for the duplicate-`paystack_reference` WARNING).

**Future items (logged, not done this pass):**
- Unify the split-refund through `reserve_order_refund()` for order-lock + cumulative cap.
- Drop the vestigial `refunds.amount` column — only after the `amount_kobo` read-fix is
  deployed and confirmed unread in prod.

---

## 2026-06-28 — Surface #3: The money path (ledger)

- 🔴 **Exploit found:** The ledger is strong (all balance writes are `FOR UPDATE`
  RPCs; balances have `>= 0` CHECKs), but three backstops were missing: (1) **no
  amount-integrity CHECK** on `wallet_transactions`, `customer_wallet_transactions`,
  `platform_earnings`, `refunds` — a zero/empty-amount row could be inserted (the
  direct-insert tables aren't RPC-validated); (2) **no idempotency UNIQUE on
  `platform_earnings`** — a re-fired completion double-books revenue, corrupting
  reconciliation; (3) **escrow released on a timestamp, not live order status** —
  `release_held_batch` never re-checked `orders`.
- 🔵 **Fix (migration 086):** Four `CHECK` constraints shipped **`NOT VALID`**
  (enforce new writes, never fail on legacy rows). **Per-table predicate** — the
  trap: `platform_earnings` and `customer_wallet_transactions` legitimately store
  NEGATIVE rows (costs / `ADMIN_ADJUSTMENT` debits), so they use `<> 0`; a blanket
  `> 0` would corrupt them. `refunds` uses `> 0`. Partial UNIQUE on
  `platform_earnings (order_id, type) WHERE order_id IS NOT NULL`, apply-safe
  (legacy dupes WARN, don't abort). Escrow gated: `release_held_batch` only
  releases a HOLD whose linked order is `DELIVERED`/`COMPLETED` (075 lot logic
  preserved verbatim; gate is the only change; strictly stricter — never releases
  something it didn't before).
- 🟣 **Hardening:** DB-level amount integrity is the structural property — the RPC
  `> 0` guards now have a database backstop that can't be bypassed by a direct
  insert. Escrow correctness is enforced in the locked release cursor itself.
- 🟢 **Detection:** A doubled-completion now fails the UNIQUE (visible error) rather
  than silently corrupting platform revenue; reconciliation (`wallet-reconciliation`
  cron) remains the float watchdog.
- ✅ **Test:** `test/money-path.test.ts` (static) locks the migration shape —
  signed-safe `<> 0` predicate (not `> 0`) on the signed ledgers, all four
  `NOT VALID`, the partial index, the escrow status-gate + text-cast. **`test/
  money-path-behavior.test.ts` (REAL Postgres via pglite)** executes the actual 086
  SQL and proves behavior: amount=0 RAISES on all four tables; a negative
  (signed-cost) row is ACCEPTED; duplicate `(order_id,type)` REJECTED while NULL
  order_id repeats freely; a HOLD on a DELIVERED order RELEASES (held→available),
  a HOLD on a CANCELLED order does NOT. Live `scripts/verify-086.sql` for the prod
  DB too. **Suite: 403/403.**
- ⚠️ **Action required:** Run migration `086_money_path_integrity.sql`, then
  `scripts/verify-086.sql` (all PASS). Constraints are `NOT VALID` by decision —
  run the audit SELECTs in the migration footer before any future `VALIDATE`.

**Open findings routed forward — surface #4 (Paystack webhooks):**
- **Vestigial `refunds.amount` (NOT NULL, no default) — LIVE BUG.** No writer sets
  it (all inserts use `amount_kobo`: webhook.ts:152, order-refund.ts:126, RPC 071),
  so the first real refund insert would hit a NOT NULL violation. WORSE: there IS a
  live READ — `lib/paystack/webhook.ts:362` does `.select('order_id, amount')` and
  line 383 renders `Math.round(refund.amount/100)` in the REFUND_PROCESSED WhatsApp
  message → reads NULL → customer sees `NaN`/₦0. Fix at #4 alongside the refund
  insert path: read `amount_kobo` in the webhook, and relax/drop the vestigial
  `amount` column. Do NOT drop the column before #4.
- `charge.success` webhook may double-process on Paystack retry (duplicate earnings/
  notifications); legacy direct refund insert at `lib/paystack/webhook.ts:152`.
- Withdraw-route PIN-attempt metadata updates aren't lock-atomic (no balance
  impact) → minor, defer.

---

## 2026-06-28 — Surface #2: Custom JWT cookie auth

- 🔴 **Exploit found:** (1) The edge `proxy` verified only the JWT signature+`exp` —
  it never checked the DB, so a **revoked / re-keyed token kept loading protected
  pages until natural expiry** (up to 24h). "Re-key everything" was not immediate
  for page navigation. (2) **No detection** — no auth-failure/lockout/revoked-token
  event was recorded anywhere; the war-room was blind and there was no
  tamper-evident trail. (3) `getSecret()` accepted a too-short `JWT_SECRET` at
  runtime (brute-forceable HS256). (4) Cookie had no `__Host-` prefix.
- 🔵 **Fix:** Shared **fail-closed** `isSessionLive()` (any DB error/timeout →
  DEAD) now enforced in BOTH `getCurrentUser` and the edge `proxy` → revocation is
  immediate everywhere. Single `sessionCookieName()` helper (prod `__Host-session`,
  dev `session`) routed through all 11 cookie read/write sites. Runtime
  `JWT_SECRET` length floor (≥32).
- 🟣 **Hardening:** Migration `085_security_events.sql` — the **hash-chained,
  append-only** detection spine. `row_hash = sha256(prev_hash || canonical fields)`,
  appends serialized by advisory lock; UPDATE/DELETE/TRUNCATE all RAISE **with no
  role check, so the guard blocks `service_role` too**. `security_events_verify_chain()`
  exposes any tamper; RLS + grant-revoke seal it from anon/authenticated.
- 🟢 **Detection:** `recordSecurityEvent()` writer (redacts pin/otp/token/phone/bank
  at any depth, never throws). Emits `auth_fail` (wrong PIN + lockout, and revoked
  token at the edge), `session_revoked` (re-key), `stepup_fail` (WebAuthn). Sentinel
  now raises **SEV2 `AUTH_FAIL_BURST`** (≥5 fails/IP/60s) and **SEV1
  `SECURITY_EVENTS_TAMPER`** (broken chain). Kill switches already on the Security
  Health page (Lockdown, Re-key/Revoke-all-sessions).
- ✅ **Test:** `test/proxy-revocation.test.ts` — revoked session → 307 `/auth` +
  cookie cleared (RED #1 now fails), incl. fail-closed case. `test/security-events.test.ts`
  — redaction, short-secret rejection (RED #3), and migration-085 audit asserting the
  immutability guard covers UPDATE+DELETE+TRUNCATE with **no `auth.role` exemption**.
  Live proof script `scripts/verify-085-immutability.sql`. **Suite: 387/387.**
- ⚠️ **Action required:** Run migration `085_security_events.sql` in Supabase, then
  `scripts/verify-085-immutability.sql` (all PASS, chain check zero rows). NOTE:
  deploying the `__Host-` cookie change logs **everyone out once** (existing
  `session` cookies stop being read) — expected, one-time.

**Cross-surface risks noticed (NOT fixed this pass):**
- No central `can()` gate; per-route inline role checks remain → surface #5.
- Dead `auth.jwt()` RLS policies (008) still present → #5 cleanup.
- No device/IP binding on sessions (impossible-travel detection) → a Sentinel rule
  for a later detection pass; the ip/user_agent columns are recorded but unused.

---

## 2026-06-28 — Surface #1: Authorization backstop (RLS)

- 🔴 **Exploit found:** The public `anon` key ships in the browser JS bundle, and
  all server reads use the `service_role` (which bypasses RLS), so RLS is the
  *only* wall on the direct-to-PostgREST/Realtime path. RLS coverage was
  hand-maintained across 30+ migrations with no central assertion, no test, and
  no alert — one forgotten `ENABLE ROW LEVEL SECURITY` on a new table = that
  table is silently world-readable with the bundled key. The live "Private tables
  reject the public key" probe (`lib/security-health.ts`) only tested **8
  hardcoded tables**, so the super-admin page showed GREEN while the RLS
  guarantee was *unverified for ~90% of tables* — including `saved_places` (home
  address + GPS), `customer_addresses`, `lumi_memory`, `consent_log`,
  `webauthn_credentials`, `push_subscriptions`, `customer_wallets` and the
  `study_*` set. (No table is actually exposed today — every table does enable
  RLS — but the guarantee was unverified and unprotected against regression.)
- 🔵 **Fix:** Migration `084_rls_coverage_backstop.sql` — a self-healing backstop
  that loops every `public` base table and enables RLS on any that lack it
  (no-op today, forward protection for future tables), plus the authoritative
  `public.rls_coverage_gaps()` function. `lib/security-health.ts` now runs a new
  `checkRlsCoverage()` (catalog truth, covers *all* tables) and the active anon
  probe was expanded from 8 to 31 high-value PII/money tables.
- 🟣 **Hardening:** The coverage guarantee is derived from the live system catalog
  (`pg_class.relrowsecurity`), so it cannot drift from an app-layer allowlist —
  the database reports its own truth. `rls_coverage_gaps()` execute is **revoked
  from anon/authenticated and granted to `service_role` only**, so the anon key
  cannot use it to enumerate the schema.
- 🟢 **Detection:** Sentinel (`lib/sentinel.ts`) now raises a **SEV1
  `RLS_COVERAGE_GAP`** issue whenever any table loses RLS — surfaced on the
  super-admin dashboard status light and the 24/7 `/api/cron/sentinel` alerts.
  On-demand, the super-admin **Security Health** page shows the new
  "Every table is RLS-protected (no coverage gap)" critical check. **Kill
  switches** already wired on that page: Emergency Lockdown (logs everyone but
  super-admin out) and Re-key/Revoke-all-sessions.
- ✅ **Test:** `test/rls-coverage.test.ts` — the static migration audit FAILS in CI
  if any created table lacks `ENABLE ROW LEVEL SECURITY` (the RED exploit now
  fails), plus asserts migration 084 ships the loop + locked-down function, plus
  unit-tests the coverage verdict logic. Full suite: **376/376 passing.**
- ⚠️ **Action required:** Run migration `084_rls_coverage_backstop.sql` in Supabase.
  Until then `checkRlsCoverage()` degrades to a WARN ("run migration 084") and the
  Sentinel coverage check is a no-op.

**Cross-surface risks noticed (NOT fixed this pass — for their own surfaces):**
- The `auth.jwt() ->> 'phone'` policies in `008_rls_policies.sql` are **dead code**:
  the app's custom JWT is not a Supabase JWT, so `auth.jwt()` is NULL for the anon
  client and those "customers/orders see own" policies grant nothing. Harmless
  (anon gets zero rows) but misleading — belongs to surface #2/#5 cleanup.
- No central `can(user, action, resource)` gate — every API route checks role
  inline. Surface #5.
- A hash-chained, append-only `security_events` table (the doc's "data spine") was
  intentionally **not** introduced — the existing append-only `audit_logs`
  (migration 056) + Sentinel cover detection for this surface. Revisit when a
  later surface needs per-actor threat scoring.
