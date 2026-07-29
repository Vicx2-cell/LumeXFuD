import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { canManagePromotions, promotionInput } from '@/lib/promotion'

async function gate() {
  const session = await getCurrentUser()
  if (!session || !canManagePromotions(session.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

export async function GET() {
  const auth = await gate()
  if ('error' in auth) return auth.error
  const db = createSupabaseAdmin()
  const [{ data: promotions, error }, { data: spend }] = await Promise.all([
    db.from('promotions').select('*').order('created_at', { ascending: false }),
    db.from('promo_fund_ledger').select('promotion_id, amount_kobo').eq('entry_type', 'COMMIT'),
  ])
  if (error) return NextResponse.json({ error: 'Could not load promotions' }, { status: 500 })
  const spending = new Map<string, number>()
  for (const row of spend ?? []) if (row.promotion_id) spending.set(row.promotion_id, (spending.get(row.promotion_id) ?? 0) + Number(row.amount_kobo))
  return NextResponse.json({ promotions: (promotions ?? []).map((row) => ({ ...row, spent_kobo: spending.get(row.id) ?? 0 })) })
}

export async function POST(req: NextRequest) {
  const auth = await gate()
  if ('error' in auth) return auth.error
  const parsed = promotionInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid promotion', details: parsed.error.flatten() }, { status: 400 })
  const db = createSupabaseAdmin()
  const { data, error } = await db.from('promotions').insert({
    ...parsed.data,
    eligible_vendor_id: parsed.data.eligible_vendor_id || null,
    eligible_category: parsed.data.eligible_category || null,
    eligible_campus_id: parsed.data.eligible_campus_id || null,
    percentage_cap_kobo: parsed.data.percentage_cap_kobo ?? null,
    total_uses_limit: parsed.data.total_uses_limit ?? null,
    uses_per_customer: parsed.data.uses_per_customer ?? null,
    campaign_budget_kobo: parsed.data.campaign_budget_kobo ?? null,
    expires_at: parsed.data.expires_at ?? null,
    created_by: auth.session.userId ?? auth.session.phone,
    updated_by: auth.session.userId ?? auth.session.phone,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'Promotion code already exists' : 'Could not create promotion' }, { status: error.code === '23505' ? 409 : 500 })
  return NextResponse.json({ promotion: data }, { status: 201 })
}

const patchInput = z.object({ id: z.uuid(), status: z.enum(['ACTIVE', 'PAUSED']) })
export async function PATCH(req: NextRequest) {
  const auth = await gate()
  if ('error' in auth) return auth.error
  const parsed = patchInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid update' }, { status: 400 })
  const db = createSupabaseAdmin()
  const { data, error } = await db.from('promotions').update({
    status: parsed.data.status, updated_by: auth.session.userId ?? auth.session.phone, updated_at: new Date().toISOString(),
  }).eq('id', parsed.data.id).select('*').maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Promotion not found' }, { status: 404 })
  return NextResponse.json({ promotion: data })
}
