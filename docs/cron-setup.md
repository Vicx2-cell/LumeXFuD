# Cron setup (external scheduler — free)

The scheduled jobs are **not** run by Vercel cron. Two reasons:

1. **Vercel Hobby (free) plan** allows at most 2 cron jobs, daily only. This app
   has 8, two of them every minute.
2. Every `/api/cron/*` route is **POST** and checks
   `Authorization: Bearer <CRON_SECRET>`. Vercel's native cron sends a **GET**
   with no body, so the routes would 405 even on Pro.

So we trigger them from a free external scheduler. **[cron-job.org](https://cron-job.org)**
is recommended (free, supports 1-minute intervals, custom method + headers).

## One-time setup per job

For each row below, create a cron job in cron-job.org with:

- **URL:** `https://<YOUR-VERCEL-DOMAIN>/api/cron/<name>`
  (use your real domain, e.g. `https://lumexfud.vercel.app` or `https://lumexfud.com.ng`)
- **Request method:** `POST`
- **Header:** `Authorization: Bearer <CRON_SECRET>`
  (the exact value of `CRON_SECRET` from your Vercel env vars)
- **Schedule:** as below
- **Timezone:** `Africa/Lagos` (WAT) — matters for the daily/weekly jobs

| Job (path) | Schedule | Cron expression | Why it matters |
|---|---|---|---|
| `/api/cron/vendor-auto-cancel` | every 1 min | `* * * * *` | Cancels + refunds orders a vendor didn't accept within 5 min. **Customer-facing — keep frequent.** |
| `/api/cron/release-payments` | every 1 min | `* * * * *` | Releases rider payouts after the 24h hold. |
| `/api/cron/wallet-release-held` | every 5 min | `*/5 * * * *` | Releases held wallet funds. |
| `/api/cron/reset-daily-limits` | daily 00:00 | `0 0 * * *` | Resets per-item daily sale counters. |
| `/api/cron/wallet-reconciliation` | daily 06:00 | `0 6 * * *` | Wallet float vs Paystack balance check. |
| `/api/cron/subscription-check` | daily 09:00 | `0 9 * * *` | Vendor subscription expiry sweep. |
| `/api/cron/recalculate-vendor-scores` | weekly Sun 00:00 | `0 0 * * 0` | Recomputes vendor ranking. |
| `/api/cron/reset-weekly-leaderboard` | weekly Mon 00:00 | `0 0 * * 1` | Resets the weekly customer leaderboard. |

## Verify a job works

```
curl -X POST https://<YOUR-VERCEL-DOMAIN>/api/cron/vendor-auto-cancel \
  -H "Authorization: Bearer <CRON_SECRET>"
```
Expect `200` with a small JSON body (e.g. `{"cancelled":0}`). A `401` means the
bearer token doesn't match `CRON_SECRET`; a `405` means you sent GET, not POST.

## If you later upgrade to Vercel Pro

Pro still sends GET to native crons, so you'd additionally need to add `GET`
handlers (or switch the routes to GET) before moving these into `vercel.json`.
Until then, keep using the external scheduler above — it works on every plan.
