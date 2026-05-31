import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = todayStart.toISOString()

  const [ordersRes, disputesRes, ridersRes, walletRes] = await Promise.all([
    db.from('orders')
      .select('id, total_amount, platform_markup, platform_delivery_cut, vendor_accepted_at, delivered_at, status')
      .gte('created_at', todayIso),
    db.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'DISPUTED'),
    db.from('riders').select('id', { count: 'exact', head: true }).in('status', ['ONLINE', 'BUSY']).eq('is_active', true),
    db.from('wallet_balances').select('held_balance'),
  ])

  const allOrders = ordersRes.data ?? []
  const nonCancelled = allOrders.filter((o) => o.status !== 'CANCELLED')
  const ordersToday = nonCancelled.length

  let profitSum = 0
  for (const o of nonCancelled) {
    profitSum += (o.platform_markup ?? 0) + (o.platform_delivery_cut ?? 0)
  }
  const avgProfitKobo = ordersToday > 0 ? Math.round(profitSum / ordersToday) : 0

  const delivered = nonCancelled.filter((o) => o.delivered_at && o.vendor_accepted_at)
  let totalMins = 0
  for (const o of delivered) {
    totalMins += (new Date(o.delivered_at!).getTime() - new Date(o.vendor_accepted_at!).getTime()) / 60_000
  }
  const avgDeliveryMins = delivered.length > 0 ? Math.round(totalMins / delivered.length) : 0

  const walletFloat = (walletRes.data ?? []).reduce((s, w) => s + (w.held_balance ?? 0), 0)

  return NextResponse.json({
    orders_today: ordersToday,
    avg_profit_kobo: avgProfitKobo,
    avg_delivery_minutes: avgDeliveryMins,
    riders_online: ridersRes.count ?? 0,
    active_disputes: disputesRes.count ?? 0,
    wallet_float_kobo: walletFloat,
  })
}
