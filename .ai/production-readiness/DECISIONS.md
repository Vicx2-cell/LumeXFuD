# Decisions

- 2026-07-21: did not create a branch or commit because the starting workspace is dirty and ownership of changes is unresolved.
- 2026-07-21: treated filesystem/working-tree code as the baseline while recording HEAD separately.
- 2026-07-21: used `npm.cmd`/`npx.cmd` after PowerShell blocked wrapper scripts.
- 2026-07-21: made documentation-only additions and stopped before remediation as required.
- 2026-07-21: after owner approval, created `audit/production-readiness` carrying the approved working tree.
- 2026-07-21: classified mixed email proof handlers as `auth` (handler-authorized), not globally public; classified the signed Resend callback as `webhook`.
- 2026-07-21: made verification-email sending fail closed because it incurs external cost.
- 2026-07-21: owner required item-level specification traceability; added `CHECKLIST.md` as the completion ledger. No phase may be declared complete while its items lack a terminal classification and evidence.
- 2026-07-21: an interrupted multi-file patch applied only the `app/api/applications/route.ts` fail-closed limiter hunk before aborting. It remains an explicit uncommitted change pending its own coherent verification/commit.
