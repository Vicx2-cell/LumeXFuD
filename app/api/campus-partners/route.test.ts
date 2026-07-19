import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const state = {
  session: { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' },
  featureOn: true,
}

const submitCampusPartnerApplication = vi.hoisted(() => vi.fn(async () => ({ applicationId: 'app-1', status: 'pending' })))
const loadCampusPartnerSummary = vi.hoisted(() => vi.fn(async () => ({ id: 'partner-1' })))

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitGeneric: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/features', () => ({
  getFeature: vi.fn(async () => state.featureOn),
}))

vi.mock('@/lib/campus-partners', () => ({
  loadCampusPartnerSummary,
  submitCampusPartnerApplication,
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

describe('campus partners route', () => {
  beforeEach(() => {
    state.session = { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' }
    state.featureOn = true
    submitCampusPartnerApplication.mockClear()
    loadCampusPartnerSummary.mockClear()
  })

  it('returns the current partner summary', async () => {
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(loadCampusPartnerSummary).toHaveBeenCalledWith('profile-1')
  })

  it('rejects applications when the program is closed', async () => {
    state.featureOn = false
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ full_name: 'Ada', phone: '0800', target_monthly_orders: 10, proposed_commission_rate: 0.05 }),
      headers: { 'content-type': 'application/json' },
    }) as never)

    expect(res.status).toBe(503)
  })

  it('submits a sanitized application for the authenticated user', async () => {
    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        full_name: 'Ada Lovelace',
        phone: '08001234567',
        campus_id: '7d6a5e56-9f74-4b93-b5c3-8f3d1a6a9a11',
        territory: 'Main campus',
        application_text: 'I can drive signups',
        target_monthly_orders: 42,
        proposed_commission_rate: 0.08,
      }),
      headers: { 'content-type': 'application/json' },
    }) as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(submitCampusPartnerApplication).toHaveBeenCalledWith(expect.objectContaining({
      full_name: 'Ada Lovelace',
      phone: '08001234567',
      target_monthly_orders: 42,
      proposed_commission_rate: 0.08,
    }))
  })
})
