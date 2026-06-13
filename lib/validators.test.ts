import { describe, it, expect } from 'vitest'
import { createOrderInput, menuAddonInput, createMenuItemInput } from './validators'

// Server-side validation tests for the menu/order min/max constraints. These run
// against the real Zod schemas the API routes use (app/api/orders, app/api/vendor/menu),
// so they prove the server rejects out-of-bounds input before any DB work.
//
// NOTE: this codebase has no "option group" min/max *select* model — the menu uses
// flat priced add-ons (migration 020). The min/max constraints that actually exist
// are: item quantity 1..20, add-ons per item <=20, items per order 1..50, and the
// menu add-on/item price + name bounds. Those are what's covered here.

const UUID = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'

function order(overrides: Record<string, unknown> = {}) {
  return {
    vendor_id: UUID,
    items: [{ menu_item_id: UUID2, quantity: 1 }],
    delivery_type: 'BIKE',
    delivery_address: 'Hall 3, Room 12',
    ...overrides,
  }
}

function items(arr: unknown[]) {
  return order({ items: arr })
}

describe('createOrderInput — item quantity (min 1, max 20)', () => {
  it('accepts the boundaries 1 and 20', () => {
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 1 }])).success).toBe(true)
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 20 }])).success).toBe(true)
  })

  it('rejects quantity 0, negative, and above 20', () => {
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 0 }])).success).toBe(false)
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: -1 }])).success).toBe(false)
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 21 }])).success).toBe(false)
  })

  it('rejects a non-integer quantity', () => {
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 1.5 }])).success).toBe(false)
  })
})

describe('createOrderInput — add-ons per item (max 20, uuid)', () => {
  it('defaults missing add-ons to an empty array', () => {
    const res = createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 1 }]))
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.items[0].addons).toEqual([])
  })

  it('accepts exactly 20 add-ons and rejects 21', () => {
    const twenty = Array.from({ length: 20 }, () => UUID)
    const twentyOne = Array.from({ length: 21 }, () => UUID)
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 1, addons: twenty }])).success).toBe(true)
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 1, addons: twentyOne }])).success).toBe(false)
  })

  it('rejects a non-uuid add-on id', () => {
    expect(createOrderInput.safeParse(items([{ menu_item_id: UUID2, quantity: 1, addons: ['not-a-uuid'] }])).success).toBe(false)
  })
})

describe('createOrderInput — items per order (min 1, max 50)', () => {
  it('rejects an empty items array', () => {
    expect(createOrderInput.safeParse(items([])).success).toBe(false)
  })

  it('accepts 50 items and rejects 51', () => {
    const fifty = Array.from({ length: 50 }, () => ({ menu_item_id: UUID2, quantity: 1 }))
    const fiftyOne = Array.from({ length: 51 }, () => ({ menu_item_id: UUID2, quantity: 1 }))
    expect(createOrderInput.safeParse(items(fifty)).success).toBe(true)
    expect(createOrderInput.safeParse(items(fiftyOne)).success).toBe(false)
  })
})

describe('createOrderInput — other field bounds + defaults', () => {
  it('rejects a non-uuid vendor_id or menu_item_id', () => {
    expect(createOrderInput.safeParse(order({ vendor_id: 'nope' })).success).toBe(false)
    expect(createOrderInput.safeParse(items([{ menu_item_id: 'nope', quantity: 1 }])).success).toBe(false)
  })

  it('rejects an out-of-enum delivery_type', () => {
    expect(createOrderInput.safeParse(order({ delivery_type: 'TELEPORT' })).success).toBe(false)
  })

  it('enforces delivery_address length (min 5, max 500)', () => {
    expect(createOrderInput.safeParse(order({ delivery_address: 'abc' })).success).toBe(false)
    expect(createOrderInput.safeParse(order({ delivery_address: 'a'.repeat(501) })).success).toBe(false)
  })

  it('clamps the tip range (0..50000, integer) and defaults to 0', () => {
    expect(createOrderInput.safeParse(order({ tip_amount: -1 })).success).toBe(false)
    expect(createOrderInput.safeParse(order({ tip_amount: 50001 })).success).toBe(false)
    expect(createOrderInput.safeParse(order({ tip_amount: 100.5 })).success).toBe(false)
    const res = createOrderInput.safeParse(order())
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.tip_amount).toBe(0)
      expect(res.data.payment_method).toBe('PAYSTACK')
    }
  })
})

describe('menuAddonInput — name (1..60) + price_naira (0..100000)', () => {
  it('accepts a valid add-on', () => {
    expect(menuAddonInput.safeParse({ name: 'Extra meat', price_naira: 300 }).success).toBe(true)
  })

  it('rejects empty/over-long names', () => {
    expect(menuAddonInput.safeParse({ name: '', price_naira: 0 }).success).toBe(false)
    expect(menuAddonInput.safeParse({ name: 'x'.repeat(61), price_naira: 0 }).success).toBe(false)
  })

  it('rejects negative / over-cap / non-integer prices', () => {
    expect(menuAddonInput.safeParse({ name: 'a', price_naira: -1 }).success).toBe(false)
    expect(menuAddonInput.safeParse({ name: 'a', price_naira: 100_001 }).success).toBe(false)
    expect(menuAddonInput.safeParse({ name: 'a', price_naira: 1.5 }).success).toBe(false)
  })
})

describe('createMenuItemInput — price (min 1) + add-on list cap (max 20)', () => {
  const base = { name: 'Jollof Rice', price_naira: 1500, category: 'RICE' as const }

  it('accepts a valid item and defaults add-ons to []', () => {
    const res = createMenuItemInput.safeParse(base)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.addons).toEqual([])
  })

  it('rejects a zero price (min is 1, unlike add-ons which allow 0)', () => {
    expect(createMenuItemInput.safeParse({ ...base, price_naira: 0 }).success).toBe(false)
  })

  it('rejects more than 20 add-ons on an item', () => {
    const addons = Array.from({ length: 21 }, (_, i) => ({ name: `a${i}`, price_naira: 0 }))
    expect(createMenuItemInput.safeParse({ ...base, addons }).success).toBe(false)
  })

  it('rejects an unknown category', () => {
    expect(createMenuItemInput.safeParse({ ...base, category: 'PIZZA' }).success).toBe(false)
  })
})
