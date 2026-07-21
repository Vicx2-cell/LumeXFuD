import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { refundTransaction } from '@/lib/paystack/transfer'
import { audit } from '@/lib/audit'
import { refundInput } from '@/lib/validators'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { recordPlatformEarning } from '@/lib/platform-earnings'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { requireStepUpForAmount } from '@/lib/step-up'
import { emailCommittedOrderStatus } from '@/lib/order-status-email'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'
import { recordSecurityEvent } from '@/lib/security-events'
import { evaluateRefundRisk } from '@/lib/refund-risk'

export async function POST(req: NextRequest) {
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined
  const session = await getCurrentUser()
  if (!session || (session.role !== 'admin' && session.role !== 'super_admin')) {
    return json({ error: 'Admin only' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`refund:${session.phone}`, 20, 300, true)
  if (!rl.success) {
    await recordSecurityEvent({
      eventType: 'ratelimit_hit', severity: 'warn', surface: 'refund',
      actorId: session.userId ?? session.phone, actorRole: session.role,
      sessionId: session.sessionId, ip, userAgent: req.headers.get('user-agent'),
      requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, outcome: 'rate_limited',
      detail: { rule: 'refund_admin_velocity' },
    })
    return json({ error: 'Too many refund requests. Please slow down.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = refundInput.safeParse(body)
  if (!parsed.success) {
    return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { order_id, reason, amount } = parsed.data
  const db = createSupabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, total_amount, payment_status, paystack_reference, customer_id, guest_phone, status')
    .eq('id', order_id)
    .single()

  if (error || !order) {
    return json({ error: 'Order not found' }, { status: 404 })
  }

  // Only card-paid orders are refundable here, and only until fully refunded.
  if (order.payment_status !== 'PAID' && order.payment_status !== 'PARTIALLY_REFUNDED') {
    return json({ error: 'Order is not in a refundable state' }, { status: 400 })
  }
  if (!order.paystack_reference) {
    return json({ error: 'Order has no card payment to refund' }, { status: 400 })
  }

  // Sum refunds already issued (all but FAILED): cap at the REMAINING balance and
  // decide step-up on the CUMULATIVE amount so a split ≥₦50k still trips re-auth.
  const { data: priorRows } = await db
    .from('refunds').select('amount_kobo').eq('order_id', order.id).neq('status', 'FAILED')
  const priorRefunded = (priorRows ?? []).reduce((s, r) => s + Number(r.amount_kobo), 0)
  const remaining = (order.total_amount as number) - priorRefunded

  const refundAmount = amount ?? remaining
  if (refundAmount <= 0 || refundAmount > remaining) {
    return json({ error: 'Refund exceeds remaining refundable amount' }, { status: 400 })
  }

  // Rule #28: re-auth once the CUMULATIVE refund on this order reaches ₦50,000.
  const reauthPin = (body as Record<string, unknown> | null)?.reauth_pin
  const stepUp = await requireStepUpForAmount(session, priorRefunded + refundAmount, reauthPin)
  if (!stepUp.ok) {
    return json({ error: stepUp.error, reauth_required: true }, { status: stepUp.status })
  }

  // Account-wide evidence uses the existing customer/order/refund ledger only.
  // Guest phone, IP and device indicators are not used to infer identity.
  let accountRefundRows: Array<{ amount_kobo: number }> = []
  if (order.customer_id) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await db.from('refunds')
      .select('amount_kobo, orders!inner(customer_id)')
      .eq('orders.customer_id', order.customer_id)
      .neq('status', 'FAILED').gte('created_at', since).limit(200)
    accountRefundRows = (data ?? []) as Array<{ amount_kobo: number }>
  }
  const risk = evaluateRefundRisk({
    accountRefundCount30d: accountRefundRows.length,
    accountRefundedKobo30d: accountRefundRows.reduce((sum, row) => sum + Number(row.amount_kobo), 0),
    sameOrderPriorRefundCount: priorRows?.length ?? 0,
    orderTotalKobo: Number(order.total_amount), requestedKobo: refundAmount,
  })
  const eventId = await recordSecurityEvent({
    eventType: 'refund_risk_evaluated',
    severity: risk.score >= 75 ? 'critical' : risk.score >= 45 ? 'warn' : 'info',
    surface: 'refund', actorId: session.userId ?? session.phone, actorRole: session.role,
    sessionId: session.sessionId, ip, userAgent: req.headers.get('user-agent'),
    requestId: context.requestId, correlationId: context.correlationId,
    route: req.nextUrl.pathname, method: req.method,
    resourceType: 'order', resourceId: order.id as string, outcome: 'evaluated',
    detail: {
      score: risk.score, confidence: risk.confidence, category_scores: risk.categoryScores,
      triggered_rules: risk.triggeredRules, actions: risk.actions,
      account_refund_count_30d: accountRefundRows.length,
      account_refunded_kobo_30d: accountRefundRows.reduce((sum, row) => sum + Number(row.amount_kobo), 0),
      same_order_prior_refund_count: priorRows?.length ?? 0,
      requested_kobo: refundAmount, order_total_kobo: Number(order.total_amount),
    },
  })
  if (eventId && risk.actions.includes('create_evidence_hold')) {
    const incidentId = `LXSI-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    const { error: incidentError } = await db.rpc('create_security_incident_v2', {
      p_incident_id: incidentId, p_event_id: eventId,
      p_actor_id: session.userId ?? session.phone, p_severity: risk.score >= 90 ? 'critical' : 'high',
      p_confidence: risk.confidence, p_classification: 'refund_abuse_indicator',
      p_account_id: order.customer_id as string, p_account_role: 'customer',
      p_orders: [order.id], p_payments: [order.paystack_reference],
      p_rules: risk.triggeredRules, p_actions: risk.actions,
      p_location: null,
      p_evidence_hold: true, p_hold_reason: 'Corroborated cumulative refund-risk indicators',
      p_recommended_action: 'Human review required; indicators do not prove fraud.',
      p_request_id: context.requestId,
    })
    if (incidentError) console.error('[paystack/refund] incident creation failed:', incidentError.message)
  }

  // Atomic reserve: locks the order, re-checks the cap under the lock, writes the
  // refunds ledger row, and flips payment_status — the duplicate-call guard.
  const { data: reserved, error: reserveErr } = await db.rpc('reserve_order_refund', {
    p_order_id: order.id, p_amount_kobo: refundAmount, p_reason: reason,
    p_triggered_by: session.phone, p_reference: order.paystack_reference,
  })
  if (reserveErr) {
    console.error('[paystack/refund] reserve_order_refund RPC error:', reserveErr.message)
    return json({ error: 'Could not record refund' }, { status: 500 })
  }
  const row = (reserved as Array<{ refund_id: string; success: boolean; error_code: string | null; fully_refunded: boolean }>)[0]
  if (!row?.success) {
    await recordSecurityEvent({
      eventType: 'refund_reservation_rejected', severity: 'warn', surface: 'refund',
      actorId: session.userId ?? session.phone, actorRole: session.role, sessionId: session.sessionId,
      ip, requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, resourceType: 'order', resourceId: order.id as string,
      outcome: row?.error_code ?? 'rejected', detail: { error_code: row?.error_code ?? 'UNKNOWN' },
    })
    const map: Record<string, [number, string]> = {
      NOT_FOUND: [404, 'Order not found'], NOT_REFUNDABLE: [400, 'Order is not in a refundable state'],
      INVALID_AMOUNT: [400, 'Invalid refund amount'], EXCEEDS_TOTAL: [400, 'Refund exceeds order total'],
    }
    const [st, msg] = map[row?.error_code ?? ''] ?? [409, 'Refund could not be processed']
    return json({ error: msg }, { status: st })
  }

  // External money movement AFTER the ledger reservation; compensate on failure.
  try {
    await refundTransaction(order.paystack_reference as string, refundAmount)
  } catch (err) {
    console.error('[paystack/refund] Paystack refund failed, compensating:', err)
    const { error: compErr } = await db.rpc('fail_order_refund', {
      p_refund_id: row.refund_id,
      p_reason: 'Paystack refund request failed',
    })
    if (compErr) {
      // Compensation failed → order stuck PARTIALLY_REFUNDED with no money out.
      // Money-path inconsistency: log loudly now, wire to the #8 alert later.
      console.error('[paystack/refund] fail_order_refund compensation failed:', compErr.message)
    }
    await recordSecurityEvent({
      eventType: 'refund_provider_failure', severity: compErr ? 'critical' : 'warn', surface: 'refund',
      actorId: session.userId ?? session.phone, actorRole: session.role, sessionId: session.sessionId,
      ip, requestId: context.requestId, correlationId: context.correlationId,
      route: req.nextUrl.pathname, method: req.method, resourceType: 'order', resourceId: order.id as string,
      outcome: compErr ? 'compensation_failed' : 'compensated',
      detail: { refund_id: row.refund_id, requested_kobo: refundAmount },
    })
    return json({ error: 'Refund could not be initiated with the payment provider' }, { status: 502 })
  }

  // Full refund → flip the order workflow status too (parity with prior behaviour).
  if (row.fully_refunded) {
    const { data: transitioned } = await db.from('orders')
      .update({ status: 'REFUNDED', order_state: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .neq('status', 'REFUNDED')
      .select('id')
      .maybeSingle()
    if (transitioned) {
      await emailCommittedOrderStatus(db, {
        orderId: order.id as string,
        status: 'REFUNDED',
        actorType: session.role,
        actorId: session.userId ?? session.phone,
      })
    }
  }

  // Record as platform cost (fire-and-forget)
  void recordPlatformEarning({
    type:        'REFUND_COST',
    amount_kobo: -refundAmount,   // negative = cost to the platform
    order_id:    order.id as string,
    description: `Refund — order ${order.order_number as string}: ${reason}`,
  })

  // Audit log
  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'refund_initiated',
    target_table: 'orders',
    target_id: order.id as string,
    new_value: { refund_amount: refundAmount, reason },
    ip_address: ip,
  })

  // Notify customer
  let customerPhone: string | null = (order.guest_phone as string) ?? null
  if (!customerPhone && order.customer_id) {
    const { data: customer } = await db.from('customers').select('phone').eq('id', order.customer_id).single()
    customerPhone = (customer?.phone as string) ?? null
  }

  if (customerPhone) {
    void sendWhatsAppWithFallback({
      to: customerPhone,
      message: renderTemplate('REFUND_INITIATED', {
        amount: Math.round(refundAmount / 100),
        order_number: order.order_number as string,
      }),
    }).catch(() => {})
  }

  return json({ success: true })
}
