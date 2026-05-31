import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = 30
  const offset = (page - 1) * limit

  const db = createSupabaseAdmin()
  let query = db
    .from('orders')
    .select(`
      id, order_number, status, delivery_type, total_amount,
      payment_status, created_at, vendor_id, customer_id,
      vendors ( shop_name ),
      customers ( name, phone )
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data: orders } = await query
  return NextResponse.json({ orders: orders ?? [], page })
}
