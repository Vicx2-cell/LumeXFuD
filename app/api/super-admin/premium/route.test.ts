import { describe, expect, it, beforeEach, vi } from 'vitest'
import { PATCH } from './route'

const state = {
  session: { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' },
}

const insertRows: Record<string, unknown>[] = []

function makeTable(table: string) {
  type Query = {
    select: () => Query
    eq: () => Query
    order: () => Query
    limit: () => Query
    is: () => Query
    maybeSingle: () => Promise<{ data: unknown }>
    upsert: (payload: Record<string, unknown>) => Promise<{ error: null }>
    insert: (payload: Record<string, unknown>) => Promise<{ error: null }>
    update: () => Query
  }
  const query: Query = {
    select() { return query },
    eq() { return query },
    order() { return query },
    limit() { return query },
    is() { return query },
    maybeSingle: async () => {
      if (table === 'premium_config') {
        return {
          data: {
            config_key: 'global',
            premium_enabled: false,
            new_subscriptions_enabled: false,
            trials_enabled: false,
            premium_ui_visible: true,
            preserve_existing_until_expiry: true,
            immediate_disable_existing_benefits: false,
            premium_fallback_policy: 'preserve_existing_until_expiry',
          },
        }
      }
      return { data: null }
    },
    upsert: async (payload: Record<string, unknown>) => {
      insertRows.push(payload)
      return { error: null }
    },
    insert: async (payload: Record<string, unknown>) => {
      insertRows.push(payload)
      return { error: null }
    },
    update() { return query },
  }
  return query
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

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return makeTable(table)
    },
  })),
}))

vi.mock('@/lib/premium', () => ({
  loadPremiumConfig: vi.fn(async () => ({
    premiumEnabled: false,
    newSubscriptionsEnabled: false,
    trialsEnabled: false,
    premiumUIVisible: true,
    premiumFallbackPolicy: 'preserve_existing_until_expiry',
  })),
  loadPremiumPlans: vi.fn(async () => []),
  getPremiumStatus: vi.fn(async () => null),
  resolvePremiumFallbackPolicy: vi.fn(async () => 'preserve_existing_until_expiry'),
}))

describe('super-admin premium route', () => {
  beforeEach(() => {
    insertRows.length = 0
    state.session = { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' }
  })

  it('rejects non-admin updates', async () => {
    state.session = { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' }
    const res = (await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ premiumEnabled: true }),
      headers: { 'content-type': 'application/json' },
    }) as never))!

    expect(res.status).toBe(403)
  })

  it('updates global premium config and writes audit history', async () => {
    const res = (await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'set_config',
        premiumEnabled: true,
        newSubscriptionsEnabled: true,
        trialsEnabled: true,
        premiumUIVisible: true,
        premiumFallbackPolicy: 'grant_all_premium_features',
        reason: 'turn on premium',
      }),
      headers: { 'content-type': 'application/json' },
    }) as never))!
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(insertRows.length).toBeGreaterThan(0)
  })

  it('grants a manual entitlement override', async () => {
    const res = (await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'grant_override',
        profile_id: 'profile-1',
        entitlement_key: 'premium.analytics.advanced',
        override_type: 'grant',
        reason: 'support credit',
      }),
      headers: { 'content-type': 'application/json' },
    }) as never))!

    expect(res.status).toBe(200)
  })
})
