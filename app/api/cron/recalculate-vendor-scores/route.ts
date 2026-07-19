import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import { computeVendorRanking } from '@/lib/vendor-ranking'

// Called weekly, Sunday midnight, by Vercel cron (vercel.json: "0 0 * * 0").
// Recomputes the simplified MVP vendor ranking and upserts vendor_scores.
// Ratings are out of MVP scope, so the score is volume + reliability + speed:
//   score = completed_orders*2 − cancelled_orders, lightly boosted for fast prep.
// Drives homepage ordering (GET /api/vendors orders by composite_score DESC).

interface OrderRow {
  vendor_id: string
  status: string
  preparing_at: string | null
  ready_at: string | null
}

interface Agg {
  completed: number
  cancelled: number
  prepTotalMin: number
  prepSamples: number
}

interface VendorMetaRow {
  id: string
  avg_rating: number | null
  total_ratings: number | null
  is_active: boolean
  status: string | null
  is_premium: boolean | null
}

interface MenuRow {
  vendor_id: string
  is_available: boolean | null
  updated_at: string | null
  created_at: string | null
}

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('recalculate-vendor-scores', () => POST(req))
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Active vendors.
  const { data: vendorsRaw, error: vErr } = await db
    .from('vendors')
    .select('id, avg_rating, total_ratings, is_active, status, is_premium')
    .is('deleted_at', null)
  if (vErr) {
    console.error('[cron/recalculate-vendor-scores] vendor query error:', vErr.message)
    return NextResponse.json({ error: 'DB query failed', detail: vErr.message }, { status: 500 })
  }
  const vendors = (vendorsRaw ?? []) as VendorMetaRow[]
  const vendorIds = vendors.map((v) => v.id)
  if (vendorIds.length === 0) return NextResponse.json({ updated: 0 })
  const PAGE = 1000

  const menuRows: MenuRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error: mErr } = await db
      .from('menu_items')
      .select('vendor_id, is_available, updated_at, created_at')
      .in('vendor_id', vendorIds)
      .is('deleted_at', null)
      .range(from, from + PAGE - 1)
    if (mErr) {
      console.error('[cron/recalculate-vendor-scores] menu query error:', mErr.message)
      return NextResponse.json({ error: 'DB query failed', detail: mErr.message }, { status: 500 })
    }
    const batch = (data ?? []) as unknown as MenuRow[]
    menuRows.push(...batch)
    if (batch.length < PAGE) break
  }

  // 30-day order window. Paginate: PostgREST caps a single response at 1000
  // rows, and at target volume (50+/day) a month easily exceeds that — an
  // unpaginated query would silently truncate and skew every score.
  const orderRows: OrderRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error: oErr } = await db
      .from('orders')
      .select('vendor_id, status, preparing_at, ready_at')
      .gte('created_at', thirtyDaysAgo)
      .in('status', ['COMPLETED', 'CANCELLED', 'REFUNDED'])
      .range(from, from + PAGE - 1)
    if (oErr) {
      console.error('[cron/recalculate-vendor-scores] order query error:', oErr.message)
      return NextResponse.json({ error: 'DB query failed', detail: oErr.message }, { status: 500 })
    }
    const batch = (data ?? []) as unknown as OrderRow[]
    orderRows.push(...batch)
    if (batch.length < PAGE) break
  }

  const aggs = new Map<string, Agg>()
  const menuAggs = new Map<string, { total: number; available: number; fresh: number }>()
  const ensure = (id: string): Agg => {
    let a = aggs.get(id)
    if (!a) { a = { completed: 0, cancelled: 0, prepTotalMin: 0, prepSamples: 0 }; aggs.set(id, a) }
    return a
  }

  for (const o of orderRows) {
    const a = ensure(o.vendor_id)
    if (o.status === 'COMPLETED') {
      a.completed++
      if (o.preparing_at && o.ready_at) {
        const mins = (new Date(o.ready_at).getTime() - new Date(o.preparing_at).getTime()) / 60000
        if (mins > 0 && mins < 240) { a.prepTotalMin += mins; a.prepSamples++ }
      }
    } else {
      // CANCELLED or REFUNDED both count against reliability.
      a.cancelled++
    }
  }

  for (const row of menuRows) {
    const a = menuAggs.get(row.vendor_id) ?? { total: 0, available: 0, fresh: 0 }
    a.total += 1
    if (row.is_available) a.available += 1
    const updated = row.updated_at ?? row.created_at
    if (updated && (Date.now() - new Date(updated).getTime()) < 30 * 24 * 60 * 60 * 1000) {
      a.fresh += 1
    }
    menuAggs.set(row.vendor_id, a)
  }

  const now = new Date().toISOString()
  const rows = vendors.map((vendor) => {
    const id = vendor.id
    const a = aggs.get(id) ?? { completed: 0, cancelled: 0, prepTotalMin: 0, prepSamples: 0 }
    const m = menuAggs.get(id) ?? { total: 0, available: 0, fresh: 0 }
    const avgPrep = a.prepSamples > 0 ? a.prepTotalMin / a.prepSamples : null
    const availabilityScore = vendor.is_active ? 1 : 0.25
    const deliveryPerformanceScore = a.completed + a.cancelled > 0 ? Math.max(0, 1 - ((a.cancelled / Math.max(1, a.completed + a.cancelled)) * 0.7)) : 0.5
    const conversionRate = a.completed + a.cancelled > 0 ? a.completed / (a.completed + a.cancelled) : 0
    const menuQualityScore = m.total > 0 ? Math.min(1, m.available / Math.max(4, m.total)) : 0.25
    const freshnessScore = m.total > 0 ? Math.min(1, m.fresh / m.total) : 0.25
    const premiumBoost = vendor.is_premium ? 6 : 0

    const ranking = computeVendorRanking({
      completedOrders30d: a.completed,
      cancelledOrders30d: a.cancelled,
      averageRating: vendor.avg_rating,
      totalRatings: vendor.total_ratings ?? 0,
      averagePrepMinutes: avgPrep,
      availabilityScore,
      deliveryPerformanceScore,
      conversionRate,
      menuQualityScore,
      freshnessScore,
      premiumBoost,
    })

    return {
      vendor_id:            id,
      composite_score:      ranking.compositeScore,
      visibility_tier:      ranking.visibilityTier,
      completed_orders_30d: a.completed,
      cancelled_orders_30d: a.cancelled,
      avg_prep_minutes:     avgPrep !== null ? Math.round(avgPrep * 100) / 100 : null,
      premium_boost:        premiumBoost,
      calculated_at:        now,
    }
  })

  const { error: upErr } = await db
    .from('vendor_scores')
    .upsert(rows, { onConflict: 'vendor_id' })
  if (upErr) {
    console.error('[cron/recalculate-vendor-scores] upsert error:', upErr.message)
    return NextResponse.json({ error: 'Upsert failed', detail: upErr.message }, { status: 500 })
  }

  return NextResponse.json({ updated: rows.length })
}
