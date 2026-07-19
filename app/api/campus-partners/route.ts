import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { loadCampusPartnerSummary, submitCampusPartnerApplication } from '@/lib/campus-partners'

const applicationSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  campus_id: z.string().uuid().nullable().optional(),
  territory: z.string().trim().max(200).nullable().optional(),
  application_text: z.string().trim().max(1000).nullable().optional(),
  target_monthly_orders: z.number().int().min(0).max(100000).default(0),
  proposed_commission_rate: z.number().min(0).max(1).default(0),
})

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rl = await rateLimitGeneric(`campus-partners:${session.userId ?? session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  try {
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
    const summary = await loadCampusPartnerSummary(String(profile.id))
    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load campus partner summary' }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await getFeature('partner_applications'))) {
    return NextResponse.json({ error: 'Applications are currently closed.' }, { status: 503 })
  }

  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rl = await rateLimitGeneric(`campus-partner-apply:${session.userId ?? session.phone}`, 6, 3600)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = applicationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid application details' }, { status: 400 })
  }

  try {
    const result = await submitCampusPartnerApplication(parsed.data)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not submit application' }, { status: 400 })
  }
}
