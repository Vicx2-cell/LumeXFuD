# File relevance and dependency audit

Last verified: 2026-07-29

The audit combined tracked-file inventory, import/reference search, App Router
entry-point recognition, migration/script/test classification, Knip, package
tree/audit, cycle analysis and build output. Lack of a direct import was not
treated as proof for routes, migrations, configuration, public assets, tests or
operator scripts.

## KEEP

- All active `app/**/page.tsx` and `app/api/**/route.ts` entry points. Disabled
  product routes are retained because they have explicit server feature gates.
- `supabase/migrations/001–154`: append-only production history.
- `test/`, co-located tests and `e2e/`: security/commerce contracts and browser
  checks.
- `scripts/` utilities that perform named diagnostics, reconciliation, storage
  setup, screenshots or fixture workflows.
- `public/` assets referenced by manifests, metadata, UI or PWA behavior.
- `.ai/` as historical audit/reference material only; launch documents supersede
  its counts and conclusions.

## REFACTOR

- Oversized feed screen, order-create route, cart and WhatsApp handler should be
  split by behavior after launch. Release-time splitting was rejected as higher
  risk than the maintainability benefit.
- Order status UI helpers and special collect/deliver APIs are related but not a
  single module. Their database audit behavior is consistent; centralize only
  with transition regression coverage.
- Knip reports unused exports in broad utility modules. Remove them incrementally
  with owner review; the final run reported 166 value exports and 122 exported
  types. Bulk deletion would risk dynamically referenced/framework contracts.

## ARCHIVE

- `.ai/` review artefacts and old root security review logs are historical, not
  operational truth. They should move to external release records in a future
  documentation-only change if long-term retention is required.

## DELETE

The following were proven irrelevant and removed:

- `.vercel-env-check`, `.vercel-env-prod-check`: committed command captures
  containing expired short-lived deployment credentials. No runtime references.
- `site.tar`, `site.zip`: complete deploy/repository snapshots; generated output
  and a secret-scanning liability.
- `_live-apple.png`, `tiktok-demo-lumex-fud.mp4`: unreferenced generated review
  media outside the public asset pipeline.
- `ersdelllumex-fud`: accidental git-log text output.
- `scripts/probe.mjs`, `scripts/probe2.mjs`, `scripts/make-tiktok-demo.js`:
  one-off probes/generator whose output was not part of product or CI.
- `app/style-preview/page.tsx`, `app/style-preview/vendor/page.tsx`: explicitly
  temporary, unlinked, unauthenticated visual experiments with no product or
  operator workflow.
- `app/vendor/[id]/vendor-profile-header.tsx`,
  `components/active-group-banner.tsx`,
  `components/boosts/boost-checkout-form.tsx`, `components/chow-ai.tsx`,
  `components/demand-banner.tsx`, `components/launch-counter.tsx`,
  `components/streak-nudge.tsx`, `components/ui/info-card.tsx`,
  `components/vendor-daily-summary.tsx`,
  `components/vendor-dashboard-videos-client.tsx`,
  `components/vendor-dashboard/sparkline.tsx`: no imports, route loading,
  dynamic string references or framework role.
- `lib/notify-user.ts`, `lib/study-ai-cache.ts`, `lib/study-cap-db.ts`,
  `lib/supabase/middleware.ts`: unreferenced superseded helpers. The last
  represented an unused Supabase SSR model; the application uses custom
  sessions and `proxy.ts`.
- `lib/feed/customer-mode.ts`, `lib/feed/entitlements.ts`,
  `lib/study-cache.ts`, `lib/study-cap.ts` and their four isolated unit tests:
  pure experimental implementations consumed only by their own tests. Feed
  premium access is implemented in `lib/premium.ts`; Study is disabled and its
  corresponding database adapters were already abandoned.
- Root `PLAN.md`, `progress.md`, `SECURITY_FINDINGS.md`, `SECURITY_LOG.md` and
  `VERIFY.md`: point-in-time implementation/audit notes whose claims and command
  counts were contradicted by the current tree. The repository map, handoff,
  security guide, progress record and certification now provide maintained
  replacements.

Each deletion is recoverable from Git history. No migration was deleted.

## MANUAL_REVIEW

- `.ai/` notes contain historical statements. They should not be consulted for
  current release status; `docs/launch/` is authoritative.
- Static analysis sees several framework/config/script files as unused because
  they are not imported. They remain intentionally.
- The repository history contains two expired Vercel OIDC tokens removed from
  the current tree. Their signed expiry and no-rewrite disposition are verified
  in `HISTORICAL_SECRET_RESPONSE.md`.
- Certification V2 constrains every Next consumer to patched Sharp 0.35.3 and
  the production audit is clean. The remaining full-audit advisory is confined
  to development ESLint glob processing and is dispositioned in
  `DEPENDENCY_SECURITY_DECISION.md`.

## Dependencies

Removed: `@supabase/ssr` (no imports; contradicted actual authentication).
Moved: `@types/leaflet` from production to development dependencies.
Updated without product changes: Next/ESLint config, Sentry, direct Sharp and
`file-type` to current compatible security-fix releases. Node 22 is now explicit
because current tooling/dependencies require it. Playwright remains because e2e
and operator scripts import it.
