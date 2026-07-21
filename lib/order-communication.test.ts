import { describe, expect, it } from 'vitest'
import type { SessionPayload } from '@/lib/session'
import {
  authorizeOrderConversation,
  conversationWriteDeadline,
  isConversationWritable,
  sanitizeOrderMessage,
  type CommunicationOrder,
} from '@/lib/order-communication'

const order: CommunicationOrder = {
  id: 'order-1',
  customer_id: 'customer-1',
  vendor_id: 'vendor-1',
  rider_id: 'rider-1',
  status: 'PICKED_UP',
  delivered_at: null,
  cancelled_at: null,
}

function session(role: SessionPayload['role'], userId: string): SessionPayload {
  return { sessionId: 'session-1', phone: '+2348000000000', role, userId }
}

describe('order communication authorization', () => {
  it('permits customer ↔ assigned rider only', () => {
    expect(authorizeOrderConversation(session('customer', 'customer-1'), order, 'CUSTOMER_RIDER').ok).toBe(true)
    expect(authorizeOrderConversation(session('customer', 'customer-1'), order, 'VENDOR_RIDER').ok).toBe(false)
    expect(authorizeOrderConversation(session('rider', 'rider-1'), order, 'CUSTOMER_RIDER').ok).toBe(true)
  })

  it('permits vendor ↔ assigned rider only', () => {
    expect(authorizeOrderConversation(session('vendor', 'vendor-1'), order, 'VENDOR_RIDER').ok).toBe(true)
    expect(authorizeOrderConversation(session('vendor', 'vendor-1'), order, 'CUSTOMER_RIDER').ok).toBe(false)
    expect(authorizeOrderConversation(session('rider', 'rider-1'), order, 'VENDOR_RIDER').ok).toBe(true)
  })

  it('rejects a stale rider and staff from participant routes', () => {
    expect(authorizeOrderConversation(session('rider', 'rider-old'), order, 'CUSTOMER_RIDER').ok).toBe(false)
    expect(authorizeOrderConversation(session('admin', 'admin-1'), order, 'CUSTOMER_RIDER').ok).toBe(false)
    expect(authorizeOrderConversation(session('super_admin', 'admin-2'), order, 'VENDOR_RIDER').ok).toBe(false)
  })

  it('fails closed before a rider is assigned', () => {
    expect(authorizeOrderConversation(
      session('customer', 'customer-1'),
      { ...order, rider_id: null },
      'CUSTOMER_RIDER',
    ).ok).toBe(false)
  })
})

describe('order communication close window', () => {
  const delivered = { ...order, status: 'DELIVERED', delivered_at: '2026-07-21T10:00:00.000Z' }

  it('is writable through the configured grace deadline and locks immediately after', () => {
    expect(conversationWriteDeadline(delivered, 60)?.toISOString()).toBe('2026-07-21T11:00:00.000Z')
    expect(isConversationWritable(delivered, 60, new Date('2026-07-21T11:00:00.000Z'))).toBe(true)
    expect(isConversationWritable(delivered, 60, new Date('2026-07-21T11:00:00.001Z'))).toBe(false)
  })

  it('fails closed when a terminal order has no valid terminal timestamp', () => {
    expect(isConversationWritable({ ...order, status: 'CANCELLED' }, 60)).toBe(false)
  })
})

describe('message safety filtering', () => {
  it('removes links, phone numbers, markup, and control characters', () => {
    const value = sanitizeOrderMessage(' <b>Call</b> +234 801 234 5678 at https://evil.test or scam.ng/path\u0000 ')
    expect(value).toBe('Call [number removed] at [link removed] or [link removed]')
  })
})
