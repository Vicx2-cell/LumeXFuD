import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getDeliveryZonePricing, getMinimumOrderKobo } from '@/lib/delivery-zones'

export const runtime = 'nodejs'

// Pricing lives in the settings table as { amount_kobo: N } rows. This endpoint
// gives a friendly, *validated* way to edit it (the raw settings editor can't
// enforce "rider cut ≤ delivery fee", which protects per-order profitability).
const KEYS = {
  platform_markup_kobo:   'platform_markup',
  delivery_fee_bike_kobo: 'delivery_fee_bike',
  rider_cut_bike_kobo:    'rider_delivery_cut_bike',
  delivery_fee_door_kobo: 'delivery_fee_door',
  rider_cut_door_kobo:    'rider_delivery_cut_door',
  min_order_kobo:         'min_order_amount',
} as const

function requireSuperAdmin(role: string) {
  return role === 'super_admin'
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireSuperAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const zone = await getDeliveryZonePricing({ db })
  const minOrder = await getMinimumOrderKobo(db)
  const pricing: Record<keyof typeof KEYS, number> = {
    platform_markup_kobo: zone?.platformMarkup ?? 0,
    delivery_fee_bike_kobo: zone?.bikeFee ?? 0,
    rider_cut_bike_kobo: zone?.riderCutBike ?? 0,
    delivery_fee_door_kobo: zone?.doorFee ?? 0,
    rider_cut_door_kobo: zone?.riderCutDoor ?? 0,
    min_order_kobo: minOrder ?? 0,
  }
  return NextResponse.json({ pricing })
}

// All amounts in kobo, whole numbers, capped to a sane ceiling (₦100,000).
const kobo = z.number().int().min(0).max(10_000_000)
const patchInput = z.object({
  platform_markup_kobo:   kobo,
  delivery_fee_bike_kobo: kobo,
  rider_cut_bike_kobo:    kobo,
  delivery_fee_door_kobo: kobo,
  rider_cut_door_kobo:    kobo,
  min_order_kobo:         kobo,
})

export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireSuperAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`super-pricing:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = patchInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'All prices must be whole amounts in kobo (0–₦100,000).' }, { status: 400 })
  const p = parsed.data

  // Profitability guard: the platform must never pay a rider more than the
  // delivery fee collected.
  if (p.rider_cut_bike_kobo > p.delivery_fee_bike_kobo) {
    return NextResponse.json({ error: "Bike rider pay can't exceed the bike delivery fee." }, { status: 400 })
  }
  if (p.rider_cut_door_kobo > p.delivery_fee_door_kobo) {
    return NextResponse.json({ error: "Door rider pay can't exceed the door delivery fee." }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()
  const { data: existingRows } = await db.from('settings').select('id, value').in('id', Object.values(KEYS))
  const oldById = new Map((existingRows ?? []).map((r) => [r.id as string, r.value]))
  const oldZone = await getDeliveryZonePricing({ db })

  const rows = (Object.entries(KEYS) as [keyof typeof KEYS, string][]).map(([outKey, id]) => ({
    id, value: { amount_kobo: p[outKey] }, updated_by: session.phone, updated_at: now,
  }))

  const { error } = await db.from('settings').upsert(rows, { onConflict: 'id' })
  if (error) return NextResponse.json({ error: 'Failed to save pricing' }, { status: 500 })

  if (oldZone?.zoneId) {
    const { error: zoneError } = await db.from('delivery_zones').update({
      base_bike_fee: p.delivery_fee_bike_kobo,
      base_door_fee: p.delivery_fee_door_kobo,
      platform_markup: p.platform_markup_kobo,
      rider_split: { BIKE: p.rider_cut_bike_kobo, DOOR: p.rider_cut_door_kobo },
      platform_split: {
        BIKE: p.delivery_fee_bike_kobo - p.rider_cut_bike_kobo,
        DOOR: p.delivery_fee_door_kobo - p.rider_cut_door_kobo,
      },
      updated_at: now,
    }).eq('id', oldZone.zoneId)
    if (zoneError) return NextResponse.json({ error: 'Failed to save delivery-zone pricing' }, { status: 500 })
  }

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'pricing_update',
    target_table: 'settings',
    target_id: 'pricing',
    old_value: Object.fromEntries(Object.values(KEYS).map((id) => [id, oldById.get(id)])),
    new_value: p,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
