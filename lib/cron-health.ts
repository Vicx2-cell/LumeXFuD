import { createSupabaseAdmin } from './supabase/server'
import type { NextResponse } from 'next/server'
import { constantTimeEqual } from './security'

/**
 * Validate a cron request's Authorization header against CRON_SECRET in constant
 * time (avoids a byte-by-byte timing side-channel on `!==`). Returns false when
 * the secret is unset or the header is missing/wrong. Used by every /api/cron/*.
 */
export function verifyCronSecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return constantTimeEqual(authHeader ?? '', `Bearer ${secret}`)
}

// Cron health tracking. Vercel invokes every cron via GET on a schedule; we wrap
// that GET entrypoint with `withCronHealth` so each run stamps a heartbeat row in
// the `settings` table (id `cron.health.<key>`). The super-admin Cron page reads
// these to spot a silently-dead cron BEFORE it strands money — e.g. the time a
// dead release cron left ₦142k held. Health logging never throws, so it can't
// break a cron.

export interface CronJob {
  key: string          // last path segment, also the settings-row + trigger key
  path: string         // the route path Vercel calls
  schedule: string     // cron expression (mirrors vercel.json)
  label: string        // human name
  description: string  // what it does
  money: boolean       // touches funds — overdue here is an emergency
  staleMs: number      // no successful run within this window ⇒ overdue
}

// Mirrors vercel.json. staleMs = a generous multiple of the interval so a single
// missed tick isn't flagged, but a genuinely dead cron is.
const MIN = 60_000
const HOUR = 60 * MIN
export const CRON_JOBS: CronJob[] = [
  { key: 'order-delay-watch',         path: '/api/cron/order-delay-watch',         schedule: '* * * * *',   label: 'Order delay watch',       description: 'Detects orders likely to miss the 25-minute target and alerts customers and operators once.', money: false, staleMs: 10 * MIN },
  { key: 'release-payments',          path: '/api/cron/release-payments',          schedule: '* * * * *',   label: 'Release payments',        description: 'Credits vendor/rider wallets after the 15-min dispute window, self-heals stranded payouts.', money: true,  staleMs: 10 * MIN },
  { key: 'vendor-auto-cancel',        path: '/api/cron/vendor-auto-cancel',        schedule: '* * * * *',   label: 'Vendor auto-cancel',      description: 'Auto-cancels + refunds orders a vendor never accepted in time.',                              money: true,  staleMs: 10 * MIN },
  { key: 'release-scheduled',         path: '/api/cron/release-scheduled',         schedule: '* * * * *',   label: 'Release scheduled orders', description: 'Releases pre-paid scheduled orders to vendors when their time arrives.',                       money: true,  staleMs: 10 * MIN },
  { key: 'wallet-release-held',       path: '/api/cron/wallet-release-held',       schedule: '*/5 * * * *', label: 'Wallet release held',     description: 'Moves held wallet funds to available once their hold expires.',                                money: true,  staleMs: 20 * MIN },
  { key: 'wallet-sweep',              path: '/api/cron/wallet-sweep',              schedule: '*/15 * * * *', label: 'Wallet auto-sweep',      description: 'Auto-transfers funds left unwithdrawn 48h after release to the verified bank.',               money: true,  staleMs: 45 * MIN },
  { key: 'sentinel',                  path: '/api/cron/sentinel',                  schedule: '*/5 * * * *', label: 'Sentinel',                description: 'Platform health snapshot + AI triage of incidents.',                                          money: false, staleMs: 20 * MIN },
  { key: 'reset-daily-limits',        path: '/api/cron/reset-daily-limits',        schedule: '0 23 * * *',  label: 'Reset daily limits',      description: 'Resets per-day counters at midnight (Africa/Lagos).',                                          money: false, staleMs: 26 * HOUR },
  { key: 'wallet-reconciliation',     path: '/api/cron/wallet-reconciliation',     schedule: '0 5 * * *',   label: 'Wallet reconciliation',   description: 'Daily check that wallet float matches Paystack balance.',                                      money: true,  staleMs: 26 * HOUR },
  { key: 'subscription-check',        path: '/api/cron/subscription-check',        schedule: '0 8 * * *',   label: 'Subscription check',      description: 'Charges/flags overdue vendor subscriptions.',                                                  money: true,  staleMs: 26 * HOUR },
  { key: 'recalculate-vendor-scores', path: '/api/cron/recalculate-vendor-scores', schedule: '0 */3 * * *', label: 'Recalculate vendor scores', description: 'Rebuilds vendor visibility from sales, reviews, reliability, and prep speed.',               money: false, staleMs: 10 * HOUR },
  { key: 'reset-weekly-leaderboard',  path: '/api/cron/reset-weekly-leaderboard',  schedule: '0 23 * * 0',  label: 'Reset weekly leaderboard', description: 'Weekly leaderboard reset.',                                                                   money: false, staleMs: 8 * 24 * HOUR },
  { key: 'official-feed',             path: '/api/cron/official-feed',             schedule: '*/15 * * * *', label: 'Official feed',          description: 'Builds and publishes protected official editorial collections for each configured area.',          money: false, staleMs: 45 * MIN },
]

export const CRON_KEYS = CRON_JOBS.map((j) => j.key)

const healthId = (key: string) => `cron.health.${key}`

export interface CronRun {
  at: string                 // ISO timestamp of the run
  ok: boolean                // HTTP < 400 and no throw
  ms: number                 // duration
  status: number | null      // HTTP status returned
  summary: unknown | null    // small JSON body (processed/healed/skipped…)
  error: string | null       // error message when it threw
}

/**
 * Persist the outcome of a cron run. NEVER throws — a failure to record health
 * must not break the cron itself.
 */
export async function recordCronRun(key: string, run: Omit<CronRun, 'at'>): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    await db.from('settings').upsert(
      {
        id: healthId(key),
        value: { at: new Date().toISOString(), ...run } satisfies CronRun,
        updated_by: 'cron',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
  } catch {
    /* health logging is best-effort */
  }
}

/**
 * Wrap a cron's GET entrypoint. Times the run, records the outcome, and returns
 * the original response untouched. Unauthorized probes (401) are NOT recorded so
 * they can't mask a real heartbeat. Re-throws so error behaviour is unchanged.
 */
export async function withCronHealth(
  key: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const start = Date.now()
  try {
    const res = await handler()
    if (res.status !== 401) {
      let summary: unknown = null
      try { summary = await res.clone().json() } catch { /* non-JSON body */ }
      await recordCronRun(key, {
        ok: res.status < 400,
        ms: Date.now() - start,
        status: res.status,
        summary,
        error: null,
      })
    }
    return res
  } catch (err) {
    await recordCronRun(key, {
      ok: false,
      ms: Date.now() - start,
      status: null,
      summary: null,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export interface CronStatus extends CronJob {
  lastRun: CronRun | null
  overdue: boolean       // no successful run within staleMs (or never ran)
}

/** Read the health heartbeat for every known cron, enriched with overdue state. */
export async function getCronHealth(): Promise<CronStatus[]> {
  const map = new Map<string, CronRun>()
  try {
    const db = createSupabaseAdmin()
    const { data } = await db.from('settings').select('id, value').in('id', CRON_KEYS.map(healthId))
    for (const row of (data ?? []) as Array<{ id: string; value: CronRun }>) {
      map.set(String(row.id).replace(/^cron\.health\./, ''), row.value)
    }
  } catch {
    /* fall through — every job reports as never-run */
  }

  const now = Date.now()
  return CRON_JOBS.map((job) => {
    const lastRun = map.get(job.key) ?? null
    const lastOkAt = lastRun?.ok && lastRun.at ? Date.parse(lastRun.at) : NaN
    const overdue = Number.isNaN(lastOkAt) || now - lastOkAt > job.staleMs
    return { ...job, lastRun, overdue }
  })
}
