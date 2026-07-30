import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const currentUser = vi.hoisted(() => ({ fn: vi.fn() }))
const loadProfile = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock('@/lib/session', () => ({ getCurrentUser: currentUser.fn }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: vi.fn(() => ({})) }))
vi.mock('@/lib/payment-profiles', () => ({
  beneficiaryTypeFromRole: (role: 'vendor' | 'rider') => role === 'vendor' ? 'VENDOR' : 'RIDER',
  loadPaymentBeneficiaryProfile: loadProfile.fn,
}))

function req(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' })
}

beforeEach(() => {
  currentUser.fn.mockReset()
  loadProfile.fn.mockReset()
  currentUser.fn.mockResolvedValue({ role: 'vendor', userId: 'vendor-1', phone: '+2348000000000' })
  loadProfile.fn.mockResolvedValue({
    id: 'profile-1',
    beneficiary_type: 'VENDOR',
    beneficiary_id: 'vendor-1',
    environment: 'test',
    version_number: 2,
    status: 'ACTIVE',
    verification_status: 'VERIFIED',
    bank_name: 'Test Bank',
    bank_code: '058',
    bank_account_last4: '6789',
    bank_account_masked: '****6789',
    bank_account_name: 'Ada Lovelace',
    bank_account_number_hash: 'hash',
    bank_account_number_encrypted: 'enc',
    paystack_recipient_code: 'RCP_1',
    paystack_subaccount_code: null,
    provider_metadata: {},
    profile_metadata: {},
    verification_reason: null,
    verified_at: new Date().toISOString(),
    suspended_at: null,
    superseded_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
})

describe('payment profiles route', () => {
  it('returns the current owner profile and masks account details', async () => {
    const mod: any = await import('@/app/api/payment-profiles/route')
    const res = await mod.GET(req('http://localhost/api/payment-profiles'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.profile.bank_account_masked).toBe('****6789')
    expect(loadProfile.fn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      beneficiaryType: 'VENDOR',
      beneficiaryId: 'vendor-1',
    }))
  })

  it('rejects attempts to read another beneficiary profile', async () => {
    const mod: any = await import('@/app/api/payment-profiles/route')
    const res = await mod.GET(req('http://localhost/api/payment-profiles?beneficiary_id=vendor-2'))
    expect(res.status).toBe(403)
  })
})
