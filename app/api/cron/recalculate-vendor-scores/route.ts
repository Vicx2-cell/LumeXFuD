import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'

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
    .select('id')
    .is('deleted_at', null)
  if (vErr) {
    console.error('[cron/recalculate-vendor-scores] vendor query error:', vErr.message)
    return NextResponse.json({ error: 'DB query failed', detail: vErr.message }, { status: 500 })
  }
  const vendorIds = (vendorsRaw ?? []).map((v) => (v as { id: string }).id)
  if (vendorIds.length === 0) return NextResponse.json({ updated: 0 })

  // 30-day order window. Paginate: PostgREST caps a single response at 1000
  // rows, and at target volume (50+/day) a month easily exceeds that — an
  // unpaginated query would silently truncate and skew every score.
  const PAGE = 1000
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

  const now = new Date().toISOString()
  const rows = vendorIds.map((id) => {
    const a = aggs.get(id) ?? { completed: 0, cancelled: 0, prepTotalMin: 0, prepSamples: 0 }
    const total = a.completed + a.cancelled
    const cancelRate = total > 0 ? a.cancelled / total : 0
    const avgPrep = a.prepSamples > 0 ? a.prepTotalMin / a.prepSamples : null

    // Volume minus cancellations; small speed boost for sub-25-min prep.
    let score = a.completed * 2 - a.cancelled
    if (avgPrep !== null && avgPrep <= 25) score += 1

    let tier: 'TOP' | 'STANDARD' | 'LOW'
    if (a.completed >= 20 && cancelRate < 0.1) tier = 'TOP'
    else if (a.completed === 0 || cancelRate > 0.3) tier = 'LOW'
    else tier = 'STANDARD'

    return {
      vendor_id:            id,
      composite_score:      score,
      visibility_tier:      tier,
      completed_orders_30d: a.completed,
      cancelled_orders_30d: a.cancelled,
      avg_prep_minutes:     avgPrep !== null ? Math.round(avgPrep * 100) / 100 : null,
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
