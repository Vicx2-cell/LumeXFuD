import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, vendor_id, status, customer_id')
    .eq('id', id)
    .eq('customer_id', customer.id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!['COMPLETED', 'CANCELLED'].includes(order.status as string)) {
    return NextResponse.json({ error: 'Can only reorder completed or cancelled orders' }, { status: 400 })
  }

  // Check vendor is still active
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, status, is_active')
    .eq('id', order.vendor_id as string)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single()

  if (!vendor) {
    return NextResponse.json({ error: 'This vendor is no longer available', vendor_closed: true }, { status: 200 })
  }

  if (vendor.status === 'CLOSED') {
    return NextResponse.json({ error: 'Vendor is currently closed', vendor_closed: true }, { status: 200 })
  }

  // Get original items
  const { data: items } = await db
    .from('order_items')
    .select('menu_item_id, name, quantity, notes')
    .eq('order_id', id)

  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'No items found in original order' }, { status: 404 })
  }

  // Check which items are still available
  const itemIds = items.filter((i: { menu_item_id: string | null }) => i.menu_item_id).map((i: { menu_item_id: string | null }) => i.menu_item_id as string)
  const { data: currentMenuItems } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available, daily_limit, sold_today')
    .in('id', itemIds)
    .eq('vendor_id', order.vendor_id as string)
    .is('deleted_at', null)

  const availableItemMap = new Map(
    (currentMenuItems ?? [])
      .filter((m: { is_available: boolean; daily_limit: number | null; sold_today: number }) => m.is_available && (m.daily_limit === null || m.sold_today < m.daily_limit))
      .map((m: { id: string; name: string; price_kobo: number; is_available: boolean; daily_limit: number | null; sold_today: number }) => [m.id, m])
  )

  const cartItems = items
    .filter((i: { menu_item_id: string | null; name: string; quantity: number; notes: string | null }) => i.menu_item_id && availableItemMap.has(i.menu_item_id))
    .map((i: { menu_item_id: string | null; name: string; quantity: number; notes: string | null }) => {
      const m = availableItemMap.get(i.menu_item_id!)!
      return {
        id: m.id,
        name: m.name,
        price_kobo: m.price_kobo,
        quantity: i.quantity,
        special_instructions: i.notes ?? undefined,
      }
    })

  const skipped = items.filter((i: { menu_item_id: string | null; name: string }) => !i.menu_item_id || !availableItemMap.has(i.menu_item_id as string)).map((i: { name: string }) => i.name)

  return NextResponse.json({
    vendor_id: order.vendor_id,
    vendor_name: vendor.shop_name,
    items: cartItems,
    skipped_items: skipped,
  })
}
