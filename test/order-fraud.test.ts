import { describe, expect, it } from 'vitest'
import { evaluateOrderCreationRisk, hashOrderDestination, hashOrderIntent, normalizeIdempotencyKey } from '@/lib/order-fraud'

const intent = {
  customerId: 'customer-1', vendorId: 'vendor-1',
  items: [{ menuItemId: 'item-1', quantity: 2, addonIds: ['b', 'a'] }],
  deliveryType: 'BIKE', destinationHash: hashOrderDestination({ address: 'Hall 2', latitude: 6.1, longitude: 5.2 }),
  paymentMethod: 'PAYSTACK', applyReward: false, groupOrderId: null,
  scheduledFor: null, subtotalKobo: 2000, totalKobo: 2500,
}

describe('order manipulation evidence', () => {
  it('accepts bounded opaque keys and rejects header abuse', () => {
    expect(normalizeIdempotencyKey('checkout:12345678')).toBe('checkout:12345678')
    expect(normalizeIdempotencyKey('short')).toBeNull()
    expect(normalizeIdempotencyKey('x'.repeat(129))).toBeNull()
    expect(normalizeIdempotencyKey('bad key with spaces')).toBeNull()
  })

  it('is stable across addon/item ordering but changes with authoritative price or quantity', () => {
    const reordered = { ...intent, items: [{ ...intent.items[0], addonIds: ['a', 'b'] }] }
    expect(hashOrderIntent(reordered)).toBe(hashOrderIntent(intent))
    expect(hashOrderIntent({ ...intent, totalKobo: 2499 })).not.toBe(hashOrderIntent(intent))
    expect(hashOrderIntent({ ...intent, items: [{ ...intent.items[0], quantity: 3 }] })).not.toBe(hashOrderIntent(intent))
    expect(hashOrderIntent({ ...intent, destinationHash: hashOrderDestination({ address: 'Hall 3', latitude: 6.1, longitude: 5.2 }) })).not.toBe(hashOrderIntent(intent))
    expect(hashOrderIntent({ ...intent, paymentMethod: 'WALLET' })).not.toBe(hashOrderIntent(intent))
  })

  it('keeps one large basket observe-only', () => {
    const result = evaluateOrderCreationRisk({ pendingOrders30m: 0, totalItemQuantity: 30 })
    expect(result.actions).toEqual(['observe'])
  })

  it('signals unpaid velocity and payload substitution without permanent accusation', () => {
    const result = evaluateOrderCreationRisk({
      pendingOrders30m: 6, totalItemQuantity: 2, idempotencyPayloadMismatch: true,
    })
    expect(result.triggeredRules).toEqual(expect.arrayContaining([
      'order_unpaid_velocity_30m', 'order_idempotency_payload_mismatch',
    ]))
    expect(result.actions as string[]).not.toContain('permanent_ban')
    const mismatchOnly = evaluateOrderCreationRisk({
      pendingOrders30m: 0, totalItemQuantity: 2, idempotencyPayloadMismatch: true,
    })
    expect(mismatchOnly.actions).not.toContain('freeze_financial_operations')
    expect(mismatchOnly.actions).not.toContain('create_evidence_hold')
  })
})
