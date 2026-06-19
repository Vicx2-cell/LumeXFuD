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

  // ── GROUP SPLIT order: each participant paid their OWN share from their wallet
  // (group_order_collect), so refund EACH of them their share — not the single
  // host's wallet_amount_kobo. Without this, only the host got money back.
  const { data: splitRows } = await db
    .from('customer_wallet_transactions')
    .select('customer_id, amount_kobo')
    .eq('order_id', order.id)
    .eq('type', 'GROUP_SPLIT')
    .like('reference', 'CWSPLIT-%')
  if (splitRows && splitRows.length > 0) {
    // Per-member idempotency: skip anyone already refunded for this order.
    const { data: doneRows } = await db
      .from('customer_wallet_transactions').select('reference').eq('order_id', order.id).eq('type', 'REFUND')
    const done = new Set((doneRows ?? []).map((r) => (r as { reference: string }).reference))
    const rows = splitRows as Array<{ customer_id: string; amount_kobo: number }>
    const ids = Array.from(new Set(rows.map((s) => s.customer_id)))
    const { data: phoneRows } = await db.from('customers').select('id, phone').in('id', ids)
    const phoneMap = new Map((phoneRows ?? []).map((p) => [(p as { id: string }).id, (p as { phone: string }).phone]))
    let allOk = true
    for (const s of rows) {
      const reference = `CWREFUND-${order.id}-${s.customer_id.slice(0, 8)}`
      if (done.has(reference)) continue
      const ok = await refundToCustomerWallet({
        customerId: s.customer_id,
        amountKobo: Number(s.amount_kobo),
        orderId: order.id,
        reference,
        reason,
        customerPhone: phoneMap.get(s.customer_id),
      })
      if (!ok) allOk = false
    }
    return { walletPortion: total, paystackPortion: 0, walletOk: allOk, paystackOk: true }
  }

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
