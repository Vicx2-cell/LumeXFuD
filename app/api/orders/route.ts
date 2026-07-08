import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { createOrderInput } from '@/lib/validators'
import { generateOrderNumber } from '@/lib/order-number'
import { initializePaystackTransaction } from '@/lib/paystack/init'
import { spendCustomerWallet, isCustomerWalletEnabled } from '@/lib/customer-wallet'
import { notifyGroupOrderPlaced, notifyGroupSplitPaid } from '@/lib/group-order'
import { trackFeature } from '@/lib/usage'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { notifyInApp } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/push'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'
import { getControls, withinHours } from '@/lib/controls'
import { computePickupEta, countActivePickups } from '@/lib/pickup'
import { recordConsent, CONSENT_ACTIONS } from '@/lib/consent'
import { anyRewardFeatureOn } from '@/lib/rewards'
import { getDeliveryZonePricing, getMinimumOrderKobo } from '@/lib/delivery-zones'
import { estimateOrderPrepMinutes } from '@/lib/prep-time'
import { getBusyModeThrottle } from '@/lib/busy-mode'

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

  const { vendor_id, items, delivery_type, delivery_address, delivery_lodge, delivery_block, delivery_room, delivery_instructions, tip_amount, payment_method, scheduled_for, delivery_latitude, delivery_longitude, group_order_id, pickup_agreement, leave_at_gate, apply_reward } = parsed.data
  const isScheduled = !!scheduled_for
  const isPickup = delivery_type === 'PICKUP'
  const hasCoords = typeof delivery_latitude === 'number' && typeof delivery_longitude === 'number'
  const db = createSupabaseAdmin()

  // ── Pickup (order ahead) gates ──────────────────────────────────────────────
  // Master switch + no scheduling/group/coords for the first version (keeps the
  // pickup money path simple: pay now, cook now, collect with a code).
  if (isPickup) {
    if (!(await getFeature('pickup_v1'))) {
      return NextResponse.json({ error: 'Pickup is not available right now.' }, { status: 503 })
    }
    // Binding consent (Invariant I8): the 1h25m agreement must be explicitly
    // ticked before the Pay button — enforce it server-side too, never trust the
    // client to have shown it.
    if (pickup_agreement !== true) {
      return NextResponse.json({ error: 'Please accept the pickup terms (once ready, your order is held 1h25m then forfeited) to continue.' }, { status: 400 })
    }
    if (isScheduled) {
      return NextResponse.json({ error: 'Scheduling isn’t available for pickup yet.' }, { status: 400 })
    }
    if (group_order_id) {
      return NextResponse.json({ error: 'Group orders can’t use pickup yet.' }, { status: 400 })
    }
  } else if (!delivery_address || delivery_address.trim().length < 5) {
    // Delivery orders still need a real address (pickup synthesizes its own).
    return NextResponse.json({ error: 'A delivery address is required.' }, { status: 400 })
  }

  // Validate vendor
  const { data: vendor, error: vendorError } = await db
    .from('vendors')
    .select('id, shop_name, status, is_active, approval_state, subscription_paid_until, prep_time_minutes, pickup_enabled, pickup_max_concurrent, city_id, zone_id')
    .eq('id', vendor_id)
    .is('deleted_at', null)
    .single()

  if (vendorError || !vendor) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }
  if (!vendor.is_active) {
    return NextResponse.json({ error: 'Vendor is not active' }, { status: 400 })
  }
  if (vendor.approval_state !== 'approved') {
    return NextResponse.json({ error: 'Vendor is pending review' }, { status: 400 })
  }
  // A currently-CLOSED vendor can still take a SCHEDULED order for later.
  if (vendor.status === 'CLOSED' && !isScheduled) {
    return NextResponse.json({ error: 'Vendor is currently closed' }, { status: 400 })
  }
  // Vendor must opt in to pickup (defaults on; they can disable per migration 072).
  if (isPickup && vendor.pickup_enabled === false) {
    return NextResponse.json({ error: 'This vendor isn’t offering pickup right now.' }, { status: 400 })
  }

  // ── Scheduling validation (prepaid pre-order) ───────────────────────────────
  // scheduled_for is the time the customer picks, and with "send time" semantics
  // it is exactly when we hand the order to the vendor (scheduled_release_at ==
  // scheduled_for). The vendor then prepares + delivers from that point. Bounds:
  // a small minimum lead so it isn't effectively immediate, within opening hours,
  // and not too far ahead.
  const SCHEDULE_MIN_LEAD_MIN = 20
  const SCHEDULE_MAX_DAYS = 7
  let scheduledForIso: string | null = null
  let scheduledReleaseIso: string | null = null
  if (isScheduled) {
    const when = new Date(scheduled_for!)
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: 'Invalid schedule time' }, { status: 400 })
    }
    if (when.getTime() < Date.now() + SCHEDULE_MIN_LEAD_MIN * 60_000) {
      return NextResponse.json(
        { error: `Please schedule at least ${SCHEDULE_MIN_LEAD_MIN} minutes from now.` },
        { status: 400 },
      )
    }
    if (when.getTime() > Date.now() + SCHEDULE_MAX_DAYS * 86_400_000) {
      return NextResponse.json({ error: `You can schedule up to ${SCHEDULE_MAX_DAYS} days ahead.` }, { status: 400 })
    }
    // Send time must fall within platform opening hours (Africa/Lagos).
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
    // Send time semantics: release to the vendor exactly at the chosen time.
    scheduledReleaseIso = when.toISOString()
  }

  // Validate all menu items belong to vendor and are available
  const itemIds = items.map((i) => i.menu_item_id)
  const { data: menuItems, error: menuError } = await db
    .from('menu_items')
    .select('id, name, price_kobo, is_available, daily_limit, sold_today, prep_time_minutes')
    .in('id', itemIds)
    .eq('vendor_id', vendor_id)
    .is('deleted_at', null)

  if (menuError || !menuItems || menuItems.length !== itemIds.length) {
    return NextResponse.json({ error: 'One or more items are invalid or do not belong to this vendor' }, { status: 400 })
  }

  const itemMap = new Map(menuItems.map((m: { id: string; name: string; price_kobo: number; is_available: boolean; daily_limit: number | null; sold_today: number; prep_time_minutes: number | null }) => [m.id, m]))
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
  // Delivery/platform fees now come from the vendor's delivery zone. During
  // rollout, the helper can fall back to existing settings rows if the migration
  // is not present yet; there are no hardcoded fee fallbacks in this route.
  const zonePricing = await getDeliveryZonePricing({ db, vendorId: vendor_id, zoneId: (vendor as { zone_id?: string | null }).zone_id ?? null })
  if (!zonePricing) {
    return NextResponse.json({ error: 'Delivery pricing is not configured' }, { status: 503 })
  }

  // PICKUP charges the SAME platform fee as delivery (platform_markup); delivery
  // is ₦0 and there's no rider/tip. Keeping it in platform_markup means the
  // existing earnings + payout code (platform_markup → platform, subtotal →
  // vendor) works unchanged.
  const platformMarkup: number = zonePricing.platformMarkup
  const bikeFee: number = zonePricing.bikeFee
  const doorFee: number = zonePricing.doorFee
  const deliveryFee: number = isPickup ? 0 : delivery_type === 'BIKE' ? bikeFee : doorFee
  const riderCut: number = isPickup
    ? 0
    : delivery_type === 'BIKE'
      ? zonePricing.riderCutBike
      : zonePricing.riderCutDoor
  const platformDeliveryCut: number = deliveryFee - riderCut
  const tipKobo: number = isPickup ? 0 : Math.max(0, Math.min(tip_amount ?? 0, 50000))

  let subtotal = 0
  items.forEach((item, idx) => {
    const menuItem = itemMap.get(item.menu_item_id)!
    const addonKobo = chosenAddons[idx].reduce((s, a) => s + a.price_kobo, 0)
    subtotal += (menuItem.price_kobo + addonKobo) * item.quantity
  })

  const minimumOrder = await getMinimumOrderKobo(db)
  if (minimumOrder === null) {
    return NextResponse.json({ error: 'Minimum order is not configured' }, { status: 503 })
  }
  if (subtotal < minimumOrder) {
    return NextResponse.json(
      { error: `Minimum order is ₦${minimumOrder / 100}` },
      { status: 400 }
    )
  }

  const totalAmount = subtotal + platformMarkup + deliveryFee + tipKobo

  const basePrepMinutes = estimateOrderPrepMinutes(
    items.map((item) => ({ prepTimeMinutes: itemMap.get(item.menu_item_id)?.prep_time_minutes ?? null })),
    (vendor.prep_time_minutes as number) ?? 25,
  )
  const busyThrottle = await getBusyModeThrottle(db, vendor_id)
  const prepMinutes = basePrepMinutes + busyThrottle.appliedBufferMinutes

  // ── Pickup specifics: synthetic address, pacing-aware ETA ───────────────────
  // The handover code is NOT created here. It is a HASHED, owner-pull secret
  // (lib/handover-code.ts) materialized to the customer via the owner-only
  // /api/orders/[id]/handover-code endpoint — never persisted in the clear.
  const resolvedAddress = isPickup ? `Pickup at ${vendor.shop_name}` : delivery_address!
  let pickupEtaIso: string | null = null
  if (isPickup) {
    const activeCount = await countActivePickups(db, vendor_id)
    const eta = computePickupEta(
      new Date(),
      prepMinutes,
      activeCount,
      (vendor.pickup_max_concurrent as number) ?? 0,
    )
    pickupEtaIso = eta.toISOString()
  }

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

  // Pickup no-show ban (repeat-abuse guard). Non-fatal read so it degrades
  // gracefully if migration 073 hasn't run (missing column → treated as not banned).
  if (isPickup && customerId) {
    const { data: pb } = await db.from('customers').select('pickup_banned').eq('id', customerId).maybeSingle()
    if ((pb as { pickup_banned?: boolean } | null)?.pickup_banned) {
      return NextResponse.json(
        { error: 'Pickup is paused on your account after repeated missed collections. You can still order delivery.' },
        { status: 403 },
      )
    }
  }

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

  // Customer-wallet kill switch (also gates group-split below). The actual
  // wallet/card SPLIT is resolved AFTER any reward discount is applied — a reward
  // lowers what's left to charge — just before the payment branches.
  const customerWalletEnabled = await isCustomerWalletEnabled()

  // If this checkout finalizes a group order, link it — but ONLY if the caller is
  // that group's host and it's still open for this vendor. Validated here so a
  // client can't attach someone else's group.
  let linkedGroupId: string | null = null
  let groupSplitEnabled = false
  if (group_order_id && customerId) {
    const { data: gq } = await db.from('group_orders').select('id, host_customer_id, vendor_id, status, split_enabled').eq('id', group_order_id).maybeSingle()
    const g = gq as { id: string; host_customer_id: string; vendor_id: string; status: string; split_enabled?: boolean } | null
    if (g && g.host_customer_id === customerId && g.vendor_id === vendor_id && g.status === 'OPEN') {
      linkedGroupId = g.id
      groupSplitEnabled = g.split_enabled !== false
    }
  }

  const orderInsert: Record<string, unknown> = {
    order_number: orderNumber,
    customer_id: customerId,
    vendor_id,
    city_id: zonePricing.cityId ?? (vendor as { city_id?: string | null }).city_id ?? null,
    zone_id: zonePricing.zoneId ?? (vendor as { zone_id?: string | null }).zone_id ?? null,
    status: 'PENDING_PAYMENT',
    order_state: null,
    delivery_type,
    delivery_address: resolvedAddress,
    delivery_instructions: delivery_instructions ?? null,
    subtotal,
    platform_markup: platformMarkup,
    delivery_fee: deliveryFee,
    platform_delivery_cut: platformDeliveryCut,
    rider_delivery_cut: riderCut,
    tip_amount: tipKobo,
    total_amount: totalAmount,
    // Placeholders — the real method/wallet split and any reward discount are
    // resolved + persisted right after the order (and its items) exist.
    payment_method: 'PAYSTACK',
    wallet_amount_kobo: 0,
    paystack_reference: orderNumber,
    idempotency_key: idempotencyKey,
    payment_status: 'PENDING',
    rider_payment_status: 'PENDING',
    prep_time_minutes: prepMinutes,
    busy_prep_buffer_minutes: busyThrottle.appliedBufferMinutes,
    scheduled_for: scheduledForIso,
    scheduled_release_at: scheduledReleaseIso,
  }
  // Pickup fields (omitted entirely for delivery orders so the insert never
  // references the new columns when migration 072 hasn't run on an old order).
  // No code here — it is issued, hashed, on owner-pull (see above).
  if (isPickup) {
    orderInsert.pickup_eta_at = pickupEtaIso
  }
  // Only include the column when actually linking, so a normal order never
  // references group_order_id and can't break if migration 065 hasn't run yet.
  if (linkedGroupId) orderInsert.group_order_id = linkedGroupId
  // Delivery leave-at-gate: code waived at the door, photo proof instead. Only
  // meaningful when the handover flag is on; ignored otherwise (flag-clean).
  if (!isPickup && leave_at_gate === true && (await getFeature('delivery_handover_v1'))) {
    orderInsert.leave_at_gate = true
  }

  const { data: order, error: orderError } = await db
    .from('orders')
    .insert(orderInsert)
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

  // ── Reward credit (promo) reservation + payment split ───────────────────────
  // A reward credit is redeemed as an ORDER-LEVEL DISCOUNT the platform absorbs:
  // capped at the platform fee + delivery (never the food or tip), so the vendor
  // and rider are still paid in full and only platform revenue is reduced. The
  // credit is reserved now and COMMITTED to a real spend by a DB trigger when the
  // order is paid (released if it never pays) — see migration 082. Skipped for
  // group orders (their split accounting is separate).
  let rewardApplied = 0
  let rewardCreditId: string | null = null
  if (!linkedGroupId && customerId && apply_reward === true && (await anyRewardFeatureOn())) {
    // Cap so EVERY order still clears a guaranteed minimum platform profit
    // (Failure Prevention Rule #1: profitable on every order, never subsidize).
    // Our margin = our markup + OUR share of the delivery fee (the rider's cut is
    // never touched). A bigger credit just spreads across future orders — each one
    // still keeps ≥ the floor. Floor is live-tunable via reward_min_profit_kobo.
    const { data: minProfitRow } = await db.from('settings').select('value').eq('id', 'reward_min_profit_kobo').maybeSingle()
    const minProfitValue = Number((minProfitRow as { value?: { amount_kobo?: number } } | null)?.value?.amount_kobo)
    const minProfit = Number.isFinite(minProfitValue) && minProfitValue >= 0 ? minProfitValue : platformMarkup
    const platformMargin = platformMarkup + platformDeliveryCut
    const cap = Math.max(0, platformMargin - minProfit)
    try {
      const { data: rsv } = await db.rpc('reserve_reward_credit', {
        p_customer: customerId,
        p_order_id: order.id,
        p_order_total: totalAmount,
        p_max_apply: cap,
      })
      const row = (rsv as Array<{ applied_kobo: number; credit_id: string | null }> | null)?.[0]
      if (row && Number(row.applied_kobo) > 0) {
        rewardApplied = Math.min(Number(row.applied_kobo), cap)
        rewardCreditId = row.credit_id
      }
    } catch {
      // Reward tables absent (migration 082 not run) or RPC error → charge full price.
    }
  }
  const netTotal = totalAmount - rewardApplied

  // Resolve the wallet/card split on the NET (post-discount) amount. Never trust
  // a client wallet amount (rule #4/#19) — we read the live balance ourselves.
  //   walletApply === net → WALLET (paid here, no Paystack)
  //   0 < walletApply < net → SPLIT (wallet debited in the webhook, card pays rest)
  //   walletApply === 0     → PAYSTACK (card pays everything)
  let walletApply = 0
  let resolvedMethod: 'PAYSTACK' | 'WALLET' | 'SPLIT' = 'PAYSTACK'
  if (customerWalletEnabled && (payment_method === 'WALLET' || payment_method === 'SPLIT') && customerId) {
    const { data: cwRow } = await db
      .from('customer_wallets')
      .select('balance_kobo, is_frozen')
      .eq('customer_id', customerId)
      .maybeSingle()
    const cw = cwRow as { balance_kobo: number; is_frozen: boolean } | null
    const bal = cw && !cw.is_frozen ? Number(cw.balance_kobo) : 0
    walletApply = Math.max(0, Math.min(bal, netTotal))
    if (walletApply >= netTotal) { walletApply = netTotal; resolvedMethod = 'WALLET' }
    else if (walletApply > 0) { resolvedMethod = 'SPLIT' }
    else { resolvedMethod = 'PAYSTACK' }
  }
  const paystackAmount = netTotal - walletApply

  // Persist the resolved net total + split (the insert stored the gross placeholder).
  // The order's total_amount is now what the customer actually pays, so the
  // Paystack webhook's amount check and vendor/rider payouts need NO changes.
  await db.from('orders')
    .update({ total_amount: netTotal, payment_method: resolvedMethod, wallet_amount_kobo: walletApply })
    .eq('id', order.id)
  // Reward columns in a SEPARATE non-fatal update so an order can't fail if
  // migration 082 hasn't run (rewardApplied is 0 in that case anyway).
  if (rewardApplied > 0) {
    db.from('orders')
      .update({ reward_discount_kobo: rewardApplied, reward_credit_id: rewardCreditId })
      .eq('id', order.id)
      .then(() => {}, () => {})
  }

  // Record the customer's binding place-order consent (Invariant I8) against the
  // current terms version. Append-only; fire-and-forget so it never blocks checkout.
  if (customerId) {
    const consentMeta = {
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    }
    if (isPickup) {
      void recordConsent({ actorId: customerId, role: 'customer', action: CONSENT_ACTIONS.PICKUP_PLACE, orderId: order.id, ...consentMeta })
    } else {
      void recordConsent({ actorId: customerId, role: 'customer', action: CONSENT_ACTIONS.DELIVERY_PLACE, orderId: order.id, ...consentMeta })
      if (orderInsert.leave_at_gate === true) {
        void recordConsent({ actorId: customerId, role: 'customer', action: CONSENT_ACTIONS.LEAVE_AT_GATE, orderId: order.id, ...consentMeta })
      }
    }
  }

  // Remember this lodge so the cart can pre-fill it next time (fire-and-forget;
  // no-ops if migration 050 hasn't run). The system "gets used to" where the
  // customer orders by bumping a per-address use count, and pins it if the
  // student shared GPS (migration 052).
  if (customerId && !isPickup) {
    // Remember the LODGE (not the full "Lodge · Block · Room" line) so the next
    // cart suggests a reusable place, not a one-off room.
    db.rpc('remember_customer_address', {
      p_customer_id: customerId,
      p_address: (delivery_lodge && delivery_lodge.trim()) || delivery_address,
      ...(hasCoords ? { p_lat: delivery_latitude, p_lng: delivery_longitude } : {}),
    }).then(() => {}, () => {})
  }

  // Stamp the structured address parts for rider-side display (block/room chips).
  // Separate NON-fatal update (never in the main insert) so an order can't fail
  // if migration 080 hasn't run — missing columns just make this a no-op.
  if (!isPickup && (delivery_lodge || delivery_block || delivery_room)) {
    db.from('orders')
      .update({
        delivery_lodge: delivery_lodge?.trim() || null,
        delivery_block: delivery_block?.trim() || null,
        delivery_room:  delivery_room?.trim()  || null,
      })
      .eq('id', order.id)
      .then(() => {}, () => {})
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

  trackFeature('ordering', 'customer') // analytics, fire-and-forget

  // ── GROUP SPLIT: each participant pays their OWN share from their wallet ─────
  // The host never fronts for anyone. Every wallet is debited its share in ONE
  // atomic call (group_order_collect): if anyone is short the whole thing rolls
  // back and the order is dropped — so checkout is impossible until everyone has
  // funded. Overrides whatever payment method the host picked at /cart.
  if (linkedGroupId && groupSplitEnabled) {
    // Group split pays each member's share from their CUSTOMER wallet, so it's a
    // pay-from-balance path — blocked when the customer wallet is disabled. Drop
    // the reserved order so the host can retry once the wallet is back (or order
    // solo via Paystack).
    if (!customerWalletEnabled) {
      await db.from('order_items').delete().eq('order_id', order.id)
      await db.from('orders').delete().eq('id', order.id)
      return NextResponse.json(
        { error: 'Wallet payment is currently unavailable. Please order individually and pay by card.', code: 'feature_disabled' },
        { status: 403 },
      )
    }
    // Per-member food (server-side prices), then split fees+tip: each pays their
    // food + an equal share of (delivery+platform); the host absorbs the rounding
    // remainder + the tip.
    const { data: goItemsRaw } = await db.from('group_order_items').select('contributor_id, menu_item_id, quantity').eq('group_order_id', linkedGroupId)
    const goItems = (goItemsRaw ?? []) as Array<{ contributor_id: string; menu_item_id: string; quantity: number }>
    const giIds = Array.from(new Set(goItems.map((r) => r.menu_item_id)))
    const { data: giMenu } = await db.from('menu_items').select('id, price_kobo').in('id', giIds)
    const priceMap = new Map((giMenu ?? []).map((m) => [(m as { id: string }).id, Number((m as { price_kobo: number }).price_kobo)]))
    const foodBy = new Map<string, number>()
    for (const r of goItems) foodBy.set(r.contributor_id, (foodBy.get(r.contributor_id) ?? 0) + (priceMap.get(r.menu_item_id) ?? 0) * r.quantity)
    // The host always participates (pays fees + tip even if they added no food).
    if (customerId && !foodBy.has(customerId)) foodBy.set(customerId, 0)

    const contribIds = Array.from(foodBy.keys())
    const n = contribIds.length || 1
    const fees = platformMarkup + deliveryFee
    const feeEach = Math.floor(fees / n)
    const hostFeePortion = fees - feeEach * (n - 1) // host covers the rounding remainder
    const shareByCid: Record<string, number> = {}
    const shares = contribIds.map((cid) => {
      const food = foodBy.get(cid) ?? 0
      const amount = cid === customerId ? food + hostFeePortion + tipKobo : food + feeEach
      shareByCid[cid] = amount
      return { customer_id: cid, amount_kobo: amount }
    })
    // Guarantee the order is EXACTLY covered (sum of shares == total) even if the
    // host tweaked quantities at /cart — any difference falls on the host.
    const sumShares = shares.reduce((s, x) => s + x.amount_kobo, 0)
    const diff = totalAmount - sumShares
    if (diff !== 0 && customerId) {
      const hostShare = shares.find((s) => s.customer_id === customerId)
      if (hostShare) { hostShare.amount_kobo += diff }
      else shares.push({ customer_id: customerId, amount_kobo: diff })
      shareByCid[customerId] = (shareByCid[customerId] ?? 0) + diff
    }

    let collectErr: string | null = null
    try {
      const { error } = await db.rpc('group_order_collect', { p_order_id: order.id, p_order_number: orderNumber, p_shares: shares })
      if (error) collectErr = error.message
    } catch (e) { collectErr = e instanceof Error ? e.message : String(e) }

    if (collectErr) {
      // Nobody charged (atomic rollback) — drop the reserved order so it can be retried once everyone funds.
      await db.from('order_items').delete().eq('order_id', order.id)
      await db.from('orders').delete().eq('id', order.id)
      const shortId = collectErr.match(/INSUFFICIENT:([0-9a-fA-F-]+)/)?.[1] ?? null
      return NextResponse.json(
        { error: 'Everyone must put their share in their LumeX wallet before checkout.', split_unfunded: true, member_id: shortId },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    await db.from('orders').update({
      payment_method: 'WALLET',
      wallet_amount_kobo: totalAmount,
      payment_status: 'PAID',
      status: isScheduled ? 'SCHEDULED' : 'PENDING',
      ...(isScheduled ? {} : { pending_since: now, placed_at: now, order_state: 'placed' }),
      updated_at: now,
    }).eq('id', order.id).eq('payment_status', 'PENDING')

    if (!isScheduled) {
      await notifyVendorNewOrder(db, order.id, vendor_id, orderNumber, netTotal, appUrl)
      await notifyGroupSplitPaid(db, { groupOrderId: linkedGroupId, orderNumber, deliveryAddress: resolvedAddress, appUrl, hostId: customerId!, shareByCid })
    }
    return NextResponse.json({ order_number: orderNumber, payment_method: 'GROUP_SPLIT', paid: true, scheduled: isScheduled })
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
          : { payment_status: 'PAID', status: 'PENDING', pending_since: now, placed_at: now, order_state: 'placed', updated_at: now },
      )
      .eq('id', order.id)
      .eq('payment_status', 'PENDING')

    if (!isScheduled) {
      await notifyVendorNewOrder(db, order.id, vendor_id, orderNumber, netTotal, appUrl)
      // Wallet orders are paid right here (no webhook), so tell the group now.
      if (linkedGroupId) {
        await notifyGroupOrderPlaced(db, { groupOrderId: linkedGroupId, orderNumber, deliveryAddress: resolvedAddress, appUrl })
      }
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

  // In-app bell + Web Push so the vendor sees the order even with the dashboard
  // closed — accept speed is the whole game (PENDING auto-cancels in 5 min).
  const title = 'New order! 🛎️'
  const body = `${itemsSummary || 'A new order'} — ₦${Math.round(totalAmount / 100).toLocaleString('en-NG')} (${orderNumber}).`
  await notifyInApp({ userId: vendorId, userType: 'VENDOR', title, body, link: '/vendor-dashboard' })
  void sendPushToUser(vendorId, { title, body, url: '/vendor-dashboard', tag: `neworder-${orderNumber}` })
}
