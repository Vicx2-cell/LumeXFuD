import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { refundOrderPayments } from '@/lib/order-refund'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'
import { rateLimitGeneric } from '@/lib/rate-limit'

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

  const rl = await rateLimitGeneric(`order-cancel:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('id, phone')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, payment_status, paystack_reference, customer_id, preparing_at, total_amount, wallet_amount_kobo')
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

  // Refund if paid — wallet portion back to the wallet, card portion via
  // Paystack (rule #30). The order is already claimed CANCELLED above, so this
  // runs at most once. A still-unpaid order (PENDING_PAYMENT) has payment_status
  // PENDING and skips this entirely — for a SPLIT that means the wallet, debited
  // only in the webhook, was never touched.
  if (order.payment_status === 'PAID') {
    const { walletOk, paystackOk } = await refundOrderPayments({
      order: {
        id:                 order.id as string,
        order_number:       order.order_number as string,
        customer_id:        order.customer_id as string | null,
        total_amount:       order.total_amount as number,
        wallet_amount_kobo: (order.wallet_amount_kobo as number) ?? 0,
        paystack_reference: order.paystack_reference as string | null,
      },
      reason:        'Customer cancelled order',
      triggeredBy:   session.phone,
      customerPhone: customer.phone as string,
    })

    if (walletOk && paystackOk) {
      await db
        .from('orders')
        .update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() })
        .eq('id', id)
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
