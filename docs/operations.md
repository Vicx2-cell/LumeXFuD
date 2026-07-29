# LumeX Fud Operations Runbook

This runbook is for daily operation without direct database edits. Use admin and
super-admin tools first; use SQL only for documented restore or migration
procedures.

## Daily Checks

- Open `/super-admin/sentinel` and confirm status is `HEALTHY`.
- Open `/super-admin/cron` and confirm no money cron is overdue.
- Open `/admin/orders` and search one recent order by order number, customer
  phone, vendor, rider, and payment reference.
- Open `/admin/disputes` and resolve or assign every open dispute.
- Open `/admin/wallets` and confirm Paystack balance versus wallet liabilities.

## Backups

### Database Backup Strategy

- Supabase point-in-time recovery is the primary database backup.
- A manual logical export must be taken before high-risk releases that include
  migrations touching money, orders, sessions, settings, or notifications.
- Store manual exports outside the app repo in the approved encrypted operations
  storage location.
- Record the export timestamp, Supabase project, operator, and release commit in
  the release ticket.

Manual export command template:

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" --file "lumex-prod-$(date +%Y%m%d-%H%M%S).sql"
```

### Storage Backup

- Supabase Storage buckets used for KYC, menu images, feed media, receipts, and
  delivery proof must be backed up before destructive storage migrations.
- Export bucket object lists before bulk deletes.
- Keep restore mapping of bucket, object path, owner id, and content type.

### Environment Backup

- Export Vercel environment variables before production release changes.
- Never commit secret values. Store only variable names and hash/checksum proof
  in release notes.
- Required operational variables: `NEXT_PUBLIC_APP_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `PAYSTACK_SECRET_KEY`,
  `SUPER_ADMIN_PHONE`, and notification/email
  provider keys.

## Restore Procedure

1. Freeze risky operations from `/super-admin/controls`: maintenance mode on,
   payouts frozen, withdrawals frozen, and notifications paused if duplicate
   sends are possible.
2. Identify the restore point: Supabase PITR timestamp or logical dump filename.
3. Restore into a temporary project first and run `npm.cmd test`,
   `npx.cmd tsc --noEmit`, and the wallet reconciliation script against the
   restored database.
4. Compare recent orders, refunds, wallet balances, and audit rows with the
   incident timeline.
5. Promote the restore only after the super-admin approves the exact timestamp.
6. Re-enable operations in this order: database reads, ordering, notifications,
   withdrawals, then payouts.
7. Record the restore timestamp and post-restore Sentinel status.

## Migration Rollback

- Prefer forward fixes for applied migrations.
- Before a risky migration, capture database backup proof and note the previous
  Vercel deployment id.
- If a migration breaks reads but preserves data, roll forward with a corrective
  migration.
- If a migration corrupts or deletes data, stop writes with maintenance mode and
  follow the restore procedure.
- Never edit historical migration files after they have been applied.

## Disaster Recovery

### Server Failure

- Roll back to the previous Vercel deployment.
- Confirm `/super-admin/sentinel`, `/api/features`, `/api/vendors`, and
  `/api/orders/history` respond below 500.
- Keep maintenance mode on if checkout or order status writes are unhealthy.

### Redis Failure

- Sentinel emits `REDIS_UNREACHABLE` when configured Redis fails.
- Expect degraded rate limits, alert dedupe, and short-lived caches.
- Keep money operations available only if Supabase and Paystack are healthy.
- If abuse traffic is active, enable lockdown or maintenance mode.

### Supabase Outage

- Sentinel emits `DB_UNREACHABLE`.
- Enable maintenance mode if admin controls are reachable; otherwise use Vercel
  environment controls to disable ordering on the next safe deployment.
- Do not process manual refunds until database writes recover.

### Webhook Outage

- Sentinel emits `WEBHOOK_FAILURES` or `WEBHOOK_FAILURE_BURST`.
- Pause manual payment-dependent operations.
- Use `/admin/orders` payment timeline to identify orders stuck in pending or
  provider-mismatched states.
- After recovery, replay only verified provider events through the existing
  idempotent webhook path.

### Vercel Outage

- Confirm whether Supabase and Paystack are healthy separately.
- Keep operators on the external incident channel.
- Do not ask developers to patch the database; wait for hosting recovery or
  roll back through Vercel if the outage is deployment-specific.

## Operational Safety

- Platform maintenance: `/super-admin/controls`.
- Campus shutdown: maintenance mode plus ordering feature flag off.
- Vendor shutdown: `/admin/vendors` suspend or pause.
- Rider shutdown: `/admin/riders` suspend or set offline.
- Payment disable: turn ordering off and freeze payouts/withdrawals.
- Notification disable: `/super-admin/controls` notifications paused.
- Panic access containment: `/super-admin/lockdown`.

## Release Checklist

1. Confirm the branch is clean except intended release files.
2. Run `npm.cmd test`.
3. Run `npx.cmd tsc --noEmit`.
4. Run `npm.cmd run lint`.
5. For migrations, capture backup proof and test rollback/forward-fix notes.
6. Deploy preview and verify admin login, order search, Sentinel, cron health,
   checkout initialization, and order status transitions.
7. Promote only after preview verification.
8. Keep the previous deployment id ready for rollback.
9. After release, check Sentinel and cron health within 10 minutes.

## Rollback

- Application rollback: redeploy the last known-good Vercel deployment.
- Database rollback: use forward-fix migrations unless data was corrupted; for
  corruption, follow the restore procedure.
- Feature rollback: use `/super-admin/features` and `/super-admin/controls`
  before code rollback when the issue is isolated to a feature or provider.
