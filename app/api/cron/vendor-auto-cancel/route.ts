import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { refundTransaction } from '@/lib/paystack/transfer'
import { recordPlatformEarning } from '@/lib/platform-earnings'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { audit } from '@/lib/audit'

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
  paystack_reference: string
  payment_status: string
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data: ordersRaw, error } = await db
    .from('orders')
    .select('id, order_number, customer_id, total_amount, paystack_reference, payment_status')
    .eq('status', 'PENDING')
    .lte('created_at', fiveMinAgo)
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
      // claimed as CANCELLED above (prevents double-processing), so a refund
      // failure here must NOT be swallowed — record it as NEEDS_ATTENTION so an
      // admin can retry, rather than leaving an un-refunded paid order with no trace.
      if (order.payment_status === 'PAID') {
        let refundOk = true
        try {
          await refundTransaction(order.paystack_reference, order.total_amount)
        } catch (refundErr) {
          refundOk = false
          console.error(`[cron/vendor-auto-cancel] refund failed for order ${order.id}:`, refundErr)
        }

        await db.from('refunds').insert({
          order_id:                       order.id,
          paystack_transaction_reference: order.paystack_reference,
          amount_kobo:                    order.total_amount,
          reason:                         'Vendor did not accept within 5 minutes',
          status:                         refundOk ? 'PROCESSING' : 'NEEDS_ATTENTION',
          triggered_by:                   'SYSTEM_AUTO_CANCEL',
        })

        if (refundOk) {
          await db
            .from('orders')
            .update({ payment_status: 'REFUNDED', updated_at: new Date().toISOString() })
            .eq('id', order.id)

          void recordPlatformEarning({
            type:        'REFUND_COST',
            amount_kobo: -order.total_amount,
            order_id:    order.id,
            description: `Auto-cancel refund — order ${order.order_number}`,
          })
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
