import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { audit } from '@/lib/audit'
import { getFeature } from '@/lib/features'
import { verifyHandoverCode, recordWrongHandoverAttempt, HANDOVER_ATTEMPT_LIMIT, isWellFormedCode } from '@/lib/handover-code'
import { recordConsent, CONSENT_ACTIONS } from '@/lib/consent'
import { recordOrderCompletedEarnings } from '@/lib/platform-earnings'
import { completeOrderPayout } from '@/lib/order-payout'
import { recordSecurityEvent } from '@/lib/security-events'
import { maybeApplyLateDeliveryCredit } from '@/lib/late-delivery-credit'
import { promoteVerifiedPlaceFromOrder } from '@/lib/location-intelligence'
import { emailCommittedOrderStatus } from '@/lib/order-status-email'
import { finalizeOrderFeedAttribution } from '@/lib/feed/attribution'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'
import { distanceMeters, evaluateLocationRisk, validCoordinates } from '@/lib/location-risk'

// POST /api/orders/[id]/deliver
// Delivery handover (delivery_handover_v1). The DEFAULT path: the ASSIGNED rider
// confirms delivery by entering the customer's 6-char code at the door. If the
// customer OPTED into leave-at-gate, the code is waived and the rider confirms the
// drop instead — a proof photo is OPTIONAL (encouraged, never required). Entering
// the code (or the explicit leave-at-gate confirm) is the SINGLE money event: it
// moves PICKED_UP → COMPLETED and releases escrow into the vendor + rider HELD
// wallets right then (exactly like pickup collect). Funds are HELD until the code
// is input — never before (Invariant I2). The existing wallet hold periods (rider
// 24h / vendor 3d) + the 24h dispute clawback still apply. The code is compared to
// a stored hash in constant time and never read in the clear (I3).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)

  if (!(await getFeature('delivery_handover_v1'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['rider', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`handover-deliver:${id}`, 6, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many tries. Wait a moment and try again.' }, { status: 429 })

  let body: { code?: unknown; leave_at_gate?: unknown; latitude?: unknown; longitude?: unknown; gps_accuracy?: unknown }
  try { body = (await req.json()) as typeof body } catch { body = {} }
  const wantsGate = body.leave_at_gate === true
  const rawCode = typeof body.code === 'string' ? body.code : ''

  const db = createSupabaseAdmin()
  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, delivery_type, vendor_id, rider_id, customer_id, guest_phone, handover_code_hash, handover_code_locked, payment_status, leave_at_gate, subtotal, rider_delivery_cut, tip_amount, platform_markup, platform_delivery_cut, city_id, delivery_address, delivery_lodge, delivery_block, delivery_room, delivery_latitude, delivery_longitude')
    .eq('id', id)
    .single()
  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership (BOLA / I5): only the assigned rider (or staff) may confirm.
  if (session.role === 'rider' && session.userId !== order.rider_id) {
    await recordSecurityEvent({
      eventType: 'stale_rider_access', severity: 'warn', surface: 'orders.deliver',
      actorId: session.userId ?? null, actorRole: session.role, sessionId: session.sessionId,
      ip: req.headers.get('x-forwarded-for'), userAgent: req.headers.get('user-agent'),
      requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, resourceType: 'order', resourceId: id,
      outcome: 'not_current_rider', detail: { assigned_rider_id: order.rider_id },
    })
    return json({ error: 'Not your delivery' }, { status: 403 })
  }
  if (order.delivery_type === 'PICKUP') {
    return NextResponse.json({ error: 'Pickup orders are collected, not delivered.' }, { status: 400 })
  }
  if (order.status !== 'PICKED_UP') {
    return NextResponse.json({ error: 'This order isn’t out for delivery yet.' }, { status: 400 })
  }
  if (order.payment_status !== 'PAID') {
    return NextResponse.json({ error: 'This order isn’t paid.' }, { status: 400 })
  }

  let method: 'CODE' | 'LEAVE_AT_GATE'

  if (order.leave_at_gate && wantsGate) {
    // Leave-at-gate: the customer opted in, so the code is waived and this explicit
    // rider confirmation IS the authorised completion (Invariant I2). A proof photo
    // is OPTIONAL — if one was uploaded via /delivery-photo it's already on the
    // order; its absence never blocks the drop.
    method = 'LEAVE_AT_GATE'
  } else {
    // Default path: verify the customer's code in constant time, attempt-capped.
    // No code → no delivery, no release (Invariant I2).
    if (order.handover_code_locked) {
      return NextResponse.json({ error: 'Too many wrong codes. Ask the customer to refresh their code.', locked: true }, { status: 423 })
    }
    if (!isWellFormedCode(rawCode)) {
      return NextResponse.json({ error: 'Enter the customer’s 6-character delivery code.' }, { status: 400 })
    }
    if (!verifyHandoverCode(rawCode, order.handover_code_hash as string | null)) {
      const { locked, assignmentCurrent } = await recordWrongHandoverAttempt(
        db, id, HANDOVER_ATTEMPT_LIMIT, session.role === 'rider' ? session.userId : undefined,
      )
      if (!assignmentCurrent) {
        await recordSecurityEvent({
          eventType: 'stale_rider_access', severity: 'warn', surface: 'orders.deliver',
          actorId: session.userId ?? null, actorRole: session.role, sessionId: session.sessionId,
          ip: req.headers.get('x-forwarded-for'), requestId: context.requestId,
          correlationId: context.correlationId, route: req.nextUrl.pathname, method: req.method,
          resourceType: 'order', resourceId: id, outcome: 'reassigned_before_wrong_code_count',
        })
        return json({ error: 'Delivery assignment changed. Refresh and try again.' }, { status: 409 })
      }
      await audit({
        actor_id: session.phone, actor_role: session.role,
        action: 'handover_code_wrong', target_table: 'orders', target_id: id,
        new_value: { kind: 'delivery', locked },
        ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      })
      return NextResponse.json(
        locked ? { error: 'Too many wrong codes. Ask the customer to refresh their code.', locked: true }
               : { error: 'That code doesn’t match. Check it with the customer.' },
        { status: locked ? 423 : 400 },
      )
    }
    method = 'CODE'
  }

  // Optimistic claim PICKED_UP → COMPLETED (race-safe) so the payout runs exactly
  // once even on a double-tap. The code (or leave-at-gate confirm) IS the release
  // trigger — no code, no completion, no money (Invariant I2).
  const now = new Date().toISOString()
  let claimQuery = db
    .from('orders')
    .update({
      status: 'COMPLETED', delivered_at: now, completed_at: now,
      order_state: 'delivered',
      rider_payment_status: 'HELD', handover_method: method,
      handover_code_hash: null, updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'PICKED_UP')
  if (session.role === 'rider') claimQuery = claimQuery.eq('rider_id', session.userId!)
  const { data: claimed } = await claimQuery.select('id')
  if (!claimed || claimed.length === 0) {
    if (session.role === 'rider') {
      await recordSecurityEvent({
        eventType: 'stale_rider_access', severity: 'warn', surface: 'orders.deliver',
        actorId: session.userId ?? null, actorRole: session.role, sessionId: session.sessionId,
        ip: req.headers.get('x-forwarded-for'), requestId: context.requestId,
        correlationId: context.correlationId, route: req.nextUrl.pathname, method: req.method,
        resourceType: 'order', resourceId: id, outcome: 'claim_lost',
        detail: { expected_status: 'PICKED_UP' },
      })
    }
    return json({ error: 'Order was already updated.' }, { status: 409 })
  }

  const hasCurrentLocation = validCoordinates(body.latitude, body.longitude)
  const hasExpectedLocation = validCoordinates(order.delivery_latitude, order.delivery_longitude)
  const currentLatitude = hasCurrentLocation ? body.latitude as number : null
  const currentLongitude = hasCurrentLocation ? body.longitude as number : null
  const gpsAccuracy = typeof body.gps_accuracy === 'number' && Number.isFinite(body.gps_accuracy) && body.gps_accuracy >= 0
    ? body.gps_accuracy : null
  const distanceFromExpected = hasCurrentLocation && hasExpectedLocation
    ? distanceMeters(
        currentLatitude!, currentLongitude!,
        Number(order.delivery_latitude), Number(order.delivery_longitude),
      )
    : null

  let previousTravelMeters: number | null = null
  let elapsedSeconds: number | null = null
  let previousAccuracyMeters: number | null = null
  if (session.role === 'rider' && hasCurrentLocation) {
    const { data: previous } = await db.from('order_status_events')
      .select('latitude, longitude, gps_accuracy, created_at')
      .eq('actor_type', 'rider').eq('actor_id', session.userId!)
      .not('latitude', 'is', null).not('longitude', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (previous && validCoordinates(previous.latitude, previous.longitude)) {
      previousTravelMeters = distanceMeters(
        Number(previous.latitude), Number(previous.longitude), currentLatitude!, currentLongitude!,
      )
      elapsedSeconds = Math.max(0, (Date.now() - new Date(previous.created_at as string).getTime()) / 1000)
      previousAccuracyMeters = Number.isFinite(Number(previous.gps_accuracy)) ? Number(previous.gps_accuracy) : null
    }
  }
  const locationRisk = evaluateLocationRisk({
    distanceFromExpectedMeters: distanceFromExpected, gpsAccuracyMeters: gpsAccuracy,
    previousTravelMeters, elapsedSeconds, previousAccuracyMeters,
  })
  if (locationRisk.triggeredRules.length) {
    await recordSecurityEvent({
      eventType: 'location_inconsistency',
      severity: locationRisk.score >= 60 ? 'warn' : 'info', surface: 'orders.deliver',
      actorId: session.userId ?? null, actorRole: session.role, sessionId: session.sessionId,
      ip: req.headers.get('x-forwarded-for'), requestId: context.requestId,
      correlationId: context.correlationId, route: req.nextUrl.pathname, method: req.method,
      resourceType: 'order', resourceId: id, outcome: 'observed_only',
      detail: {
        approximate_latitude: currentLatitude == null ? null : Math.round(currentLatitude * 1000) / 1000,
        approximate_longitude: currentLongitude == null ? null : Math.round(currentLongitude * 1000) / 1000,
        accuracy_m: gpsAccuracy, distance_from_expected_m: distanceFromExpected,
        previous_travel_m: previousTravelMeters, elapsed_seconds: elapsedSeconds,
        score: locationRisk.score, confidence: locationRisk.confidence,
        triggered_rules: locationRisk.triggeredRules, actions: locationRisk.actions,
        warning: 'Approximate location indicators do not prove identity or presence.',
      },
    })
  }

  // Rider's binding handover consent (Invariant I8).
  void recordConsent({
    actorId: order.rider_id as string, role: 'rider',
    action: method === 'LEAVE_AT_GATE' ? CONSENT_ACTIONS.RIDER_GATE_DROP : CONSENT_ACTIONS.RIDER_DELIVER,
    orderId: id,
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  })

  // Release escrow into the HELD wallets (vendor: food; rider: delivery cut + tip;
  // platform: markup + delivery cut). Idempotent via the wallet_released claim.
  void recordOrderCompletedEarnings({
    order_id: id,
    platform_markup_kobo: (order.platform_markup as number) ?? 0,
    delivery_cut_kobo: (order.platform_delivery_cut as number) ?? 0,
    order_number: order.order_number as string,
  })
  await completeOrderPayout({
    id, order_number: order.order_number as string,
    vendor_id: (order.vendor_id as string | null) ?? null,
    rider_id: (order.rider_id as string | null) ?? null,
    subtotal: (order.subtotal as number) ?? 0,
    rider_delivery_cut: (order.rider_delivery_cut as number) ?? 0,
    tip_amount: (order.tip_amount as number) ?? 0,
  })
  void finalizeOrderFeedAttribution(id).catch((err) => {
    console.error('[feed-attribution] deliver finalize failed:', err)
  })

  void maybeApplyLateDeliveryCredit(id).catch((err) => {
    console.error('[orders.deliver] late delivery credit failed:', err)
  })

  await audit({
    actor_id: session.phone, actor_role: session.role,
    action: 'delivery_confirmed', target_table: 'orders', target_id: id,
    new_value: { status: 'COMPLETED', via: method },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  // Notify the customer (no code in the message — Invariant I3).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  let phone: string | null = (order.guest_phone as string | null) ?? null
  if (!phone && order.customer_id) {
    const { data: c } = await db.from('customers').select('phone').eq('id', order.customer_id).maybeSingle()
    phone = (c as { phone?: string } | null)?.phone ?? null
  }
  if (phone) {
    void sendWhatsAppWithFallback({
      to: phone,
      message: renderTemplate('DELIVERED', { confirm_url: `${appUrl}/order/${order.order_number}` }),
    }).catch(() => {})
  }

  void recordSecurityEvent({
    eventType: 'order_handover_completed',
    severity: 'info',
    surface: 'orders.deliver',
    actorId: session.userId ?? null,
    actorRole: session.role,
    sessionId: session.sessionId,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
    requestId: context.requestId,
    correlationId: context.correlationId,
    route: req.nextUrl.pathname,
    method: req.method,
    resourceType: 'order',
    resourceId: id,
    outcome: 'completed',
    detail: {
      order_id: id,
      order_number: order.order_number,
      vendor_id: order.vendor_id,
      rider_id: order.rider_id,
      from_status: 'PICKED_UP',
      to_status: 'COMPLETED',
      status_changed_at: now,
      delivery_type: order.delivery_type,
      handover_method: method,
    },
  })

  await emailCommittedOrderStatus(db, {
    orderId: id,
    actorType: session.role,
    actorId: session.userId ?? session.phone,
    status: 'COMPLETED',
    latitude: currentLatitude,
    longitude: currentLongitude,
    gpsAccuracy,
    distanceFromExpectedMeters: distanceFromExpected,
    validationStatus: !hasCurrentLocation ? 'not_validated'
      : gpsAccuracy == null || gpsAccuracy > 250 ? 'low_accuracy'
      : locationRisk.triggeredRules.some((rule) => rule !== 'location_low_accuracy') ? 'inconsistent'
      : 'validated',
  })

  const trustedRadius = Math.max(750, (gpsAccuracy ?? 0) * 4)
  if (hasCurrentLocation && gpsAccuracy != null && gpsAccuracy <= 250 &&
      distanceFromExpected != null && distanceFromExpected <= trustedRadius) {
    void promoteVerifiedPlaceFromOrder(db, {
      orderId: id,
      orderNumber: order.order_number as string,
      deliveryAddress: order.delivery_address as string | null,
      deliveryLodge: order.delivery_lodge as string | null,
      deliveryBlock: order.delivery_block as string | null,
      deliveryRoom: order.delivery_room as string | null,
      latitude: currentLatitude,
      longitude: currentLongitude,
      cityId: order.city_id as string | null,
    }).catch(() => {})
  }

  return json({ success: true, status: 'COMPLETED', method })
}
