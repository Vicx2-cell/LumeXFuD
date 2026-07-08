import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { withCronHealth, verifyCronSecret } from '@/lib/cron-health'
import { refundOrderPayments } from '@/lib/order-refund'
import { sendWhatsAppWithFallback } from '@/lib/notify'
import { audit } from '@/lib/audit'
import { getControls } from '@/lib/controls'
import { settleDuePickupNoShows } from '@/lib/pickup'
import { UNPICKED_CEILING_STATUSES } from '@/lib/order-state'
import { recordSecurityEvent } from '@/lib/security-events'

// Called every minute by Vercel cron (vercel.json: "*/1 * * * *").
// A vendor must accept a PENDING order within 5 minutes. Past that, the
// order is auto-cancelled and the customer is fully refunded (payment was
// already collected at checkout — orders move PENDING_PAYMENT → PENDING on
// successful payment, so a PENDING order is always already PAID).

interface PendingOrder {
  id: string
  order_number: string
  customer_id: string | null
  rider_id?: string | null
  total_amount: number
  wallet_amount_kobo: number | null
  paystack_reference: string
  payment_status: string
}

interface PickupCeilingOrder extends PendingOrder {
  status: string
  placed_at: string | null
  pending_since: string | null
}

// Vercel Cron invokes via GET; POST kept for manual/curl triggering. Both gated.
export async function GET(req: NextRequest) {
  return withCronHealth('vendor-auto-cancel', () => POST(req))
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createSupabaseAdmin()

  // Pickup (order ahead): settle READY orders past their no-show window in the
  // same per-minute pass (vendor keeps payment, customer forfeits). Independent of
  // the accept-window logic below, so it runs even if auto-cancel is disabled.
  const noShow = await settleDuePickupNoShows()

  // `orders.autoCancelMinutes` (LumeX Control spec) — single enforcement point.
  // 0 = disabled (never auto-cancel). Defaults to 5 min if unset.
  const autoCancelMinutes = (await getControls()).auto_cancel_minutes
  const pickupCeilingResult = await settlePickupCeiling(db)
  if (autoCancelMinutes <= 0) {
    return NextResponse.json({ cancelled: 0, pickup_ceiling: pickupCeilingResult, no_show: noShow, skipped: 'auto-cancel disabled' })
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
    return NextResponse.json({ cancelled: 0, no_show: noShow })
  }

  let cancelled = 0
  let failed = 0

  for (const order of orders) {
    try {
      // Optimistic lock: only cancel if still PENDING (vendor may have just accepted).
      const { data: lockedRows } = await db
        .from('orders')
        .update({ status: 'CANCELLED', order_state: 'cancelled', auto_cancel_reason: 'vendor_no_accept', cancelled_at: new Date().toISOString() })
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

      void recordSecurityEvent({
        eventType: 'order_status_transition',
        severity: 'warn',
        surface: 'cron.vendor-auto-cancel',
        actorId: 'SYSTEM',
        actorRole: 'admin',
        detail: {
          order_id: order.id,
          order_number: order.order_number,
          from_status: 'PENDING',
          to_status: 'CANCELLED',
          cancellation_stage: 'vendor_ack',
          reason: 'vendor_no_accept',
          status_changed_at: new Date().toISOString(),
        },
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

  return NextResponse.json({ cancelled, failed, pickup_ceiling: pickupCeilingResult, no_show: noShow })
}

async function settlePickupCeiling(db: ReturnType<typeof createSupabaseAdmin>): Promise<{ cancelled: number; failed: number }> {
  const now = new Date()
  const nowIso = now.toISOString()
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

  const { data: ordersRaw, error } = await db
    .from('orders')
    .select('id, order_number, customer_id, rider_id, total_amount, wallet_amount_kobo, paystack_reference, payment_status, status, placed_at, pending_since')
    .eq('payment_status', 'PAID')
    .in('status', UNPICKED_CEILING_STATUSES)
    .is('picked_up_at', null)
    .or(`placed_at.lte.${cutoff},and(placed_at.is.null,pending_since.lte.${cutoff})`)
    .limit(50)

  if (error) {
    console.error('[cron/vendor-auto-cancel] pickup ceiling DB error:', error.message)
    return { cancelled: 0, failed: 1 }
  }

  const orders = (ordersRaw ?? []) as unknown as PickupCeilingOrder[]
  let cancelled = 0
  let failed = 0

  for (const order of orders) {
    try {
      const { data: claimed } = await db
        .from('orders')
        .update({
          status: 'CANCELLED',
          order_state: 'cancelled',
          cancelled_at: nowIso,
          auto_cancel_reason: 'pickup_ceiling_2h',
          updated_at: nowIso,
        })
        .eq('id', order.id)
        .in('status', UNPICKED_CEILING_STATUSES)
        .is('picked_up_at', null)
        .select('id')

      if (!claimed || claimed.length === 0) continue

      if (order.rider_id) {
        await db
          .from('riders')
          .update({ active_order_id: null, status: 'ONLINE', last_status_update_at: nowIso })
          .eq('id', order.rider_id)
          .eq('active_order_id', order.id)
      }

      const { walletOk, paystackOk } = await refundOrderPayments({
        order: {
          id:                 order.id,
          order_number:       order.order_number,
          customer_id:        order.customer_id,
          total_amount:       order.total_amount,
          wallet_amount_kobo: order.wallet_amount_kobo ?? 0,
          paystack_reference: order.paystack_reference,
        },
        reason:      'Order was not picked up within 2 hours of payment confirmation',
        triggeredBy: 'SYSTEM_PICKUP_CEILING',
      })

      if (walletOk && paystackOk) {
        await db
          .from('orders')
          .update({ payment_status: 'REFUNDED', updated_at: nowIso })
          .eq('id', order.id)
      }

      await audit({
        actor_id:     'SYSTEM',
        actor_role:   'admin',
        action:       'ORDER_AUTO_CANCELLED',
        target_table: 'orders',
        target_id:    order.id,
        new_value:    { reason: 'pickup_ceiling_2h', refunded: walletOk && paystackOk, previous_status: order.status },
      })

      void recordSecurityEvent({
        eventType: 'order_status_transition',
        severity: 'warn',
        surface: 'cron.vendor-auto-cancel',
        actorId: 'SYSTEM',
        actorRole: 'admin',
        detail: {
          order_id: order.id,
          order_number: order.order_number,
          rider_id: order.rider_id ?? null,
          from_status: order.status,
          to_status: 'CANCELLED',
          cancellation_stage: order.status === 'RIDER_ASSIGNED' ? 'pickup_wait' : 'vendor_prep',
          reason: 'pickup_ceiling_2h',
          status_changed_at: nowIso,
        },
      })

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
            message: `Your order #${order.order_number} was auto-cancelled because it was not picked up within 2 hours of payment confirmation. You've been fully refunded.`,
          }).catch(() => {})
        }
      }

      cancelled++
    } catch (err) {
      console.error(`[cron/vendor-auto-cancel] pickup ceiling failed for order ${order.id}:`, err)
      failed++
    }
  }

  return { cancelled, failed }
}
