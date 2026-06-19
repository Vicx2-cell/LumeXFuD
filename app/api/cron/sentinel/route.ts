import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { withCronHealth } from '@/lib/cron-health'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { gatherSnapshot, type SentinelSnapshot } from '@/lib/sentinel'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { resolveProvider, isAIAvailable } from '@/lib/ai/providers'
import { parseModelJson, TriageBrief } from '@/lib/ai/schemas'
import { TRIAGE_PROMPT } from '@/lib/ai/prompts'

export const runtime = 'nodejs'

// The Sentinel's 24/7 leg. Runs every 5 min (vercel.json). On a SEV1/SEV2 issue
// it alerts the super-admin's phone (WhatsApp) with an AI "first action" line.
// Read-only — never changes business state. Dedupes per issue code (Redis, 30
// min) so one incident pings once, not every 5 minutes. Without Redis we skip
// alerting rather than spam.

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

async function firstAction(snapshot: SentinelSnapshot): Promise<string | null> {
  if (!(await isAIAvailable('sentinel'))) return null
  try {
    const provider = await resolveProvider('sentinel')
    const out = await provider.generate({
      system: TRIAGE_PROMPT,
      userText: `LumeX Fud platform health snapshot:\n${JSON.stringify({ status: snapshot.status, metrics: snapshot.metrics, issues: snapshot.issues })}`,
      jsonMode: true,
      maxTokens: 500,
    })
    const parsed = parseModelJson(TriageBrief, out.text)
    return parsed.ok ? parsed.data.first_action : null
  } catch {
    return null
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()
  const snapshot = await gatherSnapshot(db)
  const actionable = snapshot.issues.filter((i) => i.severity === 'SEV1' || i.severity === 'SEV2')
  if (actionable.length === 0) return NextResponse.json({ status: snapshot.status, alerted: false })

  const r = redis()
  if (!r) {
    console.warn('[cron/sentinel] issues found but Redis unconfigured — skipping alert to avoid spam')
    return NextResponse.json({ status: snapshot.status, alerted: false, reason: 'no-redis' })
  }

  // Dedupe: only alert on issue codes we haven't alerted on in the last 30 min.
  const fresh: typeof actionable = []
  for (const issue of actionable) {
    const key = `sentinel:alert:${issue.code}`
    const seen = await r.get(key)
    if (!seen) { fresh.push(issue); await r.set(key, '1', { ex: 1800 }) }
  }
  if (fresh.length === 0) return NextResponse.json({ status: snapshot.status, alerted: false, reason: 'deduped' })

  const phone = process.env.SUPER_ADMIN_PHONE
  let alerted = false
  if (phone) {
    const action = await firstAction(snapshot)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
    const lines = [
      `🛡️ LumeX Sentinel — ${snapshot.status}`,
      '',
      ...fresh.map((i) => `[${i.severity}] ${i.message}`),
    ]
    if (action) lines.push('', `👉 First action: ${action}`)
    lines.push('', `View: ${appUrl}/super-admin/sentinel`)
    await sendWhatsAppWithFallback({ to: phone, message: lines.join('\n') }).catch(() => {})
    alerted = true
  }

  return NextResponse.json({ status: snapshot.status, alerted, new_issues: fresh.map((i) => i.code) })
}

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) { return withCronHealth('sentinel', () => handle(req)) }
export async function POST(req: NextRequest) { return handle(req) }
