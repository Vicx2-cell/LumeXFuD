import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/wallet'

// GET /api/admin/wallets
// Returns all vendor + rider + customer wallets with platform float summary.
// Admin + super_admin only.

interface WalletRow {
  user_id: string
  user_type: string
  total_balance: number
  available_balance: number
  held_balance: number
  trust_tier: string
  is_frozen: boolean
  frozen_reason: string | null
  bank_name: string | null
  bank_account_number: string | null
  lifetime_earned: number
  total_withdrawals: number
  updated_at: string
}

interface CustomerWalletRow {
  customer_id: string
  balance_kobo: number
  is_frozen: boolean
  updated_at: string
}

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const filterType   = searchParams.get('type')   // 'VENDOR' | 'RIDER' | 'CUSTOMER' | null
  const filterFrozen = searchParams.get('frozen')  // 'true' | null
  const search       = searchParams.get('q')?.trim().toLowerCase() ?? ''

  const db = createSupabaseAdmin()

  // ── Vendor + Rider wallet balances ─────────────────────────────────────────
  let walletQuery = db
    .from('wallet_balances')
    .select(
      'user_id, user_type, total_balance, available_balance, held_balance, ' +
      'trust_tier, is_frozen, frozen_reason, bank_name, bank_account_number, ' +
      'lifetime_earned, total_withdrawals, updated_at'
    )
    .order('total_balance', { ascending: false })

  if (filterType && filterType !== 'CUSTOMER') walletQuery = walletQuery.eq('user_type', filterType)
  if (filterFrozen === 'true') walletQuery = walletQuery.eq('is_frozen', true)

  // Skip vendor/rider wallets if filtering for customers only
  const skipVendorRider = filterType === 'CUSTOMER'

  const [walletRes, customerWalletRes] = await Promise.all([
    skipVendorRider ? { data: [], error: null } : walletQuery,
    (filterType === 'VENDOR' || filterType === 'RIDER')
      ? { data: [], error: null }
      : db.from('customer_wallets')
          .select('customer_id, balance_kobo, is_frozen, updated_at')
          .order('balance_kobo', { ascending: false })
          .then((r) => {
            if (filterFrozen === 'true') {
              return { ...r, data: (r.data ?? []).filter((w: CustomerWalletRow) => w.is_frozen) }
            }
            return r
          }),
  ])

  if (walletRes.error) return NextResponse.json({ error: 'Failed to load wallets' }, { status: 500 })

  const wallets         = (walletRes.data ?? []) as unknown as WalletRow[]
  const customerWallets = (customerWalletRes.data ?? []) as unknown as CustomerWalletRow[]

  // ── Enrich vendor/rider with user display names ────────────────────────────
  const vendorIds = wallets.filter((w) => w.user_type === 'VENDOR').map((w) => w.user_id)
  const riderIds  = wallets.filter((w) => w.user_type === 'RIDER').map((w) => w.user_id)
  const customerIds = customerWallets.map((w) => w.customer_id)

  const [vendorsRes, ridersRes, customersRes] = await Promise.all([
    vendorIds.length
      ? db.from('vendors').select('id, shop_name, owner_name, phone').in('id', vendorIds)
      : { data: [], error: null },
    riderIds.length
      ? db.from('riders').select('id, full_name, phone').in('id', riderIds)
      : { data: [], error: null },
    customerIds.length
      ? db.from('customers').select('id, full_name, phone').in('id', customerIds)
      : { data: [], error: null },
  ])

  const vendorMap = new Map(
    ((vendorsRes.data ?? []) as unknown as { id: string; shop_name: string; owner_name: string; phone: string }[])
      .map((v) => [v.id, { name: v.shop_name, owner: v.owner_name, phone: v.phone }])
  )
  const riderMap = new Map(
    ((ridersRes.data ?? []) as unknown as { id: string; full_name: string; phone: string }[])
      .map((r) => [r.id, { name: r.full_name, phone: r.phone }])
  )
  const customerMap = new Map(
    ((customersRes.data ?? []) as unknown as { id: string; full_name: string; phone: string }[])
      .map((c) => [c.id, { name: c.full_name ?? 'Customer', phone: c.phone }])
  )

  // ── Build vendor/rider rows ────────────────────────────────────────────────
  let rows = wallets.map((w) => {
    const isVendor = w.user_type === 'VENDOR'
    const userInfo = isVendor ? vendorMap.get(w.user_id) : riderMap.get(w.user_id)
    return {
      user_id:           w.user_id,
      user_type:         w.user_type,
      name:              userInfo?.name ?? '—',
      owner:             isVendor ? (vendorMap.get(w.user_id)?.owner ?? null) : null,
      phone:             userInfo?.phone ?? '—',
      total_balance:     formatPrice(w.total_balance),
      available_balance: formatPrice(w.available_balance),
      held_balance:      formatPrice(w.held_balance),
      total_balance_kobo: w.total_balance,
      trust_tier:        w.trust_tier,
      is_frozen:         w.is_frozen,
      frozen_reason:     w.frozen_reason,
      bank_name:         w.bank_name,
      bank_last_4:       w.bank_account_number ? w.bank_account_number.slice(-4) : null,
      lifetime_earned:   formatPrice(w.lifetime_earned ?? 0),
      total_withdrawn:   formatPrice(w.total_withdrawals ?? 0),
      updated_at:        w.updated_at,
    }
  })

  // ── Build customer wallet rows ─────────────────────────────────────────────
  const customerRows = customerWallets.map((cw) => {
    const info = customerMap.get(cw.customer_id)
    return {
      user_id:           cw.customer_id,
      user_type:         'CUSTOMER',
      name:              info?.name ?? 'Customer',
      owner:             null,
      phone:             info?.phone ?? '—',
      total_balance:     formatPrice(cw.balance_kobo),
      available_balance: formatPrice(cw.balance_kobo),
      held_balance:      formatPrice(0),
      total_balance_kobo: cw.balance_kobo,
      trust_tier:        'N/A',
      is_frozen:         cw.is_frozen,
      frozen_reason:     null,
      bank_name:         null,
      bank_last_4:       null,
      lifetime_earned:   '—',
      total_withdrawn:   '—',
      updated_at:        cw.updated_at,
    }
  })

  // Combine all rows
  const allRows = [...rows, ...customerRows]

  // Search filter (client-side after enrichment)
  const filtered = search
    ? allRows.filter(
        (r) =>
          r.name.toLowerCase().includes(search) ||
          r.phone.includes(search) ||
          (r.owner ?? '').toLowerCase().includes(search)
      )
    : allRows

  // ── Platform float summary ─────────────────────────────────────────────────
  const totalWallet     = wallets.reduce((s, w) => s + Number(w.total_balance), 0)
  const totalAvailable  = wallets.reduce((s, w) => s + Number(w.available_balance), 0)
  const totalHeld       = wallets.reduce((s, w) => s + Number(w.held_balance), 0)
  const vendorTotal     = wallets.filter((w) => w.user_type === 'VENDOR').reduce((s, w) => s + Number(w.total_balance), 0)
  const riderTotal      = wallets.filter((w) => w.user_type === 'RIDER').reduce((s, w) => s + Number(w.total_balance), 0)
  const customerFloat   = customerWallets.reduce((s, w) => s + Number(w.balance_kobo), 0)
  const frozenCount     = allRows.filter((r) => r.is_frozen).length
  const platformTotal   = totalWallet + customerFloat

  // Paystack balance (best effort)
  let paystackBalance: number | null = null
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (secret) {
      const psRes = await fetch('https://api.paystack.co/balance', {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (psRes.ok) {
        const psJson = await psRes.json() as { status: boolean; data: Array<{ currency: string; balance: number }> }
        const ngn = psJson.data?.find((b) => b.currency === 'NGN')
        paystackBalance = ngn?.balance ?? null
      }
    }
  } catch { /* non-fatal */ }

  const difference = paystackBalance !== null ? Math.abs(paystackBalance - platformTotal) : null
  const reconciled  = difference !== null ? difference <= 10_000 : null // ₦100 tolerance

  return NextResponse.json({
    float: {
      total_wallet:       formatPrice(totalWallet),
      total_available:    formatPrice(totalAvailable),
      total_held:         formatPrice(totalHeld),
      vendor_total:       formatPrice(vendorTotal),
      rider_total:        formatPrice(riderTotal),
      customer_float:     formatPrice(customerFloat),
      customer_float_kobo: customerFloat,
      platform_total:     formatPrice(platformTotal),
      frozen_count:       frozenCount,
      paystack_balance:   paystackBalance !== null ? formatPrice(paystackBalance) : null,
      difference:         difference !== null ? formatPrice(difference) : null,
      reconciled,
    },
    wallets: filtered,
    total: filtered.length,
  })
}
