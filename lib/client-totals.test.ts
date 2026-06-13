import { describe, it, expect } from 'vitest'
import { createOrderInput } from './validators'

// Guarantee: the order API computes every money figure server-side from DB prices
// and the settings table (see app/api/orders/route.ts — subtotal/total/delivery_fee,
// and the wallet split recomputed from the live balance). The client never supplies
// a total. The first line of defence is the input schema, which strips any unknown
// keys, so a malicious client cannot smuggle a price/total/wallet amount into the
// handler. These tests pin that behaviour: if someone loosens the schema (e.g.
// .passthrough()), they break here.

const UUID = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'

const valid = {
  vendor_id: UUID,
  items: [{ menu_item_id: UUID2, quantity: 2 }],
  delivery_type: 'BIKE',
  delivery_address: 'Hall 3, Room 12',
}

describe('createOrderInput rejects client-sent totals/prices', () => {
  it('strips injected top-level money fields', () => {
    const res = createOrderInput.safeParse({
      ...valid,
      total_amount: 1,
      subtotal: 1,
      platform_markup: 0,
      delivery_fee: 0,
      wallet_amount_kobo: 999_999, // cart sends this; server must ignore it
    })
    expect(res.success).toBe(true)
    if (res.success) {
      const keys = Object.keys(res.data)
      expect(keys).not.toContain('total_amount')
      expect(keys).not.toContain('subtotal')
      expect(keys).not.toContain('platform_markup')
      expect(keys).not.toContain('delivery_fee')
      expect(keys).not.toContain('wallet_amount_kobo')
    }
  })

  it('strips per-item price overrides so add-on/base prices come only from the DB', () => {
    const res = createOrderInput.safeParse({
      ...valid,
      items: [{ menu_item_id: UUID2, quantity: 2, price_kobo: 1, price: 1, subtotal: 1 }],
    })
    expect(res.success).toBe(true)
    if (res.success) {
      const itemKeys = Object.keys(res.data.items[0])
      expect(itemKeys).not.toContain('price_kobo')
      expect(itemKeys).not.toContain('price')
      expect(itemKeys).not.toContain('subtotal')
      // Only the trusted, server-resolved fields survive.
      expect(itemKeys.sort()).toEqual(['addons', 'menu_item_id', 'quantity'])
    }
  })

  it('keeps only the whitelisted top-level fields', () => {
    const res = createOrderInput.safeParse(valid)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(Object.keys(res.data).sort()).toEqual([
        'delivery_address', 'delivery_type', 'items', 'payment_method', 'tip_amount', 'vendor_id',
      ])
    }
  })
})
