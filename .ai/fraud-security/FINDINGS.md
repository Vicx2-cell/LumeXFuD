# Fraud/Security Findings

## FS-001 - HIGH - Evidence metadata omitted from tamper-evident hash

Migration 085 hashes event type, severity, actor ID/role, surface, and detail, but omits `session_id`, `ip`, and `user_agent`. Those incident indicators could therefore be changed without causing `security_events_verify_chain()` to report a broken row. The same schema has no first-class request or correlation identifiers.

Status: repaired. Migration 133 preserves verification of existing v1 rows and binds all new incident metadata into a v2 integrity payload. The verifier detects changes to protected session/IP metadata.

## FS-002 - HIGH - OTP hourly limiter existed but was not enforced

`rateLimitOtpSend()` defines a fail-closed per-phone provider-cost limit, but the OTP send route never called it. The route relied only on a 60-second Redis cooldown, emitted no structured send/verify/rate-limit events, and did not attach request/correlation IDs to API responses. Repeated sends over time and distributed phone targeting therefore lacked the intended cap and incident evidence.

Status: repaired. OTP send now applies per-phone and campus-NAT-safe per-network limits before provider traffic, records send/failure/cooldown/verification outcomes without phone numbers or OTP values, and returns server-generated request/correlation IDs.

## FS-003 - MEDIUM - No category-based risk evaluator

Security events had severities but no common category scoring or proportional action calculation.

Status: foundational repair complete. `lib/risk-engine.ts` evaluates authentication, authorization, payment, order-abuse, device/session, bot, and admin signals with explicit false-positive caps and graduated actions. Persistence and automatic execution of higher containment actions remain future tasks.

## FS-004 - HIGH - Suspension did not revoke already-issued sessions

Suspension and phone-block routes updated account rows, while `getCurrentUser()` only checked the sessions table. Existing sessions therefore remained valid until expiry. Blocklist writes and per-account updates also ignored returned database errors, so an operator could receive a success response after an incomplete restriction. Several user-facing paths interpolated the stored suspension reason.

Status: repaired. Migration 134 adds transactional suspension triggers for customers, vendors, and riders that revoke every active session. Reinstatement does not revive sessions. Blocklist/account update failures now fail the operation visibly. Restriction events are structured and request-correlated, while all current user-facing paths reuse one generic message and no longer select the internal reason.

## FS-005 - HIGH - No security incident, evidence-hold, or custody system

The immutable security-event spine had no case grouping, factual incident timeline, evidence hold, access history, integrity display, or human-review evidence package. Existing Security Health UI covered configuration posture only.

Status: repaired with a scoped foundation. Migration 135 adds incidents, immutable event links, evidence holds, and append-only custody with atomic case creation. A super-admin-only API and console show severity, confidence, classification, associated account indicator, masked session/network/device indicators, approximate-location warnings, orders/payments, rules, containment, timeline, and live chain integrity. Explicit exports include hashes, facts separated from inferences, custody, deployment commit, and a no-automatic-submission declaration.

## Scoped inventory observed

- Authentication/session paths: `lib/session.ts`, `lib/pin-auth.ts`, `lib/rate-limit.ts`, `proxy.ts`, and `app/api/auth/**`.
- Restrictions/revocation: `app/api/admin/suspend`, `app/api/admin/block`, `app/api/super-admin/revoke-sessions`, suspension checks in login/session paths.
- Security evidence: `lib/security-events.ts`, migration 085, `lib/audit.ts`, security-event tests.
- Payment/order fraud surfaces: Paystack webhook/refund routes, server-side order totals, handover/delivery routes, refund and ledger helpers.
- Admin investigation surfaces: super-admin sentinel/security health/audit routes; no complete incident-case console was found.
