import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notCurrentlySuspendedOr } from '@/lib/vendor-visibility'
import { mapVendorSignals, rankVendorFeed } from '@/lib/vendor-feed-fairness'

export async function GET(req: NextRequest) {
  try {
    const db = createSupabaseAdmin()
    const cityId = req.nextUrl.searchParams.get('city_id')
    const zoneId = req.nextUrl.searchParams.get('zone_id')

    let query = db
      .from('vendors')
      .select(`
        id, shop_name, owner_name, logo_url, shop_photo_url,
        prep_time_minutes, status, paused_until, category, description,
        avg_rating, total_ratings, is_active, subscription_paid_until, city_id, zone_id,
        vendor_scores ( composite_score, visibility_tier )
      `)
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(notCurrentlySuspendedOr()) // hide suspended vendors from the public list
      .in('status', ['OPEN', 'BUSY'])
      .order('composite_score', { referencedTable: 'vendor_scores', ascending: false })

    if (zoneId) {
      query = query.eq('zone_id', zoneId)
    } else if (cityId) {
      query = query.eq('city_id', cityId)
    }

    const { data: vendors, error } = await query

    if (error) {
      return NextResponse.json({ error: 'Failed to load vendors' }, { status: 500 })
    }

    const vendorRows = (vendors ?? []) as Array<{
      id: string
      shop_name: string
      owner_name: string | null
      logo_url: string | null
      shop_photo_url: string | null
      prep_time_minutes: number
      status: 'OPEN' | 'BUSY' | 'CLOSED'
      paused_until: string | null
      category: string
      description: string | null
      avg_rating: number
      total_ratings: number
      is_active: boolean
      subscription_paid_until: string | null
      city_id: string | null
      zone_id: string | null
      vendor_scores: Array<{ composite_score: number; visibility_tier: string }> | null
    }>

    const vendorIds = vendorRows.map((vendor) => vendor.id)
    let signals = new Map<string, { impressions?: number; clicks?: number; views?: number; downloads?: number; shares?: number; orders?: number }>()
    if (vendorIds.length > 0) {
      const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const { data: eventRows } = await db
        .from('campaign_events')
        .select('vendor_id, event_type')
        .in('vendor_id', vendorIds)
        .gte('created_at', cutoff)
      signals = mapVendorSignals((eventRows ?? []).map((row) => ({
        vendor_id: row.vendor_id as string,
        event_type: row.event_type as string,
        count: 1,
      })))
    }

    const ranked = rankVendorFeed(vendorRows, signals)

    const { data: trending } = await db
      .from('trending_data')
      .select('orders_last_hour, top_item_name, top_item_count, top_vendor_name, new_vendor_name')
      .eq('id', 1)
      .single()

    const response = NextResponse.json({ vendors: ranked, trending: trending ?? null })
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=300')
    return response
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
