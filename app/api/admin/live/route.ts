import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { classifyOrder, LIVE_STATUSES, type LiveOrderInput } from '@/lib/live-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/live — the Live Operations feed. Service-role (the browser can't
// read orders over realtime — custom JWT), admin/super-admin only. Returns every
// in-flight order enriched with the anomaly engine's severity + flags, plus a
// summary, so the board can render and alert without any client-side logic.

// Supabase returns a to-one join as an object, but the typings widen it to an
// array in places — normalise either shape to the first row.
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

interface Row {
  id: string
  order_number: string
  status: string
  payment_status: string | null
  delivery_type: string | null
  delivery_address: string | null
  delivery_latitude: number | null
  delivery_longitude: number | null
  total_amount: number
  created_at: string
  vendor_accepted_at: string | null
  preparing_at: string | null
  ready_at: string | null
  rider_assigned_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  vendor_id: string | null
  customer_id: string | null
  rider_id: string | null
  guest_phone: string | null
  vendors: { shop_name: string | null; phone: string | null } | Array<{ shop_name: string | null; phone: string | null }> | null
  customers: { name: string | null; phone: string | null; dispute_count: number | null } | Array<{ name: string | null; phone: string | null; dispute_count: number | null }> | null
  riders: { full_name: string | null; phone: string | null } | Array<{ full_name: string | null; phone: string | null }> | null
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const { data, error } = await db
    .from('orders')
    .select(`
      id, order_number, status, payment_status, delivery_type, delivery_address,
      delivery_latitude, delivery_longitude, total_amount, created_at,
      vendor_accepted_at, preparing_at, ready_at, rider_assigned_at, picked_up_at, delivered_at,
      vendor_id, customer_id, rider_id, guest_phone,
      vendors ( shop_name, phone ),
      customers ( name, phone, dispute_count ),
      riders ( full_name, phone )
    `)
    .in('status', LIVE_STATUSES as unknown as string[])
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[admin/live] query failed:', error.message)
    return NextResponse.json({ error: 'Could not load live operations' }, { status: 500 })
  }

  const now = Date.now()
  const rows = (data ?? []) as unknown as Row[]

  const orders = rows.map((r) => {
    const vendor = one(r.vendors)
    const customer = one(r.customers)
    const rider = one(r.riders)
    const disputeCount = Number(customer?.dispute_count ?? 0)

    const input: LiveOrderInput = {
      status: r.status,
      payment_status: r.payment_status,
      created_at: r.created_at,
      vendor_accepted_at: r.vendor_accepted_at,
      preparing_at: r.preparing_at,
      ready_at: r.ready_at,
      rider_assigned_at: r.rider_assigned_at,
      picked_up_at: r.picked_up_at,
      delivered_at: r.delivered_at,
      rider_id: r.rider_id,
      customer_dispute_count: disputeCount,
    }
    const c = classifyOrder(input, now)

    return {
      id: r.id,
      order_number: r.order_number,
      status: r.status,
      payment_status: r.payment_status,
      delivery_type: r.delivery_type,
      delivery_address: r.delivery_address,
      lat: r.delivery_latitude,
      lng: r.delivery_longitude,
      total_amount: r.total_amount,
      created_at: r.created_at,
      stage_since: new Date(c.stage_since).toISOString(),
      age_min: c.age_min,
      severity: c.severity,
      flags: c.flags,
      vendor_id: r.vendor_id,
      vendor_name: vendor?.shop_name ?? null,
      vendor_phone: vendor?.phone ?? null,
      rider_id: r.rider_id,
      rider_name: rider?.full_name ?? null,
      rider_phone: rider?.phone ?? null,
      customer_id: r.customer_id,
      customer_name: customer?.name ?? null,
      customer_phone: customer?.phone ?? r.guest_phone ?? null,
      customer_dispute_count: disputeCount,
    }
  })

  // Worst-first: critical, then warn, then calm; within a tier, longest-waiting first.
  const rank = { critical: 0, warn: 1, none: 2 } as const
  orders.sort((a, b) => rank[a.severity] - rank[b.severity] || b.age_min - a.age_min)

  const summary = {
    total: orders.length,
    critical: orders.filter((o) => o.severity === 'critical').length,
    warn: orders.filter((o) => o.severity === 'warn').length,
    unassigned: orders.filter((o) => o.status === 'READY' && !o.rider_id).length,
    disputed: orders.filter((o) => o.status === 'DISPUTED').length,
    mapped: orders.filter((o) => o.lat != null && o.lng != null).length,
  }

  return NextResponse.json({ generated_at: new Date().toISOString(), summary, orders })
}
