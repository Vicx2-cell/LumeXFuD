# Security architecture and release checks

Last verified: 2026-07-29

## Trust boundaries

- Browser data is presentation/input only. Prices, distance, identity, role,
  availability, order state, wallet state and provider status are reloaded on
  the server.
- `proxy.ts` is coarse routing/security-header protection; route authorization
  and Supabase RLS/column grants remain mandatory.
- Custom JWT cookies are verified against live database sessions. Restrictions,
  deactivation and revocation invalidate sessions.
- `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `PAYSTACK_SECRET_KEY`,
  `ENCRYPTION_KEY` and provider secrets are server-only.
- Webhooks use raw-body signatures, durable replay claims and idempotent money
  handlers. If the claim cannot be stored, processing fails closed.
- Guest and group access use signed scoped tokens, not discoverable identifiers.
- Uploads validate size and magic bytes, re-encode supported images and use
  controlled storage paths.

## Operational controls

`lib/controls.ts` owns maintenance, lockdown, payout, withdrawal, notification
and hours controls. Sensitive read failure returns safe locked/frozen defaults.
`lib/features.ts` owns product flags and unknown flags fail closed. These systems
are distinct: hiding navigation is never the only enforcement.

## Database

Migrations are append-only. Migration 084 contains the RLS-coverage backstop;
migration 048 limits sensitive public projections; later reconciliation
migrations harden money paths, atomic rider claims, sessions, guest/group
authorization, webhook schema and promotion/DVA rules. Run coverage tests and
production role probes; do not infer policy correctness from `ENABLE ROW LEVEL
SECURITY` alone.

## Release checks

Run on Node 22+:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit --omit=dev
git diff --check
```

Additionally:

- scan the current tree and history for secrets and generated environment
  captures;
- verify no service-role value appears in `.next/static`;
- attempt customer/vendor/rider/admin IDOR and session replay in preview;
- tamper with price, vendor/item IDs, distance and negative totals;
- replay and race checkout, webhooks, promotion reservation and rider acceptance;
- verify guest-order and group-code enumeration resistance;
- reconcile paid/refunded/provider/ledger/settlement values in integer kobo;
- confirm Sentry scrubbing, Upstash rate limiting and every cron health record.

Current release state and unresolved gates are authoritative in
`docs/launch/MVP_CERTIFICATION.md`. Do not use historical `.ai/` artefacts as a
current approval.
