import {
  MAX_READY_EXTENSION_COUNT,
  ORDER_AUTO_CANCELLED_CODE,
  extendPromisedReadyAt,
  orderStateForStatus,
  pickupCeilingAt,
  promisedReadyAt,
} from './order-state'
import { describe, expect, it } from 'vitest'

describe('order-state helpers', () => {
  it('maps legacy order statuses to explicit states', () => {
    expect(orderStateForStatus('PENDING')).toBe('placed')
    expect(orderStateForStatus('VENDOR_ACCEPTED')).toBe('vendor_ack')
    expect(orderStateForStatus('RIDER_ASSIGNED')).toBe('ready_for_pickup')
    expect(orderStateForStatus('PICKED_UP')).toBe('picked_up')
    expect(orderStateForStatus('COMPLETED')).toBe('delivered')
  })

  it('anchors the pickup ceiling to paid-live time', () => {
    const ceiling = pickupCeilingAt({ placed_at: '2026-07-08T10:00:00.000Z' })
    expect(ceiling?.toISOString()).toBe('2026-07-08T12:00:00.000Z')
  })

  it('caps promised ready and extensions at the paid-live ceiling', () => {
    const paidLive = new Date('2026-07-08T10:00:00.000Z')
    const ack = new Date('2026-07-08T11:50:00.000Z')
    expect(promisedReadyAt(ack, 20, paidLive).toISOString()).toBe('2026-07-08T12:00:00.000Z')
    expect(extendPromisedReadyAt(new Date('2026-07-08T11:55:00.000Z'), 20, paidLive).toISOString()).toBe('2026-07-08T12:00:00.000Z')
  })

  it('keeps the explicit rider conflict code stable', () => {
    expect(MAX_READY_EXTENSION_COUNT).toBe(1)
    expect(ORDER_AUTO_CANCELLED_CODE).toBe('ORDER_AUTO_CANCELLED')
  })
})
