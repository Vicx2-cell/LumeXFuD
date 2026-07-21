import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { requireStepUpForAmount } from '@/lib/step-up'
import { refundOrderPayments } from '@/lib/order-refund'
import { audit } from '@/lib/audit'
import { recordSecurityEvent } from '@/lib/security-events'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { emailCommittedOrderStatus } from '@/lib/order-status-email'
import { reverseOrderFeedAttribution } from '@/lib/feed/attribution'
import { applyRequestContext, createRequestContext } from '@/lib/request-context'

export const runtime = 'nodejs'

const TERMINAL_STATUSES = ['CANCELLED', 'REFUNDED', 'COMPLETED', 'DELIVERED', 'NO_SHOW']

const input = z.object({
  reason: z.string().trim().min(8).max(500),
  notify_customer: z.boolean().optional(),
  reauth_pin: z.string().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const context = createRequestContext(req.headers)
  const json = <T,>(body: T, init?: ResponseInit) => applyRequestContext(NextResponse.json(body, init), context)
  const session = await getCurrentUser()
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) return json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`emergency-cancel:${session.userId ?? session.phone}`, 20, 300, true)
  if (!rl.success) return json({ error: 'Too many emergency cancellations. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = input.safeParse(body)
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, payment_status, paystack_reference, customer_id, guest_phone, vendor_id, rider_id, total_amount, wallet_amount_kobo')
    .eq('id', id)
    .single()

  if (error || !order) return json({ error: 'Order not found' }, { status: 404 })
  if (TERMINAL_STATUSES.includes(String(order.status))) {
    return json({ error: 'Order is already terminal' }, { status: 409 })
  }

  if (order.payment_status === 'PAID') {
    const stepUp = await requireStepUpForAmount(session, Number(order.total_amount ?? 0), parsed.data.reauth_pin)
    if (!stepUp.ok) return json({ error: stepUp.error, reauth_required: true }, { status: stepUp.status })
  }

  let customerPhone: string | null = (order.guest_phone as string | null) ?? null
  if (!customerPhone && order.customer_id) {
    const { data: customer } = await db.from('customers').select('phone').eq('id', order.customer_id).maybeSingle()
    customerPhone = (customer?.phone as string | null) ?? null
  }

  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await db
    .from('orders')
    .update({
      status: 'CANCELLED',
      order_state: 'cancelled',
      auto_cancel_reason: 'admin_emergency',
      cancelled_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', order.status)
    .select('id')

  if (claimError) return json({ error: 'Could not cancel order' }, { status: 500 })
  if (!claimed || claimed.length === 0) return json({ error: 'Order was already updated' }, { status: 409 })

  if (order.rider_id) {
    await db
      .from('riders')
      .update({ status: 'ONLINE', active_order_id: null, updated_at: now })
      .eq('id', order.rider_id)
      .eq('active_order_id', id)
  }

  let refunded = false
  if (order.payment_status === 'PAID') {
    const result = await refundOrderPayments({
      order: {
        id: order.id as string,
        order_number: order.order_number as string,
        customer_id: order.customer_id as string | null,
        total_amount: Number(order.total_amount ?? 0),
        wallet_amount_kobo: (order.wallet_amount_kobo as number | null) ?? 0,
        paystack_reference: order.paystack_reference as string | null,
      },
      reason: `Emergency cancellation: ${parsed.data.reason}`,
      triggeredBy: session.phone,
      customerPhone: customerPhone ?? undefined,
    })
    refunded = result.walletOk && result.paystackOk
    if (refunded) {
      await db.from('orders').update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() }).eq('id', id)
    }
  }

  await db.from('support_notes').insert({
    subject_type: 'order',
    subject_id: id,
    phone: customerPhone,
    note: `Emergency cancellation: ${parsed.data.reason}`,
    pinned: true,
    created_by: session.phone,
    created_by_role: session.role,
  })

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'emergency_order_cancelled',
    target_table: 'orders',
    target_id: id,
    old_value: { status: order.status, payment_status: order.payment_status, rider_id: order.rider_id },
    new_value: { reason: parsed.data.reason, refunded, rider_released: Boolean(order.rider_id) },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    user_agent: req.headers.get('user-agent') ?? undefined,
  })

  void recordSecurityEvent({
    eventType: 'emergency_order_cancelled',
    severity: 'warn',
    surface: 'admin.orders.emergency_cancel',
    actorId: session.userId ?? session.phone,
    actorRole: session.role,
    sessionId: session.sessionId,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
    requestId: context.requestId,
    correlationId: context.correlationId,
    route: req.nextUrl.pathname,
    method: req.method,
    resourceType: 'order',
    resourceId: id,
    outcome: refunded ? 'cancelled_refunded' : 'cancelled',
    detail: { order_number: order.order_number, previous_status: order.status, rider_id: order.rider_id, reason: parsed.data.reason },
  })

  void reverseOrderFeedAttribution(id, refunded ? 'refunded_order' : 'cancelled_order', parsed.data.reason).catch((err) => {
    console.error('[feed-attribution] emergency cancel reverse failed:', err)
  })

  await emailCommittedOrderStatus(db, {
    orderId: id,
    status: refunded ? 'REFUNDED' : 'CANCELLED',
    actorType: session.role,
    actorId: session.userId ?? session.phone,
  })

  if (customerPhone && parsed.data.notify_customer !== false) {
    void sendWhatsAppWithFallback({
      to: customerPhone,
      message: renderTemplate('CANCELLED', {
        order_number: order.order_number as string,
        cancellation_reason: 'Your order was cancelled by support. Any captured payment is being refunded.',
      }),
    }).catch(() => {})
  }

  return json({ success: true, refunded, rider_released: Boolean(order.rider_id) })
}
