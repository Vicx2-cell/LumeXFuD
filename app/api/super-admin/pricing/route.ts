import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getDeliveryZonePricing, getMinimumOrderKobo } from '@/lib/delivery-zones'

export const runtime = 'nodejs'

const KEYS = {
  platform_markup_kobo:   'platform_markup',
  delivery_fee_bike_kobo: 'delivery_fee_bike',
  rider_cut_bike_kobo:    'rider_delivery_cut_bike',
  delivery_fee_door_kobo: 'delivery_fee_door',
  rider_cut_door_kobo:    'rider_delivery_cut_door',
  min_order_kobo:         'min_order_amount',
} as const

type Pricing = Record<keyof typeof KEYS, number>
type Status = 'ACTIVE' | 'PAUSED' | 'INACTIVE'

type LocationRow = {
  zone_id: string
  zone_name: string
  zone_status: Status
  uses_lodge_catalog: boolean
  city_id: string
  city_name: string
  city_state: string
  city_slug: string
  city_status: Status
  base_bike_fee_kobo: number
  base_door_fee_kobo: number
  platform_markup_kobo: number
  rider_cut_bike_kobo: number
  rider_cut_door_kobo: number
}

function requireSuperAdmin(role: string) {
  return role === 'super_admin'
}

async function loadLocations(db: ReturnType<typeof createSupabaseAdmin>): Promise<LocationRow[]> {
  try {
    let zoneRows: Array<{
      id: string
      city_id: string
      name: string
      status: Status
      base_bike_fee: number
      base_door_fee: number
      platform_markup: number
      rider_split: { BIKE?: number; DOOR?: number } | null
      uses_lodge_catalog?: boolean | null
    }> = []

    const richZones = await db
      .from('delivery_zones')
      .select('id, city_id, name, status, base_bike_fee, base_door_fee, platform_markup, rider_split, uses_lodge_catalog')
      .order('created_at', { ascending: true })
    if (!richZones.error) {
      zoneRows = (richZones.data ?? []) as typeof zoneRows
    } else {
      const baseZones = await db
        .from('delivery_zones')
        .select('id, city_id, name, status, base_bike_fee, base_door_fee, platform_markup, rider_split')
        .order('created_at', { ascending: true })
      zoneRows = (baseZones.data ?? []) as typeof zoneRows
    }
    if (zoneRows.length === 0) return []

    const cityIds = Array.from(new Set(zoneRows.map((z) => z.city_id)))
    const { data: cities } = await db.from('cities').select('id, name, state, slug, status').in('id', cityIds)
    const cityById = new Map(
      ((cities ?? []) as Array<{ id: string; name: string; state: string; slug: string; status: Status }>)
        .map((city) => [city.id, city]),
    )

    return zoneRows.flatMap((zone) => {
      const city = cityById.get(zone.city_id)
      if (!city) return []
      return [{
        zone_id: zone.id,
        zone_name: zone.name,
        zone_status: zone.status,
        uses_lodge_catalog: zone.uses_lodge_catalog ?? (city.slug === 'uturu'),
        city_id: city.id,
        city_name: city.name,
        city_state: city.state,
        city_slug: city.slug,
        city_status: city.status,
        base_bike_fee_kobo: Number(zone.base_bike_fee ?? 0),
        base_door_fee_kobo: Number(zone.base_door_fee ?? 0),
        platform_markup_kobo: Number(zone.platform_markup ?? 0),
        rider_cut_bike_kobo: Number(zone.rider_split?.BIKE ?? 0),
        rider_cut_door_kobo: Number(zone.rider_split?.DOOR ?? 0),
      }]
    }).sort((a, b) =>
      a.city_state.localeCompare(b.city_state) ||
      a.city_name.localeCompare(b.city_name) ||
      a.zone_name.localeCompare(b.zone_name),
    )
  } catch {
    return []
  }
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireSuperAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const zone = await getDeliveryZonePricing({ db })
  const minOrder = await getMinimumOrderKobo(db)
  const pricing: Pricing = {
    platform_markup_kobo: zone?.platformMarkup ?? 0,
    delivery_fee_bike_kobo: zone?.bikeFee ?? 0,
    rider_cut_bike_kobo: zone?.riderCutBike ?? 0,
    delivery_fee_door_kobo: zone?.doorFee ?? 0,
    rider_cut_door_kobo: zone?.riderCutDoor ?? 0,
    min_order_kobo: minOrder ?? 0,
  }
  const locations = await loadLocations(db)
  return NextResponse.json({ pricing, locations })
}

const kobo = z.number().int().min(0).max(10_000_000)
const patchInput = z.object({
  platform_markup_kobo:   kobo,
  delivery_fee_bike_kobo: kobo,
  rider_cut_bike_kobo:    kobo,
  delivery_fee_door_kobo: kobo,
  rider_cut_door_kobo:    kobo,
  min_order_kobo:         kobo,
})

const statusField = z.enum(['ACTIVE', 'PAUSED', 'INACTIVE'])
const zonePatchInput = z.object({
  zone_id: z.string().uuid(),
  city_id: z.string().uuid(),
  city_name: z.string().trim().min(1).max(120),
  city_state: z.string().trim().min(1).max(120),
  city_slug: z.string().trim().min(1).max(120),
  city_status: statusField,
  zone_name: z.string().trim().min(1).max(120),
  zone_status: statusField,
  uses_lodge_catalog: z.boolean(),
  base_bike_fee_kobo: kobo,
  base_door_fee_kobo: kobo,
  platform_markup_kobo: kobo,
  rider_cut_bike_kobo: kobo,
  rider_cut_door_kobo: kobo,
})

const zoneCreateInput = z.object({
  city_name: z.string().trim().min(1).max(120),
  city_state: z.string().trim().min(1).max(120),
  city_slug: z.string().trim().min(1).max(120),
  city_status: statusField.default('ACTIVE'),
  zone_name: z.string().trim().min(1).max(120),
  zone_status: statusField.default('ACTIVE'),
  uses_lodge_catalog: z.boolean().default(false),
  base_bike_fee_kobo: kobo,
  base_door_fee_kobo: kobo,
  platform_markup_kobo: kobo,
  rider_cut_bike_kobo: kobo,
  rider_cut_door_kobo: kobo,
})

export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireSuperAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`super-pricing:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()

  if (body && typeof body === 'object' && 'zone_id' in (body as Record<string, unknown>)) {
    const parsed = zonePatchInput.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid location details.' }, { status: 400 })
    }
    const p = parsed.data
    if (p.rider_cut_bike_kobo > p.base_bike_fee_kobo) {
      return NextResponse.json({ error: "Bike rider pay can't exceed the bike delivery fee." }, { status: 400 })
    }
    if (p.rider_cut_door_kobo > p.base_door_fee_kobo) {
      return NextResponse.json({ error: "Door rider pay can't exceed the door delivery fee." }, { status: 400 })
    }

    const { data: oldZone } = await db
      .from('delivery_zones')
      .select('id, city_id, name, status, base_bike_fee, base_door_fee, platform_markup, rider_split, platform_split, uses_lodge_catalog')
      .eq('id', p.zone_id)
      .maybeSingle()
    const { data: oldCity } = await db
      .from('cities')
      .select('id, name, state, slug, status')
      .eq('id', p.city_id)
      .maybeSingle()

    const { error: cityError } = await db.from('cities').update({
      name: p.city_name,
      state: p.city_state,
      slug: p.city_slug,
      status: p.city_status,
      updated_at: now,
    }).eq('id', p.city_id)
    if (cityError) return NextResponse.json({ error: 'Failed to save city details.' }, { status: 500 })

    const { error: zoneError } = await db.from('delivery_zones').update({
      name: p.zone_name,
      status: p.zone_status,
      uses_lodge_catalog: p.uses_lodge_catalog,
      base_bike_fee: p.base_bike_fee_kobo,
      base_door_fee: p.base_door_fee_kobo,
      platform_markup: p.platform_markup_kobo,
      rider_split: { BIKE: p.rider_cut_bike_kobo, DOOR: p.rider_cut_door_kobo },
      platform_split: {
        BIKE: p.base_bike_fee_kobo - p.rider_cut_bike_kobo,
        DOOR: p.base_door_fee_kobo - p.rider_cut_door_kobo,
      },
      updated_at: now,
    }).eq('id', p.zone_id)
    if (zoneError) return NextResponse.json({ error: 'Failed to save delivery-zone details.' }, { status: 500 })

    await superAudit({
      actor_id: session.phone,
      actor_role: session.role,
      action: 'delivery_zone_update',
      target_table: 'delivery_zones',
      target_id: p.zone_id,
      old_value: { city: oldCity ?? null, zone: oldZone ?? null },
      new_value: p,
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ success: true })
  }

  const parsed = patchInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'All prices must be whole amounts in kobo (0-₦100,000).' }, { status: 400 })
  const p = parsed.data

  if (p.rider_cut_bike_kobo > p.delivery_fee_bike_kobo) {
    return NextResponse.json({ error: "Bike rider pay can't exceed the bike delivery fee." }, { status: 400 })
  }
  if (p.rider_cut_door_kobo > p.delivery_fee_door_kobo) {
    return NextResponse.json({ error: "Door rider pay can't exceed the door delivery fee." }, { status: 400 })
  }

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

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireSuperAdmin(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`super-pricing:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const parsed = zoneCreateInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid location details.' }, { status: 400 })
  }

  const p = parsed.data
  if (p.rider_cut_bike_kobo > p.base_bike_fee_kobo) {
    return NextResponse.json({ error: "Bike rider pay can't exceed the bike delivery fee." }, { status: 400 })
  }
  if (p.rider_cut_door_kobo > p.base_door_fee_kobo) {
    return NextResponse.json({ error: "Door rider pay can't exceed the door delivery fee." }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()

  let cityId: string
  const { data: existingCity } = await db
    .from('cities')
    .select('id, name, state, slug, status')
    .eq('slug', p.city_slug)
    .maybeSingle()

  if (existingCity) {
    cityId = (existingCity as { id: string }).id
    const { error: cityUpdateError } = await db.from('cities').update({
      name: p.city_name,
      state: p.city_state,
      status: p.city_status,
      updated_at: now,
    }).eq('id', cityId)
    if (cityUpdateError) return NextResponse.json({ error: 'Failed to update city details.' }, { status: 500 })
  } else {
    const { data: insertedCity, error: cityInsertError } = await db.from('cities').insert({
      name: p.city_name,
      state: p.city_state,
      slug: p.city_slug,
      status: p.city_status,
      updated_at: now,
    }).select('id').single()
    if (cityInsertError || !insertedCity) return NextResponse.json({ error: 'Failed to create city.' }, { status: 500 })
    cityId = (insertedCity as { id: string }).id
  }

  const { data: zone, error: zoneError } = await db.from('delivery_zones').insert({
    city_id: cityId,
    name: p.zone_name,
    status: p.zone_status,
    uses_lodge_catalog: p.uses_lodge_catalog,
    base_bike_fee: p.base_bike_fee_kobo,
    base_door_fee: p.base_door_fee_kobo,
    platform_markup: p.platform_markup_kobo,
    rider_split: { BIKE: p.rider_cut_bike_kobo, DOOR: p.rider_cut_door_kobo },
    platform_split: {
      BIKE: p.base_bike_fee_kobo - p.rider_cut_bike_kobo,
      DOOR: p.base_door_fee_kobo - p.rider_cut_door_kobo,
    },
    updated_at: now,
  }).select('id').single()

  if (zoneError || !zone) {
    if (zoneError?.code === '23505') {
      return NextResponse.json({ error: 'That delivery zone already exists for this city.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create delivery zone.' }, { status: 500 })
  }

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'delivery_zone_create',
    target_table: 'delivery_zones',
    target_id: (zone as { id: string }).id,
    new_value: { city_id: cityId, ...p },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, city_id: cityId, zone_id: (zone as { id: string }).id })
}
