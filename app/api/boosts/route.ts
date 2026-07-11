import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { initializeBoostBilling } from '@/lib/paystack/billing'
import { getFeature } from '@/lib/features'

const bodySchema = z.object({
  post_id: z.string().trim().min(1).max(120),
  boost_package_key: z.string().trim().min(1).max(120),
  target_city_id: z.string().trim().max(120).nullable().optional(),
  target_zone_id: z.string().trim().max(120).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'vendor' || !session.userId) {
    return NextResponse.json({ error: 'Vendor authentication required' }, { status: 401 })
  }

  const rl = await rateLimitGeneric(`boost-init:${session.phone}`, 10, 300)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  if (!(await getFeature('post_boosts_enabled'))) {
    return NextResponse.json({ error: 'Post boosts are disabled' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid boost request' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const { data: profile } = await db.from('social_profiles').select('id').eq('vendor_id', session.userId).maybeSingle()
  if (!profile) {
    return NextResponse.json({ error: 'Vendor profile not found' }, { status: 404 })
  }

  try {
    const result = await initializeBoostBilling({
      vendorId: String((profile as { id: string }).id),
      postId: parsed.data.post_id,
      boostPackageKey: parsed.data.boost_package_key,
      targetCityId: parsed.data.target_city_id ?? null,
      targetZoneId: parsed.data.target_zone_id ?? null,
      actor: session.phone,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not initialize boost billing' }, { status: 400 })
  }
}
