import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { openSurprise, trackGamification } from '@/lib/rewards'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Reveal a surprise reward. The outcome was decided server-side when the reward
// was created (no client trust); this materializes the credit if it's a win.
// Ownership, expiry and single-claim are all enforced in openSurprise.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await getFeature('surprise_reward'))) {
    return NextResponse.json({ error: 'Surprise rewards are not available right now.' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`surprise-open:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: c } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Customers only' }, { status: 403 })
  const customerId = (c as { id: string }).id

  const result = await openSurprise(customerId, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  trackGamification('reward_claimed', customerId, { kind: 'surprise', amount_kobo: result.outcome_kobo, phase: 'opened' })
  return NextResponse.json(result)
}
