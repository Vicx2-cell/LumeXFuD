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

## FS-010 - HIGH - Most privileged-route denials were silent

The API proxy deliberately excluded all APIs, and 53 admin/super-admin handlers used inline role checks. Only four routes used the central evidence-emitting gate. Missing, invalid, revoked, customer/vendor/rider, and ordinary-admin probes against most privileged APIs therefore produced no common request-correlated evidence. Session IP/user-agent data already captured at login was not compared on privileged access.

Status: repaired. The proxy now narrowly matches admin, super-admin, refund, and wallet-freeze APIs, returns JSON rather than redirects, rechecks revocation, enforces super-only aliases, and records all missing/invalid/wrong-role denials. Authorized session network/user-agent changes produce observe-only evidence with an explicit no-identity-proof warning. They never block, revoke, freeze, or accuse by themselves.

## FS-011 - HIGH - Referral reward correlation data was raw and unused

Customer referral signup stored raw IP and raw user-agent fields but neither created structured evidence nor held correlated reward claims. The later `device_hash` column was unused. Repeated accounts could therefore qualify referral credits through the same referrer/request context without review, while the stored raw user-agent was more identifying than needed.

Status: repaired. Registration derives a keyed, domain-separated correlation token from already-lawful request metadata and stores no raw user-agent in referral correlation fields. Shared IP alone contributes zero risk. The first two same-context claims remain normal; only the third within 24 hours for the same referrer enters reversible reward-only manual review. The authoritative award trigger honors the hold, while signup and unrelated account actions continue normally. Evidence explicitly states that indicators do not prove common identity.

## FS-012 - HIGH - Delivery location was stored but never validated

Rider handover coordinates and GPS accuracy were already legitimate delivery fields, and `order_status_events` already had distance/validation columns. The route always marked coordinates merely “captured,” never calculated distance or implausible travel, and allowed unvalidated rider coordinates—or generic completion coordinates—to increase verified-place confidence. This enabled place-data poisoning and left investigations without accuracy-aware facts.

Status: repaired. The verified handover path now validates finite coordinates, calculates distance from the customer's delivery pin, compares a rider's prior lawful status location for implausible travel, stores accuracy/distance/validation facts, and emits only observe-mode location evidence. Missing or >250m accuracy cannot become an inconsistency claim. Security detail rounds coordinates to roughly 100m and carries a no-identity/no-presence warning. Only accurate, nearby rider handovers promote places; the generic completion path no longer promotes unvalidated coordinates. A valid code still completes delivery regardless of location signal.

## FS-013 - HIGH - Incident facts and false-positive lifecycle were display-only

The console schema displayed affected orders, payments, approximate location, containment, and case status, but both incident-creation callers used an RPC that could not populate the first three fields. There was also no authorized route or console action to move a case into investigation, containment, resolution, or false-positive review. Operators could export evidence but could not preserve the factual grounds for a case decision in its immutable timeline.

Status: repaired. Incident creation now atomically preserves bounded order/payment arrays and warning-labelled approximate location. A super-admin-only case route requires a factual note, first preserves a correlated security event, then atomically changes status, appends the event/note, and records custody. False-positive review never deletes evidence or automatically changes restrictions, sessions, or financial state. The console exposes the human-review controls and retains all existing masked indicators.

## Scoped inventory observed

- Authentication/session paths: `lib/session.ts`, `lib/pin-auth.ts`, `lib/rate-limit.ts`, `proxy.ts`, and `app/api/auth/**`.
- Restrictions/revocation: `app/api/admin/suspend`, `app/api/admin/block`, `app/api/super-admin/revoke-sessions`, suspension checks in login/session paths.
- Security evidence: `lib/security-events.ts`, migration 085, `lib/audit.ts`, security-event tests.
- Payment/order fraud surfaces: Paystack webhook/refund routes, server-side order totals, handover/delivery routes, refund and ledger helpers.
- Admin investigation surfaces: super-admin sentinel/security health/audit routes; no complete incident-case console was found.

## FS-014 - HIGH - Session issuance trusted pre-checks instead of the final minting boundary

`createSession()` inserted directly into `sessions` after route-specific checks. Several flows issue sessions after multi-step proof cookies or recovery paths, so a restriction, inactive vendor/rider/admin state, or future caller mistake between the earlier check and the final insert could still create a live bearer token. The sessions table also had no subject-integrity trigger, so a direct service-role insert could mint a session for an ineligible subject.

Status: repaired. `createSession()` now fails closed unless the subject still matches the requested role, phone, active state, deletion state, and suspension state. Migration 140 adds a sessions-table trigger that rejects suspended, inactive, wrong-phone, and wrong-role inserts at the database boundary. Tests reproduce direct minting attempts for suspended customers and inactive vendor/rider/admin subjects, plus wrong-phone and wrong-role substitution.

## FS-014 - HIGH - Refund webhooks could mass-update partial refunds sharing one transaction

`refund.processed` and `refund.failed` updated `refunds` by `paystack_transaction_reference` only. Multiple partial refunds for one Paystack charge share that transaction reference, so one provider event could mark every processing partial refund completed or failed, creating false ledger state and incorrect customer notifications.

Status: repaired. Paystack refund initiation now preserves the provider refund reference when available. Refund webhook handling selects exactly one processing refund by provider refund reference, then by unique amount, then only by single-row fallback. Ambiguous events are not applied and instead emit `webhook_reject` evidence for human review.

## FS-015 - HIGH - Incident evidence GET routes had CSRF-triggerable side effects

The incident list route records `VIEWED` custody on `GET`, and the evidence export route records `EXPORTED` custody and returns an attachment on `GET`. Because the main session cookie is `SameSite=Lax`, a cross-site top-level navigation can still carry a super-admin cookie. An attacker could not read the response through browser SOP, but could make a super-admin unknowingly append custody/export records and potentially trigger a local evidence download.

Status: repaired. Incident list and export routes now require same-origin browser provenance before performing the sensitive read/side effect. `Sec-Fetch-Site: cross-site` is rejected, same-origin and direct user navigations are allowed, Origin/Referer are used as fallbacks, and ambiguous production requests fail closed.
