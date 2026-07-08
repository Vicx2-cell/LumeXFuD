import type { OrderStatus } from '@/types'

export type OrderState =
  | 'placed'
  | 'vendor_ack'
  | 'preparing'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'late_delivered'
  | 'cancelled'

export const PICKUP_CEILING_MS = 2 * 60 * 60 * 1000
export const MAX_READY_EXTENSION_COUNT = 1
export const ORDER_AUTO_CANCELLED_CODE = 'ORDER_AUTO_CANCELLED'
export const ORDER_AUTO_CANCELLED_MESSAGE =
  'This order was auto-cancelled before pickup. Do not collect it from the vendor.'

const STATUS_TO_STATE: Partial<Record<OrderStatus, OrderState>> = {
  PENDING: 'placed',
  VENDOR_ACCEPTED: 'vendor_ack',
  PREPARING: 'preparing',
  READY: 'ready_for_pickup',
  RIDER_ASSIGNED: 'ready_for_pickup',
  PICKED_UP: 'picked_up',
  DELIVERED: 'delivered',
  COMPLETED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'cancelled',
  NO_SHOW: 'cancelled',
}

export const UNPICKED_CEILING_STATUSES: OrderStatus[] = [
  'PENDING',
  'VENDOR_ACCEPTED',
  'PREPARING',
  'READY',
  'RIDER_ASSIGNED',
]

export function orderStateForStatus(status: OrderStatus): OrderState | null {
  return STATUS_TO_STATE[status] ?? null
}

export function paidLiveAt(input: { placed_at?: string | null; pending_since?: string | null }): Date | null {
  const raw = input.placed_at ?? input.pending_since ?? null
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export function pickupCeilingAt(input: { placed_at?: string | null; pending_since?: string | null }): Date | null {
  const start = paidLiveAt(input)
  if (!start) return null
  return new Date(start.getTime() + PICKUP_CEILING_MS)
}

export function promisedReadyAt(
  vendorAckAt: Date,
  prepMinutes: number | null | undefined,
  paidLiveStart: Date | null,
): Date {
  const prep = Number.isFinite(Number(prepMinutes)) && Number(prepMinutes) > 0 ? Number(prepMinutes) : 0
  const candidate = new Date(vendorAckAt.getTime() + prep * 60_000)
  if (!paidLiveStart) return candidate
  const ceiling = new Date(paidLiveStart.getTime() + PICKUP_CEILING_MS)
  return candidate.getTime() > ceiling.getTime() ? ceiling : candidate
}

export function extendPromisedReadyAt(
  currentPromisedReadyAt: Date,
  extensionMinutes: number,
  paidLiveStart: Date | null,
): Date {
  const candidate = new Date(currentPromisedReadyAt.getTime() + extensionMinutes * 60_000)
  if (!paidLiveStart) return candidate
  const ceiling = new Date(paidLiveStart.getTime() + PICKUP_CEILING_MS)
  return candidate.getTime() > ceiling.getTime() ? ceiling : candidate
}
