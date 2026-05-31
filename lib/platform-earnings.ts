/**
 * Platform Earnings — LumeX Fud
 *
 * Every naira that belongs to the founder (Chibuike) flows through here.
 * Positive amount  = revenue earned by the platform.
 * Negative amount  = cost paid out by the platform.
 *
 * Called fire-and-forget (void) from order status, cron, and webhook handlers
 * so a recording failure never blocks the main business flow.
 */

import { createSupabaseAdmin } from './supabase/server'

export type PlatformEarningType =
  | 'FOOD_MARKUP'         // +₦250 per completed order
  | 'DELIVERY_CUT'        // +₦100 bike / +₦200 door per completed order
  | 'VENDOR_SUBSCRIPTION' // +subscription amount when vendor pays monthly fee
  | 'WALLET_TOPUP_FLOAT'  // +top-up amount when customer loads wallet (optional tracking)
  | 'RIDER_BONUS_COST'    // −bonus amount when milestone bonus awarded to rider
  | 'TOPUP_BONUS_COST'    // −bonus amount when wallet top-up bonus issued to customer
  | 'REFUND_COST'         // −refund amount when order refunded

export interface RecordEarningParams {
  type:        PlatformEarningType
  amount_kobo: number          // positive = income, negative = cost
  order_id?:   string          // UUID string (optional)
  description?: string
}

/**
 * Insert a single platform_earnings record.
 * Non-blocking — always call with `void recordPlatformEarning(...)` so it
 * never slows down or breaks the surrounding request.
 */
export async function recordPlatformEarning(params: RecordEarningParams): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    const { error } = await db.from('platform_earnings').insert({
      type:        params.type,
      amount_kobo: params.amount_kobo,
      order_id:    params.order_id ?? null,
      description: params.description ?? null,
    })
    if (error) {
      console.error('[platform-earnings] insert failed:', error.message, params)
    }
  } catch (err) {
    console.error('[platform-earnings] unexpected error:', err, params)
  }
}

/**
 * Record both FOOD_MARKUP and DELIVERY_CUT when an order is COMPLETED.
 * Pass the raw kobo values straight from the orders table.
 */
export async function recordOrderCompletedEarnings(params: {
  order_id:              string
  platform_markup_kobo:  number
  delivery_cut_kobo:     number
  order_number:          string
}): Promise<void> {
  const db = createSupabaseAdmin()
  const rows = []

  if (params.platform_markup_kobo > 0) {
    rows.push({
      type:        'FOOD_MARKUP' as PlatformEarningType,
      amount_kobo: params.platform_markup_kobo,
      order_id:    params.order_id,
      description: `Food markup — order ${params.order_number}`,
    })
  }

  if (params.delivery_cut_kobo > 0) {
    rows.push({
      type:        'DELIVERY_CUT' as PlatformEarningType,
      amount_kobo: params.delivery_cut_kobo,
      order_id:    params.order_id,
      description: `Delivery cut — order ${params.order_number}`,
    })
  }

  if (rows.length === 0) return

  try {
    const { error } = await db.from('platform_earnings').insert(rows)
    if (error) {
      console.error('[platform-earnings] order-completed insert failed:', error.message)
    }
  } catch (err) {
    console.error('[platform-earnings] recordOrderCompletedEarnings error:', err)
  }
}
