import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { CONTROL_IDS } from '@/lib/controls'

// settings is id-keyed (TEXT PK) with a JSONB `value`. `value` can be any JSON
// shape (e.g. {"amount_kobo": N}, {"value": N}, {"open":"07:00"}), so it's
// validated as unknown and stored as-is.
const patchInput = z.object({
  id:    z.string().min(1).max(100),
  value: z.unknown(),
})

// Settings owned by typed editors that enforce invariants — pricing (profitability
// guard + kobo caps, /super-admin/pricing), controls (kill-switch shape,
// /super-admin/controls) and feature flags (/super-admin/features). This generic
// editor must NOT blind-write them, or it bypasses those guards (e.g. set a rider
// cut above the delivery fee, making every order loss-making). They are edited
// only from their dedicated screens.
const PRICING_IDS = [
  'platform_markup', 'delivery_fee_bike', 'rider_delivery_cut_bike',
  'delivery_fee_door', 'rider_delivery_cut_door', 'min_order_amount',
]
const RESERVED_SETTING_IDS = new Set<string>([
  ...PRICING_IDS,
  ...Object.values(CONTROL_IDS),
])
// Feature flags all live under the `feature.<key>` id prefix (lib/features.ts).
// Matching the prefix covers every current and future flag without importing the
// catalog, so they stay editable only from /super-admin/features.
function isReservedSettingId(id: string): boolean {
  return RESERVED_SETTING_IDS.has(id) || id.startsWith('feature.')
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data: settings } = await db
    .from('settings')
    .select('id, value, updated_at')
    .order('id', { ascending: true })

  return NextResponse.json({ settings: settings ?? [] })
}

export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`super-settings:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = patchInput.safeParse(body)
  if (!parsed.success || parsed.data.value === undefined) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  if (isReservedSettingId(parsed.data.id)) {
    return NextResponse.json(
      { error: 'This setting is managed from its dedicated screen (Pricing / Controls / Features) and cannot be edited here.' },
      { status: 403 },
    )
  }

  const db = createSupabaseAdmin()
  const { data: existing } = await db
    .from('settings')
    .select('value')
    .eq('id', parsed.data.id)
    .maybeSingle()

  const { error } = await db.from('settings').upsert(
    {
      id:         parsed.data.id,
      value:      parsed.data.value,
      updated_by: session.phone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  )
  if (error) {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 })
  }

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'settings_update',
    target_table: 'settings',
    target_id: parsed.data.id,
    old_value: existing ? { value: existing.value } : undefined,
    new_value: { value: parsed.data.value },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
