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

## FS-006 - MEDIUM - Duplicate Paystack webhooks were silently discarded

The unique replay guard correctly prevented duplicate processing, but the `23505` branch returned 200 without evidence or request correlation. This made ordinary provider retries indistinguishable from replay patterns during investigation.

Status: repaired. Duplicate deliveries remain 200/no-op, now emit a request-correlated `webhook_replay` event with a weak payment signal. A single duplicate evaluates to observe-only and cannot affect an account or financial operation.

## FS-007 - HIGH - Refund abuse had no cumulative evidence or case escalation

The atomic refund reservation prevented over-refunds and concurrent duplicates, but the route recorded no structured security evidence. It did not evaluate customer-ledger refund velocity/value across orders, repeated partial-refund fragmentation, reservation rejections, or provider compensation failures. Investigators therefore lacked correlated facts even when the money path itself remained safe.

Status: repaired. The admin refund route now returns server-generated request/correlation IDs, preserves structured risk and failure events, and evaluates only existing customer/order/refund ledger facts. One refund, a full refund, or high value alone stays observe-only. Only corroborated repeated activity creates an evidence hold and security-admin case; it does not automatically freeze money or accuse the customer.

## FS-008 - HIGH - Order idempotency replay was not bound to its payload

Order pricing already came from menu/add-on/delivery data on the server and the unique idempotency key prevented duplicate charges. However, the key was unbounded and bound only to an owner. The same customer could reuse it with a materially different basket, destination, payment mode, reward, or group intent and receive the original checkout response with no manipulation evidence. Checkout rate limits also emitted no event, had no high-capacity shared-network layer, and the route itself did not reject non-customer sessions.

Status: repaired. A SHA-256 digest binds the key to canonical authoritative prices, basket, hashed destination, delivery/payment/reward/group semantics, and schedule. Payload/owner mismatches fail closed before replay and emit correlated evidence. Keys are bounded, the route enforces customer role, and account/network/unpaid-order signals are proportionate. A single large basket remains observe-only; no raw destination is stored in the new digest column.

## FS-009 - CRITICAL - Reassigned riders could win stale mutation races

Delivery and status routes checked the assigned rider in one read, then updated by order ID/status only. Reassignment between those operations allowed a stale rider to complete the write. Wrong-code accounting had the same gap and could lock the new rider's code. Optional proof upload could attach after reassignment. Rider acceptance also changed the order and rider in separate statements, allowing partial or competing assignment state.

Status: repaired. Rider acceptance now locks and updates both rows in one service-role RPC. Rider status/delivery mutations recheck `rider_id` in the write predicate, wrong-code counting locks only the expected assigned rider's picked-up order, and proof uploads are assignment/status-bound with orphan cleanup. Every stale/rejected outcome records request-correlated evidence; raw handover codes are never recorded.

## Scoped inventory observed

- Authentication/session paths: `lib/session.ts`, `lib/pin-auth.ts`, `lib/rate-limit.ts`, `proxy.ts`, and `app/api/auth/**`.
- Restrictions/revocation: `app/api/admin/suspend`, `app/api/admin/block`, `app/api/super-admin/revoke-sessions`, suspension checks in login/session paths.
- Security evidence: `lib/security-events.ts`, migration 085, `lib/audit.ts`, security-event tests.
- Payment/order fraud surfaces: Paystack webhook/refund routes, server-side order totals, handover/delivery routes, refund and ledger helpers.
- Admin investigation surfaces: super-admin sentinel/security health/audit routes; no complete incident-case console was found.
