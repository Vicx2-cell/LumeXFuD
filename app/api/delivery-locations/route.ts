import { NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const db = createSupabaseAdmin()

  try {
    const { data: cities } = await db
      .from('cities')
      .select('id, name, state, slug, status')
      .eq('status', 'ACTIVE')
      .order('state', { ascending: true })
      .order('name', { ascending: true })

    const cityRows = (cities ?? []) as Array<{
      id: string
      name: string
      state: string
      slug: string
      status: 'ACTIVE'
    }>
    if (cityRows.length === 0) {
      return NextResponse.json({ locations: [] }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const cityIds = cityRows.map((city) => city.id)
    let zoneRows: Array<{
      id: string
      city_id: string
      name: string
      status: 'ACTIVE'
      base_bike_fee: number
      base_door_fee: number
      platform_markup: number
      rider_split: { BIKE?: number; DOOR?: number } | null
      uses_lodge_catalog?: boolean | null
    }> = []

    const richZones = await db
      .from('delivery_zones')
      .select('id, city_id, name, status, base_bike_fee, base_door_fee, platform_markup, rider_split, uses_lodge_catalog')
      .eq('status', 'ACTIVE')
      .in('city_id', cityIds)
      .order('created_at', { ascending: true })
    if (!richZones.error) {
      zoneRows = (richZones.data ?? []) as typeof zoneRows
    } else {
      const baseZones = await db
        .from('delivery_zones')
        .select('id, city_id, name, status, base_bike_fee, base_door_fee, platform_markup, rider_split')
        .eq('status', 'ACTIVE')
        .in('city_id', cityIds)
        .order('created_at', { ascending: true })
      zoneRows = (baseZones.data ?? []) as typeof zoneRows
    }

    const cityById = new Map(cityRows.map((city) => [city.id, city]))
    const locations = zoneRows.flatMap((zone) => {
        const city = cityById.get(zone.city_id)
        if (!city) return []
        return [{
          city_id: city.id,
          city_name: city.name,
          city_state: city.state,
          city_slug: city.slug,
          zone_id: zone.id,
          zone_name: zone.name,
          base_bike_fee_kobo: Number(zone.base_bike_fee ?? 0),
          base_door_fee_kobo: Number(zone.base_door_fee ?? 0),
          platform_markup_kobo: Number(zone.platform_markup ?? 0),
          rider_cut_bike_kobo: Number(zone.rider_split?.BIKE ?? 0),
          rider_cut_door_kobo: Number(zone.rider_split?.DOOR ?? 0),
          uses_lodge_catalog: zone.uses_lodge_catalog ?? (city.slug === 'uturu'),
        }]
      })
      .sort((a, b) =>
        a.city_state.localeCompare(b.city_state) ||
        a.city_name.localeCompare(b.city_name) ||
        a.zone_name.localeCompare(b.zone_name),
      )

    return NextResponse.json({ locations }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ locations: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
