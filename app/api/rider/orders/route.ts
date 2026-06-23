import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { callPhoneMap } from '@/lib/call-phone'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rider', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  const { data: rider, error: re } = await db
    .from('riders')
    .select('id, full_name, status, active_order_id, avg_rating, total_deliveries, avatar_url')
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
            id, order_number, status, delivery_type, delivery_address, vendor_id, customer_id,
            rider_delivery_cut, picked_up_at, created_at, delivery_photo_url,
            vendors ( shop_name, phone ),
            customers ( phone, name, avatar_url ),
            order_items ( name, quantity )
          `)
          .eq('id', rider.active_order_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  // leave_at_gate (migration 073) + call_phone (migration 074) are read SEPARATELY
  // and non-fatally so the rider dashboard never breaks on a DB where those haven't
  // been applied yet. tel: calls the call number (fallback: the WhatsApp number).
  const current = currentResult.data as ({
    id: string; vendor_id?: string | null; customer_id?: string | null; leave_at_gate?: boolean
    vendors?: { phone: string; call_phone?: string | null } | null
    customers?: { phone: string; call_phone?: string | null } | null
  } | null)
  if (current?.id) {
    const { data: lag } = await db.from('orders').select('leave_at_gate').eq('id', current.id).maybeSingle()
    current.leave_at_gate = !!(lag as { leave_at_gate?: boolean } | null)?.leave_at_gate
    const [vMap, cMap] = await Promise.all([
      callPhoneMap('vendors', [current.vendor_id], db),
      callPhoneMap('customers', [current.customer_id], db),
    ])
    if (current.vendors && current.vendor_id) current.vendors.call_phone = vMap.get(current.vendor_id) ?? null
    if (current.customers && current.customer_id) current.customers.call_phone = cMap.get(current.customer_id) ?? null
  }

  return NextResponse.json({
    rider: {
      id: rider.id,
      full_name: rider.full_name,
      status: rider.status,
      avg_rating: rider.avg_rating,
      total_deliveries: rider.total_deliveries,
      avatar_url: rider.avatar_url,
    },
    available: availableResult.data ?? [],
    current: current ?? null,
  })
}
