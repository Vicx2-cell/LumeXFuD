import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

/** Fetch live NGN balance from Paystack. Returns 0 on any error. */
async function fetchPaystackBalance(): Promise<number> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return 0
  try {
    const res = await fetch('https://api.paystack.co/balance', {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return 0
    const json = (await res.json()) as {
      status: boolean
      data: Array<{ currency: string; balance: number }>
    }
    return json.data?.find((d) => d.currency === 'NGN')?.balance ?? 0
  } catch {
    return 0
  }
}

type EarningRow = { type: string; amount_kobo: number }

function aggregatePeriod(rows: EarningRow[]) {
  const breakdown: Record<string, number> = {}
  let gross = 0
  let net   = 0

  for (const r of rows) {
    breakdown[r.type] = (breakdown[r.type] ?? 0) + r.amount_kobo
    net += r.amount_kobo
    if (r.amount_kobo > 0) gross += r.amount_kobo
  }

  return { gross, net, breakdown }
}

// GET /api/super-admin/earnings
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db  = createSupabaseAdmin()
  const now = new Date()

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekStart  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [todayRes, weekRes, monthRes, walletsRes, customerWalletsRes, paystackBalance] =
    await Promise.all([
      db.from('platform_earnings')
        .select('type, amount_kobo')
        .gte('created_at', todayStart),
      db.from('platform_earnings')
        .select('type, amount_kobo')
        .gte('created_at', weekStart),
      db.from('platform_earnings')
        .select('type, amount_kobo')
        .gte('created_at', monthStart),
      db.from('wallet_balances')
        .select('user_type, available_balance, total_balance'),
      db.from('customer_wallets')
        .select('balance_kobo'),
      fetchPaystackBalance(),
    ])

  const wallets = walletsRes.data ?? []
  const vendorWalletTotal    = wallets
    .filter((w) => w.user_type === 'VENDOR')
    .reduce((s, w) => s + (w.available_balance ?? 0), 0)
  const riderWalletTotal     = wallets
    .filter((w) => w.user_type === 'RIDER')
    .reduce((s, w) => s + (w.available_balance ?? 0), 0)
  const customerWalletTotal  = (customerWalletsRes.data ?? [])
    .reduce((s, w) => s + (w.balance_kobo ?? 0), 0)

  const founderActualMoney =
    paystackBalance - vendorWalletTotal - riderWalletTotal - customerWalletTotal

  return NextResponse.json({
    today:   aggregatePeriod(todayRes.data  ?? []),
    week:    aggregatePeriod(weekRes.data   ?? []),
    month:   aggregatePeriod(monthRes.data  ?? []),
    paystack_balance_kobo:       paystackBalance,
    vendor_wallet_total_kobo:    vendorWalletTotal,
    rider_wallet_total_kobo:     riderWalletTotal,
    customer_wallet_total_kobo:  customerWalletTotal,
    founder_actual_money_kobo:   founderActualMoney,
  })
}
