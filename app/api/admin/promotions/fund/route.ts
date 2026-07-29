import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

async function gate() {
  const session = await getCurrentUser()
  if (!session || !['admin', 'super_admin'].includes(session.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET() {
  const auth = await gate()
  if ('error' in auth) return auth.error
  const db = createSupabaseAdmin()
  const [{ data: summary }, { data: history }, { data: campaigns }, { data: killSetting }] = await Promise.all([
    db.from('promo_fund_summary').select('*').single(),
    db.from('promo_fund_ledger').select('*').order('created_at', { ascending: false }).limit(100),
    db.from('promo_fund_ledger').select('promotion_id, amount_kobo, promotions(code)').eq('entry_type', 'COMMIT'),
    db.from('settings').select('value').eq('id', 'promo.kill_switch').maybeSingle(),
  ])
  const campaignMap = new Map<string, { code: string; spent_kobo: number }>()
  for (const row of campaigns ?? []) {
    const id = String(row.promotion_id ?? '')
    if (!id) continue
    const relation = row.promotions as unknown as { code?: string } | Array<{ code?: string }> | null
    const code = Array.isArray(relation) ? relation[0]?.code : relation?.code
    const current = campaignMap.get(id) ?? { code: code ?? 'Unknown', spent_kobo: 0 }
    current.spent_kobo += Number(row.amount_kobo)
    campaignMap.set(id, current)
  }
  const expected = Number(summary?.total_funded_kobo ?? 0) - Number(summary?.total_spent_kobo ?? 0) - Number(summary?.reserved_kobo ?? 0)
  return NextResponse.json({
    summary: summary ?? { available_kobo: 0, reserved_kobo: 0, total_spent_kobo: 0, total_funded_kobo: 0 },
    history: history ?? [], campaign_spending: [...campaignMap.entries()].map(([promotion_id, value]) => ({ promotion_id, ...value })),
    reconciliation: { expected_available_kobo: expected, actual_available_kobo: Number(summary?.available_kobo ?? 0), difference_kobo: Number(summary?.available_kobo ?? 0) - expected },
    kill_switch_enabled: Boolean((killSetting?.value as { enabled?: boolean } | null)?.enabled),
  })
}

const rechargeInput = z.object({
  amount_kobo: z.number().int().positive(),
  idempotency_key: z.string().trim().min(8).max(120),
  provider_reference: z.string().trim().max(160).optional().default(''),
  reason: z.string().trim().min(3).max(300),
  reconciled: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (!value.reconciled && value.provider_reference.length < 3) {
    ctx.addIssue({ code: 'custom', path: ['provider_reference'], message: 'Provider reference is required' })
  }
})
export async function POST(req: NextRequest) {
  const auth = await gate()
  if ('error' in auth) return auth.error
  const parsed = rechargeInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid recharge' }, { status: 400 })
  if (parsed.data.reconciled && auth.session.role !== 'super_admin') return NextResponse.json({ error: 'Super admin authorization required' }, { status: 403 })
  const db = createSupabaseAdmin()
  const { data, error } = await db.rpc('recharge_promo_fund', {
    p_amount: parsed.data.amount_kobo, p_key: parsed.data.idempotency_key,
    p_provider_reference: parsed.data.provider_reference, p_reason: parsed.data.reason,
    p_actor_id: auth.session.userId ?? auth.session.phone, p_actor_role: auth.session.role,
    p_reconciled: parsed.data.reconciled,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ ledger_entry_id: data }, { status: 201 })
}

const killSwitchInput = z.object({ kill_switch_enabled: z.boolean() })
export async function PATCH(req: NextRequest) {
  const auth = await gate()
  if ('error' in auth) return auth.error
  const parsed = killSwitchInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid kill-switch update' }, { status: 400 })
  const db = createSupabaseAdmin()
  const { error } = await db.from('settings').upsert({
    id: 'promo.kill_switch', value: { enabled: parsed.data.kill_switch_enabled },
    updated_by: auth.session.userId ?? auth.session.phone, updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: 'Could not update kill switch' }, { status: 500 })
  return NextResponse.json({ kill_switch_enabled: parsed.data.kill_switch_enabled })
}
