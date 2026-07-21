import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { buildOrderTimeline, escapeSupabaseLike, parseAdminOrderSearch, sanitizeUuidList } from '@/lib/admin-order-ops'

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const search = parseAdminOrderSearch(searchParams.get('q'))
  const detailId = searchParams.get('order_id')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '30', 10) || 30, 1), 50)
  const offset = (page - 1) * limit

  const db = createSupabaseAdmin()

  if (detailId) {
    const { data: order, error: orderError } = await db
      .from('orders')
      .select(`
        *,
        vendors ( id, shop_name, phone ),
        customers ( id, name, phone ),
        riders ( id, full_name, phone )
      `)
      .eq('id', detailId)
      .maybeSingle()

    if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const paystackReference = typeof order.paystack_reference === 'string' ? order.paystack_reference : ''
    const [
      items,
      disputes,
      refunds,
      audits,
      walletTransactions,
      customerWalletTransactions,
      webhooks,
    ] = await Promise.all([
      db.from('order_items').select('*').eq('order_id', detailId).order('created_at', { ascending: true }),
      db.from('disputes').select('*').eq('order_id', detailId).order('created_at', { ascending: true }),
      db.from('refunds').select('*').eq('order_id', detailId).order('created_at', { ascending: true }),
      db.from('audit_logs').select('*').eq('target_id', detailId).order('created_at', { ascending: true }),
      db.from('wallet_transactions').select('*').eq('order_id', detailId).order('created_at', { ascending: true }),
      db.from('customer_wallet_transactions').select('*').eq('order_id', detailId).order('created_at', { ascending: true }),
      paystackReference
        ? db.from('processed_webhooks').select('*').or(`reference.eq.${paystackReference},paystack_reference.eq.${paystackReference}`).order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ])

    const timeline = buildOrderTimeline({
      order,
      audits: (audits.data ?? []) as Array<Record<string, unknown>>,
      disputes: (disputes.data ?? []) as Array<Record<string, unknown>>,
      refunds: (refunds.data ?? []) as Array<Record<string, unknown>>,
      walletTransactions: (walletTransactions.data ?? []) as Array<Record<string, unknown>>,
      customerWalletTransactions: (customerWalletTransactions.data ?? []) as Array<Record<string, unknown>>,
      webhooks: (webhooks.data ?? []) as Array<Record<string, unknown>>,
    })

    return NextResponse.json({
      order,
      items: items.data ?? [],
      disputes: disputes.data ?? [],
      refunds: refunds.data ?? [],
      wallet_transactions: walletTransactions.data ?? [],
      customer_wallet_transactions: customerWalletTransactions.data ?? [],
      webhooks: webhooks.data ?? [],
      timeline,
    })
  }

  const searchTerm = escapeSupabaseLike(search.normalized)
  const searchDigits = escapeSupabaseLike(search.digits)
  const customerIds: string[] = []
  const vendorIds: string[] = []
  const riderIds: string[] = []

  if (search.kind !== 'empty') {
    const peopleLookups = await Promise.all([
      search.kind === 'phone'
        ? db.from('customers').select('id').ilike('phone', `%${searchDigits}%`).limit(25)
        : db.from('customers').select('id').or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`).limit(25),
      db.from('vendors').select('id').or(`shop_name.ilike.%${searchTerm}%,owner_name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`).limit(25),
      db.from('riders').select('id').or(`full_name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`).limit(25),
    ])
    customerIds.push(...sanitizeUuidList(((peopleLookups[0].data ?? []) as Array<{ id?: string }>).map((row) => row.id)))
    vendorIds.push(...sanitizeUuidList(((peopleLookups[1].data ?? []) as Array<{ id?: string }>).map((row) => row.id)))
    riderIds.push(...sanitizeUuidList(((peopleLookups[2].data ?? []) as Array<{ id?: string }>).map((row) => row.id)))
  }

  let query = db
    .from('orders')
    .select(`
      id, order_number, status, delivery_type, total_amount,
      platform_markup, platform_delivery_cut, payment_status,
      rider_payment_status, paystack_reference, created_at, updated_at,
      vendor_id, customer_id, rider_id,
      vendors ( shop_name ),
      customers ( name, phone ),
      riders ( full_name, phone )
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (search.kind !== 'empty') {
    const clauses = [
      search.kind === 'uuid' ? `id.eq.${search.normalized}` : '',
      `order_number.ilike.%${searchTerm}%`,
      `paystack_reference.ilike.%${searchTerm}%`,
      `guest_phone.ilike.%${search.kind === 'phone' ? searchDigits : searchTerm}%`,
      customerIds.length ? `customer_id.in.(${customerIds.join(',')})` : '',
      vendorIds.length ? `vendor_id.in.(${vendorIds.join(',')})` : '',
      riderIds.length ? `rider_id.in.(${riderIds.join(',')})` : '',
    ].filter(Boolean)
    query = query.or(clauses.join(','))
  }

  const { data: orders, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ orders: orders ?? [], page, limit, search: search.normalized })
}
