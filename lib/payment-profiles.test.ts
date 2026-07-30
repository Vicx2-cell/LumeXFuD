import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaymentBeneficiaryProfile } from './payment-profiles'

const state = vi.hoisted(() => ({
  recipient: vi.fn(),
  subaccount: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}))

vi.mock('./paystack/transfer', () => ({
  createTransferRecipient: state.recipient,
  createPaystackSubaccount: state.subaccount,
}))

function makeDb(): any {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'upsert_payment_beneficiary_profile') return { data: null, error: null }

      const existing = state.rows.find(
        (row) =>
          row.beneficiary_type === args.p_beneficiary_type &&
          row.beneficiary_id === args.p_beneficiary_id &&
          row.environment === args.p_environment &&
          row.status === 'ACTIVE',
      )
      if (existing) {
        existing.status = 'SUPERSEDED'
        existing.superseded_at = new Date().toISOString()
        existing.updated_at = new Date().toISOString()
      }

      const profile = {
        id: `profile-${state.rows.length + 1}`,
        beneficiary_type: args.p_beneficiary_type,
        beneficiary_id: args.p_beneficiary_id,
        environment: args.p_environment,
        version_number: existing ? Number(existing.version_number) + 1 : 1,
        status: args.p_status,
        verification_status: args.p_verification_status,
        bank_name: args.p_bank_name,
        bank_code: args.p_bank_code,
        bank_account_last4: args.p_bank_account_last4,
        bank_account_masked: args.p_bank_account_masked,
        bank_account_name: args.p_bank_account_name,
        bank_account_number_hash: args.p_bank_account_number_hash,
        bank_account_number_encrypted: args.p_bank_account_number_encrypted,
        paystack_recipient_code: args.p_paystack_recipient_code,
        paystack_subaccount_code: args.p_paystack_subaccount_code,
        provider_metadata: args.p_provider_metadata ?? {},
        profile_metadata: args.p_profile_metadata ?? {},
        verification_reason: args.p_verification_reason ?? null,
        verified_at: args.p_verification_status === 'VERIFIED' ? new Date().toISOString() : null,
        suspended_at: null,
        superseded_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      state.rows.push(profile)
      return { data: [{ profile_id: profile.id, version_number: profile.version_number, replayed: false, status: profile.status }], error: null }
    },
    from(table: string) {
      const filters: Array<{ field: string; value: unknown }> = []
      return {
        select() { return this },
        eq(field: string, value: unknown) {
          filters.push({ field, value })
          return this
        },
        maybeSingle: async () => {
          if (table !== 'payment_beneficiary_profiles') return { data: null }
          const found = state.rows.find((row) => filters.every((f) => row[f.field] === f.value))
          return { data: found ?? null }
        },
        single: async () => {
          const idFilter = filters.find((f) => f.field === 'id')
          const found = state.rows.find((row) => row.id === idFilter?.value)
          return { data: found ?? null, error: null }
        },
      }
    },
  }
}

beforeEach(() => {
  state.recipient.mockReset()
  state.subaccount.mockReset()
  state.rows = []
  state.recipient.mockResolvedValueOnce('rcpt-1').mockResolvedValueOnce('rcpt-2')
  state.subaccount.mockResolvedValue('sub-1')
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  delete process.env.PAYSTACK_ENABLE_SUBACCOUNTS
})

describe('payment beneficiary profiles', () => {
  it('replays unchanged bank details and versions changed details', async () => {
    const db = makeDb()

    const first = await createPaymentBeneficiaryProfile(db, {
      beneficiaryType: 'VENDOR',
      beneficiaryId: 'vendor-1',
      bankName: 'Test Bank',
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Ada Lovelace',
      profileMetadata: { source: 'test' },
      providerMetadata: { source: 'test' },
    })

    const replay = await createPaymentBeneficiaryProfile(db, {
      beneficiaryType: 'VENDOR',
      beneficiaryId: 'vendor-1',
      bankName: 'Test Bank',
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Ada Lovelace',
      profileMetadata: { source: 'test' },
      providerMetadata: { source: 'test' },
    })

    const changed = await createPaymentBeneficiaryProfile(db, {
      beneficiaryType: 'VENDOR',
      beneficiaryId: 'vendor-1',
      bankName: 'Test Bank',
      bankCode: '058',
      accountNumber: '0123456790',
      accountName: 'Ada Lovelace',
      profileMetadata: { source: 'test' },
      providerMetadata: { source: 'test' },
    })

    expect(first.profile.version_number).toBe(1)
    expect(first.profile.paystack_recipient_code).toBe('rcpt-1')
    expect(replay.replayed).toBe(true)
    expect(state.recipient).toHaveBeenCalledTimes(2)
    expect(changed.profile.version_number).toBe(2)
    expect(state.rows[0].status).toBe('SUPERSEDED')
  })
})
