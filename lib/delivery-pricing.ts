import { createSupabaseAdmin } from './supabase/server'
import { getDeliveryZonePricing, type DeliveryZonePricing } from './delivery-zones'

type DB = ReturnType<typeof createSupabaseAdmin>
type DeliveryType = 'BIKE' | 'DOOR'
type AdjustmentKind = 'FIXED' | 'MULTIPLIER'

export interface DeliveryPricingRule {
  id: string
  name: string
  startTime: string | null
  endTime: string | null
  daysOfWeek: number[]
  weatherTrigger: string | null
  customerAdjustmentKind: AdjustmentKind
  customerAdjustmentValue: number
  riderBonusKind: AdjustmentKind
  riderBonusValue: number
  priority: number
  enabled: boolean
}

export interface DeliveryPricingConfig extends DeliveryZonePricing {
  pricingMode: 'FLAT' | 'DISTANCE'
  baseDistanceMeters: number
  distanceIncrementMeters: number
  bikeIncrementFee: number
  doorIncrementFee: number
  bikeIncrementRiderFee: number
  doorIncrementRiderFee: number
  maxDeliveryDistanceMeters: number
  vendorDeliveryRadiusMeters: number
  rules: DeliveryPricingRule[]
}

export interface ActivePricingAdjustment {
  ruleId: string
  name: string
  customerAmountKobo: number
  riderAmountKobo: number
}

export interface DeliveryPriceEstimate {
  zoneId: string | null
  cityId: string | null
  deliveryType: DeliveryType
  distanceMeters: number
  distanceKm: number
  segmentCount: number
  serviceFeeKobo: number
  baseDeliveryFeeKobo: number
  distanceSurchargeKobo: number
  deliveryFeeBeforeRulesKobo: number
  activeSurchargeTotalKobo: number
  deliveryFeeKobo: number
  riderBaseCutKobo: number
  riderDistanceBonusKobo: number
  riderRuleBonusKobo: number
  riderTotalCutKobo: number
  platformDeliveryCutKobo: number
  maxDeliveryDistanceMeters: number
  vendorDeliveryRadiusMeters: number
  activeAdjustments: ActivePricingAdjustment[]
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function dayKeyForLagos(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
  }).format(date)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts)
}

function timeKeyForLagos(date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function isTimeWithinWindow(now: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  if (start === end) return true
  if (start < end) return now >= start && now <= end
  return now >= start || now <= end
}

function applyAdjustment(kind: AdjustmentKind, value: number, amount: number): number {
  if (value <= 0 || amount <= 0) return 0
  if (kind === 'MULTIPLIER') {
    return Math.max(0, Math.round(amount * (value - 1)))
  }
  return Math.max(0, Math.round(value))
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

export function haversineDistanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const earthRadius = 6_371_000
  const latDelta = toRadians(to.lat - from.lat)
  const lngDelta = toRadians(to.lng - from.lng)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(lngDelta / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(earthRadius * c)
}

export function computeDeliveryPriceEstimate(input: {
  pricing: DeliveryPricingConfig
  deliveryType: DeliveryType
  distanceMeters: number
  weather?: string | null
  now?: Date
}): DeliveryPriceEstimate {
  const { pricing, deliveryType } = input
  const distanceMeters = Math.max(0, Math.round(input.distanceMeters))
  const now = input.now ?? new Date()
  const dayOfWeek = dayKeyForLagos(now)
  const timeKey = timeKeyForLagos(now)
  const weather = input.weather?.trim().toLowerCase() ?? null

  const baseDeliveryFeeKobo = deliveryType === 'BIKE' ? pricing.bikeFee : pricing.doorFee
  const riderBaseCutKobo = deliveryType === 'BIKE' ? pricing.riderCutBike : pricing.riderCutDoor
  const incrementFeeKobo = deliveryType === 'BIKE' ? pricing.bikeIncrementFee : pricing.doorIncrementFee
  const incrementRiderFeeKobo = deliveryType === 'BIKE' ? pricing.bikeIncrementRiderFee : pricing.doorIncrementRiderFee

  const extraDistance = Math.max(0, distanceMeters - pricing.baseDistanceMeters)
  const segmentCount = pricing.pricingMode === 'DISTANCE' && extraDistance > 0
    ? Math.ceil(extraDistance / Math.max(1, pricing.distanceIncrementMeters))
    : 0

  const distanceSurchargeKobo = segmentCount * incrementFeeKobo
  const riderDistanceBonusKobo = segmentCount * incrementRiderFeeKobo
  const deliveryFeeBeforeRulesKobo = baseDeliveryFeeKobo + distanceSurchargeKobo

  const activeAdjustments: ActivePricingAdjustment[] = []
  let activeSurchargeTotalKobo = 0
  let riderRuleBonusKobo = 0

  for (const rule of pricing.rules
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))) {
    if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(dayOfWeek)) continue
    if (!isTimeWithinWindow(timeKey, rule.startTime, rule.endTime)) continue
    if (rule.weatherTrigger && rule.weatherTrigger.trim().toLowerCase() !== weather) continue

    const customerAmountKobo = applyAdjustment(
      rule.customerAdjustmentKind,
      rule.customerAdjustmentValue,
      deliveryFeeBeforeRulesKobo,
    )
    const riderAmountKobo = applyAdjustment(
      rule.riderBonusKind,
      rule.riderBonusValue,
      riderBaseCutKobo + riderDistanceBonusKobo,
    )
    if (customerAmountKobo > 0 && riderAmountKobo <= 0) {
      continue
    }
    if (customerAmountKobo <= 0 && riderAmountKobo <= 0) continue

    activeAdjustments.push({
      ruleId: rule.id,
      name: rule.name,
      customerAmountKobo,
      riderAmountKobo,
    })
    activeSurchargeTotalKobo += customerAmountKobo
    riderRuleBonusKobo += riderAmountKobo
  }

  const deliveryFeeKobo = deliveryFeeBeforeRulesKobo + activeSurchargeTotalKobo
  const riderTotalCutKobo = riderBaseCutKobo + riderDistanceBonusKobo + riderRuleBonusKobo

  return {
    zoneId: pricing.zoneId,
    cityId: pricing.cityId,
    deliveryType,
    distanceMeters,
    distanceKm: Math.round((distanceMeters / 1000) * 100) / 100,
    segmentCount,
    serviceFeeKobo: pricing.platformMarkup,
    baseDeliveryFeeKobo,
    distanceSurchargeKobo,
    deliveryFeeBeforeRulesKobo,
    activeSurchargeTotalKobo,
    deliveryFeeKobo,
    riderBaseCutKobo,
    riderDistanceBonusKobo,
    riderRuleBonusKobo,
    riderTotalCutKobo,
    platformDeliveryCutKobo: Math.max(0, deliveryFeeKobo - riderTotalCutKobo),
    maxDeliveryDistanceMeters: pricing.maxDeliveryDistanceMeters,
    vendorDeliveryRadiusMeters: pricing.vendorDeliveryRadiusMeters,
    activeAdjustments,
  }
}

export async function getDeliveryPricingConfig(opts: {
  db?: DB
  zoneId?: string | null
  vendorId?: string | null
} = {}): Promise<DeliveryPricingConfig | null> {
  const db = opts.db ?? createSupabaseAdmin()
  const base = await getDeliveryZonePricing({ db, zoneId: opts.zoneId, vendorId: opts.vendorId })
  if (!base) return null

  try {
    const { data: zone } = await db
      .from('delivery_zones')
      .select(`
        id, pricing_mode, base_distance_meters, distance_increment_meters,
        bike_increment_fee, door_increment_fee, bike_increment_rider_fee,
        door_increment_rider_fee, max_delivery_distance_meters, vendor_delivery_radius_meters
      `)
      .eq('id', base.zoneId)
      .maybeSingle()

    const { data: rulesRows } = await db
      .from('delivery_pricing_rules')
      .select(`
        id, name, start_time, end_time, days_of_week, weather_trigger,
        customer_adjustment_kind, customer_adjustment_value,
        rider_bonus_kind, rider_bonus_value, priority, enabled
      `)
      .eq('zone_id', base.zoneId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    const rules: DeliveryPricingRule[] = ((rulesRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? 'Pricing rule'),
      startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
      endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
      daysOfWeek: Array.isArray(row.days_of_week)
        ? row.days_of_week.map((day) => asNumber(day)).filter((day) => day >= 0 && day <= 6)
        : [],
      weatherTrigger: row.weather_trigger ? String(row.weather_trigger) : null,
      customerAdjustmentKind: String(row.customer_adjustment_kind ?? 'FIXED') === 'MULTIPLIER' ? 'MULTIPLIER' : 'FIXED',
      customerAdjustmentValue: asNumber(row.customer_adjustment_value),
      riderBonusKind: String(row.rider_bonus_kind ?? 'FIXED') === 'MULTIPLIER' ? 'MULTIPLIER' : 'FIXED',
      riderBonusValue: asNumber(row.rider_bonus_value),
      priority: asNumber(row.priority, 100),
      enabled: row.enabled !== false,
    }))

    return {
      ...base,
      pricingMode: String((zone as { pricing_mode?: string } | null)?.pricing_mode ?? 'DISTANCE') === 'FLAT' ? 'FLAT' : 'DISTANCE',
      baseDistanceMeters: asNumber((zone as { base_distance_meters?: unknown } | null)?.base_distance_meters, 2000),
      distanceIncrementMeters: Math.max(1, asNumber((zone as { distance_increment_meters?: unknown } | null)?.distance_increment_meters, 2000)),
      bikeIncrementFee: asNumber((zone as { bike_increment_fee?: unknown } | null)?.bike_increment_fee),
      doorIncrementFee: asNumber((zone as { door_increment_fee?: unknown } | null)?.door_increment_fee),
      bikeIncrementRiderFee: asNumber((zone as { bike_increment_rider_fee?: unknown } | null)?.bike_increment_rider_fee),
      doorIncrementRiderFee: asNumber((zone as { door_increment_rider_fee?: unknown } | null)?.door_increment_rider_fee),
      maxDeliveryDistanceMeters: Math.max(1, asNumber((zone as { max_delivery_distance_meters?: unknown } | null)?.max_delivery_distance_meters, 10000)),
      vendorDeliveryRadiusMeters: Math.max(1, asNumber((zone as { vendor_delivery_radius_meters?: unknown } | null)?.vendor_delivery_radius_meters, 10000)),
      rules,
    }
  } catch {
    return {
      ...base,
      pricingMode: 'FLAT',
      baseDistanceMeters: 2000,
      distanceIncrementMeters: 2000,
      bikeIncrementFee: 0,
      doorIncrementFee: 0,
      bikeIncrementRiderFee: 0,
      doorIncrementRiderFee: 0,
      maxDeliveryDistanceMeters: 10000,
      vendorDeliveryRadiusMeters: 10000,
      rules: [],
    }
  }
}
