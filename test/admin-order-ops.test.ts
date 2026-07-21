import { describe, expect, it } from 'vitest'
import { buildOrderTimeline, parseAdminOrderSearch, sanitizeUuidList } from '@/lib/admin-order-ops'

describe('admin order operations helpers', () => {
  it('classifies operational order searches', () => {
    expect(parseAdminOrderSearch(' LXF-2026-42 ').kind).toBe('order')
    expect(parseAdminOrderSearch('+234 801 234 5678').kind).toBe('phone')
    expect(parseAdminOrderSearch('7b6c8a12-5e0b-4f23-9a80-384d5464584b').kind).toBe('uuid')
    expect(parseAdminOrderSearch('Mama Nkechi').kind).toBe('text')
    expect(parseAdminOrderSearch('').kind).toBe('empty')
  })

  it('only passes valid UUIDs into Supabase in() filters', () => {
    expect(sanitizeUuidList([
      '7b6c8a12-5e0b-4f23-9a80-384d5464584b',
      'not-a-uuid',
      '7b6c8a12-5e0b-4f23-9a80-384d5464584b',
    ])).toEqual(['7b6c8a12-5e0b-4f23-9a80-384d5464584b'])
  })

  it('builds a chronological operator timeline from order, payment, dispute, refund, and audit evidence', () => {
    const timeline = buildOrderTimeline({
      order: {
        id: 'order-1',
        status: 'REFUNDED',
        payment_status: 'REFUNDED',
        rider_payment_status: 'HELD',
        created_at: '2026-07-21T09:00:00.000Z',
        placed_at: '2026-07-21T09:02:00.000Z',
        ready_at: '2026-07-21T09:20:00.000Z',
        updated_at: '2026-07-21T10:00:00.000Z',
      },
      disputes: [{ id: 'disp-1', status: 'OPEN', reason: 'wrong_item', created_at: '2026-07-21T09:45:00.000Z' }],
      refunds: [{ id: 'ref-1', status: 'PROCESSING', amount_kobo: 250000, created_at: '2026-07-21T09:50:00.000Z' }],
      audits: [{ id: 'audit-1', action: 'manual_refund', actor_id: 'adm', actor_role: 'admin', created_at: '2026-07-21T09:49:00.000Z' }],
      webhooks: [{ id: 'wh-1', event: 'charge.success', reference: 'PSK-1', created_at: '2026-07-21T09:03:00.000Z' }],
    })

    expect(timeline.map((event) => event.label)).toEqual([
      'Order created',
      'Order placed',
      'Webhook charge.success',
      'Order ready',
      'Dispute OPEN',
      'manual_refund',
      'Refund PROCESSING',
      'Last order update',
    ])
  })
})
