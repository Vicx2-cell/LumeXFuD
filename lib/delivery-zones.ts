import { createSupabaseAdmin } from './supabase/server'

export interface DeliveryZonePricing {
  cityId: string | null
  zoneId: string | null
  platformMarkup: number
  bikeFee: number
  doorFee: number
  riderCutBike: number
  riderCutDoor: number
  platformCutBike: number
  platformCutDoor: number
}

type DB = ReturnType<typeof createSupabaseAdmin>

function nonNegative(n: unknown): number | null {
  const value = Number(n)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function splitValue(split: unknown, key: 'BIKE' | 'DOOR'): number | null {
  if (!split || typeof split !== 'object') return null
  return nonNegative((split as Record<string, unknown>)[key])
}

function fromZone(row: {
  id: string
  city_id: string
  base_bike_fee: unknown
  base_door_fee: unknown
  platform_markup?: unknown
  rider_split?: unknown
  platform_split?: unknown
}): DeliveryZonePricing | null {
  const bikeFee = nonNegative(row.base_bike_fee)
  const doorFee = nonNegative(row.base_door_fee)
  const platformMarkup = nonNegative(row.platform_markup)
  const riderCutBike = splitValue(row.rider_split, 'BIKE')
  const riderCutDoor = splitValue(row.rider_split, 'DOOR')
  const platformCutBike = splitValue(row.platform_split, 'BIKE')
  const platformCutDoor = splitValue(row.platform_split, 'DOOR')
  if (
    bikeFee === null || doorFee === null || platformMarkup === null ||
    riderCutBike === null || riderCutDoor === null ||
    platformCutBike === null || platformCutDoor === null
  ) return null
  return {
    cityId: row.city_id,
    zoneId: row.id,
    platformMarkup,
    bikeFee,
    doorFee,
    riderCutBike,
    riderCutDoor,
    platformCutBike,
    platformCutDoor,
  }
}

async function readSettingsPricing(db: DB): Promise<DeliveryZonePricing | null> {
  const ids = [
    'platform_markup', 'delivery_fee_bike', 'delivery_fee_door',
    'rider_delivery_cut_bike', 'rider_delivery_cut_door',
    'platform_delivery_cut_bike', 'platform_delivery_cut_door',
  ]
  const { data } = await db.from('settings').select('id, value').in('id', ids)
  const byId = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ id: string; value: { amount_kobo?: number } }>) {
    const n = nonNegative(row.value?.amount_kobo)
    if (n !== null) byId.set(row.id, n)
  }
  const platformMarkup = byId.get('platform_markup')
  const bikeFee = byId.get('delivery_fee_bike')
  const doorFee = byId.get('delivery_fee_door')
  const riderCutBike = byId.get('rider_delivery_cut_bike')
  const riderCutDoor = byId.get('rider_delivery_cut_door')
  const platformCutBike = byId.get('platform_delivery_cut_bike')
  const platformCutDoor = byId.get('platform_delivery_cut_door')
  if (
    platformMarkup === undefined || bikeFee === undefined || doorFee === undefined ||
    riderCutBike === undefined || riderCutDoor === undefined ||
    platformCutBike === undefined || platformCutDoor === undefined
  ) return null
  return {
    cityId: null,
    zoneId: null,
    platformMarkup,
    bikeFee,
    doorFee,
    riderCutBike,
    riderCutDoor,
    platformCutBike,
    platformCutDoor,
  }
}

export async function getDeliveryZonePricing(opts: {
  db?: DB
  vendorId?: string | null
  zoneId?: string | null
} = {}): Promise<DeliveryZonePricing | null> {
  const db = opts.db ?? createSupabaseAdmin()

  try {
    let zoneId = opts.zoneId ?? null
    if (!zoneId && opts.vendorId) {
      const { data: vendor } = await db
        .from('vendors')
        .select('zone_id')
        .eq('id', opts.vendorId)
        .maybeSingle()
      zoneId = (vendor as { zone_id?: string | null } | null)?.zone_id ?? null
    }

    if (zoneId) {
      const { data: zone } = await db
        .from('delivery_zones')
        .select('id, city_id, base_bike_fee, base_door_fee, platform_markup, rider_split, platform_split')
        .eq('id', zoneId)
        .eq('status', 'ACTIVE')
        .maybeSingle()
      if (zone) {
        const parsed = fromZone(zone as Parameters<typeof fromZone>[0])
        if (parsed) return parsed
      }
    }

    const { data: defaultZone } = await db
      .from('delivery_zones')
      .select('id, city_id, base_bike_fee, base_door_fee, platform_markup, rider_split, platform_split')
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (defaultZone) {
      const parsed = fromZone(defaultZone as Parameters<typeof fromZone>[0])
      if (parsed) return parsed
    }
  } catch {
    // Migration may not be applied yet in an older environment. Existing settings
    // rows remain the back-compat source during rollout.
  }

  return readSettingsPricing(db)
}

export async function getMinimumOrderKobo(db: DB = createSupabaseAdmin()): Promise<number | null> {
  const { data } = await db.from('settings').select('value').eq('id', 'min_order_amount').maybeSingle()
  return nonNegative((data as { value?: { amount_kobo?: number } } | null)?.value?.amount_kobo)
}
