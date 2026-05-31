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
  const { data: disputes } = await db
    .from('orders')
    .select(`
      id, order_number, total_amount, delivery_address,
      created_at, delivered_at, customer_id, vendor_id,
      vendors ( shop_name ),
      customers ( name, phone )
    `)
    .eq('status', 'DISPUTED')
    .order('delivered_at', { ascending: true })

  return NextResponse.json({ disputes: disputes ?? [] })
}
