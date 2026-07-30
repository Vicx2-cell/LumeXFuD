import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const state = {
  session: { role: 'customer', phone: '+2348000000000', userId: 'customer-1' },
  featureEnabled: true,
  dvaEnv: undefined as string | undefined,
}

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/features', () => ({
  getFeature: vi.fn(async (key: string) => (key === 'customer_virtual_accounts' ? state.featureEnabled : false)),
}))

vi.mock('@/lib/paystack/virtual-accounts', () => ({
  assignDedicatedAccount: vi.fn(),
  createPaystackCustomer: vi.fn(),
  fetchPaystackCustomer: vi.fn(),
  maskIdentity: vi.fn(),
  requeryDedicatedAccount: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => {
          if (table === 'customers') {
            return { data: { id: 'customer-1', email: 'student@example.com', name: 'Ada Lovelace', phone: '+2348000000000', email_verified: true } }
          }
          if (table === 'customer_virtual_accounts') {
            return {
              data: {
                bank_name: 'Test Bank',
                account_name: 'Ada Lovelace',
                account_number: '0123456789',
                provider_slug: 'paystack',
                status: 'ACTIVE',
                consented_at: new Date().toISOString(),
                failure_reason: null,
                paystack_customer_code: 'CUS_test_123',
                identity_snapshot: { accountNumber: '0123456789' },
              },
            }
          }
          return { data: null }
        },
      }
    },
  })),
}))

describe('customer virtual-account route', () => {
  beforeEach(() => {
    state.session = { role: 'customer', phone: '+2348000000000', userId: 'customer-1' }
    state.featureEnabled = true
    state.dvaEnv = undefined
    delete process.env.PAYSTACK_DVA_ENABLED
  })

  it('allows DVA access when the feature flag is on even if the env var is absent', async () => {
    const res = (await GET()) as Response
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.virtual_account.account_number).toBe('0123456789')
  })

  it('blocks DVA access when the env var explicitly disables it', async () => {
    process.env.PAYSTACK_DVA_ENABLED = 'false'
    const res = (await GET()) as Response

    expect(res.status).toBe(404)
  })

  it('returns only safe virtual-account fields from POST', async () => {
    const res = (await POST(new Request('http://localhost/api/customer/virtual-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        consent: true,
        account_number: '0123456789',
        bank_code: '044',
        bvn: '12345678901',
      }),
    }) as never)) as Response
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.virtual_account).toMatchObject({
      bank_name: 'Test Bank',
      account_name: 'Ada Lovelace',
      account_number: '0123456789',
      provider_slug: 'paystack',
      status: 'ACTIVE',
    })
    expect(json.virtual_account.paystack_customer_code).toBeUndefined()
    expect(json.virtual_account.identity_snapshot).toBeUndefined()
  })
})
