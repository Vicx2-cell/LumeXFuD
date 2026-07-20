import { createSupabaseAdmin } from './supabase/server'

type DB = ReturnType<typeof createSupabaseAdmin>

function roundCoord(value: number): number {
  return Math.round(value * 100000) / 100000
}

function cleanText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

export async function captureCustomerLocation(db: DB, input: {
  customerId: string
  label?: string | null
  deliveryNote?: string | null
  latitude: number
  longitude: number
  cityId?: string | null
  zoneId?: string | null
}) {
  const now = new Date().toISOString()
  const latitude = roundCoord(input.latitude)
  const longitude = roundCoord(input.longitude)
  const label = cleanText(input.label, 'Active GPS pin')

  await db
    .from('customer_locations')
    .update({ is_active: false, updated_at: now })
    .eq('customer_id', input.customerId)
    .eq('is_active', true)

  const { data } = await db
    .from('customer_locations')
    .insert({
      customer_id: input.customerId,
      label,
      delivery_note: input.deliveryNote ?? null,
      latitude,
      longitude,
      city_id: input.cityId ?? null,
      zone_id: input.zoneId ?? null,
      is_active: true,
      updated_at: now,
    })
    .select('id')
    .single()

  return (data as { id: string } | null) ?? null
}

export async function recordOrderStatusEvent(db: DB, input: {
  eventId?: string
  orderId: string
  actorType: string
  actorId: string
  status: string
  latitude?: number | null
  longitude?: number | null
  gpsAccuracy?: number | null
  distanceFromExpectedMeters?: number | null
  validationStatus?: string
}) {
  const { data, error } = await db.from('order_status_events').insert({
    ...(input.eventId ? { id: input.eventId } : {}),
    order_id: input.orderId,
    actor_type: input.actorType,
    actor_id: input.actorId,
    status: input.status,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    gps_accuracy: input.gpsAccuracy ?? null,
    distance_from_expected_meters: input.distanceFromExpectedMeters ?? null,
    validation_status: input.validationStatus ?? (input.latitude != null && input.longitude != null ? 'captured' : 'not_validated'),
  }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

function placeNameFromOrder(order: {
  delivery_lodge?: string | null
  delivery_block?: string | null
  delivery_room?: string | null
  delivery_address?: string | null
  order_number?: string | null
}): string {
  const lodge = typeof order.delivery_lodge === 'string' ? order.delivery_lodge.trim() : ''
  const block = typeof order.delivery_block === 'string' ? order.delivery_block.trim() : ''
  const room = typeof order.delivery_room === 'string' ? order.delivery_room.trim() : ''
  const address = typeof order.delivery_address === 'string' ? order.delivery_address.trim() : ''
  const parts = [lodge, block, room].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  if (address) return address
  return order.order_number ? `Order ${order.order_number}` : 'Delivery place'
}

export async function promoteVerifiedPlaceFromOrder(db: DB, input: {
  orderId: string
  orderNumber?: string | null
  customerLocationLabel?: string | null
  deliveryAddress?: string | null
  deliveryLodge?: string | null
  deliveryBlock?: string | null
  deliveryRoom?: string | null
  latitude?: number | null
  longitude?: number | null
  cityId?: string | null
}) {
  if (typeof input.latitude !== 'number' || typeof input.longitude !== 'number') return null
  const cityId = input.cityId ?? null
  const name = placeNameFromOrder({
    delivery_lodge: input.deliveryLodge ?? null,
    delivery_block: input.deliveryBlock ?? null,
    delivery_room: input.deliveryRoom ?? null,
    delivery_address: input.deliveryAddress ?? null,
    order_number: input.orderNumber ?? null,
  })
  const canonicalLatitude = roundCoord(input.latitude)
  const canonicalLongitude = roundCoord(input.longitude)

  let cityName = cityId ?? 'unknown'
  if (cityId) {
    const { data: city } = await db.from('cities').select('name').eq('id', cityId).maybeSingle()
    cityName = (city as { name?: string | null } | null)?.name?.trim() || cityName
  }

  const existing = await db
    .from('verified_places')
    .select('id, confidence_count, status')
    .eq('name', name)
    .eq('city', cityName)
    .eq('canonical_latitude', canonicalLatitude)
    .eq('canonical_longitude', canonicalLongitude)
    .maybeSingle()

  let verifiedPlaceId = (existing.data as { id: string } | null)?.id ?? null
  if (!verifiedPlaceId) {
    const { data: inserted } = await db
      .from('verified_places')
      .insert({
        name,
        canonical_latitude: canonicalLatitude,
        canonical_longitude: canonicalLongitude,
        city: cityName,
        status: 'candidate',
        confidence_count: 1,
      })
      .select('id')
      .single()
    verifiedPlaceId = (inserted as { id: string } | null)?.id ?? null
  } else {
    const currentCount = Number((existing.data as { confidence_count?: number } | null)?.confidence_count ?? 0)
    const nextCount = currentCount + 1
    const nextStatus = nextCount >= 3 ? 'verified' : ((existing.data as { status?: string } | null)?.status ?? 'candidate')
    await db
      .from('verified_places')
      .update({
        confidence_count: nextCount,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', verifiedPlaceId)
  }

  if (!verifiedPlaceId) return null

  await db.from('verified_place_votes').insert({
    verified_place_id: verifiedPlaceId,
    order_id: input.orderId,
    customer_location_label: input.customerLocationLabel ?? name,
    latitude: canonicalLatitude,
    longitude: canonicalLongitude,
  })

  return { verifiedPlaceId, city: cityName, name }
}
