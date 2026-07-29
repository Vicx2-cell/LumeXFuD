# Feed automation administration

Super-admin endpoints:

- `GET/PATCH /api/super-admin/feed-automation`: inspect controls, failed jobs,
  audit history and template previews; update the kill switch, post-type map,
  thresholds, frequency, affordability, anonymity, and milestone settings.
- `POST /api/super-admin/feed-automation`: rerun failed jobs idempotently or
  archive generated posts.
- `GET/POST /api/super-admin/feed-pins`: inspect, pin, replace, and unpin the
  one primary official post allowed per scope.
- Existing `/api/super-admin/official-feed` remains the official manual/editorial
  collection control, including fail-closed delivery coverage coordinates.

The `/super-admin/feed-automation` screen exposes these controls, previews,
failed-job reruns, provenance, and pins. `/vendor-dashboard/feed-automation`
provides vendor opt-out/archive controls, while `/vendor-dashboard/bundles`
publishes price-consistent orderable bundles.

Vendor endpoint `GET/POST /api/vendor/feed-automation` lists the vendor's
generated posts, updates optional-marketing opt-out/type choices, and archives
owned generated posts. It cannot alter provenance or source facts. The existing
manual composer is unchanged.

Safe defaults:

- Automation kill switch: off.
- Vendor automatic posts: maximum 2/day.
- Official post: maximum 1/area/window.
- Duplicate topic cooldown: 72 hours.
- Related menu batch window: 30 minutes.
- Price reduction: at least ₦500 or 10%.
- Back-in-stock evidence: 2 verified orders.
- Popularity: 10 verified orders.
- Order-derived anonymity: 5 orders.
- Milestones: 25, 50, 100, 500.
- Collection size: 5 (validated range 3–10).

Only super admins can change platform controls or pins. Sensitive automation
tables have RLS enabled, no anon/authenticated grants, and service-role-only
access.
