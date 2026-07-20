import 'server-only'

import type { createSupabaseAdmin } from './supabase/server'
import { notifyInApp } from './notifications'
import { recordSecurityEvent } from './security-events'
import { sendDelayedOrderEmail } from './transactional-email'

type DB = ReturnType<typeof createSupabaseAdmin>

export const DELIVERY_TARGET_MINUTES = 25
export const HIGH_ESTIMATE_MINUTES = 30
export const DELAY_WARNING_WINDOW_MINUTES = 5

export type DelayOwner = 'vendor' | 'dispatch' | 'rider'
export type DelaySignal = 'at_risk' | 'overdue'

export interface SpeedOrder {
  id: string
  order_number: string
  status: string
  payment_status: string
  delivery_type: string
  customer_id: string | null
  vendor_id: string | null
  rider_id: string | null
  placed_at: string | null
  pending_since: string | null
  promised_delivery_at: string | null
}

export interface DelayDecision {
  delayed: boolean
  signal: DelaySignal | null
  owner: DelayOwner | null
  deadlineAt: string | null
  projectedAt: string | null
  minutesLate: number
  reason: string | null
}

const TERMINAL = new Set(['DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'NO_SHOW'])
const MINIMUM_REMAINING_MINUTES: Record<string, number> = {
  PENDING: 15,
  VENDOR_ACCEPTED: 12,
  PREPARING: 12,
  READY: 10,
  RIDER_ASSIGNED: 8,
  PICKED_UP: 4,
}

function date(raw: string | null): Date | null {
  if (!raw) return null
  const value = new Date(raw)
  return Number.isNaN(value.getTime()) ? null : value
}

export function speedTargetAt(placedAt: Date): Date {
  return new Date(placedAt.getTime() + DELIVERY_TARGET_MINUTES * 60_000)
}

export function deliveryPromiseAt(acceptedAt: Date, prepMinutes: number, deliveryMinutes: number): Date {
  return new Date(acceptedAt.getTime() + (prepMinutes + deliveryMinutes) * 60_000)
}

export function estimateNeedsReason(prepMinutes: number, deliveryMinutes: number): boolean {
  return prepMinutes + deliveryMinutes > HIGH_ESTIMATE_MINUTES
}

function delayOwner(status: string): DelayOwner {
  if (['PENDING', 'VENDOR_ACCEPTED', 'PREPARING'].includes(status)) return 'vendor'
  if (status === 'READY') return 'dispatch'
  return 'rider'
}

export function evaluateOrderDelay(order: SpeedOrder, now = new Date()): DelayDecision {
  const none: DelayDecision = { delayed: false, signal: null, owner: null, deadlineAt: null, projectedAt: null, minutesLate: 0, reason: null }
  if (order.payment_status !== 'PAID' || order.delivery_type === 'PICKUP' || TERMINAL.has(order.status)) return none
  const started = date(order.placed_at ?? order.pending_since)
  if (!started) return { ...none, reason: 'missing_start_time' }
  const target = speedTargetAt(started)
  const promise = date(order.promised_delivery_at)
  const deadline = promise && promise.getTime() < target.getTime() ? promise : target
  const remaining = MINIMUM_REMAINING_MINUTES[order.status]
  if (remaining === undefined) return { ...none, deadlineAt: deadline.toISOString(), reason: 'unsupported_status' }
  const projected = new Date(now.getTime() + remaining * 60_000)
  const overdue = now.getTime() >= deadline.getTime()
  const withinWarningWindow = deadline.getTime() - now.getTime() <= DELAY_WARNING_WINDOW_MINUTES * 60_000
  const atRisk = withinWarningWindow && projected.getTime() > deadline.getTime()
  if (!overdue && !atRisk) return { ...none, deadlineAt: deadline.toISOString(), projectedAt: projected.toISOString(), reason: 'on_track' }
  return {
    delayed: true,
    signal: overdue ? 'overdue' : 'at_risk',
    owner: delayOwner(order.status),
    deadlineAt: deadline.toISOString(),
    projectedAt: projected.toISOString(),
    minutesLate: Math.max(0, Math.ceil((projected.getTime() - deadline.getTime()) / 60_000)),
    reason: overdue ? 'delivery_deadline_passed' : 'projected_to_miss_deadline',
  }
}

export async function processOrderDelay(db: DB, order: SpeedOrder, now = new Date()): Promise<DelayDecision> {
  const decision = evaluateOrderDelay(order, now)
  if (!decision.delayed || !decision.signal || !decision.owner) return decision

  const { data: incident } = await db.from('order_speed_incidents').insert({
    order_id: order.id,
    signal: decision.signal,
    responsible_party: decision.owner,
    status_at_detection: order.status,
    deadline_at: decision.deadlineAt,
    projected_delivery_at: decision.projectedAt,
    minutes_late: decision.minutesLate,
  }).select('id').maybeSingle()

  if (incident) {
    await db.from('orders').update({ delay_detected_at: now.toISOString(), delay_owner: decision.owner }).eq('id', order.id).is('delay_detected_at', null)
    const link = `/order/${order.order_number}`
    if (decision.owner === 'vendor' && order.vendor_id) {
      void notifyInApp({ userId: order.vendor_id, userType: 'VENDOR', title: 'Order speed alert', body: `Order ${order.order_number} is likely to miss its delivery target. Please act now.`, link: '/vendor-dashboard/orders', template: 'ORDER_DELAY_ALERT' })
    }
    if (decision.owner === 'rider' && order.rider_id) {
      void notifyInApp({ userId: order.rider_id, userType: 'RIDER', title: 'Delivery speed alert', body: `Order ${order.order_number} is likely to miss its delivery target.`, link, template: 'ORDER_DELAY_ALERT' })
    }
    void recordSecurityEvent({
      eventType: 'order_delivery_delay_detected', severity: 'warn', surface: 'orders.speed', actorId: 'SYSTEM', actorRole: 'admin',
      detail: { order_id: order.id, order_number: order.order_number, status: order.status, signal: decision.signal, responsible_party: decision.owner, deadline_at: decision.deadlineAt, projected_delivery_at: decision.projectedAt, minutes_late: decision.minutesLate },
    })
  }

  await sendDelayedOrderEmail(db, { orderId: order.id, projectedDeliveryAt: decision.projectedAt })
  return decision
}
