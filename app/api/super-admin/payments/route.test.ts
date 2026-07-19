import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const state = {
  session: { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' },
}

const rows = {
  premium_payment_events: [{ id: 'prem-1', paystack_reference: 'PREM-1' }],
  boost_payment_events: [{ id: 'boost-1', paystack_reference: 'BOST-1' }],
  billing_ledger_entries: [{ id: 'led-1', payment_reference: 'PREM-1' }],
  paystack_billing_diagnostics: [{ id: 'diag-1', reference: 'PREM-1' }],
}

function makeQuery(table: keyof typeof rows) {
  const q: Record<string, unknown> = {
    select() { return q },
    order() { return q },
    limit() { return q },
    eq() { return q },
    then(resolve: (value: unknown) => void, reject: (reason?: unknown) => void) {
      return Promise.resolve({ data: rows[table] }).then(resolve, reject)
    },
  }
  return q
}

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return makeQuery(table as keyof typeof rows)
    },
  })),
}))

describe('super-admin payments route', () => {
  beforeEach(() => {
    state.session = { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' }
  })

  it('requires super admin access', async () => {
    state.session = { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' }
    const res = await GET(new NextRequest('http://localhost') as never)
    expect(res.status).toBe(403)
  })

  it('returns recent billing diagnostics and payment events', async () => {
    const res = await GET(new NextRequest('http://localhost?domain=all&limit=5') as never)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.premium).toHaveLength(1)
    expect(json.boost).toHaveLength(1)
    expect(json.ledger).toHaveLength(1)
    expect(json.diagnostics).toHaveLength(1)
  })
})
