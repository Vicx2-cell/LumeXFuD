import { describe, expect, it } from 'vitest'
import { cartLineKey, cartReducer, type CartState } from '@/components/cart-context'

const empty: CartState = { vendor_id: null, vendor_name: null, items: [] }

describe('cart context reducer', () => {
  it('keeps configured variants as separate lines and merges identical ones', () => {
    const first = cartReducer(empty, {
      type: 'ADD_ITEM',
      vendor_id: 'vendor-1',
      vendor_name: 'Vendor',
      item: {
        id: cartLineKey('item-1', [{ id: 'addon-1' }]),
        menu_item_id: 'item-1',
        name: 'Rice',
        price_kobo: 100000,
        quantity: 1,
        addons: [{ id: 'addon-1', name: 'Egg', price_kobo: 20000 }],
      },
    })
    const second = cartReducer(first, {
      type: 'ADD_ITEM',
      vendor_id: 'vendor-1',
      vendor_name: 'Vendor',
      item: {
        id: cartLineKey('item-1', [{ id: 'addon-2' }]),
        menu_item_id: 'item-1',
        name: 'Rice',
        price_kobo: 100000,
        quantity: 1,
        addons: [{ id: 'addon-2', name: 'Plantain', price_kobo: 30000 }],
      },
    })
    const third = cartReducer(second, {
      type: 'ADD_ITEM',
      vendor_id: 'vendor-1',
      vendor_name: 'Vendor',
      item: second.items[0],
    })

    expect(third.items).toHaveLength(2)
    expect(third.items[0].quantity).toBe(2)
    expect(third.items[1].quantity).toBe(1)
  })

  it('updates notes without losing add-ons or image data', () => {
    const state: CartState = {
      vendor_id: 'vendor-1',
      vendor_name: 'Vendor',
      items: [{
        id: 'line-1',
        menu_item_id: 'item-1',
        name: 'Rice',
        price_kobo: 100000,
        image_url: 'https://example.com/rice.jpg',
        quantity: 1,
        addons: [{ id: 'addon-1', name: 'Egg', price_kobo: 20000 }],
      }],
    }

    const next = cartReducer(state, { type: 'SET_ITEM_NOTES', id: 'line-1', notes: '  no pepper  ' })

    expect(next.items[0].special_instructions).toBe('no pepper')
    expect(next.items[0].addons).toEqual(state.items[0].addons)
    expect(next.items[0].image_url).toBe('https://example.com/rice.jpg')
  })

  it('removes an item without modifying remaining selections', () => {
    const state: CartState = {
      vendor_id: 'vendor-1',
      vendor_name: 'Vendor',
      items: [
        { id: 'line-1', menu_item_id: 'item-1', name: 'Rice', price_kobo: 100000, quantity: 1, addons: [] },
        { id: 'line-2', menu_item_id: 'item-2', name: 'Beans', price_kobo: 80000, quantity: 1, addons: [{ id: 'addon-1', name: 'Fish', price_kobo: 50000 }] },
      ],
    }

    const next = cartReducer(state, { type: 'REMOVE_ITEM', id: 'line-1' })

    expect(next.vendor_id).toBe('vendor-1')
    expect(next.items).toEqual([state.items[1]])
  })
})

