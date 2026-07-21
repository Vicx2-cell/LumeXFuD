# Fraud/Security Results

## FS-001 complete

- Added server-generated request IDs and bounded correlation IDs to page request/response flow.
- Added structured request, route, resource, and outcome fields to security events.
- Added backward-compatible v2 evidence hashing covering actor, session, network, request, route, resource, and outcome indicators.
- Added static and embedded-PostgreSQL regression tests, including a metadata-tampering bypass attempt.
