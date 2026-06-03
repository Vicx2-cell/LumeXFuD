import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { refundTransaction } from '@/lib/paystack/transfer'
import { audit } from '@/lib/audit'
import { refundInput } from '@/lib/validators'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'
import { recordPlatformEarning } from '@/lib/platform-earnings'
import { rateLimitGeneric } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session || (session.role !== 'admin' && session.role !== 'super_admin')) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`refund:${session.phone}`, 20, 300)
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

  if (order.payment_status !== 'PAID') {
    return NextResponse.json({ error: 'Order was not paid' }, { status: 400 })
  }

  const refundAmount = amount ?? (order.total_amount as number)
  if (refundAmount > (order.total_amount as number)) {
    return NextResponse.json({ error: 'Refund exceeds order total' }, { status: 400 })
  }

  // Trigger Paystack refund
  await refundTransaction(order.paystack_reference as string, refundAmount)

  // Record refund (column is amount_kobo — surface a write failure rather than
  // leaving an issued refund with no ledger row, per rule #30)
  const { error: refundInsertErr } = await db.from('refunds').insert({
    order_id: order.id,
    paystack_transaction_reference: order.paystack_reference,
    amount_kobo: refundAmount,
    reason,
    status: 'PROCESSING',
    triggered_by: session.phone,
  })
  if (refundInsertErr) {
    console.error('[paystack/refund] refunds ledger insert failed:', refundInsertErr.message)
    return NextResponse.json({ error: 'Refund issued but failed to record — investigate immediately' }, { status: 500 })
  }

  // Update order
  await db
    .from('orders')
    .update({ status: 'REFUNDED', updated_at: new Date().toISOString() })
    .eq('id', order.id)

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
