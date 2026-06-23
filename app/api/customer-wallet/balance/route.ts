import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { getCustomerWallet, formatPrice, isCustomerWalletEnabled } from '@/lib/customer-wallet'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// GET /api/customer-wallet/balance
// Returns the logged-in customer's wallet balance + metadata.

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!(await isCustomerWalletEnabled())) {
    return NextResponse.json({ error: 'The wallet is currently unavailable.', code: 'feature_disabled' }, { status: 403 })
  }

  const db = createSupabaseAdmin()

  // Resolve customer UUID from phone
  const { data: cust } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .maybeSingle()

  const customerId = (cust as { id: string } | null)?.id
  if (!customerId) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  const wallet = await getCustomerWallet(customerId)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
  }

  return NextResponse.json({
    balance_kobo:          wallet.balance_kobo,
    balance_formatted:     formatPrice(wallet.balance_kobo),
    lifetime_topup:        formatPrice(wallet.lifetime_topup_kobo),
    lifetime_topup_kobo:   wallet.lifetime_topup_kobo,
    lifetime_spent:        formatPrice(wallet.lifetime_spent_kobo),
    lifetime_spent_kobo:   wallet.lifetime_spent_kobo,
    is_frozen:             wallet.is_frozen,
    frozen_reason:         wallet.frozen_reason,
    // Own phone, so the wallet page can build a "ask family to top up" link
    // (/sponsor?phone=…). It's the caller's own number — no exposure.
    phone:                 session.phone,
  })
}
