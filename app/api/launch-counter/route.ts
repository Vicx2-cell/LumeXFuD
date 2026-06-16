import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getLaunchFlag, getCustomerCount } from '@/lib/launch-counter'

export const runtime = 'nodejs'

// Public-facing launch counter. Returns ONLY aggregate integers — never any user
// row, email, phone or PII. Any authenticated role may read it (customer/vendor/
// rider/admin); the count is the same number shown to everyone.
export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 30 reads/min, keyed to the session (falls back to IP). Scoped to this route
  // only — does not touch any other route's limiter.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rlKey = `launch-counter:read:${session.sessionId || session.userId || ip}`
  const rl = await rateLimitGeneric(rlKey, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const flag = await getLaunchFlag()
  if (!flag.enabled) return NextResponse.json({ enabled: false })

  const count = await getCustomerCount()
  return NextResponse.json({ enabled: true, count, goal: flag.goal })
}
