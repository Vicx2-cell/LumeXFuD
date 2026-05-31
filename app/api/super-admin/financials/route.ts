import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  const [
    monthOrders,
    todayOrders,
    walletBalances,
    vendorSubs,
    customerWallets,
    topupTxToday,
    bonusTxToday,
    riderBonusesToday,
  ] = await Promise.all([
    db.from('orders')
      .select('total_amount, platform_markup, platform_delivery_cut, status')
      .gte('created_at', monthStart),
    db.from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart)
      .not('status', 'eq', 'CANCELLED'),
    db.from('wallet_balances')
      .select('user_type, total_balance, held_balance, available_balance'),
    db.from('vendor_subscriptions')
      .select('amount_kobo')
      .gte('paid_at', monthStart),
    db.from('customer_wallets')
      .select('balance_kobo, lifetime_topup_kobo'),
    // Customer wallet top-ups today
    db.from('customer_wallet_transactions')
      .select('amount_kobo')
      .eq('type', 'TOPUP')
      .gte('created_at', todayStart),
    // Top-up bonuses issued today
    db.from('customer_wallet_transactions')
      .select('amount_kobo')
      .eq('type', 'TOPUP_BONUS')
      .gte('created_at', todayStart),
    // Rider milestone bonuses awarded today
    db.from('rider_milestone_bonuses')
      .select('amount_kobo')
      .gte('awarded_at', todayStart),
  ])

  const orders    = monthOrders.data ?? []
  const completed = orders.filter((o) => !['CANCELLED', 'REFUNDED'].includes(o.status ?? ''))

  const gmv               = completed.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const platformRevenue   = completed.reduce((s, o) => s + (o.platform_markup ?? 0) + (o.platform_delivery_cut ?? 0), 0)
  const subscriptionRevenue = (vendorSubs.data ?? []).reduce((s, v) => s + (v.amount_kobo ?? 0), 0)

  const wallets      = walletBalances.data ?? []
  const vendorWallet = wallets.filter((w) => w.user_type === 'VENDOR').reduce((s, w) => s + w.total_balance, 0)
  const riderWallet  = wallets.filter((w) => w.user_type === 'RIDER').reduce((s, w) => s + w.total_balance, 0)
  const totalHeld    = wallets.reduce((s, w) => s + w.held_balance, 0)

  // Customer wallet stats
  const cwRows             = customerWallets.data ?? []
  const customerFloat      = cwRows.reduce((s, w) => s + (w.balance_kobo ?? 0), 0)
  const lifetimeTopup      = cwRows.reduce((s, w) => s + (w.lifetime_topup_kobo ?? 0), 0)

  // Today's top-up activity
  const topupToday         = (topupTxToday.data ?? []).reduce((s, t) => s + (t.amount_kobo ?? 0), 0)
  const bonusIssuedToday   = (bonusTxToday.data ?? []).reduce((s, t) => s + (t.amount_kobo ?? 0), 0)
  const netFloatGainToday  = topupToday - bonusIssuedToday
  const riderBonusPaidToday = (riderBonusesToday.data ?? []).reduce((s, b) => s + (b.amount_kobo ?? 0), 0)

  // Platform orders profit today (approximation)
  const [todayOrdersData] = await Promise.all([
    db.from('orders')
      .select('platform_markup, platform_delivery_cut, status')
      .gte('created_at', todayStart)
      .not('status', 'eq', 'CANCELLED'),
  ])
  const todayCompleted = (todayOrdersData.data ?? []).filter(
    (o) => !['CANCELLED', 'REFUNDED'].includes(o.status ?? '')
  )
  const platformRevenueToday = todayCompleted.reduce(
    (s, o) => s + (o.platform_markup ?? 0) + (o.platform_delivery_cut ?? 0),
    0
  )
  const netPlatformProfitToday = platformRevenueToday + netFloatGainToday - riderBonusPaidToday

  // Annual earning potential on float (12% / year as illustration)
  const floatAnnualPotential = Math.round((customerFloat * 0.12))

  return NextResponse.json({
    // Monthly GMV + revenue
    gmv_kobo:                    gmv,
    platform_revenue_kobo:       platformRevenue,
    subscription_revenue_kobo:   subscriptionRevenue,
    total_revenue_kobo:          platformRevenue + subscriptionRevenue,
    take_rate_pct:               gmv > 0 ? Math.round((platformRevenue / gmv) * 10000) / 100 : 0,

    // Order counts
    orders_this_month:           completed.length,
    orders_today:                todayOrders.count ?? 0,

    // Vendor + rider wallet float
    vendor_wallet_kobo:          vendorWallet,
    rider_wallet_kobo:           riderWallet,
    total_held_kobo:             totalHeld,

    // Customer wallet float
    customer_float_kobo:         customerFloat,
    lifetime_topup_kobo:         lifetimeTopup,
    customer_wallet_count:       cwRows.length,
    float_annual_potential_kobo: floatAnnualPotential,

    // Today's activity
    topup_today_kobo:            topupToday,
    bonus_issued_today_kobo:     bonusIssuedToday,
    net_float_gain_today_kobo:   netFloatGainToday,
    rider_bonus_paid_today_kobo: riderBonusPaidToday,
    platform_revenue_today_kobo: platformRevenueToday,
    net_platform_profit_today_kobo: netPlatformProfitToday,
  })
}
