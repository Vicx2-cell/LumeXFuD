import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { normalizePhone } from '@/lib/phone'
import { createOrderInput } from '@/lib/validators'
import { generateOrderNumber } from '@/lib/order-number'
import { initializePaystackTransaction } from '@/lib/paystack/init'

// Allowed delivery types from settings
const DELIVERY_FEES: Record<string, number> = {
  BIKE: 50000, // ₦500 in kobo — overridden from settings table
  DOOR: 100000, // ₦1,000 in kobo
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  let guestPhone: string | null = null

  if (!session) {
    // Guest checkout — requires phone in body
    const raw = await req.json().catch(() => null)
    if (!raw || typeof raw.guest_phone !== 'string') {
      return NextResponse.json({ error: 'Authentication required or provide guest_phone' }, { status: 401 })
    }
    try {
      guestPhone = normalizePhone(raw.guest_phone as string)
    } catch {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    }
  }

  let body: Record<string, unknown>
  try {
    if (!session) {
      // already parsed above but need full body
      const raw2 = await req.text().catch(() => '{}')
      body = JSON.parse(raw2)
    } else {
      body = await req.json()
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = createOrderInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid order data', details: parsed.error.flatten() }, { status: 400 })
  }

  const { vendor_id, items, delivery_type, delivery_address, delivery_instructions, tip_amount } = parsed.data
  const db = createSupabaseAdmin()

  // Validate vendor
  const { data: vendor, error: vendorError } = await db
    .from('vendors')
    .select('id, shop_name, status, is_active, subscription_paid_until, prep_time_minutes')
    .eq('id', vendor_id)
    .is('deleted_at', null)
    .single()

  if (vendorError || !vendor) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }
  if (!vendor.is_active) {
    return NextResponse.json({ error: 'Vendor is not active' }, { status: 400 })
  }
  if (vendor.status === 'CLOSED') {
    return NextResponse.json({ error: 'Vendor is currently closed' }, { status: 400 })
  }

  // Validate all menu items belong to vendor and are available
  const itemIds = items.map((i) => i.menu_item_id)
  const { data: menuItems, error: menuError } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available, daily_limit, sold_today')
    .in('id', itemIds)
    .eq('vendor_id', vendor_id)
    .is('deleted_at', null)

  if (menuError || !menuItems || menuItems.length !== itemIds.length) {
    return NextResponse.json({ error: 'One or more items are invalid or do not belong to this vendor' }, { status: 400 })
  }

  const itemMap = new Map(menuItems.map((m: { id: string; name: string; price_kobo: number; is_available: boolean; daily_limit: number | null; sold_today: number }) => [m.id, m]))
  for (const item of items) {
    const menuItem = itemMap.get(item.menu_item_id)
    if (!menuItem) return NextResponse.json({ error: `Item ${item.menu_item_id} not found` }, { status: 400 })
    if (!menuItem.is_available) return NextResponse.json({ error: `${menuItem.name} is not available` }, { status: 400 })
    if (menuItem.daily_limit !== null && menuItem.sold_today + item.quantity > menuItem.daily_limit) {
      return NextResponse.json({ error: `${menuItem.name} has reached its daily limit` }, { status: 400 })
    }
  }

  // SERVER-SIDE price calculation — never trust client
  const { data: settings } = await db
    .from('settings')
    .select('value')
    .eq('id', 'pricing')
    .single()

  const pricing = (settings?.value as Record<string, number>) ?? {}
  const platformMarkup: number = (pricing.platform_markup ?? 25000) // ₦250 in kobo
  const bikeFee: number = pricing.bike_fee ?? DELIVERY_FEES.BIKE
  const doorFee: number = pricing.door_fee ?? DELIVERY_FEES.DOOR
  const deliveryFee: number = delivery_type === 'BIKE' ? bikeFee : doorFee
  const riderCut: number = delivery_type === 'BIKE' ? (pricing.bike_rider_cut ?? 40000) : (pricing.door_rider_cut ?? 80000)
  const platformDeliveryCut: number = deliveryFee - riderCut
  const tipKobo: number = Math.max(0, Math.min(tip_amount ?? 0, 50000))

  let subtotal = 0
  for (const item of items) {
    const menuItem = itemMap.get(item.menu_item_id)!
    subtotal += menuItem.price_kobo * item.quantity
  }

  const minimumOrder = pricing.minimum_order ?? 50000 // ₦500
  if (subtotal < minimumOrder) {
    return NextResponse.json(
      { error: `Minimum order is ₦${minimumOrder / 100}` },
      { status: 400 }
    )
  }

  const totalAmount = subtotal + platformMarkup + deliveryFee + tipKobo

  // Generate order number
  const orderNumber = await generateOrderNumber()

  // Get customer id or null for guest
  let customerId: string | null = null
  let customerEmail: string
  let customerPhone: string

  if (session) {
    customerId = (await db
      .from('customers')
      .select('id, phone')
      .eq('phone', session.phone)
      .single()
      .then((r) => r.data)) as unknown as string | null

    const { data: c } = await db
      .from('customers')
      .select('id, phone')
      .eq('phone', session.phone)
      .single()

    customerId = c?.id ?? null
    customerPhone = session.phone
    customerEmail = `${session.phone.replace('+', '')}@lumex.fud`
  } else {
    customerPhone = guestPhone!
    customerEmail = `${guestPhone!.replace('+', '')}@lumex.fud`
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  // Initialize Paystack
  const paystackResult = await initializePaystackTransaction({
    email: customerEmail,
    amount: totalAmount,
    reference: orderNumber,
    callback_url: `${appUrl}/order/${orderNumber}`,
    metadata: {
      order_number: orderNumber,
      customer_phone: customerPhone,
      vendor_id,
    },
  })

  // Insert order
  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      order_number: orderNumber,
      customer_id: customerId,
      vendor_id,
      guest_phone: guestPhone,
      status: 'PENDING_PAYMENT',
      delivery_type,
      delivery_address,
      delivery_instructions: delivery_instructions ?? null,
      subtotal,
      platform_markup: platformMarkup,
      delivery_fee: deliveryFee,
      platform_delivery_cut: platformDeliveryCut,
      rider_delivery_cut: riderCut,
      tip_amount: tipKobo,
      total_amount: totalAmount,
      paystack_reference: orderNumber,
      idempotency_key: crypto.randomUUID(),
      payment_status: 'PENDING',
      rider_payment_status: 'PENDING',
    })
    .select('id')
    .single()

  if (orderError || !order) {
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

  // Insert order items with price SNAPSHOTS
  const orderItems = items.map((item) => {
    const menuItem = itemMap.get(item.menu_item_id)!
    return {
      order_id: order.id,
      menu_item_id: item.menu_item_id,
      name: menuItem.name,
      price: menuItem.price_kobo,
      quantity: item.quantity,
      subtotal: menuItem.price_kobo * item.quantity,
      notes: item.special_instructions ?? null,
    }
  })

  await db.from('order_items').insert(orderItems)

  return NextResponse.json({
    order_number: orderNumber,
    authorization_url: paystackResult.authorization_url,
    access_code: paystackResult.access_code,
  })
}
