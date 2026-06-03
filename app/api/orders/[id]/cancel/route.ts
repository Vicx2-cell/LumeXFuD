import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { refundTransaction } from '@/lib/paystack/transfer'
import { recordPlatformEarning } from '@/lib/platform-earnings'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'

const CANCELLABLE_STATUSES = ['PENDING_PAYMENT', 'PENDING', 'VENDOR_ACCEPTED']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Customer only' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('id, phone')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, payment_status, paystack_reference, customer_id, preparing_at, total_amount')
    .eq('id', id)
    .eq('customer_id', customer.id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (!CANCELLABLE_STATUSES.includes(order.status as string)) {
    return NextResponse.json(
      { error: 'Order cannot be cancelled at this stage' },
      { status: 400 }
    )
  }

  // VENDOR_ACCEPTED → only if not yet PREPARING
  if (order.status === 'VENDOR_ACCEPTED' && order.preparing_at) {
    return NextResponse.json({ error: 'Cannot cancel after vendor started preparing' }, { status: 400 })
  }

  await db
    .from('orders')
    .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)

  // Refund if paid — record a refunds ledger row + platform cost so every
  // refund is traceable (rule #30), consistent with the auto-cancel cron.
  if (order.payment_status === 'PAID' && order.paystack_reference) {
    const amountKobo = order.total_amount as number
    let refundOk = true
    try {
      await refundTransaction(order.paystack_reference as string, amountKobo)
    } catch (refundErr) {
      refundOk = false
      console.error(`[orders/cancel] refund failed for order ${order.id}:`, refundErr)
    }

    await db.from('refunds').insert({
      order_id:                       order.id,
      paystack_transaction_reference: order.paystack_reference,
      amount_kobo:                    amountKobo,
      reason:                         'Customer cancelled order',
      status:                         refundOk ? 'PROCESSING' : 'NEEDS_ATTENTION',
      triggered_by:                   session.phone,
    })

    if (refundOk) {
      await db
        .from('orders')
        .update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() })
        .eq('id', id)

      void recordPlatformEarning({
        type:        'REFUND_COST',
        amount_kobo: -amountKobo,
        order_id:    order.id as string,
        description: `Customer-cancel refund — order ${order.order_number as string}`,
      })
    }
  }

  void sendWhatsAppWithFallback({
    to: customer.phone as string,
    message: renderTemplate('CANCELLED', {
      order_number: order.order_number as string,
      cancellation_reason: 'You cancelled this order.',
    }),
  }).catch(() => {})

  return NextResponse.json({ success: true })
}
