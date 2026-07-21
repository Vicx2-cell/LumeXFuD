# Fraud/Security Results

## FS-001 complete

- Added server-generated request IDs and bounded correlation IDs to page request/response flow.
- Added structured request, route, resource, and outcome fields to security events.
- Added backward-compatible v2 evidence hashing covering actor, session, network, request, route, resource, and outcome indicators.
- Added static and embedded-PostgreSQL regression tests, including a metadata-tampering bypass attempt.

## FS-002 / FS-003 complete

- Enforced the existing fail-closed OTP send limiter and a separate high-capacity network limiter suitable for shared campus networks.
- Added structured OTP send, verify, failure, cooldown, and throttle evidence with request/correlation IDs.
- Added a seven-category risk evaluator with graduated actions and false-positive protections; it contains no permanent-ban action.
- Added regression and bypass tests covering provider-call prevention, proof-cookie boundaries, identifier injection, and proportional response.

## FS-004 complete

- Added database triggers that revoke active sessions in the same transaction as customer, vendor, or rider suspension.
- Ensured reinstatement requires a fresh login and never resurrects revoked sessions.
- Added structured, request-correlated restriction/lift events to admin suspension and block actions.
- Made blocklist and per-account mutation failures visible rather than silently returning success.
- Replaced reason-revealing restriction responses with one generic message across login, social auth, web ordering, and WhatsApp ordering.

## FS-005 complete

- Added durable incident cases, factual event timelines, evidence holds, and append-only custody.
- Added atomic incident creation from a preserved security event.
- Added a super-admin-only incident API and console with masked indicators and explicit accuracy warnings.
- Added a hashed JSON evidence package for human review; export is custody-logged and never automatically submitted or transmitted.

## FS-006 complete

- Preserved Paystack idempotent 200/no-op behavior while recording duplicate delivery/replay evidence.
- Added server-generated request/correlation IDs to every webhook response and event.
- Kept one duplicate as a weak, observe-only signal to protect against false positives from normal provider retries.
