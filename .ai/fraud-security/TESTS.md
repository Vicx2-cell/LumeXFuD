# Fraud/Security Tests

## Baseline

- PASS: `npm.cmd test -- --run test/security-events.test.ts test/proxy-revocation.test.ts`
- Result: 2 files, 11 tests passed.

## FS-001 verification

- PASS: new request IDs ignore caller-supplied request IDs.
- PASS: valid bounded correlation IDs continue; malformed/oversized values are replaced.
- PASS: response exposes both identifiers.
- PASS: migration statically proves every incident indicator enters the v2 integrity payload.
- PASS: embedded PostgreSQL verifies existing v1 rows together with v2 rows.
- PASS: bypass simulation changing `session_id` and `ip` is reported as an integrity mismatch.
- PASS: TypeScript and targeted ESLint.

## FS-002 / FS-003 verification

- PASS: per-phone and per-network OTP send limits run before provider traffic.
- PASS: caller-supplied request ID is ignored on OTP API responses.
- PASS: cooldown retry and verify velocity emit rate-limit evidence.
- PASS: invalid OTP emits evidence and never mints a proof cookie.
- PASS: successful sends store no phone, OTP, or provider reference in security-event details.
- PASS: a weak location/device signal remains observe-only.
- PASS: one OTP velocity signal can rate-limit but cannot restrict or freeze.
- PASS: corroborated payment and authorization signals produce graduated containment actions.
- PASS: 233 focused/authorization tests, TypeScript, and targeted ESLint.

## FS-004 verification

- PASS: customer, vendor, and rider suspension revokes all active sessions in embedded PostgreSQL.
- PASS: lifting a restriction does not revive a revoked session.
- PASS: generic restriction message exposes no device, fingerprint, location, rule, or score detail.
- PASS: PIN login, social completion, order creation, and WhatsApp ordering share the same message and do not select `suspend_reason`.
- PASS: block/unblock persistence errors reject instead of reporting success.
- PASS: 223 focused/revocation/authorization tests, TypeScript, and targeted ESLint.

## FS-005 verification

- PASS: incident, timeline, evidence-hold, and append-only custody schema checks.
- PASS: incident and export routes are super-admin-only and present in route-policy coverage.
- PASS: new tables enable RLS and deny anon/authenticated table access.
- PASS: default console masks account/session/resource identifiers, coarsens IP indicators, hides user-agent detail, and removes precise coordinates.
- PASS: evidence export is SHA-256 hashed, records custody, separates facts/inferences, requires human authorization, and contains no external-send call.
- PASS: 230 incident/authorization/RLS/redaction/evidence tests, TypeScript, and targeted ESLint.

## FS-006 verification

- PASS: duplicate webhook still returns 200 and never invokes the money processor.
- PASS: duplicate emits `webhook_replay` with request ID, provider resource, and observe-only risk.
- PASS: forged signature and dedupe-storage failure remain rejected/deferred with structured evidence.
- PASS: focused webhook/idempotency/risk tests, TypeScript, and targeted ESLint.

## Checkpoint

- PASS: production build on Next.js 16.2.6, including TypeScript and 150 generated static pages.
- PASS after isolated reproduction: `test/handover-flow.test.ts` (8/8).
- Full suite under concurrent build load: 758 passed, one timeout-only failure; the timed-out test passed immediately in isolation, so no delivery-code assertion failure was reproduced.

## FS-007 verification

- PASS (1.47s Vitest duration): `npm.cmd test -- test/refund-risk.test.ts test/risk-engine.test.ts test/security-events.test.ts` (3 files, 19 tests).
- PASS (combined command 56.5s): the focused tests above followed by `npx.cmd tsc --noEmit`.
- PASS (5.93s Vitest duration; 8.5s command): broader refund, money-path, webhook, request-context, risk, and security-event set (9 files, 50 tests).
- PASS: a legitimate first/full refund and value alone remain observe-only and cannot create a hold or freeze.
- PASS: repeated account refunds plus cumulative value create a human-review evidence hold; repeated split refunds preserve an order-abuse indicator without case escalation by themselves.
- PASS: atomic reservation remains the concurrency/replay authority; rejected races and provider compensation outcomes now produce correlated evidence.

## FS-008 verification

- PASS (1.12s Vitest duration; 16.2s with TypeScript): focused order-fraud, route-boundary, risk, request-context, and security-event tests (5 files, 25 tests), followed by `npx.cmd tsc --noEmit`.
- PASS (5.43s Vitest duration; 7.2s command): broader order, money-path, authorization, validators, delivery pricing, rewards, state/speed, and webhook-idempotency tests (12 files, 71 tests).
- PASS: order-intent digest is stable under harmless add-on ordering and changes for price, quantity, destination, or payment-mode substitution.
- PASS: oversized, short, whitespace-bearing, and malformed idempotency keys fail closed.
- PASS: wrong-role, account-rate, shared-network-rate, owner-mismatch, payload-mismatch, and safe-replay outcomes preserve request-correlated evidence.
- PASS: one unusual basket remains observe-only; one payload mismatch alone does not recommend a financial freeze or evidence hold.

## FS-009 verification

- PASS (1.69s Vitest duration; 10.5s command with TypeScript): focused stale-rider, handover, rider-chat, order-state, request-context, and security-event tests (7 files, 41 tests), followed by `npx.cmd tsc --noEmit`.
- PASS (6.27s Vitest duration; 8.0s command): broader handover, rider/vendor/customer communication, reassignment race, lifecycle/RLS, authz, money-path, order-state, and speed tests (15 files, 73 tests).
- PASS: concurrent accepts serialize rider/order rows and cannot leave an assigned order with an available rider.
- PASS: status and delivery claims include the live rider ID, so reassignment during a request yields 409 and evidence rather than a state or payout transition.
- PASS: stale wrong-code guesses cannot increment or lock the replacement rider's handover code.
- PASS: proof upload rechecks assignment/status and removes the just-uploaded orphan when the claim is lost.
- PASS: no security event contains the raw handover code.

## FS-010 verification

- PASS (1.14s Vitest duration; 13.2s command with TypeScript): focused privileged proxy, admin risk, proxy revocation, authz, and route-policy tests (5 files, 20 tests), followed by `npx.cmd tsc --noEmit`.
- PASS (5.49s Vitest duration; 7.4s command): broader admin risk/proxy/authz/security-event/incident/restriction/session/admin-route tests (11 files, 46 tests).
- PASS: missing, invalid/revoked, wrong-role, ordinary-admin-to-super, and trailing-slash alias probes return JSON 401/403 with request-correlated evidence.
- PASS: admin/block, admin/wallet-adjust, feature flags, stats, and WhatsApp remain super-only at the proxy and handler layers.
- PASS: changed IP and user-agent indicators together remain observe-only and explicitly do not prove identity.
- PASS: one wrong-role signal cannot recommend a financial freeze.

## FS-011 verification

- PASS (1.08s Vitest duration; 23.2s command with TypeScript): focused multi-account token, referral integration, rewards, risk, request-context, and security-event tests (6 files, 28 tests), followed by `npx.cmd tsc --noEmit`.
- PASS (4.56s Vitest duration; 6.3s command): broader auth/referral/reward/risk/authz/OTP/email/restriction tests (11 files, 56 tests).
- PASS: correlation token is deterministic, keyed, non-reversible, and unavailable with a weak/missing secret.
- PASS: shared IP alone and the first two correlated claims remain observe-only.
- PASS: the third same-referrer/same-token claim in 24 hours enters reward-only manual review and emits no token/raw user-agent detail.
- PASS: the completion trigger returns before issuing either referral credit while manual review is active.
- PASS: no customer suspension, permanent ban, identity claim, or unrelated financial freeze is introduced.

## FS-012 verification

- PASS (1.63s Vitest duration; 26.3s command with TypeScript): focused location-risk, route integration, delivery pricing, handover, stale-rider, request-context, and security-event tests (7 files, 39 tests), followed by `npx.cmd tsc --noEmit`.
- PASS (4.74s Vitest duration; 6.6s command): broader location, saved/vendor place, handover, order state/speed, money-path, incident, and redaction tests (13 files, 84 tests).
- PASS: NaN/out-of-range coordinates are not persisted as validated evidence.
- PASS: missing or poor accuracy is observe-only even at extreme distance; shared uncertainty is not converted into an accusation.
- PASS: nearby accurate handover is unflagged; >5km accurate mismatch plus >160km/h prior travel produces factual corroborated rules.
- PASS: event coordinates are rounded and carry the no-identity/no-presence warning.
- PASS: only <=250m-accuracy, within-radius rider handover can promote a verified place; generic completion cannot.
- PASS: location signals are evaluated after the assignment-bound handover claim and never block valid-code completion or release funds independently.

## FS-013 verification

- PASS (1.01s Vitest duration; 12.1s command with TypeScript): focused incident lifecycle, authorization coverage, and privileged proxy tests (4 files, 20 tests), followed by `npx.cmd tsc --noEmit`.
- PASS (6.87s Vitest duration; 9.4s command): broader incident, refund, order, rider, admin, multi-account, location, restriction, revocation, risk, event, and replay tests (20 files, 90 tests).
- PASS: anonymous and ordinary-admin case updates are denied before any case RPC.
- PASS: unsupported status, missing factual note, missing evidence event, missing case, and transaction failure do not report success.
- PASS: affected order/payment evidence is preserved by automatic refund cases and manual case creation supports bounded approximate-location facts.
- PASS: false-positive status appends timeline and custody records; it cannot delete evidence, lift restrictions, revive sessions, unfreeze wallets, or assert innocence/guilt automatically.

## Final isolated verification

- PASS: `$fraudBuildTimer = [System.Diagnostics.Stopwatch]::StartNew(); npm.cmd run build` completed alone in 126.167s. Next.js 16.2.6 compiled successfully, completed TypeScript, and generated 150/150 static pages.
- PASS: after the build process exited, `$fraudTestTimer = [System.Diagnostics.Stopwatch]::StartNew(); npm.cmd test` completed alone in 39.185s (37.24s Vitest duration): 113/113 files and 807/807 tests passed.
- No failure occurred in the isolated full suite, so no deterministic, timing-sensitive, or environmental defect remained to rerun or classify.
- The earlier concurrent-load 758/759 checkpoint is not a full pass and is superseded by this serialized 807/807 result.
- PASS: ancestry checks confirmed all six pre-existing loop commits remain intact: `fddff21`, `355ccd1`, `383dc8c`, `df09a57`, `44f9967`, and `4c10bd1`.

## FS-014 red-team checkpoint

- PASS: `npm.cmd test -- --run test/account-restriction.test.ts` completed in 11.9s command time / 8.57s Vitest duration: 1 file, 9/9 tests passed.
- PASS: `npm.cmd test -- --run test/refund-webhook-target.test.ts test/refund-naira.test.ts test/webhook-idempotency.test.ts` completed in 10.6s command time / 7.15s Vitest duration: 3 files, 12/12 tests passed.
- PASS: `npm.cmd test -- --run test/account-restriction.test.ts test/proxy-revocation.test.ts test/access-control.test.ts test/webhook-route.test.ts test/webhook-and-exposure.test.ts test/webhook-idempotency.test.ts test/refund-risk.test.ts test/refund-naira.test.ts test/refund-webhook-target.test.ts test/order-fraud.test.ts test/order-fraud-route.test.ts test/stale-rider-access.test.ts test/security-incidents.test.ts test/security-incident-case-route.test.ts test/security-events.test.ts` completed in 17.0s command time / 14.14s Vitest duration: 15 files, 283/283 tests passed.
- PASS: `npx.cmd tsc --noEmit` passed after the session-boundary repair and again after the refund-webhook repair.

## FS-015 red-team checkpoint

- PASS: `npm.cmd test -- --run test/csrf-origin.test.ts test/security-incidents.test.ts test/security-incident-case-route.test.ts test/incident-redaction.test.ts test/privileged-api-proxy.test.ts` completed in 6.6s command time / 2.78s Vitest duration: 5 files, 22/22 tests passed.
- PASS: `npm.cmd test -- --run test/csrf-origin.test.ts test/account-restriction.test.ts test/proxy-revocation.test.ts test/access-control.test.ts test/webhook-route.test.ts test/webhook-and-exposure.test.ts test/webhook-idempotency.test.ts test/refund-risk.test.ts test/refund-naira.test.ts test/refund-webhook-target.test.ts test/order-fraud.test.ts test/order-fraud-route.test.ts test/stale-rider-access.test.ts test/security-incidents.test.ts test/security-incident-case-route.test.ts test/security-events.test.ts` completed in 16.0s command time / 13.28s Vitest duration: 16 files, 286/286 tests passed.
- PASS: `npx.cmd tsc --noEmit` passed.
