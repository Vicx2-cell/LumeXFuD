import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { settleDuePickupNoShows } from '@/lib/pickup'
import { callPhoneMap } from '@/lib/call-phone'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  // Self-heal pickup no-shows for THIS vendor on every poll (the per-minute cron
  // has been unreliable). Scoped + cheap; idempotent claim makes it safe.
  if (session.role === 'vendor' && session.userId) {
    void settleDuePickupNoShows(session.userId)
  }

  const { data: vendor, error: ve } = await db
    .from('vendors')
    .select('id, shop_name, phone, status, paused_until, prep_time_minutes, opening_time, closing_time, logo_url, shop_photo_url, pickup_enabled, pickup_max_concurrent, address_text, landmark, latitude, longitude, subscription_tier, is_premium')
    .eq('id', session.userId!)
    .single()

  if (ve || !vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  const { data: orders } = await db
    .from('orders')
    .select(`
      id, order_number, status, delivery_type, delivery_address,
      subtotal, total_amount, created_at, customer_id,
      pickup_eta_at,
      customers ( phone, name ),
      order_items ( id, name, quantity, price, notes, addons )
    `)
    .eq('vendor_id', vendor.id)
    .not('status', 'in', '("COMPLETED","CANCELLED","REFUNDED","NO_SHOW")')
    .order('created_at', { ascending: false })
    .limit(30)

  const { data: recent } = await db
    .from('orders')
    .select('id, order_number, status, total_amount, created_at, order_items ( name, quantity )')
    .eq('vendor_id', vendor.id)
    .in('status', ['COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: todayOrders } = await db
    .from('orders')
    .select('id, status, total_amount, preparing_at, ready_at')
    .eq('vendor_id', vendor.id)
    .gte('created_at', todayStart)
    .order('created_at', { ascending: false })

  // Customer call numbers (migration 074) — resolved non-fatally so the dashboard
  // never breaks pre-074. tel: uses the call number; wa.me uses the WhatsApp number.
  type VOrder = { customer_id?: string | null; status?: string; total_amount?: number | null; customers?: { phone: string; call_phone?: string | null } | null }
  const list = (orders ?? []) as unknown as VOrder[]
  const cMap = await callPhoneMap('customers', list.map((o) => o.customer_id), db)
  for (const o of list) if (o.customers && o.customer_id) o.customers.call_phone = cMap.get(o.customer_id) ?? null

  const todays = todayOrders ?? []
  const completedToday = todays.filter((order) => order.status === 'COMPLETED')
  const prepSamples = completedToday
    .map((order) => {
      if (!order.preparing_at || !order.ready_at) return null
      const start = new Date(order.preparing_at).getTime()
      const end = new Date(order.ready_at).getTime()
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
      return (end - start) / 60000
    })
    .filter((value): value is number => value !== null)
  const avgPrepMinutes = prepSamples.length > 0
    ? Math.round((prepSamples.reduce((sum, value) => sum + value, 0) / prepSamples.length) * 10) / 10
    : null

  const summary = {
    orders_today: todays.length,
    revenue_today_kobo: todays
      .filter((order) => order.status === 'COMPLETED')
      .reduce((sum, order) => sum + (order.total_amount ?? 0), 0),
    pending_orders: list.filter((order) => order.status === 'PENDING').length,
    active_orders: list.length,
    completed_today: completedToday.length,
    avg_prep_minutes: avgPrepMinutes,
    store_status: vendor.status,
  }

  return NextResponse.json({ vendor, orders: list, recent: recent ?? [], summary })
}
