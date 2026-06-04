import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice, tierEmoji, tierHoldLabel, getNextTier, ordersToNextTier } from '@/lib/wallet'
import type { WalletBalance, TrustTier } from '@/lib/wallet'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const userType = session.role === 'vendor' ? 'VENDOR' : 'RIDER'
  const db = createSupabaseAdmin()

  const { data: raw } = await db
    .from('wallet_balances')
    .select(
      'total_balance, available_balance, held_balance, trust_tier, ' +
      'wallet_pin_hash, bank_account_number, bank_account_last4, bank_code, bank_account_name, bank_name, ' +
      'last_bank_added_at, is_frozen, frozen_reason, lifetime_earned, total_withdrawals, ' +
      'pin_attempts, pin_locked_until'
    )
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .maybeSingle()

  const wallet = raw as unknown as WalletBalance | null
  const tier = (wallet?.trust_tier ?? 'BRONZE') as TrustTier

  // Count for tier progress bar
  const countField = userType === 'VENDOR' ? 'total_ratings' : 'total_deliveries'
  const { data: userRow } = await db
    .from(userType === 'VENDOR' ? 'vendors' : 'riders')
    .select(`avg_rating, ${countField}`)
    .eq('id', session.userId!)
    .maybeSingle()

  const ur = userRow as unknown as Record<string, unknown> | null
  const totalCount = Number(ur?.[countField] ?? 0)
  const nextTier = getNextTier(tier)
  const ordersToNext = ordersToNextTier(totalCount, tier)

  // 24-hour cooling period for bank account
  const bankAdded = wallet?.last_bank_added_at ? new Date(wallet.last_bank_added_at) : null
  const coolingExpires = bankAdded
    ? new Date(bankAdded.getTime() + 24 * 3_600_000)
    : null
  const bankReady = !coolingExpires || coolingExpires <= new Date()

  return NextResponse.json({
    total_balance:     formatPrice(wallet?.total_balance ?? 0),
    available_balance: formatPrice(wallet?.available_balance ?? 0),
    held_balance:      formatPrice(wallet?.held_balance ?? 0),
    // Raw kobo values for client-side logic
    available_kobo:    wallet?.available_balance ?? 0,
    held_kobo:         wallet?.held_balance ?? 0,
    trust_tier:        tier,
    tier_emoji:        tierEmoji(tier),
    tier_label:        tierHoldLabel(tier),
    tier_progress: {
      current_count: totalCount,
      next_tier:     nextTier,
      orders_to_next: ordersToNext,
    },
    wallet_pin_set: !!wallet?.wallet_pin_hash,
    bank_connected: !!(wallet?.bank_account_number),
    bank_name:      wallet?.bank_name ?? null,
    bank_last_4:    wallet?.bank_account_last4 ?? null,
    bank_account_name: wallet?.bank_account_name ?? null,
    bank_ready:     bankReady,
    bank_ready_at:  coolingExpires?.toISOString() ?? null,
    is_frozen:      wallet?.is_frozen ?? false,
    frozen_reason:  wallet?.is_frozen ? (wallet?.frozen_reason ?? null) : null,
    lifetime_earned: formatPrice(wallet?.lifetime_earned ?? 0),
    total_withdrawn: formatPrice(wallet?.total_withdrawals ?? 0),
  })
}
