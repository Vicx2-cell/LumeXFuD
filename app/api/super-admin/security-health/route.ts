import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { runSecurityChecks, overallPosture } from '@/lib/security-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The anon-exposure + header probes make network calls — give them headroom.
export const maxDuration = 30

// GET /api/super-admin/security-health — super-admin only. Runs the read-only
// security self-audit on demand and returns each check + the overall posture.
export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // The probes hit the DB + the live site — cap how often they can be fired.
  const rl = await rateLimitGeneric(`security-health:${session.userId ?? session.phone}`, 10, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many runs. Wait a moment.' }, { status: 429 })

  const checks = await runSecurityChecks()
  return NextResponse.json({
    posture: overallPosture(checks),
    checks,
    counts: {
      fail: checks.filter((c) => c.status === 'fail').length,
      warn: checks.filter((c) => c.status === 'warn').length,
      pass: checks.filter((c) => c.status === 'pass').length,
    },
    ran_at: new Date().toISOString(),
  })
}
