import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { currentReferralHub } from '@/lib/referrals'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`referrals:${session.userId ?? session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const hub = await currentReferralHub()
    if (!hub) return NextResponse.json({ error: 'Referral hub unavailable' }, { status: 404 })
    return NextResponse.json({ ok: true, hub })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load referral summary' }, { status: 400 })
  }
}

export async function POST() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createSupabaseAdmin()
  const roleColumn = session.role === 'customer'
    ? 'customer_id'
    : session.role === 'vendor'
      ? 'vendor_id'
      : session.role === 'rider'
        ? 'rider_id'
        : 'admin_id'
  const { data: profile } = await db.from('social_profiles').select('id').eq(roleColumn, session.userId ?? '').maybeSingle()
  if (!profile?.id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  return NextResponse.json({ ok: true, hub: await currentReferralHub() })
}
