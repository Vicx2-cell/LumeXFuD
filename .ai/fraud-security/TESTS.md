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
