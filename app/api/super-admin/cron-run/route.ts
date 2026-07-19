import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { CRON_JOBS, CRON_KEYS } from '@/lib/cron-health'

// Each cron's GET entrypoint, imported so we can run it in-process (no network
// hop, no public exposure of CRON_SECRET). Running via GET means the existing
// withCronHealth wrapper records the manual run exactly like a scheduled one.
import { GET as releasePayments } from '@/app/api/cron/release-payments/route'
import { GET as vendorAutoCancel } from '@/app/api/cron/vendor-auto-cancel/route'
import { GET as releaseScheduled } from '@/app/api/cron/release-scheduled/route'
import { GET as walletReleaseHeld } from '@/app/api/cron/wallet-release-held/route'
import { GET as sentinel } from '@/app/api/cron/sentinel/route'
import { GET as resetDailyLimits } from '@/app/api/cron/reset-daily-limits/route'
import { GET as walletReconciliation } from '@/app/api/cron/wallet-reconciliation/route'
import { GET as subscriptionCheck } from '@/app/api/cron/subscription-check/route'
import { GET as recalculateVendorScores } from '@/app/api/cron/recalculate-vendor-scores/route'
import { GET as resetWeeklyLeaderboard } from '@/app/api/cron/reset-weekly-leaderboard/route'
import { GET as officialFeed } from '@/app/api/cron/official-feed/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A daily/weekly job can do real work; give the manual run headroom.
export const maxDuration = 60

type CronHandler = (req: NextRequest) => Promise<Response> | Response
const HANDLERS: Record<string, CronHandler> = {
  'release-payments': releasePayments,
  'vendor-auto-cancel': vendorAutoCancel,
  'release-scheduled': releaseScheduled,
  'wallet-release-held': walletReleaseHeld,
  'sentinel': sentinel,
  'reset-daily-limits': resetDailyLimits,
  'wallet-reconciliation': walletReconciliation,
  'subscription-check': subscriptionCheck,
  'recalculate-vendor-scores': recalculateVendorScores,
  'reset-weekly-leaderboard': resetWeeklyLeaderboard,
  'official-feed': officialFeed,
}

const schema = z.object({ key: z.enum(CRON_KEYS as [string, ...string[]]) })

// POST /api/super-admin/cron-run — super-admin only. Manually fire one cron now
// (e.g. to unstick a dead release cron). Authenticates the in-process call with
// the server-side CRON_SECRET; the secret never reaches the client.
export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`cron-run:${session.userId ?? session.phone}`, 10, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many runs. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Unknown cron job' }, { status: 400 })

  const { key } = parsed.data
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })

  const handler = HANDLERS[key]
  const job = CRON_JOBS.find((j) => j.key === key)!

  // Synthetic authenticated GET, identical to what Vercel cron sends.
  const cronReq = new NextRequest(new URL(job.path, req.nextUrl.origin), {
    headers: { authorization: `Bearer ${secret}` },
  })

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'cron_manual_run',
    target_table: 'cron',
    target_id: key,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  try {
    const res = await handler(cronReq)
    const result = await res.clone().json().catch(() => null)
    return NextResponse.json({ ran: true, key, status: res.status, result })
  } catch (err) {
    return NextResponse.json(
      { ran: false, key, error: err instanceof Error ? err.message : 'Cron run failed' },
      { status: 500 },
    )
  }
}
