import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { handoverCodeInput } from '@/lib/validators'
import { completeOrderPayout } from '@/lib/order-payout'
import { recordOrderCompletedEarnings } from '@/lib/platform-earnings'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { getFeature } from '@/lib/features'
import { verifyHandoverCode, recordWrongHandoverAttempt, HANDOVER_ATTEMPT_LIMIT } from '@/lib/handover-code'
import { recordConsent, CONSENT_ACTIONS } from '@/lib/consent'
import { recordSecurityEvent } from '@/lib/security-events'

// POST /api/orders/[id]/collect
// The vendor hands a pickup (order ahead) order to the customer by entering the
// customer's 6-char handover code. This is the ONLY trigger that moves the money:
// it completes the order and releases the held funds to the vendor (food → held
// balance) while the platform keeps its pickup fee. No valid code → no release
// (Invariant I2). The code is compared to a stored HASH in constant time and the
// raw code is never read from the DB (Invariant I3).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Flag gate (server side): pickup off → endpoint unreachable.
  if (!(await getFeature('pickup_v1'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  // Throttle code entry — caps brute-forcing the code (Upstash, atomic).
  const rl = await rateLimitGeneric(`handover-collect:${id}`, 6, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many tries. Wait a moment and try again.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const parsed = handoverCodeInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Enter the customer’s 6-character pickup code.' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, delivery_type, vendor_id, customer_id, guest_phone, handover_code_hash, handover_code_locked, payment_status, subtotal, platform_markup')
    .eq('id', id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership (BOLA): a vendor can only collect their own orders (Invariant I5 —
  // presence of the code is not enough; the assigned, authenticated fulfiller is
  // required).
  if (session.role === 'vendor' && session.userId !== order.vendor_id) {
    return NextResponse.json({ error: 'Not your order' }, { status: 403 })
  }
  if (order.delivery_type !== 'PICKUP') {
    return NextResponse.json({ error: 'This isn’t a pickup order.' }, { status: 400 })
  }
  if (order.status !== 'READY') {
    return NextResponse.json({ error: 'This order isn’t ready for collection yet.' }, { status: 400 })
  }
  if (order.payment_status !== 'PAID') {
    return NextResponse.json({ error: 'This order isn’t paid.' }, { status: 400 })
  }
  if (order.handover_code_locked) {
    return NextResponse.json(
      { error: 'Too many wrong codes. Ask the customer to tap “Refresh code” and read you the new one.', locked: true },
      { status: 423 },
    )
  }

  // Constant-time verify against the stored hash. A wrong code increments the
  // per-order counter and locks the order at the cap (force-refresh).
  if (!verifyHandoverCode(parsed.data.code, order.handover_code_hash as string | null)) {
    const { locked } = await recordWrongHandoverAttempt(db, id, HANDOVER_ATTEMPT_LIMIT)
    await audit({
      actor_id: session.phone, actor_role: session.role,
      action: 'handover_code_wrong', target_table: 'orders', target_id: id,
      new_value: { kind: 'pickup', locked },
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return NextResponse.json(
      locked
        ? { error: 'Too many wrong codes. Ask the customer to refresh their code.', locked: true }
        : { error: 'That code doesn’t match. Check it with the customer.' },
      { status: locked ? 423 : 400 },
    )
  }

  // Optimistic claim READY → COMPLETED so the payout runs exactly once even if the
  // button is double-tapped or races the no-show sweep (Invariant I1).
  const now = new Date().toISOString()
  const { data: claimed } = await db
    .from('orders')
    .update({ status: 'COMPLETED', order_state: 'delivered', completed_at: now, collected_at: now, handover_method: 'CODE', handover_code_hash: null, updated_at: now })
    .eq('id', id)
    .eq('status', 'READY')
    .select('id')
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'Order was already updated.' }, { status: 409 })
  }

  // Record the vendor's binding handover consent (Invariant I8).
  void recordConsent({
    actorId: order.vendor_id as string, role: 'vendor',
    action: CONSENT_ACTIONS.VENDOR_HANDOVER, orderId: id,
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  })

  // Release the money: vendor gets the food (held), platform keeps the pickup fee.
  // No rider on a pickup order. completeOrderPayout is idempotent (wallet_released).
  void recordOrderCompletedEarnings({
    order_id: id, platform_markup_kobo: (order.platform_markup as number) ?? 0,
    delivery_cut_kobo: 0, order_number: order.order_number as string,
  })
  await completeOrderPayout({
    id, order_number: order.order_number as string,
    vendor_id: (order.vendor_id as string | null) ?? null, rider_id: null,
    subtotal: (order.subtotal as number) ?? 0, rider_delivery_cut: 0, tip_amount: 0,
  })

  // Let the customer know it's collected (no code in the message — Invariant I3).
  let customerPhone: string | null = (order.guest_phone as string | null) ?? null
  if (!customerPhone && order.customer_id) {
    const { data: c } = await db.from('customers').select('phone').eq('id', order.customer_id).maybeSingle()
    customerPhone = (c as { phone?: string } | null)?.phone ?? null
  }
  if (customerPhone) {
    void sendWhatsAppWithFallback({
      to: customerPhone,
      message: `✅ Order #${order.order_number} collected — enjoy your meal! Thanks for ordering with LumeX Fud. 🧡`,
    }).catch(() => {})
  }

  await audit({
    actor_id: session.phone, actor_role: session.role,
    action: 'pickup_collected', target_table: 'orders', target_id: id,
    new_value: { status: 'COMPLETED', via: 'handover_code' },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  void recordSecurityEvent({
    eventType: 'order_handover_completed',
    severity: 'info',
    surface: 'orders.collect',
    actorId: session.userId ?? null,
    actorRole: session.role,
    sessionId: session.sessionId,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
    detail: {
      order_id: id,
      order_number: order.order_number,
      vendor_id: order.vendor_id,
      rider_id: null,
      from_status: 'READY',
      to_status: 'COMPLETED',
      status_changed_at: now,
      delivery_type: order.delivery_type,
      handover_method: 'CODE',
    },
  })

  return NextResponse.json({ success: true, status: 'COMPLETED' })
}
