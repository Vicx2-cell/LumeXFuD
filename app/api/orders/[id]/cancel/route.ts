import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { refundOrderPayments } from '@/lib/order-refund'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { renderTemplate } from '@/lib/notify-templates'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { reverseOrderFeedAttribution } from '@/lib/feed/attribution'

const CANCELLABLE_STATUSES = ['PENDING_PAYMENT', 'SCHEDULED', 'PENDING', 'VENDOR_ACCEPTED']

// Who may cancel WHAT. A customer may cancel ONLY while the vendor hasn't accepted
// yet — an unpaid checkout, a scheduled pre-order before it's sent, or a paid
// PENDING order the vendor hasn't picked up. The moment the vendor ACCEPTS, the
// customer can no longer cancel (the food is being committed/prepared) — that's
// the line that stops people pulling out after a vendor has committed. Vendors may
// reject (PENDING / VENDOR_ACCEPTED before cooking); staff may cancel anything.
const CANCELLABLE_BY_ROLE: Record<string, string[]> = {
  customer:    ['PENDING_PAYMENT', 'SCHEDULED', 'PENDING'],
  vendor:      ['PENDING', 'VENDOR_ACCEPTED'],
  admin:       CANCELLABLE_STATUSES,
  super_admin: CANCELLABLE_STATUSES,
}

// POST /api/orders/[id]/cancel
// A customer cancels their own order, a VENDOR rejects an order placed with them
// (the "Decline" button — previously this route was customer-only, so vendor
// rejection silently 403'd), or staff cancels any. Refunds the customer if the
// order was already paid.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['customer', 'vendor', 'admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`order-cancel:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, payment_status, paystack_reference, customer_id, vendor_id, preparing_at, total_amount, wallet_amount_kobo')
    .eq('id', id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership (BOLA): customer cancels only their own, vendor rejects only orders
  // placed with them, staff can cancel anything.
  let authorized = false
  if (session.role === 'admin' || session.role === 'super_admin') {
    authorized = true
  } else if (session.role === 'vendor') {
    authorized = !!session.userId && session.userId === order.vendor_id
  } else if (session.role === 'customer') {
    const { data: customer } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
    authorized = !!customer && customer.id === order.customer_id
  }
  if (!authorized) return NextResponse.json({ error: 'Not your order' }, { status: 403 })

  const allowedForRole = CANCELLABLE_BY_ROLE[session.role] ?? []
  if (!allowedForRole.includes(order.status as string)) {
    const msg = session.role === 'customer'
      ? 'This order can’t be cancelled — the vendor has already accepted it. If there’s a problem, report it after delivery.'
      : 'Order cannot be cancelled at this stage'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // Once cooking has started, no one can cancel a VENDOR_ACCEPTED order.
  if (order.status === 'VENDOR_ACCEPTED' && order.preparing_at) {
    return NextResponse.json({ error: 'Cannot cancel after the vendor started preparing' }, { status: 400 })
  }

  const byVendor = session.role === 'vendor'
  const reason = byVendor
    ? 'Vendor could not accept this order'
    : session.role === 'customer'
      ? 'Customer cancelled order'
      : 'Cancelled by admin'

  // Optimistic claim — only the first caller flips it to CANCELLED, so the refund
  // below runs at most once even if customer-cancel and vendor-reject race.
  const now = new Date().toISOString()
  const { data: claimed } = await db
    .from('orders')
    .update({ status: 'CANCELLED', order_state: 'cancelled', cancelled_at: now, updated_at: now })
    .eq('id', id)
    .eq('status', order.status)
    .select('id')

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'Order was already updated' }, { status: 409 })
  }

  // Customer phone — for the refund notification + the cancellation message.
  let customerPhone: string | null = null
  if (order.customer_id) {
    const { data: cust } = await db.from('customers').select('phone').eq('id', order.customer_id).maybeSingle()
    customerPhone = (cust?.phone as string) ?? null
  }

  // Refund if paid — wallet portion back to the wallet, card portion via Paystack
  // (rule #30). The CANCELLED claim above means this runs once.
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
      reason,
      triggeredBy:   session.phone,
      customerPhone: customerPhone ?? undefined,
    })

    if (walletOk && paystackOk) {
      await db
        .from('orders')
        .update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() })
        .eq('id', id)
    }
  }

  void reverseOrderFeedAttribution(
    id,
    order.payment_status === 'PAID' ? 'refunded_order' : 'cancelled_order',
    reason,
  ).catch((err) => {
    console.error('[feed-attribution] cancel reverse failed:', err)
  })

  // Tell the customer (they need to know — especially when a vendor rejected it).
  if (customerPhone) {
    void sendWhatsAppWithFallback({
      to: customerPhone,
      message: renderTemplate('CANCELLED', {
        order_number: order.order_number as string,
        cancellation_reason: byVendor
          ? 'The vendor could not take your order, so it was cancelled. Any payment is being refunded.'
          : session.role === 'customer'
            ? 'You cancelled this order.'
            : 'Your order was cancelled. Any payment is being refunded.',
      }),
    }).catch(() => {})
  }

  // Audit staff/vendor cancellations (customer self-cancel isn't an admin action).
  if (session.role !== 'customer') {
    await audit({
      actor_id: session.phone,
      actor_role: session.role,
      action: 'order_cancelled',
      target_table: 'orders',
      target_id: id,
      new_value: { reason, by: session.role },
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
    })
  }

  return NextResponse.json({ success: true })
}
