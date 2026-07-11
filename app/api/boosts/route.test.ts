import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './route'

const state = {
  session: { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' },
}

const mocks = vi.hoisted(() => ({
  initializeBoostBilling: vi.fn(async () => ({
    authorization_url: 'https://paystack.test/boost',
    access_code: 'boost-code',
    reference: 'BOST-123',
    amount_kobo: 15000,
  })),
}))

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitGeneric: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/features', () => ({
  getFeature: vi.fn(async () => true),
}))

vi.mock('@/lib/paystack/billing', () => ({
  initializeBoostBilling: mocks.initializeBoostBilling,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => table === 'social_profiles'
          ? { data: { id: 'profile-boost-1' } }
          : { data: null },
      }
    },
  })),
}))

describe('boosts route', () => {
  beforeEach(() => {
    state.session = { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' }
    mocks.initializeBoostBilling.mockClear()
  })

  it('rejects non-vendors', async () => {
    state.session = { role: 'customer', phone: '+2348000000000', userId: 'customer-1' }
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ post_id: 'post-1', boost_package_key: 'boost-1d' }),
      headers: { 'content-type': 'application/json' },
    }) as never)

    expect(res.status).toBe(401)
  })

  it('starts a boost checkout for the resolved vendor profile', async () => {
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ post_id: 'post-1', boost_package_key: 'boost-3d', target_city_id: 'city-1' }),
      headers: { 'content-type': 'application/json' },
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.authorization_url).toContain('paystack.test')
    expect(mocks.initializeBoostBilling).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'profile-boost-1',
      postId: 'post-1',
      boostPackageKey: 'boost-3d',
      targetCityId: 'city-1',
    }))
  })
})
