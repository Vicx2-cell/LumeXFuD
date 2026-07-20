import { createSupabaseAdmin } from './supabase/server'
import { creditWalletHeld, getTierAndCount, calculateReleaseTime, getHoldPolicy } from './wallet'
import { maybeApplyLateDeliveryCredit } from './late-delivery-credit'
import { emailCommittedOrderStatus } from './order-status-email'

export interface PayoutOrder {
  id: string
  order_number: string
  vendor_id: string | null
  rider_id: string | null
  subtotal: number
  rider_delivery_cut: number
  tip_amount: number
}

// Far-future sentinel used to "lock" an order's held funds while it is disputed,
// so release_held_batch (which only checks release_at, not order status) can't
// auto-release money that may have to be refunded.
const DISPUTE_LOCK_AT = '2999-01-01T00:00:00.000Z'

/**
 * Lock an order's still-held earnings when a problem is reported: push their
 * release_at far out so they can't auto-release while the dispute is open. Only
 * touches PENDING (still-held) holds — already-released funds are handled by
 * freeze + clawback. Safe/idempotent.
 */
export async function lockOrderHolds(orderId: string): Promise<void> {
  const db = createSupabaseAdmin()
  await db.from('wallet_transactions')
    .update({ release_at: DISPUTE_LOCK_AT })
    .eq('order_id', orderId)
    .eq('type', 'HOLD')
    .eq('status', 'PENDING')
}

/**
 * Unlock an order's held earnings (dispute resolved in the vendor/rider's
 * favour): set release_at to now so the next release pass frees them. Only
 * touches PENDING holds that are still locked in the future.
 */
export async function unlockOrderHolds(orderId: string): Promise<void> {
  const db = createSupabaseAdmin()
  await db.from('wallet_transactions')
    .update({ release_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('type', 'HOLD')
    .eq('status', 'PENDING')
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

  // 1. Free the rider — clear active_order_id AND flip BUSY back to ONLINE so
  //    they're available for the next job. Accepting an order sets them BUSY but
  //    nothing reset it, and the UI disables the toggle while BUSY, so without
  //    this a rider is stuck BUSY forever. Scoped to this order so we never touch
  //    a rider who has already moved on to a newer one.
  if (order.rider_id) {
    await db.from('riders')
      .update({ active_order_id: null, status: 'ONLINE', last_status_update_at: new Date().toISOString() })
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
    const policy = await getHoldPolicy()
    if (order.vendor_id && vendorAmount > 0) {
      const { tier, count } = await getTierAndCount(order.vendor_id, 'VENDOR')
      await creditWalletHeld({
        userId: order.vendor_id, userType: 'VENDOR', amount: vendorAmount,
        orderId: order.id, description: `Payment for order #${order.order_number}`,
        releaseAt: calculateReleaseTime('VENDOR', tier, count, now, policy), reference: `VENDOR-${order.id}`,
      })
    }
    if (order.rider_id && riderAmount > 0) {
      const { tier, count } = await getTierAndCount(order.rider_id, 'RIDER')
      await creditWalletHeld({
        userId: order.rider_id, userType: 'RIDER', amount: riderAmount,
        orderId: order.id, description: `Delivery earnings for order #${order.order_number}`,
        releaseAt: calculateReleaseTime('RIDER', tier, count, now, policy), reference: `RIDER-${order.id}`,
      })
    }
  } catch (err) {
    // Crediting failed after the claim — unwind so it can be retried, and don't
    // throw: the order is already COMPLETED and the rider is freed.
    await db.from('orders').update({ wallet_released: false }).eq('id', order.id)
    console.error(`[order-payout] crediting failed for ${order.order_number}:`, err)
  }
}

/**
 * On-demand settlement backstop. Auto-completes a user's own DELIVERED orders
 * whose 15-min window has elapsed and credits the held earnings — so money is
 * held on EVERY order even if the per-minute release-payments cron isn't firing
 * (the cron has been unreliable). Mirrors the cron's core, scoped to one user so
 * it's cheap to call from hot paths (e.g. the wallet balance check). Idempotent:
 * the optimistic DELIVERED→COMPLETED lock + completeOrderPayout's wallet_released
 * claim guarantee each order settles exactly once. Never throws.
 */
export async function settleDueDeliveriesForUser(
  userId: string,
  userType: 'VENDOR' | 'RIDER'
): Promise<number> {
  const db = createSupabaseAdmin()
  const column = userType === 'VENDOR' ? 'vendor_id' : 'rider_id'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { data: due } = await db
    .from('orders')
    .select('id, order_number, vendor_id, rider_id, subtotal, rider_delivery_cut, tip_amount')
    .eq('status', 'DELIVERED')
    .eq('wallet_released', false)
    .lte('delivered_at', fifteenMinAgo)
    .eq(column, userId)
    .limit(20)

  let settled = 0
  for (const o of (due ?? []) as Array<PayoutOrder>) {
    try {
      // Claim the completion first (optimistic lock on DELIVERED) so two callers
      // can't both settle the same order.
      const now = new Date().toISOString()
      const { data: claimed } = await db
        .from('orders')
        .update({ status: 'COMPLETED', order_state: 'delivered', completed_at: now, rider_payment_status: 'HELD', updated_at: now })
        .eq('id', o.id)
        .eq('status', 'DELIVERED')
        .select('id')
      if (!claimed || claimed.length === 0) continue

      await completeOrderPayout({
        id: o.id, order_number: o.order_number,
        vendor_id: o.vendor_id, rider_id: o.rider_id,
        subtotal: Number(o.subtotal) || 0,
        rider_delivery_cut: Number(o.rider_delivery_cut) || 0,
        tip_amount: Number(o.tip_amount) || 0,
      })
      await emailCommittedOrderStatus(db, {
        orderId: o.id,
        status: 'COMPLETED',
        actorType: 'system',
        actorId: `settle:${userType}:${userId}`,
      })
      void maybeApplyLateDeliveryCredit(o.id).catch((err) => {
        console.error('[settleDueDeliveries] late delivery credit failed:', err)
      })
      settled++
    } catch (err) {
      console.error(`[settleDueDeliveries] failed for ${o.order_number}:`, err)
    }
  }
  return settled
}
