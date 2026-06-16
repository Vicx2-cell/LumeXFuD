import { createSupabaseAdmin } from './supabase/server'
import { refundOrderPayments } from './order-refund'
import { getControls } from './controls'
import { sendWhatsAppWithFallback } from './termii/whatsapp'

// Bank-grade self-healing: a customer's money must never get stuck just because a
// background cron didn't fire. When anyone opens an order page, we settle that ONE
// order if it's overdue — independent of the Vercel scheduler.
//
// Currently handles the scariest case: an order the customer PAID for that a
// vendor never accepted. Past the auto-cancel window it is cancelled + fully
// refunded here (idempotent: the CANCELLED claim is optimistic, so the refund
// runs at most once even across concurrent views / the real cron).

export interface SettleableOrder {
  id: string
  order_number: string
  status: string
  payment_status: string
  created_at: string
  pending_since: string | null
  total_amount: number
  wallet_amount_kobo: number | null
  paystack_reference: string | null
  customer_id: string | null
}

// Returns the new status if it changed (e.g. 'CANCELLED'), else null.
export async function settleOrderIfDue(order: SettleableOrder): Promise<string | null> {
  // Only stale, still-unaccepted, already-paid orders are eligible.
  if (order.status !== 'PENDING' || order.payment_status !== 'PAID') return null

  const minutes = (await getControls()).auto_cancel_minutes
  if (minutes <= 0) return null // auto-cancel disabled

  const sinceMs = new Date(order.pending_since ?? order.created_at).getTime()
  if (Date.now() - sinceMs < minutes * 60_000) return null // still within accept window

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()

  // Optimistic claim — only the first caller flips PENDING → CANCELLED, so the
  // refund below runs exactly once even if this races the cron or another tab.
  const { data: claimed } = await db
    .from('orders')
    .update({ status: 'CANCELLED', cancelled_at: now, updated_at: now })
    .eq('id', order.id)
    .eq('status', 'PENDING')
    .select('id')
  if (!claimed || claimed.length === 0) return null

  let customerPhone: string | null = null
  if (order.customer_id) {
    const { data: c } = await db.from('customers').select('phone').eq('id', order.customer_id).maybeSingle()
    customerPhone = (c as { phone?: string } | null)?.phone ?? null
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
    reason:        `Vendor did not accept within ${minutes} minutes`,
    triggeredBy:   'SYSTEM_SELF_HEAL',
    customerPhone: customerPhone ?? undefined,
  })
  if (walletOk && paystackOk) {
    await db.from('orders').update({ payment_status: 'REFUNDED', updated_at: now }).eq('id', order.id)
  }

  if (customerPhone) {
    void sendWhatsAppWithFallback({
      to: customerPhone,
      message: `😔 Your order #${order.order_number} was cancelled — the vendor didn't accept in time. You've been fully refunded.`,
    }).catch(() => {})
  }

  return 'CANCELLED'
}
