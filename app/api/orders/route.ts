import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { createOrderInput } from '@/lib/validators'
import { generateOrderNumber } from '@/lib/order-number'
import { initializePaystackTransaction } from '@/lib/paystack/init'
import { rateLimitGeneric } from '@/lib/rate-limit'

// Allowed delivery types from settings
const DELIVERY_FEES: Record<string, number> = {
  BIKE: 50000, // ₦500 in kobo — overridden from settings table
  DOOR: 100000, // ₦1,000 in kobo
}

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit: each order create spins up a Paystack transaction — cap bursts
  // per user (15 / 5 min) to stop checkout spam. No-ops if Upstash is unset.
  const rl = await rateLimitGeneric(`order:create:${session.userId ?? session.phone}`, 15, 300)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many orders in a short time. Please wait a moment and try again.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
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

  // ── Add-ons: validate each belongs to its item + is available, price from DB ──
  // (never trust client add-on prices — rule #4). chosenAddons is parallel to items.
  const allAddonIds = Array.from(new Set(items.flatMap((i) => i.addons ?? [])))
  const addonMap = new Map<string, { id: string; menu_item_id: string; name: string; price_kobo: number; is_available: boolean }>()
  if (allAddonIds.length > 0) {
    const { data: addonRows } = await db
      .from('menu_item_addons')
      .select('id, menu_item_id, name, price_kobo, is_available')
      .in('id', allAddonIds)
      .is('deleted_at', null)
    for (const a of (addonRows ?? []) as Array<{ id: string; menu_item_id: string; name: string; price_kobo: number; is_available: boolean }>) {
      addonMap.set(a.id, a)
    }
  }

  const chosenAddons: Array<Array<{ name: string; price_kobo: number }>> = []
  for (const item of items) {
    const picked: Array<{ name: string; price_kobo: number }> = []
    for (const addonId of item.addons ?? []) {
      const a = addonMap.get(addonId)
      if (!a || a.menu_item_id !== item.menu_item_id || !a.is_available) {
        return NextResponse.json({ error: 'One or more add-ons are invalid or unavailable' }, { status: 400 })
      }
      picked.push({ name: a.name, price_kobo: a.price_kobo })
    }
    chosenAddons.push(picked)
  }

  // SERVER-SIDE price calculation — never trust client (rule #4 + #17).
  // Pricing lives in the settings table as id-keyed JSONB rows seeded in 010,
  // each money row shaped {"amount_kobo": N}. The hardcoded numbers below are
  // defensive fallbacks only — the DB rows are the source of truth.
  const PRICING_IDS = [
    'platform_markup', 'delivery_fee_bike', 'delivery_fee_door',
    'rider_delivery_cut_bike', 'rider_delivery_cut_door', 'min_order_amount',
  ]
  const { data: settingsRows } = await db
    .from('settings')
    .select('id, value')
    .in('id', PRICING_IDS)

  const priceMap = new Map<string, number>()
  for (const row of (settingsRows ?? []) as Array<{ id: string; value: { amount_kobo?: number } }>) {
    priceMap.set(row.id, Number(row.value?.amount_kobo))
  }
  const kobo = (id: string, fallback: number): number => {
    const v = priceMap.get(id)
    return v !== undefined && Number.isFinite(v) ? v : fallback
  }

  const platformMarkup: number = kobo('platform_markup', 25000) // ₦250 in kobo
  const bikeFee: number = kobo('delivery_fee_bike', DELIVERY_FEES.BIKE)
  const doorFee: number = kobo('delivery_fee_door', DELIVERY_FEES.DOOR)
  const deliveryFee: number = delivery_type === 'BIKE' ? bikeFee : doorFee
  const riderCut: number = delivery_type === 'BIKE'
    ? kobo('rider_delivery_cut_bike', 40000)
    : kobo('rider_delivery_cut_door', 80000)
  const platformDeliveryCut: number = deliveryFee - riderCut
  const tipKobo: number = Math.max(0, Math.min(tip_amount ?? 0, 50000))

  let subtotal = 0
  items.forEach((item, idx) => {
    const menuItem = itemMap.get(item.menu_item_id)!
    const addonKobo = chosenAddons[idx].reduce((s, a) => s + a.price_kobo, 0)
    subtotal += (menuItem.price_kobo + addonKobo) * item.quantity
  })

  const minimumOrder = kobo('min_order_amount', 50000) // ₦500
  if (subtotal < minimumOrder) {
    return NextResponse.json(
      { error: `Minimum order is ₦${minimumOrder / 100}` },
      { status: 400 }
    )
  }

  const totalAmount = subtotal + platformMarkup + deliveryFee + tipKobo

  // Generate order number
  const orderNumber = await generateOrderNumber()

  const { data: c } = await db
    .from('customers')
    .select('id, phone')
    .eq('phone', session.phone)
    .single()

  const customerId: string | null = c?.id ?? null
  const customerPhone = session.phone
  const customerEmail = `${session.phone.replace('+', '')}@lumex.fud`

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
  const orderItems = items.map((item, idx) => {
    const menuItem = itemMap.get(item.menu_item_id)!
    const picked = chosenAddons[idx]
    const addonKobo = picked.reduce((s, a) => s + a.price_kobo, 0)
    return {
      order_id: order.id,
      menu_item_id: item.menu_item_id,
      name: menuItem.name,
      price: menuItem.price_kobo,            // base unit price snapshot
      quantity: item.quantity,
      subtotal: (menuItem.price_kobo + addonKobo) * item.quantity,
      notes: item.special_instructions ?? null,
      addons: picked,                        // [{name, price_kobo}] snapshot
    }
  })

  await db.from('order_items').insert(orderItems)

  return NextResponse.json({
    order_number: orderNumber,
    authorization_url: paystackResult.authorization_url,
    access_code: paystackResult.access_code,
  })
}
