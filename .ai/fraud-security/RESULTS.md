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
