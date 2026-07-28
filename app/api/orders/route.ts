import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { ACCOUNT_RESTRICTION_MESSAGE } from '@/lib/account-restriction'
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
import { getMinimumOrderKobo } from '@/lib/delivery-zones'
import { estimateOrderPrepMinutes } from '@/lib/prep-time'
import { getBusyModeThrottle } from '@/lib/busy-mode'
import { captureCustomerLocation } from '@/lib/location-intelligence'
import { computeDeliveryPriceEstimate, getDeliveryPricingConfig, haversineDistanceMeters } from '@/lib/delivery-pricing'
import { sendAccountNotificationEmail, sendOrderConfirmationEmail } from '@/lib/transactional-email'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'
import { recordSecurityEvent } from '@/lib/security-events'
import { evaluateOrderCreationRisk, hashOrderDestination, hashOrderIntent, normalizeIdempotencyKey } from '@/lib/order-fraud'
import { createGuestOrderToken, guestOrderCookieName, hashGuestOrderToken } from '@/lib/guest-order-access'
import { normalizePhone } from '@/lib/phone'
import { validateMenuAddonSelection, type MenuAddonChoice } from '@/lib/menu-addon-selection'
import { normalizeGroupOrderAddons } from '@/lib/group-order-addons'

function groupCheckoutLineKey(menuItemId: string, quantity: number, addonIds: string[], notes: string | null | undefined): string {
  return `${menuItemId}|${quantity}|${addonIds.slice().sort().join(',')}|${(notes ?? '').trim()}`
}

export async function POST(req: NextRequest) {
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined
  const session = await getCurrentUser()

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

  let guestPhone: string | null = null
  if (!session) {
    if (!parsed.data.guest_phone || !parsed.data.guest_name) {
      return json({ error: 'Authentication required' }, { status: 401 })
    }
    if (parsed.data.guest_terms_accepted !== true) {
      return json({ error: 'Please accept the Terms and Privacy Policy to continue as a guest.' }, { status: 400 })
    }
    try {
      guestPhone = normalizePhone(parsed.data.guest_phone)
    } catch {
      return json({ error: 'Enter a valid phone number for WhatsApp updates.' }, { status: 400 })
    }
  }

  if (session && session.role !== 'customer') {
    await recordSecurityEvent({
      eventType: 'authz_deny', severity: 'warn', surface: 'order_creation',
      actorId: session.userId ?? session.phone, actorRole: session.role, sessionId: session.sessionId,
      ip, userAgent: req.headers.get('user-agent'), requestId: context.requestId,
      correlationId: context.correlationId, route: req.nextUrl.pathname, method: req.method,
      outcome: 'wrong_role', detail: { required_role: 'customer' },
    })
    return json({ error: 'Forbidden' }, { status: 403 })
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
  const actorKey = session?.userId ?? session?.phone ?? guestPhone ?? ip ?? 'guest'
  const actorRole = session?.role ?? 'guest'
  const actorSessionId = session?.sessionId
  const rl = await rateLimitGeneric(`order:create:${actorKey}`, 15, 300, true)
  if (!rl.success) {
    await recordSecurityEvent({
      eventType: 'ratelimit_hit', severity: 'warn', surface: 'order_creation',
      actorId: actorKey, actorRole, sessionId: actorSessionId,
      ip, requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, outcome: 'account_rate_limited',
      detail: { rule: 'order_account_velocity' },
    })
    return json({ error: 'Too many orders in a short time. Please wait a moment and try again.' }, { status: 429 })
  }
  if (ip) {
    // High shared-network ceiling: detects distributed fake-order traffic without
    // treating a campus NAT as one customer.
    const networkRl = await rateLimitGeneric(`order:create:network:${ip}`, 60, 300, true)
    if (!networkRl.success) {
      await recordSecurityEvent({
        eventType: 'ratelimit_hit', severity: 'warn', surface: 'order_creation',
        actorId: actorKey, actorRole, sessionId: actorSessionId,
        ip, requestId: context.requestId, correlationId: context.correlationId,
        route: req.nextUrl.pathname, method: req.method, outcome: 'network_rate_limited',
        detail: { rule: 'order_shared_network_velocity' },
      })
      return json({ error: 'Too many orders in a short time. Please wait a moment and try again.' }, { status: 429 })
    }
  }

  const { vendor_id, items, delivery_type, delivery_address, city_id, zone_id, delivery_lodge, delivery_block, delivery_room, delivery_instructions, tip_amount, payment_method, scheduled_for, delivery_latitude, delivery_longitude, group_order_id, pickup_agreement, leave_at_gate, apply_reward, campaign_id, guest_name } = parsed.data
  const isGuest = !session
  const isScheduled = !!scheduled_for
  const isPickup = delivery_type === 'PICKUP'
  const hasCoords = typeof delivery_latitude === 'number' && typeof delivery_longitude === 'number'
  const db = createSupabaseAdmin()
  const campaignQuery = campaign_id ? `?campaign=${encodeURIComponent(campaign_id)}` : ''

  if (isGuest && (isPickup || group_order_id || payment_method !== 'PAYSTACK' || apply_reward === true)) {
    return json({ error: 'Guest checkout supports delivery paid by card or transfer only.' }, { status: 400 })
  }

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
  } else if (!hasCoords && !isPickup) {
    return NextResponse.json({ error: 'Share your current location before placing a delivery order.' }, { status: 400 })
  }

  // Validate vendor
  const { data: vendor, error: vendorError } = await db
    .from('vendors')
    .select('id, shop_name, status, is_active, approval_state, subscription_paid_until, prep_time_minutes, pickup_enabled, pickup_max_concurrent, city_id, zone_id, official_latitude, official_longitude, latitude, longitude')
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
  const { data: addonRows, error: addonError } = await db
    .from('menu_item_addons')
    .select('id, menu_item_id, name, price_kobo, is_available, is_required')
    .in('menu_item_id', itemIds)
    .is('deleted_at', null)
  if (addonError) {
    return NextResponse.json({ error: 'Menu options could not be validated' }, { status: 503 })
  }
  const addonsByItem = new Map<string, MenuAddonChoice[]>()
  for (const addon of (addonRows ?? []) as MenuAddonChoice[]) {
    const current = addonsByItem.get(addon.menu_item_id) ?? []
    current.push(addon)
    addonsByItem.set(addon.menu_item_id, current)
  }

  const chosenAddons: Array<Array<{ name: string; price_kobo: number }>> = []
  for (const item of items) {
    const availableChoices = addonsByItem.get(item.menu_item_id) ?? []
    const selection = validateMenuAddonSelection(availableChoices, item.addons ?? [])
    if (selection.error) {
      return NextResponse.json({ error: selection.error }, { status: 400 })
    }
    chosenAddons.push(selection.selected.map((addon) => ({ name: addon.name, price_kobo: addon.price_kobo })))
  }

  // SERVER-SIDE price calculation — never trust client (rule #4 + #17).
  // Delivery/platform fees now come from the vendor's delivery zone. During
  // rollout, the helper can fall back to existing settings rows if the migration
  // is not present yet; there are no hardcoded fee fallbacks in this route.
  const pricingZoneId = isPickup
    ? ((vendor as { zone_id?: string | null }).zone_id ?? null)
    : zone_id ?? ((vendor as { zone_id?: string | null }).zone_id ?? null)
  const pricingConfig = await getDeliveryPricingConfig({ db, zoneId: pricingZoneId, vendorId: vendor_id })
  if (!pricingConfig) {
    return NextResponse.json({ error: 'Delivery pricing is not configured' }, { status: 503 })
  }
  if (!isPickup) {
    if (zone_id && pricingConfig.zoneId !== zone_id) {
      return NextResponse.json({ error: 'That delivery area is not available right now.' }, { status: 400 })
    }
    if (city_id && pricingConfig.cityId && city_id !== pricingConfig.cityId) {
      return NextResponse.json({ error: 'That city does not match the chosen delivery area.' }, { status: 400 })
    }
  }

  // PICKUP charges the SAME platform fee as delivery (platform_markup); delivery
  // is ₦0 and there's no rider/tip. Keeping it in platform_markup means the
  // existing earnings + payout code (platform_markup → platform, subtotal →
  // vendor) works unchanged.
  const platformMarkup: number = pricingConfig.platformMarkup
  let deliveryFee = 0
  let riderCut = 0
  let platformDeliveryCut = 0
  let deliveryDistanceMeters: number | null = null
  let activeSurchargeTotalKobo = 0
  let riderBonusTotalKobo = 0
  let deliveryPricingBreakdown: Record<string, unknown> | null = null
  if (!isPickup) {
    const vendorLat = Number((vendor as { official_latitude?: number | null; latitude?: number | null }).official_latitude ?? (vendor as { latitude?: number | null }).latitude)
    const vendorLng = Number((vendor as { official_longitude?: number | null; longitude?: number | null }).official_longitude ?? (vendor as { longitude?: number | null }).longitude)
    if (!Number.isFinite(vendorLat) || !Number.isFinite(vendorLng)) {
      return NextResponse.json({ error: 'Vendor location is not configured yet.' }, { status: 409 })
    }

    deliveryDistanceMeters = haversineDistanceMeters(
      { lat: vendorLat, lng: vendorLng },
      { lat: delivery_latitude as number, lng: delivery_longitude as number },
    )
    const estimate = computeDeliveryPriceEstimate({
      pricing: pricingConfig,
      deliveryType: delivery_type as 'BIKE' | 'DOOR',
      distanceMeters: deliveryDistanceMeters,
    })
    if (estimate.distanceMeters > estimate.maxDeliveryDistanceMeters) {
      return NextResponse.json({ error: 'Delivery distance is outside the configured service area.' }, { status: 400 })
    }
    if (estimate.distanceMeters > estimate.vendorDeliveryRadiusMeters) {
      return NextResponse.json({ error: 'This vendor does not deliver that far yet.' }, { status: 400 })
    }

    deliveryFee = estimate.deliveryFeeKobo
    riderCut = estimate.riderTotalCutKobo
    platformDeliveryCut = estimate.platformDeliveryCutKobo
    activeSurchargeTotalKobo = estimate.activeSurchargeTotalKobo
    riderBonusTotalKobo = estimate.riderDistanceBonusKobo + estimate.riderRuleBonusKobo
    deliveryPricingBreakdown = {
      distance_meters: estimate.distanceMeters,
      distance_km: estimate.distanceKm,
      segment_count: estimate.segmentCount,
      base_delivery_fee_kobo: estimate.baseDeliveryFeeKobo,
      distance_surcharge_kobo: estimate.distanceSurchargeKobo,
      active_surcharge_total_kobo: estimate.activeSurchargeTotalKobo,
      service_fee_kobo: estimate.serviceFeeKobo,
      rider_base_cut_kobo: estimate.riderBaseCutKobo,
      rider_distance_bonus_kobo: estimate.riderDistanceBonusKobo,
      rider_rule_bonus_kobo: estimate.riderRuleBonusKobo,
      active_adjustments: estimate.activeAdjustments,
    }
  }
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

  const { data: c } = session
    ? await db
      .from('customers')
      .select('id, phone, suspended_until')
      .eq('phone', session.phone)
      .single()
    : { data: null }

  // Suspended account → can't place orders. (suspended_until far in the future =
  // indefinite suspension; degrades gracefully if migration 046 hasn't run.)
  const suspendedUntil = (c as { suspended_until?: string | null } | null)?.suspended_until
  if (suspendedUntil && new Date(suspendedUntil).getTime() > Date.now()) {
    return NextResponse.json({ error: ACCOUNT_RESTRICTION_MESSAGE }, { status: 403 })
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

  const customerPhone = session?.phone ?? guestPhone!
  // Paystack validates the email's TLD — ".fud" is not a real TLD and is
  // rejected ("Invalid Email Address Passed"), which fails EVERY order. Use the
  // platform's real domain so the placeholder address always passes.
  const customerEmail = `${customerPhone.replace('+', '')}@lumexfud.com.ng`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'

  // Idempotency: a client-supplied key dedupes a double-tapped checkout. We
  // RESERVE it by inserting the order row BEFORE talking to Paystack — the
  // orders.idempotency_key UNIQUE constraint makes the second concurrent insert
  // fail, so we never open a second Paystack transaction for the same intent.
  // Absent header → random key (no cross-request dedup, but no regression).
  const suppliedIdempotencyKey = req.headers.get('idempotency-key')
  const normalizedIdempotencyKey = normalizeIdempotencyKey(suppliedIdempotencyKey)
  if (suppliedIdempotencyKey !== null && normalizedIdempotencyKey === null) {
    await recordSecurityEvent({
      eventType: 'order_idempotency_invalid', severity: 'warn', surface: 'order_creation',
      actorId: actorKey, actorRole, sessionId: actorSessionId,
      ip, requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, outcome: 'invalid_key_format',
      detail: { supplied_length: suppliedIdempotencyKey.length },
    })
    return json({ error: 'Invalid idempotency key' }, { status: 400 })
  }
  const idempotencyKey = normalizedIdempotencyKey ?? crypto.randomUUID()

  let pendingOrders30m = 0
  if (customerId) {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { count } = await db.from('orders').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId).eq('status', 'PENDING_PAYMENT').gte('created_at', since)
    pendingOrders30m = count ?? 0
  }
  const creationRisk = evaluateOrderCreationRisk({
    pendingOrders30m,
    totalItemQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
  })
  if (creationRisk.triggeredRules.length) {
    await recordSecurityEvent({
      eventType: 'order_risk_evaluated', severity: creationRisk.score >= 45 ? 'warn' : 'info',
      surface: 'order_creation', actorId: actorKey,
      actorRole, sessionId: actorSessionId, ip,
      requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, outcome: 'evaluated',
      detail: {
        score: creationRisk.score, confidence: creationRisk.confidence,
        triggered_rules: creationRisk.triggeredRules, actions: creationRisk.actions,
        pending_orders_30m: pendingOrders30m,
        total_item_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      },
    })
  }

  // Customer-wallet kill switch (also gates group-split below). The actual
  // wallet/card SPLIT is resolved AFTER any reward discount is applied — a reward
  // lowers what's left to charge — just before the payment branches.
  const customerWalletEnabled = await isCustomerWalletEnabled()

  // If this checkout finalizes a group order, link it — but ONLY if the caller is
  // that group's host and it's still open for this vendor. Validated here so a
  // client can't attach someone else's group.
  let linkedGroupId: string | null = null
  // The supported group model is organizer-paid. Participant wallet collection
  // remains explicitly deferred and cannot be activated by stale database flags.
  const groupSplitEnabled = false
  if (group_order_id) {
    if (!customerId) return NextResponse.json({ error: 'Organizer authentication is required for group checkout.' }, { status: 401 })
    const { data: gq } = await db.from('group_orders').select('id, host_customer_id, vendor_id, status, delivery_type, delivery_address').eq('id', group_order_id).maybeSingle()
    const g = gq as { id: string; host_customer_id: string; vendor_id: string; status: string; delivery_type: string; delivery_address: string | null } | null
    if (!g || g.host_customer_id !== customerId || g.vendor_id !== vendor_id || g.status !== 'AWAITING_PAYMENT') {
      return NextResponse.json({ error: 'This group checkout is stale or no longer belongs to the organizer.' }, { status: 409 })
    }
    if (g.delivery_type !== delivery_type || (g.delivery_type !== 'PICKUP' && g.delivery_address !== resolvedAddress)) {
      return NextResponse.json({ error: 'Group fulfilment or destination changed. Reopen the group and reconcile again.' }, { status: 409 })
    }
    const { data: groupLines } = await db.from('group_order_items').select('menu_item_id, quantity, notes, addons').eq('group_order_id', g.id)
    const expectedLines = (groupLines ?? []).map((record) => {
      const row = record as { menu_item_id: string; quantity: number; notes: string | null; addons: unknown }
      return groupCheckoutLineKey(row.menu_item_id, row.quantity, normalizeGroupOrderAddons(row.addons).map((addon) => addon.id), row.notes)
    }).sort()
    const submittedLines = items.map((item) => groupCheckoutLineKey(item.menu_item_id, item.quantity, item.addons ?? [], item.special_instructions ?? null)).sort()
    if (expectedLines.length !== submittedLines.length || expectedLines.some((line, index) => line !== submittedLines[index])) {
      return NextResponse.json({ error: 'Group contributions changed. Return to the group and reconcile again.' }, { status: 409 })
    }
    linkedGroupId = g.id
  }

  const orderIntentHash = hashOrderIntent({
    customerId, vendorId: vendor_id,
    items: items.map((item) => ({
      menuItemId: item.menu_item_id, quantity: item.quantity, addonIds: item.addons ?? [],
    })),
    deliveryType: delivery_type,
    destinationHash: hashOrderDestination({
      address: resolvedAddress,
      latitude: hasCoords ? delivery_latitude as number : null,
      longitude: hasCoords ? delivery_longitude as number : null,
    }),
    paymentMethod: payment_method, applyReward: apply_reward,
    groupOrderId: linkedGroupId, scheduledFor: scheduledForIso,
    subtotalKobo: subtotal, totalKobo: totalAmount,
  })

  const guestAccessToken = isGuest ? createGuestOrderToken() : null
  const orderInsert: Record<string, unknown> = {
    order_number: orderNumber,
    customer_id: customerId,
    guest_phone: guestPhone,
    guest_name: isGuest ? guest_name : null,
    guest_access_token_hash: guestAccessToken ? hashGuestOrderToken(guestAccessToken) : null,
    vendor_id,
    city_id: pricingConfig.cityId ?? (vendor as { city_id?: string | null }).city_id ?? null,
    zone_id: pricingConfig.zoneId ?? (vendor as { zone_id?: string | null }).zone_id ?? null,
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
    delivery_distance_meters: deliveryDistanceMeters,
    active_surcharge_total_kobo: activeSurchargeTotalKobo,
    rider_bonus_total_kobo: riderBonusTotalKobo,
    delivery_pricing_breakdown: deliveryPricingBreakdown,
    tip_amount: tipKobo,
    total_amount: totalAmount,
    // Placeholders — the real method/wallet split and any reward discount are
    // resolved + persisted right after the order (and its items) exist.
    payment_method: 'PAYSTACK',
    wallet_amount_kobo: 0,
    paystack_reference: orderNumber,
    idempotency_key: idempotencyKey,
    order_intent_hash: orderIntentHash,
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
      const fields = 'order_number, customer_id, order_intent_hash, paystack_authorization_url, paystack_access_code'
      const groupExisting = linkedGroupId
        ? await db.from('orders').select(fields).eq('group_order_id', linkedGroupId).maybeSingle()
        : { data: null }
      const keyExisting = groupExisting.data
        ? groupExisting
        : await db.from('orders').select(fields).eq('idempotency_key', idempotencyKey).maybeSingle()
      const existing = keyExisting.data

      // Bind the key to its owner — a client must not retrieve another
      // customer's checkout link by reusing their idempotency key.
      if (existing && existing.customer_id !== customerId) {
        await recordSecurityEvent({
          eventType: 'order_intent_mismatch', severity: 'critical', surface: 'order_creation',
          actorId: actorKey, actorRole, sessionId: actorSessionId,
          ip, requestId: context.requestId, correlationId: context.correlationId,
          route: req.nextUrl.pathname, method: req.method, outcome: 'owner_mismatch',
          detail: { rule: 'order_idempotency_owner_mismatch' },
        })
        return json({ error: 'Invalid idempotency key' }, { status: 409 })
      }
      if (existing?.order_intent_hash && existing.order_intent_hash !== orderIntentHash) {
        const mismatchRisk = evaluateOrderCreationRisk({
          pendingOrders30m, totalItemQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
          idempotencyPayloadMismatch: true,
        })
        await recordSecurityEvent({
          eventType: 'order_intent_mismatch', severity: 'critical', surface: 'order_creation',
          actorId: actorKey, actorRole, sessionId: actorSessionId,
          ip, requestId: context.requestId, correlationId: context.correlationId,
          route: req.nextUrl.pathname, method: req.method, outcome: 'payload_mismatch',
          resourceType: 'order', resourceId: existing.order_number,
          detail: { score: mismatchRisk.score, confidence: mismatchRisk.confidence, triggered_rules: mismatchRisk.triggeredRules },
        })
        return json({ error: 'Invalid idempotency key' }, { status: 409 })
      }
      if (existing?.paystack_authorization_url) {
        await recordSecurityEvent({
          eventType: 'order_idempotency_replay', severity: 'info', surface: 'order_creation',
          actorId: actorKey, actorRole, sessionId: actorSessionId,
          ip, requestId: context.requestId, correlationId: context.correlationId,
          route: req.nextUrl.pathname, method: req.method, outcome: 'safe_replay',
          resourceType: 'order', resourceId: existing.order_number,
          detail: { intent_match: existing.order_intent_hash ? true : 'legacy_unknown' },
        })
        return json({
          order_number: existing.order_number,
          authorization_url: existing.paystack_authorization_url,
          access_code: existing.paystack_access_code,
          idempotent_replay: true,
        })
      }
      // Original is still being created (auth not stored yet) — ask the client to retry.
      return json({ error: 'Order is being created, please retry' }, { status: 409 })
    }
    // Keep database diagnostics in server logs only. The customer gets a
    // recoverable message and their idempotency key can safely be retried.
    console.error('[orders] order insert failed', {
      code: orderError?.code,
      message: orderError?.message,
      details: orderError?.details,
      hint: orderError?.hint,
      requestId: context.requestId,
      correlationId: context.correlationId,
      isGuest,
      vendorId: vendor_id,
    })
    return json({ error: 'We could not start your order. Your cart is still saved; please retry.' }, { status: 500 })
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
    await db.from('orders')
      .update({ reward_discount_kobo: rewardApplied, reward_credit_id: rewardCreditId })
      .eq('id', order.id)
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

    if (hasCoords) {
      void captureCustomerLocation(db, {
        customerId,
        label: (delivery_lodge && delivery_lodge.trim()) || delivery_address,
        deliveryNote: delivery_instructions?.trim() || null,
        latitude: delivery_latitude as number,
        longitude: delivery_longitude as number,
        cityId: pricingConfig.cityId ?? (vendor as { city_id?: string | null }).city_id ?? null,
        zoneId: pricingConfig.zoneId ?? (vendor as { zone_id?: string | null }).zone_id ?? null,
      }).catch(() => {})
    }
  }

  // Stamp the structured address parts for rider-side display (block/room chips).
  // Separate NON-fatal update (never in the main insert) so an order can't fail
  // if migration 080 hasn't run — missing columns just make this a no-op.
  if (!isPickup && (delivery_lodge || delivery_block || delivery_room)) {
    await db.from('orders')
      .update({
        delivery_lodge: delivery_lodge?.trim() || null,
        delivery_block: delivery_block?.trim() || null,
        delivery_room:  delivery_room?.trim()  || null,
      })
      .eq('id', order.id)
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
    const { data: goItemsRaw } = await db.from('group_order_items').select('contributor_id, menu_item_id, quantity, addons').eq('group_order_id', linkedGroupId)
    const goItems = (goItemsRaw ?? []) as Array<{ contributor_id: string; menu_item_id: string; quantity: number; addons?: Array<{ price_kobo?: number }> | null }>
    const giIds = Array.from(new Set(goItems.map((r) => r.menu_item_id)))
    const { data: giMenu } = await db.from('menu_items').select('id, price_kobo').in('id', giIds)
    const priceMap = new Map((giMenu ?? []).map((m) => [(m as { id: string }).id, Number((m as { price_kobo: number }).price_kobo)]))
    const foodBy = new Map<string, number>()
    for (const r of goItems) {
      const addonKobo = (Array.isArray(r.addons) ? r.addons : []).reduce((sum, addon) => sum + (Number(addon.price_kobo) || 0), 0)
      foodBy.set(r.contributor_id, (foodBy.get(r.contributor_id) ?? 0) + ((priceMap.get(r.menu_item_id) ?? 0) + addonKobo) * r.quantity)
    }
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
    const { data: paidOrder } = await db.from('orders').update({
      payment_method: 'WALLET',
      wallet_amount_kobo: totalAmount,
      payment_status: 'PAID',
      status: isScheduled ? 'SCHEDULED' : 'PENDING',
      ...(isScheduled ? {} : { pending_since: now, placed_at: now, order_state: 'placed' }),
      updated_at: now,
    }).eq('id', order.id).eq('payment_status', 'PENDING').select('id').maybeSingle()

    if (paidOrder) await sendOrderConfirmationEmail(db, { orderId: order.id })

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
    const { data: paidOrder } = await db
      .from('orders')
      .update(
        isScheduled
          ? { payment_status: 'PAID', status: 'SCHEDULED', updated_at: now }
          : { payment_status: 'PAID', status: 'PENDING', pending_since: now, placed_at: now, order_state: 'placed', updated_at: now },
      )
      .eq('id', order.id)
      .eq('payment_status', 'PENDING')
      .select('id')
      .maybeSingle()

    if (paidOrder) await sendOrderConfirmationEmail(db, { orderId: order.id })

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
      // Guest access is kept in an HttpOnly, order-scoped browser cookie below.
      // Keeping it out of the callback URL prevents referrer/history leakage.
      callback_url: `${appUrl}/order/${orderNumber}${campaignQuery}`,
      metadata: {
        order_number: orderNumber,
        customer_phone: customerPhone,
        vendor_id,
        campaign_id: campaign_id ?? undefined,
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

  const response = json({
    order_number: orderNumber,
    authorization_url: paystackResult.authorization_url,
    access_code: paystackResult.access_code,
  })
  if (guestAccessToken) {
    response.cookies.set({
      name: guestOrderCookieName(orderNumber),
      value: guestAccessToken,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  }
  return response
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
    .select('phone, whatsapp_number, shop_name')
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
    to: (vendor.whatsapp_number ?? vendor.phone) as string,
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
  void sendAccountNotificationEmail(db, {
    role: 'vendor',
    accountId: vendorId,
    eventKey: `vendor-order-pending:${orderId}`,
    title: `New order ${orderNumber}`,
    body: `${itemsSummary || 'A new customer order'} is ready for your kitchen.`,
    actionLabel: 'Open orders',
    actionUrl: `${appUrl}/vendor-dashboard/orders`,
  }).catch(() => {})
}
