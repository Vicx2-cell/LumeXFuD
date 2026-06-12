/**
 * LumeX Fud — unified order refund
 *
 * An order can be paid from two money sources at once (see payment_method on
 * orders: PAYSTACK / WALLET / SPLIT). Refunding only the Paystack side — as the
 * cancel route, auto-cancel cron and dispute-resolve all used to — would either
 * silently swallow a wallet payment (customer loses money) or fire a Paystack
 * refund against a charge that never existed for a wallet-only order. This
 * centralises the logic so every refund path is symmetric with how the order
 * was actually paid:
 *   - wallet portion (orders.wallet_amount_kobo)  → back to the customer wallet
 *   - card/bank portion (total − wallet portion)  → back via Paystack
 *
 * NOT idempotent on its own. refund_customer_wallet credits unconditionally, so
 * callers MUST first claim the order (optimistic status / payment_status flip)
 * so this runs at most once per order. As a second backstop it skips the wallet
 * leg if a REFUND ledger row already exists for the order.
 */

import { createSupabaseAdmin } from './supabase/server'
import { refundTransaction } from './paystack/transfer'
import { refundToCustomerWallet } from './customer-wallet'
import { recordPlatformEarning } from './platform-earnings'

export interface RefundableOrder {
  id: string
  order_number: string
  customer_id: string | null
  total_amount: number
  wallet_amount_kobo: number | null
  paystack_reference: string | null
}

export interface RefundResult {
  walletPortion: number
  paystackPortion: number
  walletOk: boolean
  paystackOk: boolean
}

export async function refundOrderPayments(params: {
  order: RefundableOrder
  reason: string
  triggeredBy: string
  customerPhone?: string
}): Promise<RefundResult> {
  const { order, reason, triggeredBy, customerPhone } = params
  const db = createSupabaseAdmin()

  const total = Number(order.total_amount) || 0
  const walletPortion = Math.max(0, Math.min(Number(order.wallet_amount_kobo) || 0, total))
  const paystackPortion = total - walletPortion

  let walletOk = true
  let paystackOk = true

  // ── 1. Wallet portion → customer wallet ─────────────────────────────────────
  if (walletPortion > 0 && order.customer_id) {
    // Backstop against a double refund (the RPC isn't idempotent): if a REFUND
    // row for this order already exists, the wallet was already restored.
    const { data: existing } = await db
      .from('customer_wallet_transactions')
      .select('id')
      .eq('order_id', order.id)
      .eq('type', 'REFUND')
      .limit(1)

    if (!existing || existing.length === 0) {
      walletOk = await refundToCustomerWallet({
        customerId: order.customer_id,
        amountKobo: walletPortion,
        orderId:    order.id,
        reference:  `CWREFUND-${order.id}`,
        reason,
        customerPhone,
      })
    }
  }

  // ── 2. Card/bank portion → Paystack ─────────────────────────────────────────
  // Skipped entirely for wallet-only orders (paystackPortion === 0), so we never
  // fire a Paystack refund against a charge that doesn't exist.
  if (paystackPortion > 0 && order.paystack_reference) {
    try {
      await refundTransaction(order.paystack_reference, paystackPortion)
    } catch (err) {
      paystackOk = false
      console.error(`[order-refund] Paystack refund failed for order ${order.id}:`, err)
    }

    await db.from('refunds').insert({
      order_id:                       order.id,
      paystack_transaction_reference: order.paystack_reference,
      amount_kobo:                    paystackPortion,
      reason,
      status:                         paystackOk ? 'PROCESSING' : 'NEEDS_ATTENTION',
      triggered_by:                   triggeredBy,
    })

    // Only the cash that actually leaves Paystack is a platform cost. The wallet
    // leg is an internal ledger move (a restored liability), not cash out.
    if (paystackOk) {
      void recordPlatformEarning({
        type:        'REFUND_COST',
        amount_kobo: -paystackPortion,
        order_id:    order.id,
        description: `Refund — order ${order.order_number} — ${reason}`,
      })
    }
  }

  return { walletPortion, paystackPortion, walletOk, paystackOk }
}
