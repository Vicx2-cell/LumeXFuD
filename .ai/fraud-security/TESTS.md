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
