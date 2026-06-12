import { createSupabaseAdmin } from './supabase/server'
import { creditWalletHeld, getTrustTier, calculateReleaseTime } from './wallet'

export interface PayoutOrder {
  id: string
  order_number: string
  vendor_id: string | null
  rider_id: string | null
  subtotal: number
  rider_delivery_cut: number
  tip_amount: number
}

/**
 * Settles a completed order: credits the vendor + rider HELD earnings and frees
 * the rider for their next job. Previously this only lived in the release-payments
 * cron (which isn't running), so completed orders never paid out and riders got
 * permanently stuck (active_order_id was never cleared anywhere).
 *
 * Safe to call more than once per order:
 *  - freeing the rider is bound to THIS order id, so it won't clear a newer one
 *  - crediting is claimed via orders.wallet_released (false->true) so it runs once
 */
export async function completeOrderPayout(order: PayoutOrder): Promise<void> {
  const db = createSupabaseAdmin()

  // 1. Free the rider — unconditional, so a credit hiccup can never leave them
  //    stuck. Scoped to this order so we don't clear a freshly-accepted one.
  if (order.rider_id) {
    await db.from('riders')
      .update({ active_order_id: null })
      .eq('id', order.rider_id)
      .eq('active_order_id', order.id)
  }

  // 2. Credit earnings at most once (claim wallet_released atomically).
  const { data: claimed } = await db.from('orders')
    .update({ wallet_released: true })
    .eq('id', order.id)
    .eq('wallet_released', false)
    .select('id')
  if (!claimed || claimed.length === 0) return // already settled

  const now = new Date()
  const vendorAmount = Number(order.subtotal) || 0
  const riderAmount = (Number(order.rider_delivery_cut) || 0) + (Number(order.tip_amount) || 0)

  try {
    if (order.vendor_id && vendorAmount > 0) {
      const tier = await getTrustTier(order.vendor_id, 'VENDOR')
      await creditWalletHeld({
        userId: order.vendor_id, userType: 'VENDOR', amount: vendorAmount,
        orderId: order.id, description: `Payment for order #${order.order_number}`,
        releaseAt: calculateReleaseTime('VENDOR', tier, now), reference: `VENDOR-${order.id}`,
      })
    }
    if (order.rider_id && riderAmount > 0) {
      const tier = await getTrustTier(order.rider_id, 'RIDER')
      await creditWalletHeld({
        userId: order.rider_id, userType: 'RIDER', amount: riderAmount,
        orderId: order.id, description: `Delivery earnings for order #${order.order_number}`,
        releaseAt: calculateReleaseTime('RIDER', tier, now), reference: `RIDER-${order.id}`,
      })
    }
  } catch (err) {
    // Crediting failed after the claim — unwind so it can be retried, and don't
    // throw: the order is already COMPLETED and the rider is freed.
    await db.from('orders').update({ wallet_released: false }).eq('id', order.id)
    console.error(`[order-payout] crediting failed for ${order.order_number}:`, err)
  }
}
