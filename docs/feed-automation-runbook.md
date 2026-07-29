# Feed automation operational runbook

## Before enabling

1. Apply migrations 156 and 157 in staging and verify all new tables, triggers, grants,
   indexes, and the claim RPC.
2. Keep `feed_automation_settings.enabled = false`.
3. Confirm the protected official profile has key `lumex_fud`, gold/official
   badge data, verified state, locked identity, and exactly one row.
4. Run the full application suite and a dry data review for each area.
5. Configure thresholds, post-type switches, area collection settings, vendor
   limits, anonymity minimum, and each area coverage anchor/radius. Official
   scheduled collections fail closed when coverage is incomplete.
6. Exercise `/api/cron/official-feed` with the cron secret while paused; it must
   report `paused` and publish nothing.
7. Enable in one test area only, inspect generated drafts/posts and provenance,
   then expand deliberately.

## Monitoring

Run the official-feed cron every 15 minutes. Monitor cron health,
`feed_automation_outbox` status/age, `dead` jobs, generation audit, per-vendor
daily volume, duplicate suppression, invalid CTA count, and expired pins.

## Failure response

- Spike or bad copy: turn the global kill switch off. Pending jobs remain
  unclaimed.
- One vendor: pause its automation or disable optional marketing.
- One type: disable it in `enabled_post_types`.
- Failed job: correct source/config, then use idempotent rerun. Never edit the
  event key.
- Bad generated post: archive it; do not delete provenance.
- Broken link: run the worker reconciliation and confirm `cta_enabled = false`.
- Stuck pin: unpin through the super-admin API and inspect the pin audit.

Feed failure must never be treated as a reason to retry or roll back checkout,
payment, vendor approval, or inventory writes. The outbox trigger catches its
own errors and the worker is asynchronous.

## Rollback

Disable the kill switch first. Code can be rolled back while the additive
tables remain. Do not edit or remove migrations 156 or 157 after application. Add a new
reconciliation migration for any production drift.
