import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { orderEstimateInput } from '@/lib/validators'
import {
  computeDeliveryPriceEstimate,
  getDeliveryPricingConfig,
  haversineDistanceMeters,
} from '@/lib/delivery-pricing'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = orderEstimateInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid estimate request' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const { vendor_id, delivery_type, city_id, zone_id, delivery_latitude, delivery_longitude } = parsed.data

  const { data: vendor } = await db
    .from('vendors')
    .select('id, city_id, zone_id, official_latitude, official_longitude, latitude, longitude')
    .eq('id', vendor_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!vendor) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }

  const vendorLat = Number((vendor as Record<string, unknown>).official_latitude ?? (vendor as Record<string, unknown>).latitude)
  const vendorLng = Number((vendor as Record<string, unknown>).official_longitude ?? (vendor as Record<string, unknown>).longitude)
  if (!Number.isFinite(vendorLat) || !Number.isFinite(vendorLng)) {
    return NextResponse.json({ error: 'Vendor location is not configured yet' }, { status: 409 })
  }

  const pricing = await getDeliveryPricingConfig({
    db,
    zoneId: zone_id ?? ((vendor as { zone_id?: string | null }).zone_id ?? null),
    vendorId: vendor_id,
  })
  if (!pricing) {
    return NextResponse.json({ error: 'Delivery pricing is not configured' }, { status: 503 })
  }
  if (zone_id && pricing.zoneId !== zone_id) {
    return NextResponse.json({ error: 'That delivery area is not available right now.' }, { status: 400 })
  }
  if (city_id && pricing.cityId && city_id !== pricing.cityId) {
    return NextResponse.json({ error: 'That city does not match the chosen delivery area.' }, { status: 400 })
  }

  const distanceMeters = haversineDistanceMeters(
    { lat: vendorLat, lng: vendorLng },
    { lat: delivery_latitude, lng: delivery_longitude },
  )
  const estimate = computeDeliveryPriceEstimate({
    pricing,
    deliveryType: delivery_type,
    distanceMeters,
  })

  if (estimate.distanceMeters > estimate.maxDeliveryDistanceMeters) {
    return NextResponse.json({
      error: 'Delivery distance is outside the configured service area.',
      code: 'max_distance_exceeded',
      estimate,
    }, { status: 400 })
  }
  if (estimate.distanceMeters > estimate.vendorDeliveryRadiusMeters) {
    return NextResponse.json({
      error: 'This vendor does not deliver that far yet.',
      code: 'vendor_radius_exceeded',
      estimate,
    }, { status: 400 })
  }

  return NextResponse.json({ estimate }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
