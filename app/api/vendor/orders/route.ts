import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  const { data: vendor, error: ve } = await db
    .from('vendors')
    .select('id, shop_name, status, paused_until, prep_time_minutes, opening_time, closing_time, logo_url, shop_photo_url')
    .eq('id', session.userId!)
    .single()

  if (ve || !vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  const { data: orders } = await db
    .from('orders')
    .select(`
      id, order_number, status, delivery_type, delivery_address,
      subtotal, total_amount, created_at, customer_id,
      order_items ( id, name, quantity, price, notes, addons )
    `)
    .eq('vendor_id', vendor.id)
    .not('status', 'in', '("COMPLETED","CANCELLED","REFUNDED")')
    .order('created_at', { ascending: false })
    .limit(30)

  const { data: recent } = await db
    .from('orders')
    .select('id, order_number, status, total_amount, created_at')
    .eq('vendor_id', vendor.id)
    .in('status', ['COMPLETED', 'CANCELLED'])
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({ vendor, orders: orders ?? [], recent: recent ?? [] })
}
