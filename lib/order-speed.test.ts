import { describe, expect, it } from 'vitest'
import { deliveryPromiseAt, estimateNeedsReason, evaluateOrderDelay, speedTargetAt, type SpeedOrder } from './order-speed'

const base: SpeedOrder = {
  id: 'order-1', order_number: 'LXF-1', status: 'PREPARING', payment_status: 'PAID', delivery_type: 'BIKE',
  customer_id: 'customer-1', vendor_id: 'vendor-1', rider_id: null,
  placed_at: '2026-07-20T12:00:00.000Z', pending_since: null, promised_delivery_at: '2026-07-20T12:30:00.000Z',
}

describe('25-minute delivery SLA', () => {
  it('builds target and vendor promise from committed timestamps', () => {
    expect(speedTargetAt(new Date('2026-07-20T12:00:00Z')).toISOString()).toBe('2026-07-20T12:25:00.000Z')
    expect(deliveryPromiseAt(new Date('2026-07-20T12:02:00Z'), 12, 8).toISOString()).toBe('2026-07-20T12:22:00.000Z')
    expect(estimateNeedsReason(20, 11)).toBe(true)
    expect(estimateNeedsReason(17, 8)).toBe(false)
  })

  it('uses the earlier of the vendor promise and platform target', () => {
    const decision = evaluateOrderDelay({ ...base, promised_delivery_at: '2026-07-20T12:22:00Z' }, new Date('2026-07-20T12:18:00Z'))
    expect(decision.delayed).toBe(true)
    expect(decision.signal).toBe('at_risk')
    expect(decision.deadlineAt).toBe('2026-07-20T12:22:00.000Z')
    expect(decision.owner).toBe('vendor')
  })

  it('flags an overdue rider and ignores irrelevant or terminal orders', () => {
    const late = evaluateOrderDelay({ ...base, status: 'PICKED_UP', rider_id: 'rider-1' }, new Date('2026-07-20T12:26:00Z'))
    expect(late).toMatchObject({ delayed: true, signal: 'overdue', owner: 'rider' })
    expect(evaluateOrderDelay({ ...base, status: 'COMPLETED' }, new Date('2026-07-20T12:40:00Z')).delayed).toBe(false)
    expect(evaluateOrderDelay({ ...base, delivery_type: 'PICKUP' }, new Date('2026-07-20T12:40:00Z')).delayed).toBe(false)
  })

  it('does not alert while an order still has enough time', () => {
    const decision = evaluateOrderDelay(base, new Date('2026-07-20T12:05:00Z'))
    expect(decision).toMatchObject({ delayed: false, reason: 'on_track' })
  })
})
