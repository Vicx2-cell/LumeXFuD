import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { refundTransaction } from '@/lib/paystack/transfer'
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
    .select('id, order_number, status, payment_status, paystack_reference, customer_id, preparing_at')
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

  // Refund if paid
  if (order.payment_status === 'PAID' && order.paystack_reference) {
    void refundTransaction(order.paystack_reference as string).catch(() => {})
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
