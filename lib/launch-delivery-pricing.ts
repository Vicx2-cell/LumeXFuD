import { createSupabaseAdmin } from './supabase/server'

type DB = ReturnType<typeof createSupabaseAdmin>

export type LaunchDeliveryPricing = {
  minimumCustomerDeliveryFeeKobo: number
  minimumRiderPayoutKobo: number
  deliveryMarginKobo: number
  customerPlatformFeeKobo: number
  vendorCommissionBps: number
  guestFeeKobo: number
  fuelPriceKoboPerLitre: number
  bikeEfficiencyMetresPerLitre: number
  maintenanceKoboPerKm: number
  roadDistanceMultiplierBps: number
}

const DEFAULTS: LaunchDeliveryPricing = {
  minimumCustomerDeliveryFeeKobo: 40_000,
  minimumRiderPayoutKobo: 30_000,
  deliveryMarginKobo: 10_000,
  customerPlatformFeeKobo: 10_000,
  vendorCommissionBps: 300,
  guestFeeKobo: 5_000,
  // Provisional operational values: change in Super Admin settings before launch.
  fuelPriceKoboPerLitre: 100_000,
  bikeEfficiencyMetresPerLitre: 40_000,
  maintenanceKoboPerKm: 2_000,
  roadDistanceMultiplierBps: 13_500,
}

export const LAUNCH_DELIVERY_SETTING_KEYS: Record<keyof LaunchDeliveryPricing, string> = {
  minimumCustomerDeliveryFeeKobo: 'launch_minimum_customer_delivery_fee_kobo',
  minimumRiderPayoutKobo: 'launch_minimum_rider_payout_kobo',
  deliveryMarginKobo: 'launch_delivery_margin_kobo',
  customerPlatformFeeKobo: 'launch_customer_platform_fee_kobo',
  vendorCommissionBps: 'launch_vendor_commission_bps',
  guestFeeKobo: 'launch_guest_fee_kobo',
  fuelPriceKoboPerLitre: 'launch_fuel_price_kobo_per_litre',
  bikeEfficiencyMetresPerLitre: 'launch_bike_efficiency_metres_per_litre',
  maintenanceKoboPerKm: 'launch_maintenance_kobo_per_km',
  roadDistanceMultiplierBps: 'launch_road_distance_multiplier_bps',
}

function validInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback
}

export async function getLaunchDeliveryPricing(db: DB = createSupabaseAdmin()): Promise<LaunchDeliveryPricing> {
  const keys = Object.values(LAUNCH_DELIVERY_SETTING_KEYS)
  const { data } = await db.from('settings').select('id, value').in('id', keys)
  const settings = new Map((data ?? []).map((row) => [String(row.id), row.value]))
  const result = {} as LaunchDeliveryPricing
  for (const field of Object.keys(LAUNCH_DELIVERY_SETTING_KEYS) as Array<keyof LaunchDeliveryPricing>) {
    const value = settings.get(LAUNCH_DELIVERY_SETTING_KEYS[field]) as { value?: unknown; amount_kobo?: unknown } | undefined
    result[field] = validInt(value?.value ?? value?.amount_kobo, DEFAULTS[field])
  }
  return result
}

export function computeLaunchDeliveryQuote(input: { pricing: LaunchDeliveryPricing; roadDistanceMeters: number; isGuest: boolean }) {
  const distance = Math.max(0, Math.round(input.roadDistanceMeters))
  const p = input.pricing
  const fuelKobo = Math.ceil((distance * p.fuelPriceKoboPerLitre) / Math.max(1, p.bikeEfficiencyMetresPerLitre))
  const maintenanceKobo = Math.ceil((distance * p.maintenanceKoboPerKm) / 1_000)
  const riderPayoutKobo = Math.max(p.minimumRiderPayoutKobo, fuelKobo + maintenanceKobo)
  const deliveryFeeKobo = Math.max(p.minimumCustomerDeliveryFeeKobo, riderPayoutKobo + p.deliveryMarginKobo)
  return {
    roadDistanceMeters: distance,
    fuelKobo,
    maintenanceKobo,
    riderPayoutKobo,
    deliveryFeeKobo,
    platformDeliveryMarginKobo: deliveryFeeKobo - riderPayoutKobo,
    platformFeeKobo: p.customerPlatformFeeKobo,
    guestFeeKobo: input.isGuest ? p.guestFeeKobo : 0,
  }
}

/**
 * MVP server-side road-distance estimate. Coordinates originate from the
 * selected saved place/current-location flow and are never accepted as a price
 * or distance from the browser. The multiplier is admin-editable and should be
 * replaced by live routing only when the product can justify that cost.
 */
export function estimateRoadDistanceMeters(straightLineMeters: number, multiplierBps: number): number {
  return Math.max(0, Math.ceil(Math.max(0, straightLineMeters) * Math.max(10_000, multiplierBps) / 10_000))
}
