import { describe, expect, it } from 'vitest'
import { reconcileGroupOrder, type ReconciliationInput } from '@/lib/group-order-reconciliation'

function input(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    vendorAvailable: true,
    budgetKobo: 500000,
    participants: [{ id: 'participant', status: 'READY' }],
    items: [{ id: 'line', participant_id: 'participant', menu_item_id: 'item', unit_price_kobo: 200000, quantity: 1, addons: [{ id: 'addon', name: 'Egg', price_kobo: 50000 }] }],
    currentItems: new Map([['item', { name: 'Rice', price_kobo: 200000, is_available: true }]]),
    currentAddons: new Map([['addon', { name: 'Egg', price_kobo: 50000, is_available: true, menu_item_id: 'item' }]]),
    ...overrides,
  }
}

describe('group final reconciliation', () => {
  it('accepts an unchanged ready group', () => {
    expect(reconcileGroupOrder(input())).toEqual([])
  })

  it('reports lock-time participant, price, availability, vendor and budget conflicts', () => {
    const result = reconcileGroupOrder(input({
      vendorAvailable: false,
      budgetKobo: 100000,
      participants: [{ id: 'participant', status: 'EDITING' }],
      currentItems: new Map([['item', { name: 'Rice', price_kobo: 250000, is_available: true }]]),
      currentAddons: new Map([['addon', { name: 'Egg', price_kobo: 70000, is_available: false, menu_item_id: 'item' }]]),
    }))
    expect(result.map((issue) => issue.type)).toEqual(expect.arrayContaining([
      'vendor_unavailable', 'participant_incomplete', 'item_price_changed', 'addon_unavailable', 'budget_exceeded',
    ]))
  })
})
