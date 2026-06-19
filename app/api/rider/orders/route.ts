import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rider', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  const { data: rider, error: re } = await db
    .from('riders')
    .select('id, full_name, status, active_order_id, avg_rating, total_deliveries, opening_time, closing_time, avatar_url')
    .eq('id', session.userId!)
    .single()
  if (re || !rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  const [availableResult, currentResult] = await Promise.all([
    db.from('orders')
      .select(`
        id, order_number, status, delivery_type, delivery_address,
        rider_delivery_cut, created_at,
        vendors ( shop_name )
      `)
      .eq('status', 'READY')
      .is('rider_id', null)
      .order('created_at', { ascending: true })
      .limit(10),

    rider.active_order_id
      ? db.from('orders')
          .select(`
            id, order_number, status, delivery_type, delivery_address,
            rider_delivery_cut, picked_up_at, created_at,
            vendors ( shop_name, phone ),
            customers ( phone, name )
          `)
          .eq('id', rider.active_order_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  return NextResponse.json({
    rider: {
      id: rider.id,
      full_name: rider.full_name,
      status: rider.status,
      avg_rating: rider.avg_rating,
      total_deliveries: rider.total_deliveries,
      opening_time: rider.opening_time,
      closing_time: rider.closing_time,
      avatar_url: rider.avatar_url,
    },
    available: availableResult.data ?? [],
    current: currentResult.data ?? null,
  })
}
