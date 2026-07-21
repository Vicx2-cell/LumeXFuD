# Fraud/Security Findings

## FS-001 - HIGH - Evidence metadata omitted from tamper-evident hash

Migration 085 hashes event type, severity, actor ID/role, surface, and detail, but omits `session_id`, `ip`, and `user_agent`. Those incident indicators could therefore be changed without causing `security_events_verify_chain()` to report a broken row. The same schema has no first-class request or correlation identifiers.

Status: repaired. Migration 133 preserves verification of existing v1 rows and binds all new incident metadata into a v2 integrity payload. The verifier detects changes to protected session/IP metadata.

## Scoped inventory observed

- Authentication/session paths: `lib/session.ts`, `lib/pin-auth.ts`, `lib/rate-limit.ts`, `proxy.ts`, and `app/api/auth/**`.
- Restrictions/revocation: `app/api/admin/suspend`, `app/api/admin/block`, `app/api/super-admin/revoke-sessions`, suspension checks in login/session paths.
- Security evidence: `lib/security-events.ts`, migration 085, `lib/audit.ts`, security-event tests.
- Payment/order fraud surfaces: Paystack webhook/refund routes, server-side order totals, handover/delivery routes, refund and ledger helpers.
- Admin investigation surfaces: super-admin sentinel/security health/audit routes; no complete incident-case console was found.
