import { describe, expect, it } from 'vitest'
import { calculateLateDeliveryCredit } from './late-delivery-credit'
import type { LateDeliveryCreditOrder } from './late-delivery-credit'

const baseOrder: LateDeliveryCreditOrder = {
  id: 'order-1',
  order_number: 'LXF-2026-000001',
  status: 'COMPLETED',
  order_state: 'delivered',
  payment_status: 'PAID',
  customer_id: 'customer-1',
  vendor_id: 'vendor-1',
  rider_id: 'rider-1',
  delivery_type: 'BIKE',
  platform_markup: 25_000,
  platform_delivery_cut: 10_000,
  promised_ready_at: '2026-07-08T10:00:00.000Z',
  ready_at: '2026-07-08T10:00:00.000Z',
  picked_up_at: '2026-07-08T10:03:00.000Z',
  delivered_at: '2026-07-08T10:20:00.000Z',
  late_delivery_credit_applied_at: null,
}

describe('late delivery credit', () => {
  it('measures lateness against the current promised_ready_at', () => {
    expect(calculateLateDeliveryCredit(baseOrder).lateMinutes).toBe(12)
    expect(calculateLateDeliveryCredit({
      ...baseOrder,
      promised_ready_at: '2026-07-08T10:15:00.000Z',
    }).eligible).toBe(false)
  })

  it('scales credit with lateness and caps it at platform margin', () => {
    const decision = calculateLateDeliveryCredit({
      ...baseOrder,
      delivered_at: '2026-07-08T11:40:00.000Z',
    })
    expect(decision.eligible).toBe(true)
    expect(decision.creditKobo).toBe(35_000)
  })

  it('attributes the dominant late stage for logging only', () => {
    expect(calculateLateDeliveryCredit({
      ...baseOrder,
      ready_at: '2026-07-08T10:14:00.000Z',
    }).stage).toBe('vendor_prep')
    expect(calculateLateDeliveryCredit({
      ...baseOrder,
      picked_up_at: '2026-07-08T10:20:00.000Z',
    }).stage).toBe('pickup_wait')
    expect(calculateLateDeliveryCredit(baseOrder).stage).toBe('transit')
  })

  it('excludes cancelled, pickup, unpaid, and already credited orders', () => {
    expect(calculateLateDeliveryCredit({ ...baseOrder, status: 'CANCELLED', order_state: 'cancelled' }).eligible).toBe(false)
    expect(calculateLateDeliveryCredit({ ...baseOrder, delivery_type: 'PICKUP' }).eligible).toBe(false)
    expect(calculateLateDeliveryCredit({ ...baseOrder, payment_status: 'REFUNDED' }).eligible).toBe(false)
    expect(calculateLateDeliveryCredit({ ...baseOrder, late_delivery_credit_applied_at: '2026-07-08T10:25:00.000Z' }).eligible).toBe(false)
  })
})
