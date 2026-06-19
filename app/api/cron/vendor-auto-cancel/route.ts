import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth } from '@/lib/cron-health'
import { refundOrderPayments } from '@/lib/order-refund'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { getControls } from '@/lib/controls'

// Called every minute by Vercel cron (vercel.json: "*/1 * * * *").
// A vendor must accept a PENDING order within 5 minutes. Past that, the
// order is auto-cancelled and the customer is fully refunded (payment was
// already collected at checkout — orders move PENDING_PAYMENT → PENDING on
// successful payment, so a PENDING order is always already PAID).

interface PendingOrder {
  id: string
  order_number: string
  customer_id: string | null
  total_amount: number
  wallet_amount_kobo: number | null
  paystack_reference: string
  payment_status: string
}

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('vendor-auto-cancel', () => POST(req))
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()

  // `orders.autoCancelMinutes` (LumeX Control spec) — single enforcement point.
  // 0 = disabled (never auto-cancel). Defaults to 5 min if unset.
  const autoCancelMinutes = (await getControls()).auto_cancel_minutes
  if (autoCancelMinutes <= 0) {
    return NextResponse.json({ cancelled: 0, skipped: 'auto-cancel disabled' })
  }
  const cutoff = new Date(Date.now() - autoCancelMinutes * 60 * 1000).toISOString()

  // Measure the accept window from when the order ENTERED pending (pending_since),
  // not created_at — otherwise a just-released SCHEDULED order (created hours ago)
  // would be auto-cancelled the instant it reaches the vendor. Older rows have no
  // pending_since, so fall back to created_at for them.
  const { data: ordersRaw, error } = await db
    .from('orders')
    .select('id, order_number, customer_id, total_amount, wallet_amount_kobo, paystack_reference, payment_status')
    .eq('status', 'PENDING')
    .or(`pending_since.lte.${cutoff},and(pending_since.is.null,created_at.lte.${cutoff})`)
    .limit(50)

  if (error) {
    console.error('[cron/vendor-auto-cancel] DB error:', error.message)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  const orders = (ordersRaw ?? []) as unknown as PendingOrder[]
  if (orders.length === 0) {
    return NextResponse.json({ cancelled: 0 })
  }

  let cancelled = 0
  let failed = 0

  for (const order of orders) {
    try {
      // Optimistic lock: only cancel if still PENDING (vendor may have just accepted).
      const { data: lockedRows } = await db
        .from('orders')
        .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
        .eq('id', order.id)
        .eq('status', 'PENDING')
        .select('id')

      if (!lockedRows || lockedRows.length === 0) {
        continue // status changed concurrently — skip
      }

      // Refund the customer (payment already collected). The order is already
      // claimed as CANCELLED above (prevents double-processing). Refund both
      // money sources — wallet portion back to the wallet, card portion via
      // Paystack — so a wallet/split order isn't left un-refunded. A failure is
      // recorded as NEEDS_ATTENTION inside the helper rather than swallowed.
      if (order.payment_status === 'PAID') {
        const { walletOk, paystackOk } = await refundOrderPayments({
          order: {
            id:                 order.id,
            order_number:       order.order_number,
            customer_id:        order.customer_id,
            total_amount:       order.total_amount,
            wallet_amount_kobo: order.wallet_amount_kobo ?? 0,
            paystack_reference: order.paystack_reference,
          },
          reason:      `Vendor did not accept within ${autoCancelMinutes} minutes`,
          triggeredBy: 'SYSTEM_AUTO_CANCEL',
        })

        if (walletOk && paystackOk) {
          await db
            .from('orders')
            .update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() })
            .eq('id', order.id)
        }
      }

      await audit({
        actor_id:     'SYSTEM',
        actor_role:   'admin',
        action:       'ORDER_AUTO_CANCELLED',
        target_table: 'orders',
        target_id:    order.id,
        new_value:    { reason: 'vendor_no_accept_5min', refunded: order.payment_status === 'PAID' },
      })

      // Notify customer
      if (order.customer_id) {
        const { data: customer } = await db
          .from('customers')
          .select('phone')
          .eq('id', order.customer_id)
          .maybeSingle()
        const phone = (customer as { phone: string } | null)?.phone
        if (phone) {
          sendWhatsAppWithFallback({
            to: phone,
            message: `😔 Your order #${order.order_number} was cancelled — the vendor didn't accept in time. You've been fully refunded.`,
          }).catch(() => {})
        }
      }

      cancelled++
    } catch (err) {
      console.error(`[cron/vendor-auto-cancel] Failed for order ${order.id}:`, err)
      failed++
    }
  }

  return NextResponse.json({ cancelled, failed })
}
