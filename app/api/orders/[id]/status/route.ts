import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { orderStatusInput } from '@/lib/validators'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { notifyInApp } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/push'
import { recordOrderCompletedEarnings } from '@/lib/platform-earnings'
import { completeOrderPayout } from '@/lib/order-payout'
import { getPickupConfig } from '@/lib/pickup'
import { getFeature } from '@/lib/features'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { recordSecurityEvent } from '@/lib/security-events'
import { maybeApplyLateDeliveryCredit } from '@/lib/late-delivery-credit'
import { recordOrderStatusEvent, promoteVerifiedPlaceFromOrder } from '@/lib/location-intelligence'
import { finalizeOrderFeedAttribution, reverseOrderFeedAttribution } from '@/lib/feed/attribution'
import {
  MAX_READY_EXTENSION_COUNT,
  ORDER_AUTO_CANCELLED_CODE,
  ORDER_AUTO_CANCELLED_MESSAGE,
  extendPromisedReadyAt,
  orderStateForStatus,
  paidLiveAt,
  promisedReadyAt,
} from '@/lib/order-state'
import type { OrderStatus } from '@/types'

// Whitelist: [from, to, allowed roles]
const TRANSITIONS: Array<[OrderStatus, OrderStatus, string[]]> = [
  ['PENDING', 'VENDOR_ACCEPTED', ['vendor', 'admin', 'super_admin']],
  ['VENDOR_ACCEPTED', 'PREPARING', ['vendor', 'admin', 'super_admin']],
  ['PREPARING', 'READY', ['vendor', 'admin', 'super_admin']],
  ['READY', 'RIDER_ASSIGNED', ['rider', 'admin', 'super_admin']],
  ['RIDER_ASSIGNED', 'PICKED_UP', ['rider', 'admin', 'super_admin']],
  ['PICKED_UP', 'DELIVERED', ['rider', 'admin', 'super_admin']],
  // Riders can mark their own delivery complete (frees them for the next order);
  // customers can confirm; staff can force it.
  ['DELIVERED', 'COMPLETED', ['rider', 'customer', 'admin', 'super_admin']],
  ['PENDING', 'CANCELLED', ['vendor', 'admin', 'super_admin']],
  ['VENDOR_ACCEPTED', 'CANCELLED', ['vendor', 'admin', 'super_admin']],
  ['DISPUTED', 'REFUNDED', ['admin', 'super_admin']],
  ['DISPUTED', 'COMPLETED', ['admin', 'super_admin']],
]

function isTransitionAllowed(from: OrderStatus, to: OrderStatus, role: string): boolean {
  return TRANSITIONS.some(([f, t, roles]) => f === from && t === to && roles.includes(role))
}

const TIMESTAMP_FIELDS: Partial<Record<OrderStatus, string>> = {
  VENDOR_ACCEPTED: 'vendor_accepted_at',
  PREPARING: 'preparing_at',
  READY: 'ready_at',
  RIDER_ASSIGNED: 'rider_assigned_at',
  PICKED_UP: 'picked_up_at',
  DELIVERED: 'delivered_at',
  COMPLETED: 'completed_at',
  CANCELLED: 'cancelled_at',
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitGeneric(`order-status:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = orderStatusInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid status update', code: 'INVALID_STATUS', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const newStatus = parsed.data.status as OrderStatus
  const db = createSupabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, delivery_type, vendor_id, customer_id, rider_id, guest_phone, total_amount, subtotal, rider_delivery_cut, tip_amount, platform_markup, platform_delivery_cut, placed_at, pending_since, prep_time_minutes, promised_ready_at, promised_ready_extension_count, city_id, delivery_address, delivery_lodge, delivery_block, delivery_room, delivery_latitude, delivery_longitude')
    .eq('id', id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership (BOLA prevention): the transition whitelist gates by ROLE, but a
  // role alone doesn't bind the actor to THIS order — without this, any vendor
  // could accept/cancel another vendor's order, any rider could mark a stranger's
  // order PICKED_UP, and any customer could COMPLETE any DELIVERED order (early
  // rider payout). Admins/super admins are exempt (they act on all orders).
  // Riders reach RIDER_ASSIGNED via the race-safe /accept route, so by the time
  // they hit /status their rider_id is already bound to the row.
  if (session.role !== 'admin' && session.role !== 'super_admin') {
    const ownerId =
      session.role === 'vendor' ? order.vendor_id
      : session.role === 'rider' ? order.rider_id
      : order.customer_id
    if (!ownerId || ownerId !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const currentStatus = order.status as OrderStatus
  const extensionMinutes = parsed.data.extend_ready_minutes

  if (extensionMinutes !== undefined) {
    if (!['vendor', 'admin', 'super_admin'].includes(session.role)) {
      return NextResponse.json({ error: 'Only the vendor or staff can extend prep time' }, { status: 403 })
    }
    if (!['VENDOR_ACCEPTED', 'PREPARING'].includes(currentStatus)) {
      return NextResponse.json({ error: 'Prep time can only be extended before the order is ready' }, { status: 400 })
    }
    const currentPromisedRaw = order.promised_ready_at as string | null
    if (!currentPromisedRaw) {
      return NextResponse.json({ error: 'This order does not have a promised ready time yet' }, { status: 400 })
    }
    const extensionCount = Number(order.promised_ready_extension_count ?? 0)
    if (extensionCount >= MAX_READY_EXTENSION_COUNT) {
      return NextResponse.json({ error: 'Prep time has already been extended for this order' }, { status: 409 })
    }
    const currentPromised = new Date(currentPromisedRaw)
    if (Number.isNaN(currentPromised.getTime())) {
      return NextResponse.json({ error: 'Promised ready time is invalid' }, { status: 500 })
    }
    const nextPromised = extendPromisedReadyAt(
      currentPromised,
      extensionMinutes,
      paidLiveAt(order as { placed_at?: string | null; pending_since?: string | null }),
    ).toISOString()
    const now = new Date().toISOString()
    const { data: extended } = await db
      .from('orders')
      .update({
        promised_ready_at: nextPromised,
        promised_ready_extended_at: now,
        promised_ready_extension_count: extensionCount + 1,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', currentStatus)
      .eq('promised_ready_extension_count', extensionCount)
      .select('id')

    if (!extended || extended.length === 0) {
      return NextResponse.json({ error: 'Order was already updated. Refresh and try again.' }, { status: 409 })
    }

    void recordSecurityEvent({
      eventType: 'order_status_transition',
      severity: 'info',
      surface: 'orders.status',
      actorId: session.userId ?? null,
      actorRole: session.role,
      sessionId: session.sessionId,
      ip: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
      detail: {
        order_id: id,
        order_number: order.order_number,
        vendor_id: order.vendor_id,
        rider_id: order.rider_id,
        action: 'promised_ready_extended',
        from_promised_ready_at: currentPromisedRaw,
        to_promised_ready_at: nextPromised,
        extension_minutes: extensionMinutes,
        extension_count: extensionCount + 1,
      },
    })

    return NextResponse.json({ success: true, promised_ready_at: nextPromised, extension_count: extensionCount + 1 })
  }

  if (!isTransitionAllowed(currentStatus, newStatus, session.role)) {
    if (session.role === 'rider' && newStatus === 'PICKED_UP' && currentStatus === 'CANCELLED') {
      return NextResponse.json(
        { error: ORDER_AUTO_CANCELLED_MESSAGE, code: ORDER_AUTO_CANCELLED_CODE },
        { status: 409 },
      )
    }
    if (session.role === 'rider' && newStatus === 'PICKED_UP') {
      const riderPickupReason =
        currentStatus === 'READY'
          ? 'This order is ready, but it has not been assigned to you yet. Accept it first.'
          : currentStatus === 'RIDER_ASSIGNED'
            ? 'This order cannot be marked as picked up yet.'
            : `This order is currently ${currentStatus}. Pickup is only allowed after assignment.`
      return NextResponse.json(
        { error: riderPickupReason, code: 'PICKUP_BLOCKED' },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error: `Transition from ${currentStatus} to ${newStatus} is not allowed for role ${session.role}`,
        code: 'STATUS_TRANSITION_BLOCKED',
      },
      { status: 400 }
    )
  }

  // Delivery handover (delivery_handover_v1): a rider may NOT mark a delivery
  // DELIVERED directly — they must enter the customer's code via /deliver, so the
  // handover is verified (Invariant I2). Staff can still force it. No-op for pickup.
  if (
    newStatus === 'DELIVERED' && order.delivery_type !== 'PICKUP' &&
    session.role === 'rider' && (await getFeature('delivery_handover_v1'))
  ) {
    return NextResponse.json(
      { error: 'Confirm delivery by entering the customer’s code (use the delivery handover).' },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()
  const timestampField = TIMESTAMP_FIELDS[newStatus]
  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: now,
  }
  const orderState = orderStateForStatus(newStatus)
  if (orderState) updateData.order_state = orderState
  if (timestampField) updateData[timestampField] = now
  if (newStatus === 'VENDOR_ACCEPTED') {
    updateData.promised_ready_at = promisedReadyAt(
      new Date(now),
      order.prep_time_minutes as number | null,
      paidLiveAt(order as { placed_at?: string | null; pending_since?: string | null }),
    ).toISOString()
  }

  // When DELIVERED: set 15-min auto-complete window
  if (newStatus === 'DELIVERED') {
    const autoComplete = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    updateData.rider_auto_release_at = autoComplete
  }

  // NOTE: the PICKUP forfeit clock is NOT started here. It runs from PAYMENT
  // (orders.pending_since), enforced server-side by settleDuePickups — so marking
  // READY does not reset or extend the customer's 1h25m window (Invariant I7).

  // When COMPLETED: mark rider payment as HELD (will be released by cron after 24h)
  if (newStatus === 'COMPLETED') {
    updateData.rider_payment_status = 'HELD'
  }

  const { data: updatedRows } = await db
    .from('orders')
    .update(updateData)
    .eq('id', id)
    .eq('status', currentStatus)
    .select('id')

  if (!updatedRows || updatedRows.length === 0) {
    const { data: latest } = await db.from('orders').select('status').eq('id', id).maybeSingle()
    if (session.role === 'rider' && newStatus === 'PICKED_UP' && latest?.status === 'CANCELLED') {
      return NextResponse.json(
        { error: ORDER_AUTO_CANCELLED_MESSAGE, code: ORDER_AUTO_CANCELLED_CODE },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Order was already updated. Refresh and try again.' }, { status: 409 })
  }

  // On completion: record platform earnings, credit the vendor + rider wallets,
  // and free the rider for their next order. This used to be done only by the
  // release-payments cron (which isn't running) — doing it here makes the flow
  // self-contained, so a rider tapping "Complete delivery" pays everyone out.
  if (newStatus === 'COMPLETED') {
    void recordOrderCompletedEarnings({
      order_id:             id,
      platform_markup_kobo: (order.platform_markup as number) ?? 0,
      delivery_cut_kobo:    (order.platform_delivery_cut as number) ?? 0,
      order_number:         order.order_number as string,
    })
    await completeOrderPayout({
      id,
      order_number:       order.order_number as string,
      vendor_id:          (order.vendor_id as string | null) ?? null,
      rider_id:           (order.rider_id as string | null) ?? null,
      subtotal:           (order.subtotal as number) ?? 0,
      rider_delivery_cut: (order.rider_delivery_cut as number) ?? 0,
      tip_amount:         (order.tip_amount as number) ?? 0,
    })
    void finalizeOrderFeedAttribution(id).catch((err) => {
      console.error('[feed-attribution] status finalize failed:', err)
    })

  }

  if (newStatus === 'CANCELLED' || newStatus === 'REFUNDED') {
    void reverseOrderFeedAttribution(
      id,
      newStatus === 'REFUNDED' ? 'refunded_order' : 'cancelled_order',
      `Order ${newStatus.toLowerCase()} via status route`,
    ).catch((err) => {
      console.error('[feed-attribution] status reverse failed:', err)
    })
  }

  // Notifications
  void sendNotificationForStatus(newStatus, order, db).catch(() => {})

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `order_status_${newStatus.toLowerCase()}`,
    target_table: 'orders',
    target_id: id,
    old_value: { status: currentStatus },
    new_value: { status: newStatus },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  void recordSecurityEvent({
    eventType: 'order_status_transition',
    severity: 'info',
    surface: 'orders.status',
    actorId: session.userId ?? null,
    actorRole: session.role,
    sessionId: session.sessionId,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
    detail: {
      order_id: id,
      order_number: order.order_number,
      vendor_id: order.vendor_id,
      rider_id: order.rider_id,
      from_status: currentStatus,
      to_status: newStatus,
      status_changed_at: now,
      delivery_type: order.delivery_type,
    },
  })

  void recordOrderStatusEvent(db, {
    orderId: id,
    actorType: session.role,
    actorId: session.userId ?? session.phone,
    status: newStatus,
    latitude: parsed.data.latitude ?? null,
    longitude: parsed.data.longitude ?? null,
    gpsAccuracy: parsed.data.gps_accuracy ?? null,
    validationStatus: parsed.data.latitude != null && parsed.data.longitude != null ? 'captured' : 'not_validated',
  }).catch(() => {})

  if (newStatus === 'COMPLETED' && order.delivery_type !== 'PICKUP') {
    void promoteVerifiedPlaceFromOrder(db, {
      orderId: id,
      orderNumber: order.order_number as string,
      deliveryAddress: order.delivery_address as string | null,
      deliveryLodge: order.delivery_lodge as string | null,
      deliveryBlock: order.delivery_block as string | null,
      deliveryRoom: order.delivery_room as string | null,
      latitude: parsed.data.latitude ?? (order.delivery_latitude as number | null),
      longitude: parsed.data.longitude ?? (order.delivery_longitude as number | null),
      cityId: order.city_id as string | null,
    }).catch(() => {})
  }

  if (newStatus === 'DELIVERED' || newStatus === 'COMPLETED') {
    void maybeApplyLateDeliveryCredit(id).catch((err) => {
      console.error('[orders.status] late delivery credit failed:', err)
    })
  }

  return NextResponse.json({ success: true, status: newStatus })
}

async function sendNotificationForStatus(
  status: OrderStatus,
  order: Record<string, unknown>,
  db: ReturnType<typeof createSupabaseAdmin>
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  const orderNumber = order.order_number as string

  const getCustomerPhone = async (): Promise<string | null> => {
    if (order.guest_phone) return order.guest_phone as string
    if (!order.customer_id) return null
    const { data } = await db.from('customers').select('phone').eq('id', order.customer_id).single()
    return (data?.phone as string) ?? null
  }

  const getVendor = async () => {
    const { data } = await db.from('vendors').select('phone, shop_name, prep_time_minutes').eq('id', order.vendor_id).single()
    return data
  }

  const getRider = async () => {
    if (!order.rider_id) return null
    const { data } = await db.from('riders').select('phone, full_name').eq('id', order.rider_id).single()
    return data
  }

  switch (status) {
    case 'READY': {
      // Only pickup orders notify the customer at READY. The message NEVER carries
      // the collection code (Invariant I3) — it tells them to open the app, where
      // the code is shown to the owner only. (Delivery orders broadcast to riders
      // elsewhere, not the customer.)
      if (order.delivery_type !== 'PICKUP') break
      const phone = await getCustomerPhone()
      const vendor = await getVendor()
      if (phone) {
        const { holdMinutes } = await getPickupConfig(db)
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('PICKUP_READY', {
            order_number: orderNumber,
            vendor_name: (vendor?.shop_name as string) ?? 'the vendor',
            window: holdMinutes,
          }),
        })
      }
      break
    }
    case 'VENDOR_ACCEPTED': {
      const phone = await getCustomerPhone()
      const vendor = await getVendor()
      if (phone && vendor) {
        const eta = new Date(Date.now() + (vendor.prep_time_minutes as number) * 60_000 + 10 * 60_000)
        const etaStr = eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('VENDOR_ACCEPTED', {
            vendor_name: vendor.shop_name as string,
            arrival_time: etaStr,
            tracking_url: `${appUrl}/order/${orderNumber}`,
          }),
        })
      }
      break
    }
    case 'RIDER_ASSIGNED': {
      const phone = await getCustomerPhone()
      const rider = await getRider()
      if (phone && rider) {
        const eta = new Date(Date.now() + 15 * 60_000)
        const etaStr = eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('RIDER_ASSIGNED', {
            rider_first_name: (rider.full_name as string).split(' ')[0],
            arrival_time: etaStr,
            tracking_url: `${appUrl}/order/${orderNumber}`,
          }),
        })
      }
      break
    }
    case 'PICKED_UP': {
      const phone = await getCustomerPhone()
      const rider = await getRider()
      if (phone && rider) {
        const eta = new Date(Date.now() + 8 * 60_000)
        const etaStr = eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('PICKED_UP', {
            rider_first_name: (rider.full_name as string).split(' ')[0],
            arrival_time: etaStr,
            rider_phone: rider.phone as string,
          }),
        })
      }
      break
    }
    case 'DELIVERED': {
      const phone = await getCustomerPhone()
      if (phone) {
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('DELIVERED', {
            confirm_url: `${appUrl}/order/${orderNumber}`,
          }),
        })
      }
      break
    }
    case 'COMPLETED': {
      const rider = await getRider()
      if (rider && order.rider_delivery_cut) {
        const amount = Math.round((order.rider_delivery_cut as number) / 100)
        await sendWhatsAppWithFallback({
          to: rider.phone as string,
          message: renderTemplate('COMPLETED', {
            amount,
            order_number: orderNumber,
            hours: 24,
          }),
        })
        if (order.rider_id) {
          const title = 'Payout on the way 💰'
          const body = `₦${amount.toLocaleString('en-NG')} for order ${orderNumber} (released after 24h).`
          await notifyInApp({ userId: order.rider_id as string, userType: 'RIDER', title, body, link: '/rider/wallet' })
          void sendPushToUser(order.rider_id as string, { title, body, url: '/rider/wallet', tag: `payout-${orderNumber}` })
        }
      }
      break
    }
    case 'CANCELLED': {
      const phone = await getCustomerPhone()
      if (phone) {
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('CANCELLED', {
            order_number: orderNumber,
            cancellation_reason: 'Your order was cancelled.',
          }),
        })
      }
      break
    }
  }

  // In-app bell + Web Push for the CUSTOMER. The WhatsApp copy above already went
  // out; this lights up the in-app notification centre and pushes when the app is
  // closed. Registered customers only (guests have no in-app inbox). READY is
  // customer-relevant only for pickup orders (delivery customers aren't pinged at
  // READY), matching the WhatsApp logic above.
  if (order.customer_id) {
    const skipReady = status === 'READY' && order.delivery_type !== 'PICKUP'
    const copy = skipReady ? null : customerCopyForStatus(status, orderNumber)
    if (copy) {
      const link = `/order/${orderNumber}`
      await notifyInApp({ userId: order.customer_id as string, userType: 'CUSTOMER', title: copy.title, body: copy.body, link })
      void sendPushToUser(order.customer_id as string, { title: copy.title, body: copy.body, url: link, tag: `order-${orderNumber}` })
    }
  }

  // Rider broadcast: a delivery order just hit READY — alert every ONLINE rider so
  // the fastest one grabs it (the difference between a 5- and a 25-minute pickup).
  if (status === 'READY' && order.delivery_type !== 'PICKUP') {
    await broadcastNewDeliveryToRiders(db, orderNumber)
  }
}

const CUSTOMER_STATUS_COPY: Partial<Record<OrderStatus, { title: string; body: (n: string) => string }>> = {
  VENDOR_ACCEPTED: { title: 'Order confirmed 🍳', body: (n) => `The vendor is preparing order ${n}.` },
  READY:           { title: 'Ready for pickup 🛍️', body: (n) => `Order ${n} is ready — open the app for your code.` },
  RIDER_ASSIGNED:  { title: 'Rider assigned 🛵', body: (n) => `A rider is heading to pick up order ${n}.` },
  PICKED_UP:       { title: 'On the way 🚀', body: (n) => `Your order ${n} is out for delivery.` },
  DELIVERED:       { title: 'Delivered ✅', body: (n) => `Tap to confirm you received order ${n}.` },
  COMPLETED:       { title: 'Order complete 🎉', body: (n) => `Enjoy! Order ${n} is complete.` },
  CANCELLED:       { title: 'Order cancelled', body: (n) => `Order ${n} was cancelled.` },
}

function customerCopyForStatus(status: OrderStatus, orderNumber: string): { title: string; body: string } | null {
  const c = CUSTOMER_STATUS_COPY[status]
  return c ? { title: c.title, body: c.body(orderNumber) } : null
}

async function broadcastNewDeliveryToRiders(
  db: ReturnType<typeof createSupabaseAdmin>,
  orderNumber: string
): Promise<void> {
  const { data: riders } = await db
    .from('riders')
    .select('id')
    .eq('status', 'ONLINE')
    .eq('is_active', true)
    .limit(50)
  if (!riders || riders.length === 0) return
  const title = 'New delivery available 🛵'
  const body = `Order ${orderNumber} is ready for pickup. Grab it fast!`
  await Promise.allSettled(
    riders.map(async (r) => {
      await notifyInApp({ userId: r.id as string, userType: 'RIDER', title, body, link: '/rider' })
      await sendPushToUser(r.id as string, { title, body, url: '/rider', tag: 'new-delivery' })
    })
  )
}
