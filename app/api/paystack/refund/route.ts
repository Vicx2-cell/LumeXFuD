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

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || (session.role !== 'admin' && session.role !== 'super_admin')) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`refund:${session.phone}`, 20, 300, true)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many refund requests. Please slow down.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = refundInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const { order_id, reason, amount } = parsed.data
  const db = createSupabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, total_amount, payment_status, paystack_reference, customer_id, guest_phone, status')
    .eq('id', order_id)
    .single()

  if (error || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Only card-paid orders are refundable here, and only until fully refunded.
  if (order.payment_status !== 'PAID' && order.payment_status !== 'PARTIALLY_REFUNDED') {
    return NextResponse.json({ error: 'Order is not in a refundable state' }, { status: 400 })
  }
  if (!order.paystack_reference) {
    return NextResponse.json({ error: 'Order has no card payment to refund' }, { status: 400 })
  }

  // Sum refunds already issued (all but FAILED): cap at the REMAINING balance and
  // decide step-up on the CUMULATIVE amount so a split ≥₦50k still trips re-auth.
  const { data: priorRows } = await db
    .from('refunds').select('amount_kobo').eq('order_id', order.id).neq('status', 'FAILED')
  const priorRefunded = (priorRows ?? []).reduce((s, r) => s + Number(r.amount_kobo), 0)
  const remaining = (order.total_amount as number) - priorRefunded

  const refundAmount = amount ?? remaining
  if (refundAmount <= 0 || refundAmount > remaining) {
    return NextResponse.json({ error: 'Refund exceeds remaining refundable amount' }, { status: 400 })
  }

  // Rule #28: re-auth once the CUMULATIVE refund on this order reaches ₦50,000.
  const reauthPin = (body as Record<string, unknown> | null)?.reauth_pin
  const stepUp = await requireStepUpForAmount(session, priorRefunded + refundAmount, reauthPin)
  if (!stepUp.ok) {
    return NextResponse.json({ error: stepUp.error, reauth_required: true }, { status: stepUp.status })
  }

  // Atomic reserve: locks the order, re-checks the cap under the lock, writes the
  // refunds ledger row, and flips payment_status — the duplicate-call guard.
  const { data: reserved, error: reserveErr } = await db.rpc('reserve_order_refund', {
    p_order_id: order.id, p_amount_kobo: refundAmount, p_reason: reason,
    p_triggered_by: session.phone, p_reference: order.paystack_reference,
  })
  if (reserveErr) {
    console.error('[paystack/refund] reserve_order_refund RPC error:', reserveErr.message)
    return NextResponse.json({ error: 'Could not record refund' }, { status: 500 })
  }
  const row = (reserved as Array<{ refund_id: string; success: boolean; error_code: string | null; fully_refunded: boolean }>)[0]
  if (!row?.success) {
    const map: Record<string, [number, string]> = {
      NOT_FOUND: [404, 'Order not found'], NOT_REFUNDABLE: [400, 'Order is not in a refundable state'],
      INVALID_AMOUNT: [400, 'Invalid refund amount'], EXCEEDS_TOTAL: [400, 'Refund exceeds order total'],
    }
    const [st, msg] = map[row?.error_code ?? ''] ?? [409, 'Refund could not be processed']
    return NextResponse.json({ error: msg }, { status: st })
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
    return NextResponse.json({ error: 'Refund could not be initiated with the payment provider' }, { status: 502 })
  }

  // Full refund → flip the order workflow status too (parity with prior behaviour).
  if (row.fully_refunded) {
    await db.from('orders').update({ status: 'REFUNDED', updated_at: new Date().toISOString() }).eq('id', order.id)
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
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
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

  return NextResponse.json({ success: true })
}
