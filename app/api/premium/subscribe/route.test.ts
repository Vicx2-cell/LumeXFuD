import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './route'

const state = {
  session: { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' },
}

const mocks = vi.hoisted(() => ({
  initializePremiumBilling: vi.fn(async () => ({
    authorization_url: 'https://paystack.test/auth',
    access_code: 'access-code',
    reference: 'PREM-123',
    amount_kobo: 5000,
  })),
}))

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitGeneric: vi.fn(async () => ({ success: true })),
}))

const featureFlags = {
  premium_enabled: true,
  premium_new_subscriptions_enabled: true,
  premium_checkout_enabled: true,
}

vi.mock('@/lib/features', () => ({
  getFeature: vi.fn(async (key: string) => featureFlags[key as keyof typeof featureFlags] ?? true),
}))

vi.mock('@/lib/paystack/billing', () => ({
  initializePremiumBilling: mocks.initializePremiumBilling,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => table === 'social_profiles'
          ? { data: { id: 'profile-1' } }
          : { data: null },
      }
    },
  })),
}))

describe('premium subscribe route', () => {
  beforeEach(() => {
    state.session = { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' }
    mocks.initializePremiumBilling.mockClear()
  })

  it('rejects non-vendors', async () => {
    state.session = { role: 'customer', phone: '+2348000000000', userId: 'customer-1' }
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ plan_key: 'vendor-premium', billing_cycle: 'monthly' }),
      headers: { 'content-type': 'application/json' },
    }) as never)

    expect(res.status).toBe(401)
  })

  it('starts premium checkout for the resolved vendor profile', async () => {
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ plan_key: 'vendor-premium', billing_cycle: 'yearly' }),
      headers: { 'content-type': 'application/json' },
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.authorization_url).toContain('paystack.test')
    expect(mocks.initializePremiumBilling).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'profile-1',
      planKey: 'vendor-premium',
      billingCycle: 'yearly',
    }))
  })

  it('blocks checkout behind the feature flag', async () => {
    featureFlags.premium_checkout_enabled = false
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ plan_key: 'vendor-premium', billing_cycle: 'monthly' }),
      headers: { 'content-type': 'application/json' },
    }) as never)
    expect(res.status).toBe(503)
  })
})
