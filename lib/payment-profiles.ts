import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptField } from './crypto'
import { createTransferRecipient, createPaystackSubaccount } from './paystack/transfer'
import { paystackEnvironmentFromSecret } from './paystack/init'

export type BeneficiaryType = 'VENDOR' | 'RIDER'
export type PaymentProfileStatus = 'ACTIVE' | 'SUSPENDED' | 'SUPERSEDED'
export type PaymentProfileVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'

export interface PaymentBeneficiaryProfileRecord {
  id: string
  beneficiary_type: BeneficiaryType
  beneficiary_id: string
  environment: 'test' | 'production'
  version_number: number
  status: PaymentProfileStatus
  verification_status: PaymentProfileVerificationStatus
  bank_name: string
  bank_code: string
  bank_account_last4: string
  bank_account_masked: string
  bank_account_name: string
  bank_account_number_hash: string
  bank_account_number_encrypted: string
  paystack_recipient_code: string | null
  paystack_subaccount_code: string | null
  provider_metadata: Record<string, unknown>
  profile_metadata: Record<string, unknown>
  verification_reason: string | null
  verified_at: string | null
  suspended_at: string | null
  superseded_at: string | null
  created_at: string
  updated_at: string
}

type DB = SupabaseClient

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

export function maskAccountNumber(accountNumber: string): string {
  return `****${accountNumber.slice(-4)}`
}

export function beneficiaryTypeFromRole(role: string): BeneficiaryType {
  return role === 'vendor' ? 'VENDOR' : 'RIDER'
}

export function paymentProfilesEnvironment(): 'test' | 'production' {
  return paystackEnvironmentFromSecret(process.env.PAYSTACK_SECRET_KEY)
}

export async function resolveBankAccountName(accountNumber: string, bankCode: string): Promise<string> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new Error('PAYSTACK_SECRET_KEY not set')

  const url = `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bank resolve failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const json = await res.json() as { status: boolean; data?: { account_name?: string } }
  if (!json.status || !json.data?.account_name) throw new Error('Bank resolve returned no account name')
  return json.data.account_name
}

export async function createPaymentBeneficiaryProfile(db: DB, params: {
  beneficiaryType: BeneficiaryType
  beneficiaryId: string
  bankName: string
  bankCode: string
  accountNumber: string
  accountName: string
  createSubaccount?: boolean
  profileMetadata?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}): Promise<{ profile: PaymentBeneficiaryProfileRecord; replayed: boolean }> {
  const environment = paymentProfilesEnvironment()
  const accountNumberHash = sha256(params.accountNumber)
  const bankAccountMasked = maskAccountNumber(params.accountNumber)

  const { data: existing } = await db
    .from('payment_beneficiary_profiles')
    .select('*')
    .eq('beneficiary_type', params.beneficiaryType)
    .eq('beneficiary_id', params.beneficiaryId)
    .eq('environment', environment)
    .eq('status', 'ACTIVE')
    .maybeSingle()

  const current = existing as PaymentBeneficiaryProfileRecord | null
  if (
    current &&
    current.bank_account_number_hash === accountNumberHash &&
    current.bank_code === params.bankCode &&
    current.bank_account_name === params.accountName &&
    current.bank_account_masked === bankAccountMasked
  ) {
    return { profile: current, replayed: true }
  }

  const encryptedAccountNumber = encryptField(params.accountNumber)
  const recipientCode = await createTransferRecipient({
    name: params.accountName,
    account_number: params.accountNumber,
    bank_code: params.bankCode,
  })
  const shouldCreateSubaccount = params.createSubaccount ?? (params.beneficiaryType === 'VENDOR' && process.env.PAYSTACK_ENABLE_SUBACCOUNTS === '1')
  const subaccountCode = shouldCreateSubaccount
    ? await createPaystackSubaccount({
        business_name: params.accountName,
        settlement_bank: params.bankCode,
        account_number: params.accountNumber,
        percentage_charge: 0,
        description: 'LumeX Fud vendor payout profile',
      })
    : null

  const { data, error } = await db.rpc('upsert_payment_beneficiary_profile', {
    p_beneficiary_type: params.beneficiaryType,
    p_beneficiary_id: params.beneficiaryId,
    p_environment: environment,
    p_bank_name: params.bankName,
    p_bank_code: params.bankCode,
    p_bank_account_last4: params.accountNumber.slice(-4),
    p_bank_account_masked: bankAccountMasked,
    p_bank_account_name: params.accountName,
    p_bank_account_number_hash: accountNumberHash,
    p_bank_account_number_encrypted: encryptedAccountNumber,
    p_verification_status: 'VERIFIED',
    p_status: 'ACTIVE',
    p_paystack_recipient_code: recipientCode,
    p_paystack_subaccount_code: subaccountCode,
    p_provider_metadata: {
      ...(params.providerMetadata ?? {}),
      paystack_environment: environment,
    },
    p_profile_metadata: params.profileMetadata ?? {},
    p_verification_reason: null,
  })

  if (error) throw new Error(`upsert_payment_beneficiary_profile failed: ${error.message}`)
  const profileId = (data as Array<{ profile_id: string }> | null)?.[0]?.profile_id
  if (!profileId) throw new Error('upsert_payment_beneficiary_profile returned no profile id')

  const { data: profile, error: loadError } = await db.from('payment_beneficiary_profiles').select('*').eq('id', profileId).single()
  if (loadError || !profile) throw new Error(`Unable to load payment profile: ${loadError?.message ?? 'missing profile'}`)

  return { profile: profile as PaymentBeneficiaryProfileRecord, replayed: !!(data as Array<{ replayed?: boolean }> | null)?.[0]?.replayed }
}

export async function loadPaymentBeneficiaryProfile(db: DB, params: {
  beneficiaryType: BeneficiaryType
  beneficiaryId: string
  environment?: 'test' | 'production'
}): Promise<PaymentBeneficiaryProfileRecord | null> {
  const env = params.environment ?? paymentProfilesEnvironment()
  const { data } = await db
    .from('payment_beneficiary_profiles')
    .select('*')
    .eq('beneficiary_type', params.beneficiaryType)
    .eq('beneficiary_id', params.beneficiaryId)
    .eq('environment', env)
    .eq('status', 'ACTIVE')
    .order('version_number', { ascending: false })
    .maybeSingle()
  return (data as PaymentBeneficiaryProfileRecord | null) ?? null
}
