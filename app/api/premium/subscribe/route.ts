import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { initializePremiumBilling } from '@/lib/paystack/billing'

const bodySchema = z.object({
  plan_key: z.string().trim().min(1).max(120),
  billing_cycle: z.enum(['monthly', 'yearly']),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor' || !session.userId) {
    return NextResponse.json({ error: 'Vendor authentication required' }, { status: 401 })
  }

  if (!(await getFeature('premium_enabled')) || !(await getFeature('premium_new_subscriptions_enabled')) || !(await getFeature('premium_checkout_enabled'))) {
    return NextResponse.json({ error: 'Premium checkout is disabled right now' }, { status: 503 })
  }

  const rl = await rateLimitGeneric(`premium-subscribe:${session.phone}`, 10, 300)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid subscription request' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', session.userId).maybeSingle()
  if (!profile) {
    return NextResponse.json({ error: 'Vendor profile not found' }, { status: 404 })
  }

  try {
    const result = await initializePremiumBilling({
      profileId: String((profile as { id: string }).id),
      planKey: parsed.data.plan_key,
      billingCycle: parsed.data.billing_cycle,
      actor: session.phone,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not initialize Premium billing' }, { status: 400 })
  }
}
