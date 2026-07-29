import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './route'

const state = {
  session: { role: 'customer', phone: '+2348000000000', userId: 'customer-1' },
  promotion: {
    id: 'promo-1',
    code: 'SAVE10',
    promotion_kind: 'STANDARD',
    discount_type: 'FIXED',
    value_kobo: 50_000,
    percentage_bps: 0,
    percentage_cap_kobo: null,
    minimum_subtotal_kobo: 0,
    eligible_vendor_id: null,
    eligible_category: null,
    eligible_campus_id: null,
    first_order_only: false,
    group_order_only: false,
    starts_at: '2026-07-01T00:00:00.000Z',
    expires_at: null,
    total_uses_limit: null,
    uses_per_customer: null,
    funding_source: 'LUMEX',
    status: 'ACTIVE',
  },
  vendor: { id: '11111111-1111-4111-8111-111111111111', city_id: '22222222-2222-4222-8222-222222222222', zone_id: '33333333-3333-4333-8333-333333333333' },
  orders: [] as Array<Record<string, unknown>>,
  redemptions: [] as Array<Record<string, unknown>>,
}

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      const query: Record<string, unknown> = { table, filters: {} }
      const chain = {
        select() { return chain },
        eq(column: string, value: unknown) {
          ;(query.filters as Record<string, unknown>)[column] = value
          return chain
        },
        in(column: string, values: unknown[]) {
          ;(query.filters as Record<string, unknown>)[column] = values
          return chain
        },
        maybeSingle: async () => {
          if (table === 'promotions' && (query.filters as Record<string, unknown>).code === 'SAVE10') return { data: state.promotion, error: null }
          if (table === 'vendors' && (query.filters as Record<string, unknown>).id === '11111111-1111-4111-8111-111111111111') return { data: state.vendor, error: null }
          return { data: null, error: null }
        },
        then(onFulfilled: (value: { data: Array<Record<string, unknown>> }) => unknown, onRejected?: (reason?: unknown) => unknown) {
          try {
            let data: Array<Record<string, unknown>> = []
            if (table === 'orders') {
              data = state.orders.filter((row) => {
                const filters = query.filters as Record<string, unknown>
                if (filters.customer_id && row.customer_id !== filters.customer_id) return false
                if (filters.payment_status && row.payment_status !== filters.payment_status) return false
                return true
              })
            } else if (table === 'promo_redemptions') {
              data = state.redemptions.filter((row) => {
                const filters = query.filters as Record<string, unknown>
                if (filters.promotion_id && row.promotion_id !== filters.promotion_id) return false
                if (filters.customer_id && row.customer_id !== filters.customer_id) return false
                if (filters.status && Array.isArray(filters.status) && !filters.status.includes(row.status)) return false
                return true
              })
            }
            return Promise.resolve(onFulfilled({ data })).catch(onRejected)
          } catch (error) {
            return onRejected ? Promise.resolve(onRejected(error)) : Promise.reject(error)
          }
        },
      }
      return chain
    },
  })),
}))

describe('promo quote route', () => {
  beforeEach(() => {
    state.session = { role: 'customer', phone: '+2348000000000', userId: 'customer-1' }
    state.promotion = {
      ...state.promotion,
      code: 'SAVE10',
      discount_type: 'FIXED',
      value_kobo: 50_000,
      first_order_only: false,
      group_order_only: false,
      eligible_vendor_id: null,
      eligible_category: null,
      eligible_campus_id: null,
      status: 'ACTIVE',
    }
    state.orders = []
    state.redemptions = []
  })

  it('returns an applied promo when the code is valid', async () => {
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'save10',
        subtotal_kobo: 500_000,
        delivery_fee_kobo: 50_000,
        platform_fee_kobo: 40_000,
        vendor_id: '11111111-1111-4111-8111-111111111111',
      }),
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.matched).toBe(true)
    expect(json.eligible).toBe(true)
    expect(json.discount_kobo).toBe(50_000)
  })

  it('returns a clear miss when the code does not exist', async () => {
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'missing',
        subtotal_kobo: 500_000,
        delivery_fee_kobo: 50_000,
        platform_fee_kobo: 40_000,
      }),
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.matched).toBe(false)
    expect(json.reason).toMatch(/not found/i)
  })

  it('blocks first-order-only promos after the customer already has a paid order', async () => {
    state.promotion = {
      ...state.promotion,
      first_order_only: true,
    }
    state.orders = [{ id: 'order-1', customer_id: 'customer-1', payment_status: 'PAID' }]

    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'SAVE10',
        subtotal_kobo: 500_000,
        delivery_fee_kobo: 50_000,
        platform_fee_kobo: 40_000,
        vendor_id: '11111111-1111-4111-8111-111111111111',
      }),
    }) as never)
    const json = await res.json()

    expect(json.matched).toBe(true)
    expect(json.eligible).toBe(false)
    expect(json.reason).toMatch(/first order/i)
  })
})
