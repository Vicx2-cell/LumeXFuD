import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  fundingSource: 'VENDOR',
  credits: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    from(table: string) {
      let operation = 'read'
      let selected = ''
      const chain: Record<string, unknown> = {}
      chain.select = (columns: string) => {
        selected = columns
        return chain
      }
      chain.update = () => {
        operation = 'update'
        return chain
      }
      chain.eq = () => chain
      chain.maybeSingle = async () => {
        if (table === 'orders') {
          return {
            data: {
              subtotal: 10_000,
              vendor_commission_kobo: 1_000,
              promo_discount_kobo: 2_000,
              promotion_id: 'promo-1',
            },
            error: null,
          }
        }
        if (table === 'promotions') {
          return { data: { funding_source: state.fundingSource }, error: null }
        }
        return { data: null, error: null }
      }
      chain.then = (
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(
        table === 'orders' && operation === 'update' && selected === 'id'
          ? { data: [{ id: 'order-1' }], error: null }
          : { data: null, error: null },
      ).then(resolve, reject)
      return chain
    },
  }),
}))

vi.mock('@/lib/wallet', () => ({
  creditWalletHeld: async (input: Record<string, unknown>) => {
    state.credits.push(input)
  },
  getTierAndCount: async () => ({ tier: 'NEW', count: 0 }),
  calculateReleaseTime: () => new Date('2026-07-30T00:00:00.000Z'),
  getHoldPolicy: async () => ({}),
}))

import { completeOrderPayout } from './order-payout'

describe('vendor-funded promotion settlement', () => {
  beforeEach(() => {
    state.credits = []
  })

  it('deducts a vendor-funded discount as well as commission from vendor earnings', async () => {
    state.fundingSource = 'VENDOR'
    await completeOrderPayout({
      id: 'order-1',
      order_number: 'LX-1',
      vendor_id: 'vendor-1',
      rider_id: null,
      subtotal: 99_999,
      rider_delivery_cut: 0,
      tip_amount: 0,
    })
    expect(state.credits).toHaveLength(1)
    expect(state.credits[0]).toMatchObject({ userType: 'VENDOR', amount: 7_000 })
  })

  it('does not deduct a LumeX-funded discount from vendor earnings', async () => {
    state.fundingSource = 'LUMEX'
    await completeOrderPayout({
      id: 'order-1',
      order_number: 'LX-1',
      vendor_id: 'vendor-1',
      rider_id: null,
      subtotal: 99_999,
      rider_delivery_cut: 0,
      tip_amount: 0,
    })
    expect(state.credits[0]).toMatchObject({ userType: 'VENDOR', amount: 9_000 })
  })
})
