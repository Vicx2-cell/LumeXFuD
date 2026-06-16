import { describe, it, expect } from 'vitest'
import { classifyOrder, type LiveOrderInput } from '@/lib/live-ops'

const NOW = new Date('2026-06-17T12:00:00.000Z').getTime()
const agoMin = (m: number) => new Date(NOW - m * 60_000).toISOString()

function mk(p: Partial<LiveOrderInput>): LiveOrderInput {
  return {
    status: 'PREPARING',
    payment_status: 'PAID',
    created_at: agoMin(5),
    vendor_accepted_at: null,
    preparing_at: agoMin(5),
    ready_at: null,
    rider_assigned_at: null,
    picked_up_at: null,
    delivered_at: null,
    rider_id: 'r1',
    customer_dispute_count: 0,
    ...p,
  }
}

describe('live-ops anomaly engine', () => {
  it('a healthy in-progress order has no flags', () => {
    const c = classifyOrder(mk({ status: 'PREPARING', preparing_at: agoMin(5) }), NOW)
    expect(c.severity).toBe('none')
    expect(c.flags).toHaveLength(0)
    expect(c.age_min).toBe(5)
  })

  it('flags a PENDING order past the 6m vendor-accept deadline as critical', () => {
    const c = classifyOrder(mk({ status: 'PENDING', created_at: agoMin(7), preparing_at: null }), NOW)
    expect(c.severity).toBe('critical')
    expect(c.flags.some((f) => f.code === 'STUCK_PENDING')).toBe(true)
  })

  it('flags a READY order with no rider as unassigned (critical past 15m)', () => {
    const c = classifyOrder(mk({ status: 'READY', ready_at: agoMin(20), rider_id: null, preparing_at: null }), NOW)
    expect(c.severity).toBe('critical')
    expect(c.flags.some((f) => f.code === 'UNASSIGNED')).toBe(true)
  })

  it('always flags a DISPUTED order critical', () => {
    const c = classifyOrder(mk({ status: 'DISPUTED', preparing_at: null }), NOW)
    expect(c.severity).toBe('critical')
    expect(c.flags.some((f) => f.code === 'DISPUTED')).toBe(true)
  })

  it('flags an order progressing while unpaid', () => {
    const c = classifyOrder(mk({ status: 'VENDOR_ACCEPTED', payment_status: 'PENDING', vendor_accepted_at: agoMin(1), preparing_at: null }), NOW)
    expect(c.severity).toBe('critical')
    expect(c.flags.some((f) => f.code === 'UNPAID')).toBe(true)
  })

  it('raises a warn on a high-dispute customer even when the order is on time', () => {
    const c = classifyOrder(mk({ status: 'PREPARING', preparing_at: agoMin(3), customer_dispute_count: 4 }), NOW)
    expect(c.severity).toBe('warn')
    expect(c.flags.some((f) => f.code === 'RISKY_CUSTOMER')).toBe(true)
  })

  it('a slow (not yet critical) preparing order is a warn', () => {
    const c = classifyOrder(mk({ status: 'PREPARING', preparing_at: agoMin(32) }), NOW)
    expect(c.severity).toBe('warn')
    expect(c.flags.some((f) => f.code === 'SLOW_PREPARING')).toBe(true)
  })
})
