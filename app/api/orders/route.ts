import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { createOrderInput } from '@/lib/validators'
import { generateOrderNumber } from '@/lib/order-number'
import { initializePaystackTransaction } from '@/lib/paystack/init'
import { spendCustomerWallet } from '@/lib/customer-wallet'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'
import { getControls, withinHours } from '@/lib/controls'

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

  // Feature flag: ordering can be paused platform-wide by a super admin.
  if (!(await getFeature('ordering'))) {
    return NextResponse.json({ error: 'Ordering is temporarily paused. Please check back soon.' }, { status: 503 })
  }

  // Emergency controls: maintenance mode + (optional) opening-hours enforcement.
  const controls = await getControls()
  if (controls.maintenance_enabled) {
    return NextResponse.json({ error: controls.maintenance_message }, { status: 503 })
  }
  if (!withinHours(controls)) {
    return NextResponse.json({ error: `LumeX is open ${controls.hours_open}–${controls.hours_close}. Please order during opening hours.` }, { status: 503 })
  }

  // Rate limit: each order create spins up a Paystack transaction — cap bursts
  // per user (15 / 5 min) to stop checkout spam. No-ops if Upstash is unset.
  const rl = await rateLimitGeneric(`order:create:${session.userId ?? session.phone}`, 15, 300, true)
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

  const { vendor_id, items, delivery_type, delivery_address, delivery_instructions, tip_amount, payment_method, scheduled_for, delivery_latitude, delivery_longitude } = parsed.data
  const isScheduled = !!scheduled_for
  const hasCoords = typeof delivery_latitude === 'number' && typeof delivery_longitude === 'number'
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
  // A currently-CLOSED vendor can still take a SCHEDULED order for later.
  if (vendor.status === 'CLOSED' && !isScheduled) {
    return NextResponse.json({ error: 'Vendor is currently closed' }, { status: 400 })
  }

  // ── Scheduling validation (prepaid pre-order) ───────────────────────────────
  // scheduled_for is the desired DELIVERY time. We hand the order to the vendor at
  // scheduled_release_at = delivery − prep − buffer, so it's prepared to arrive on
  // time. Bounds: enough lead, within delivery hours, not too far ahead.
  const DELIVERY_BUFFER_MIN = 15
  const SCHEDULE_MARGIN_MIN = 20
  const SCHEDULE_MAX_DAYS = 7
  let scheduledForIso: string | null = null
  let scheduledReleaseIso: string | null = null
  if (isScheduled) {
    const when = new Date(scheduled_for!)
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: 'Invalid schedule time' }, { status: 400 })
    }
    const prep = Number(vendor.prep_time_minutes) || 25
    const requiredLeadMs = (prep + DELIVERY_BUFFER_MIN + SCHEDULE_MARGIN_MIN) * 60_000
    if (when.getTime() < Date.now() + requiredLeadMs) {
      return NextResponse.json(
        { error: `Please schedule at least ${Math.ceil(requiredLeadMs / 60_000)} minutes from now.` },
        { status: 400 },
      )
    }
    if (when.getTime() > Date.now() + SCHEDULE_MAX_DAYS * 86_400_000) {
      return NextResponse.json({ error: `You can schedule up to ${SCHEDULE_MAX_DAYS} days ahead.` }, { status: 400 })
    }
    // Delivery time must fall within platform opening hours (Africa/Lagos).
    const hm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(when)
    if (hm < controls.hours_open || hm >= controls.hours_close) {
      return NextResponse.json(
        { error: `LumeX delivers ${controls.hours_open}–${controls.hours_close}. Pick a time in that window.` },
        { status: 400 },
      )
    }
    scheduledForIso = when.toISOString()
    scheduledReleaseIso = new Date(when.getTime() - (prep + DELIVERY_BUFFER_MIN) * 60_000).toISOString()
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
    .select('id, phone, suspended_until, suspend_reason')
    .eq('phone', session.phone)
    .single()

  // Suspended account → can't place orders. (suspended_until far in the future =
  // indefinite suspension; degrades gracefully if migration 046 hasn't run.)
  const suspendedUntil = (c as { suspended_until?: string | null } | null)?.suspended_until
  if (suspendedUntil && new Date(suspendedUntil).getTime() > Date.now()) {
    const reason = (c as { suspend_reason?: string | null } | null)?.suspend_reason
    return NextResponse.json(
      { error: reason ? `Your account is suspended: ${reason}` : 'Your account is suspended. Contact support.' },
      { status: 403 },
    )
  }

  const customerId: string | null = c?.id ?? null
  const customerPhone = session.phone
  // Paystack validates the email's TLD — ".fud" is not a real TLD and is
  // rejected ("Invalid Email Address Passed"), which fails EVERY order. Use the
  // platform's real domain so the placeholder address always passes.
  const customerEmail = `${session.phone.replace('+', '')}@lumexfud.com.ng`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'

  // Idempotency: a client-supplied key dedupes a double-tapped checkout. We
  // RESERVE it by inserting the order row BEFORE talking to Paystack — the
  // orders.idempotency_key UNIQUE constraint makes the second concurrent insert
  // fail, so we never open a second Paystack transaction for the same intent.
  // Absent header → random key (no cross-request dedup, but no regression).
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || crypto.randomUUID()

  // ── Resolve the payment split SERVER-SIDE ───────────────────────────────────
  // Never trust a client-supplied wallet amount (rule #4/#19): we read the live
  // wallet balance and decide how much it covers ourselves.
  //   walletApply === total → WALLET (paid here, no Paystack)
  //   0 < walletApply < total → SPLIT (wallet debited in the webhook, card pays rest)
  //   walletApply === 0       → PAYSTACK (card pays everything)
  let walletApply = 0
  let resolvedMethod: 'PAYSTACK' | 'WALLET' | 'SPLIT' = 'PAYSTACK'
  if ((payment_method === 'WALLET' || payment_method === 'SPLIT') && customerId) {
    const { data: cwRow } = await db
      .from('customer_wallets')
      .select('balance_kobo, is_frozen')
      .eq('customer_id', customerId)
      .maybeSingle()
    const cw = cwRow as { balance_kobo: number; is_frozen: boolean } | null
    const bal = cw && !cw.is_frozen ? Number(cw.balance_kobo) : 0
    walletApply = Math.max(0, Math.min(bal, totalAmount))
    if (walletApply >= totalAmount) { walletApply = totalAmount; resolvedMethod = 'WALLET' }
    else if (walletApply > 0) { resolvedMethod = 'SPLIT' }
    else { resolvedMethod = 'PAYSTACK' }
  }
  const paystackAmount = totalAmount - walletApply

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
      payment_method: resolvedMethod,
      wallet_amount_kobo: walletApply,
      paystack_reference: orderNumber,
      idempotency_key: idempotencyKey,
      payment_status: 'PENDING',
      rider_payment_status: 'PENDING',
      scheduled_for: scheduledForIso,
      scheduled_release_at: scheduledReleaseIso,
    })
    .select('id')
    .single()

  if (orderError || !order) {
    // 23505 = unique_violation on idempotency_key → this is a duplicate submit.
    // Return the original order's stored Paystack authorization instead of
    // creating a second order/charge.
    if (orderError?.code === '23505') {
      const { data: existing } = await db
        .from('orders')
        .select('order_number, customer_id, paystack_authorization_url, paystack_access_code')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()

      // Bind the key to its owner — a client must not retrieve another
      // customer's checkout link by reusing their idempotency key.
      if (existing && existing.customer_id !== customerId) {
        return NextResponse.json({ error: 'Invalid idempotency key' }, { status: 409 })
      }
      if (existing?.paystack_authorization_url) {
        return NextResponse.json({
          order_number: existing.order_number,
          authorization_url: existing.paystack_authorization_url,
          access_code: existing.paystack_access_code,
          idempotent_replay: true,
        })
      }
      // Original is still being created (auth not stored yet) — ask the client to retry.
      return NextResponse.json({ error: 'Order is being created, please retry' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }

  // Insert order items with price SNAPSHOTS — every payment path needs these,
  // so do it before branching (and roll them back with the order on failure).
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

  // Remember this lodge so the cart can pre-fill it next time (fire-and-forget;
  // no-ops if migration 050 hasn't run). The system "gets used to" where the
  // customer orders by bumping a per-address use count, and pins it if the
  // student shared GPS (migration 052).
  if (customerId) {
    db.rpc('remember_customer_address', {
      p_customer_id: customerId,
      p_address: delivery_address,
      ...(hasCoords ? { p_lat: delivery_latitude, p_lng: delivery_longitude } : {}),
    }).then(() => {}, () => {})
  }

  // Stamp the delivery GPS on the order for rider navigation. Separate, NON-fatal
  // update (never in the main insert) so an order can't fail if migration 052
  // hasn't run yet — a missing column just makes this no-op.
  if (hasCoords) {
    db.from('orders')
      .update({ delivery_latitude, delivery_longitude })
      .eq('id', order.id)
      .then(() => {}, () => {})
  }

  // ── WALLET (full): debit now, mark paid, hand the order to the vendor ───────
  // No Paystack charge and therefore no webhook will ever fire for this order,
  // so the whole payment must settle here. spend_customer_wallet is atomic and
  // idempotent per order (CWUSE-<id>).
  if (resolvedMethod === 'WALLET') {
    let spend: { success: boolean; errorMsg: string | null }
    try {
      spend = await spendCustomerWallet({
        customerId:  customerId!,
        amountKobo:  walletApply,
        orderId:     order.id,
        orderNumber,
        reference:   `CWUSE-${order.id}`,
      })
    } catch (err) {
      console.error('[orders] wallet debit RPC error:', err)
      spend = { success: false, errorMsg: 'Wallet payment failed' }
    }

    if (!spend.success) {
      // Nothing was charged — drop the reserved order + items so the customer
      // can retry or pick another method (e.g. balance changed since checkout).
      await db.from('order_items').delete().eq('order_id', order.id)
      await db.from('orders').delete().eq('id', order.id)
      return NextResponse.json({ error: spend.errorMsg ?? 'Wallet payment failed' }, { status: 400 })
    }

    // Paid in full from wallet. For a SCHEDULED order: park it as PAID + SCHEDULED
    // and DON'T notify the vendor — the release cron hands it over at the right
    // time. For an immediate order: make it visible to the vendor now (mirrors the
    // charge.success webhook), stamping pending_since for the auto-cancel clock.
    const now = new Date().toISOString()
    await db
      .from('orders')
      .update(
        isScheduled
          ? { payment_status: 'PAID', status: 'SCHEDULED', updated_at: now }
          : { payment_status: 'PAID', status: 'PENDING', pending_since: now, updated_at: now },
      )
      .eq('id', order.id)
      .eq('payment_status', 'PENDING')

    if (!isScheduled) {
      await notifyVendorNewOrder(db, order.id, vendor_id, orderNumber, totalAmount, appUrl)
    }

    return NextResponse.json({ order_number: orderNumber, payment_method: 'WALLET', paid: true, scheduled: isScheduled })
  }

  // ── PAYSTACK or SPLIT: charge the remaining amount via Paystack ─────────────
  // For SPLIT the wallet portion is debited in the charge.success webhook (a
  // single commit point), so an abandoned checkout never touches the wallet.
  let paystackResult
  try {
    paystackResult = await initializePaystackTransaction({
      email: customerEmail,
      amount: paystackAmount,
      reference: orderNumber,
      callback_url: `${appUrl}/order/${orderNumber}`,
      metadata: {
        order_number: orderNumber,
        customer_phone: customerPhone,
        vendor_id,
      },
    })
  } catch (err) {
    // No charge was created — drop the reserved order + items so the customer can retry.
    console.error('[orders] Paystack init failed, rolling back order:', err)
    await db.from('order_items').delete().eq('order_id', order.id)
    await db.from('orders').delete().eq('id', order.id)
    return NextResponse.json({ error: 'Could not start payment. Please try again.' }, { status: 502 })
  }

  // Persist the authorization so a duplicate request can replay it (above).
  await db
    .from('orders')
    .update({
      paystack_authorization_url: paystackResult.authorization_url,
      paystack_access_code: paystackResult.access_code,
    })
    .eq('id', order.id)

  return NextResponse.json({
    order_number: orderNumber,
    authorization_url: paystackResult.authorization_url,
    access_code: paystackResult.access_code,
  })
}

// Notify the vendor of a freshly-paid order. Mirrors the charge.success webhook
// path so wallet-paid orders surface in the vendor dashboard the same way.
async function notifyVendorNewOrder(
  db: ReturnType<typeof createSupabaseAdmin>,
  orderId: string,
  vendorId: string,
  orderNumber: string,
  totalAmount: number,
  appUrl: string,
): Promise<void> {
  const { data: vendor } = await db
    .from('vendors')
    .select('phone, shop_name')
    .eq('id', vendorId)
    .single()
  if (!vendor) return

  const { data: items } = await db
    .from('order_items')
    .select('name, quantity')
    .eq('order_id', orderId)

  const itemsSummary = (items ?? [])
    .map((i: { name: string; quantity: number }) => `${i.name} x${i.quantity}`)
    .join(', ')

  void sendWhatsAppWithFallback({
    to: vendor.phone as string,
    message: renderTemplate('ORDER_PENDING', {
      order_number: orderNumber,
      total: Math.round(totalAmount / 100),
      customer_first_name: 'Customer',
      items_summary: itemsSummary,
      dashboard_url: `${appUrl}/vendor-dashboard`,
    }),
  }).catch(() => {})
}
