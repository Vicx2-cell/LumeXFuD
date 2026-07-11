import { describe, expect, it, vi } from 'vitest'
import { GET } from './route'

vi.mock('@/lib/premium', () => ({
  loadPremiumConfig: vi.fn(async () => ({
    premiumEnabled: true,
    newSubscriptionsEnabled: true,
    trialsEnabled: true,
    premiumUIVisible: true,
    premiumFallbackPolicy: 'preserve_existing_until_expiry',
  })),
  loadPremiumPlans: vi.fn(async () => ([{ id: 'plan-1', plan_key: 'vendor-premium', name: 'Vendor Premium' }])),
}))

describe('premium plans route', () => {
  it('returns the public catalog with premium configuration', async () => {
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.enabled).toBe(true)
    expect(json.premiumUIVisible).toBe(true)
    expect(json.plans).toHaveLength(1)
  })
})
