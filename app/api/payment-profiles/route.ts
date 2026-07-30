import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { beneficiaryTypeFromRole, loadPaymentBeneficiaryProfile } from '@/lib/payment-profiles'

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const beneficiaryId = searchParams.get('beneficiary_id')
  if (beneficiaryId && beneficiaryId !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const profile = await loadPaymentBeneficiaryProfile(db, {
    beneficiaryType: beneficiaryTypeFromRole(session.role),
    beneficiaryId: session.userId!,
  })

  if (!profile) {
    return NextResponse.json({ profile: null })
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      beneficiary_type: profile.beneficiary_type,
      beneficiary_id: profile.beneficiary_id,
      version_number: profile.version_number,
      status: profile.status,
      verification_status: profile.verification_status,
      bank_name: profile.bank_name,
      bank_code: profile.bank_code,
      bank_account_last4: profile.bank_account_last4,
      bank_account_masked: profile.bank_account_masked,
      bank_account_name: profile.bank_account_name,
      paystack_recipient_code: profile.paystack_recipient_code,
      paystack_subaccount_code: profile.paystack_subaccount_code,
      verified_at: profile.verified_at,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    },
  })
}
