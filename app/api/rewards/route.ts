import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getRewardSummary } from '@/lib/rewards'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// The customer's reward hub data: loyalty tier + progress, active credit balance,
// referral code/link/stats, and any unopened surprise. Aggregates only (no PII of
// other users). Customer session required.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`rewards:${session.userId ?? session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: c } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Customers only' }, { status: 403 })

  try {
    const summary = await getRewardSummary((c as { id: string }).id)
    return NextResponse.json(summary)
  } catch {
    // Migration 082 not yet run, or a transient DB error — the UI hides the card.
    return NextResponse.json({ error: 'Rewards unavailable' }, { status: 503 })
  }
}
