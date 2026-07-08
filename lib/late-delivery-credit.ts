import { createSupabaseAdmin } from './supabase/server'
import { refundToCustomerWallet } from './customer-wallet'
import { notifyInApp } from './notifications'
import { recordPlatformEarning } from './platform-earnings'
import { recordSecurityEvent } from './security-events'

type DB = ReturnType<typeof createSupabaseAdmin>

export type LateDeliveryStage = 'vendor_prep' | 'pickup_wait' | 'transit'

export interface LateDeliveryCreditOrder {
  id: string
  order_number: string
  status: string
  order_state: string | null
  payment_status: string
  customer_id: string | null
  vendor_id: string | null
  rider_id: string | null
  delivery_type: string
  platform_markup: number
  platform_delivery_cut: number
  promised_ready_at: string | null
  ready_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  late_delivery_credit_applied_at: string | null
}

export interface LateDeliveryCreditDecision {
  eligible: boolean
  creditKobo: number
  lateMinutes: number
  stage: LateDeliveryStage | null
  reason?: string
  lateAfter?: string
  transitEstimateMinutes: number
  pickupWaitGraceMinutes: number
}

export const TRANSIT_ESTIMATE_MINUTES = 8
export const PICKUP_WAIT_GRACE_MINUTES = 15
const MIN_CREDIT_KOBO = 10_000
const CREDIT_PER_10_MINUTES_KOBO = 5_000

function validDate(raw: string | null): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function minutesLate(lateAfter: Date, deliveredAt: Date): number {
  return Math.max(0, Math.ceil((deliveredAt.getTime() - lateAfter.getTime()) / 60_000))
}

function delayStage(order: LateDeliveryCreditOrder, promisedReadyAt: Date): LateDeliveryStage {
  const readyAt = validDate(order.ready_at)
  const pickedUpAt = validDate(order.picked_up_at)
  if (!readyAt || readyAt.getTime() > promisedReadyAt.getTime()) return 'vendor_prep'
  if (!pickedUpAt) return 'pickup_wait'
  const pickupWaitLimit = new Date(readyAt.getTime() + PICKUP_WAIT_GRACE_MINUTES * 60_000)
  if (pickedUpAt.getTime() > pickupWaitLimit.getTime()) return 'pickup_wait'
  return 'transit'
}

export function calculateLateDeliveryCredit(order: LateDeliveryCreditOrder): LateDeliveryCreditDecision {
  const base = {
    eligible: false,
    creditKobo: 0,
    lateMinutes: 0,
    stage: null,
    transitEstimateMinutes: TRANSIT_ESTIMATE_MINUTES,
    pickupWaitGraceMinutes: PICKUP_WAIT_GRACE_MINUTES,
  }

  if (!['DELIVERED', 'COMPLETED'].includes(order.status)) return { ...base, reason: 'not_delivered' }
  if (order.order_state === 'cancelled' || order.status === 'CANCELLED') return { ...base, reason: 'cancelled' }
  if (order.payment_status !== 'PAID') return { ...base, reason: 'not_paid' }
  if (!order.customer_id) return { ...base, reason: 'no_customer' }
  if (order.delivery_type === 'PICKUP') return { ...base, reason: 'pickup_order' }
  if (order.late_delivery_credit_applied_at) return { ...base, reason: 'already_applied' }

  const promisedReadyAt = validDate(order.promised_ready_at)
  const deliveredAt = validDate(order.delivered_at)
  if (!promisedReadyAt || !deliveredAt) return { ...base, reason: 'missing_timestamp' }

  const lateAfter = new Date(promisedReadyAt.getTime() + TRANSIT_ESTIMATE_MINUTES * 60_000)
  const lateMinutes = minutesLate(lateAfter, deliveredAt)
  if (lateMinutes <= 0) {
    return {
      ...base,
      reason: 'on_time',
      lateAfter: lateAfter.toISOString(),
    }
  }

  const platformMargin = Math.max(0, Number(order.platform_markup) + Number(order.platform_delivery_cut))
  const scaled = Math.max(MIN_CREDIT_KOBO, Math.ceil(lateMinutes / 10) * CREDIT_PER_10_MINUTES_KOBO)
  const creditKobo = Math.min(platformMargin, scaled)
  if (creditKobo <= 0) return { ...base, reason: 'no_platform_margin', lateMinutes, lateAfter: lateAfter.toISOString() }

  return {
    eligible: true,
    creditKobo,
    lateMinutes,
    stage: delayStage(order, promisedReadyAt),
    lateAfter: lateAfter.toISOString(),
    transitEstimateMinutes: TRANSIT_ESTIMATE_MINUTES,
    pickupWaitGraceMinutes: PICKUP_WAIT_GRACE_MINUTES,
  }
}

export async function maybeApplyLateDeliveryCredit(orderId: string, db: DB = createSupabaseAdmin()): Promise<LateDeliveryCreditDecision> {
  const { data: raw } = await db
    .from('orders')
    .select('id, order_number, status, order_state, payment_status, customer_id, vendor_id, rider_id, delivery_type, platform_markup, platform_delivery_cut, promised_ready_at, ready_at, picked_up_at, delivered_at, late_delivery_credit_applied_at')
    .eq('id', orderId)
    .maybeSingle()

  const order = raw as LateDeliveryCreditOrder | null
  if (!order) {
    return {
      eligible: false,
      creditKobo: 0,
      lateMinutes: 0,
      stage: null,
      reason: 'not_found',
      transitEstimateMinutes: TRANSIT_ESTIMATE_MINUTES,
      pickupWaitGraceMinutes: PICKUP_WAIT_GRACE_MINUTES,
    }
  }

  const decision = calculateLateDeliveryCredit(order)
  if (!decision.eligible || !order.customer_id || !decision.stage) return decision

  const reference = `LATE-${order.id}`
  const reason = `Late delivery credit for order #${order.order_number}`
  const walletOk = await refundToCustomerWallet({
    customerId: order.customer_id,
    amountKobo: decision.creditKobo,
    orderId: order.id,
    reference,
    reason,
  })

  let credited = walletOk
  if (!credited) {
    const { data: existing } = await db
      .from('customer_wallet_transactions')
      .select('id')
      .eq('reference', reference)
      .maybeSingle()
    credited = !!existing
  }
  if (!credited) return { ...decision, eligible: false, reason: 'wallet_credit_failed' }

  const now = new Date().toISOString()
  const { data: claimed } = await db
    .from('orders')
    .update({
      late_delivery_credit_applied_at: now,
      late_delivery_credit_kobo: decision.creditKobo,
      late_delivery_credit_stage: decision.stage,
      late_delivery_credit_reference: reference,
      order_state: 'late_delivered',
      updated_at: now,
    })
    .eq('id', order.id)
    .is('late_delivery_credit_applied_at', null)
    .in('status', ['DELIVERED', 'COMPLETED'])
    .select('id')

  if (!claimed || claimed.length === 0) {
    return { ...decision, eligible: false, reason: 'already_applied' }
  }

  void recordPlatformEarning({
    type: 'LATE_DELIVERY_CREDIT_COST',
    amount_kobo: -decision.creditKobo,
    order_id: order.id,
    description: `Late delivery credit - order ${order.order_number}`,
  })

  void notifyInApp({
    userId: order.customer_id,
    userType: 'CUSTOMER',
    title: 'Late delivery credit added',
    body: `Order ${order.order_number} arrived late, so a credit has been added to your LumeX Wallet.`,
    link: `/order/${order.order_number}`,
    template: 'LATE_DELIVERY_CREDIT',
  })

  void recordSecurityEvent({
    eventType: 'late_delivery_credit_issued',
    severity: 'info',
    surface: 'orders.late_delivery_credit',
    actorId: 'SYSTEM',
    actorRole: 'admin',
    detail: {
      order_id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id,
      vendor_id: order.vendor_id,
      rider_id: order.rider_id,
      credit_kobo: decision.creditKobo,
      late_minutes: decision.lateMinutes,
      delay_stage: decision.stage,
      promised_ready_at: order.promised_ready_at,
      delivered_at: order.delivered_at,
      late_after: decision.lateAfter,
      transit_estimate_minutes: decision.transitEstimateMinutes,
      pickup_wait_grace_minutes: decision.pickupWaitGraceMinutes,
      platform_absorbs_cost: true,
    },
  })

  return decision
}
