import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

const PAGE_SIZE = 20

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Customer only' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const { data: orders, count } = await db
    .from('orders')
    .select(`
      id, order_number, status, payment_status, total_amount,
      delivery_type, created_at, vendor_id,
      vendors ( shop_name, logo_url ),
      ratings ( id )
    `, { count: 'exact' })
    .eq('customer_id', customer.id)
    .neq('status', 'PENDING_PAYMENT')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  return NextResponse.json({
    orders: orders ?? [],
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / PAGE_SIZE),
  })
}
