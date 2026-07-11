import { describe, expect, it, vi } from 'vitest'
import { GET } from './route'

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => ({ role: 'vendor', userId: 'vendor-1', phone: '+2348000000000' })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from() {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => ({ data: { id: 'profile-1' } }),
      }
    },
  })),
}))

vi.mock('@/lib/feed/video-management', () => ({
  getVideoQuotaForVendor: vi.fn(async () => ({
    activeCount: 59,
    draftCount: 2,
    archivedCount: 1,
    processingCount: 0,
    failedCount: 0,
    storageBytes: 1000,
    limit: 60,
    unlimited: false,
    remaining: 1,
    canPublish: true,
    premiumActive: false,
  })),
}))

describe('video quota route', () => {
  it('returns vendor quota using the central resolver', async () => {
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.quota.limit).toBe(60)
    expect(json.quota.canPublish).toBe(true)
  })
})
