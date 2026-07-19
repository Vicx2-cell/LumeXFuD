import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PATCH } from './route'

const state = {
  session: { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' },
}

const createCampusPayout = vi.hoisted(() => vi.fn(async (_id: string, _amount: number, _actor: string, key?: string) => ({ reference: key ?? 'CP-1' })))
const partnerId = '7d6a5e56-9f74-4b93-b5c3-8f3d1a6a9a11'

function makeTable(table: string) {
  return {
    select() { return this },
    eq() { return this },
    maybeSingle: async () => {
      if (table === 'campus_partners') return { data: { id: partnerId, profile_id: 'profile-1', referral_code: 'CP-AAAA1111' } }
      return { data: null }
    },
    update() { return this },
    insert: async () => ({ error: null }),
  }
}

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitGeneric: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/audit', () => ({
  superAudit: vi.fn(async () => undefined),
}))

vi.mock('@/lib/campus-partners', () => ({
  createCampusPayout,
  campusPartnerLink: vi.fn((code: string) => `https://example.test/campus-partners?ref=${code}`),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return makeTable(table)
    },
  })),
}))

describe('super-admin campus partners route', () => {
  beforeEach(() => {
    state.session = { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' }
    createCampusPayout.mockClear()
  })

  it('creates payouts with a deterministic idempotency key', async () => {
    const res = await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'payout',
        partner_id: partnerId,
        amount_kobo: 5000,
        reason: 'weekly commission',
      }),
      headers: { 'content-type': 'application/json' },
    }) as never)
    const json = await res!.json()

    expect(res!.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(createCampusPayout).toHaveBeenCalledWith(partnerId, 5000, '+2348000000000', `campus-payout:${partnerId}:5000:weekly commission`)
  })
})
