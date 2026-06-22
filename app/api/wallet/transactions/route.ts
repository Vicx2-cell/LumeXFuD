import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice, humanizeTx, txSign, txIcon } from '@/lib/wallet'
import type { WalletTransaction, WalletBalance } from '@/lib/wallet'
import { receiptCode } from '@/lib/receipt'
import { callPhoneMap } from '@/lib/call-phone'

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['vendor', 'rider'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const userType = session.role === 'vendor' ? 'VENDOR' : 'RIDER'
  const { searchParams } = new URL(req.url)
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
  const type   = searchParams.get('type') ?? undefined
  const offset = (page - 1) * limit

  const db = createSupabaseAdmin()

  // Fetch bank last-4 for display
  const { data: walletRaw } = await db
    .from('wallet_balances')
    .select('bank_account_last4')
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .maybeSingle()
  const wallet = walletRaw as unknown as Pick<WalletBalance, 'bank_account_last4'> | null
  const bankLast4 = wallet?.bank_account_last4 ?? undefined

  let query = db
    .from('wallet_transactions')
    .select(
      'id, type, amount, balance_before, balance_after, ' +
      'available_before, available_after, held_before, held_after, ' +
      'reference, order_id, description, status, release_at, ' +
      'paystack_transfer_code, failure_reason, created_at',
      { count: 'exact' }
    )
    .eq('user_id', session.userId!)
    .eq('user_type', userType)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (type) query = query.eq('type', type)

  const { data: txsRaw, count, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })

  const txs = (txsRaw ?? []) as unknown as WalletTransaction[]

  // ── Enrich each order-linked transaction with the people on that order ───────
  // So a vendor sees the RIDER they worked with (and vice-versa) on each payout —
  // profile + contact — straight from the transaction record.
  const orderIds = Array.from(new Set(txs.map((t) => t.order_id).filter(Boolean))) as string[]
  type Party = { name: string; phone: string | null; call_phone: string | null; avatar: string | null }
  const vendorByOrder = new Map<string, Party>()
  const riderByOrder = new Map<string, Party>()
  if (orderIds.length) {
    const { data: ordersRaw } = await db
      .from('orders')
      .select('id, vendor_id, rider_id')
      .in('id', orderIds)
    const orders = (ordersRaw ?? []) as Array<{ id: string; vendor_id: string | null; rider_id: string | null }>
    const vIds = Array.from(new Set(orders.map((o) => o.vendor_id).filter(Boolean))) as string[]
    const rIds = Array.from(new Set(orders.map((o) => o.rider_id).filter(Boolean))) as string[]
    const [vRes, rRes, vCall, rCall] = await Promise.all([
      vIds.length ? db.from('vendors').select('id, shop_name, phone, logo_url').in('id', vIds) : Promise.resolve({ data: [] }),
      rIds.length ? db.from('riders').select('id, full_name, phone, avatar_url').in('id', rIds) : Promise.resolve({ data: [] }),
      callPhoneMap('vendors', vIds, db),  // migration-074-safe (empty map if absent)
      callPhoneMap('riders', rIds, db),
    ])
    const vMap = new Map(((vRes.data ?? []) as Array<{ id: string; shop_name: string; phone: string | null; logo_url: string | null }>)
      .map((v) => [v.id, { name: v.shop_name, phone: v.phone, call_phone: vCall.get(v.id) ?? null, avatar: v.logo_url } as Party]))
    const rMap = new Map(((rRes.data ?? []) as Array<{ id: string; full_name: string; phone: string | null; avatar_url: string | null }>)
      .map((r) => [r.id, { name: r.full_name, phone: r.phone, call_phone: rCall.get(r.id) ?? null, avatar: r.avatar_url } as Party]))
    for (const o of orders) {
      if (o.vendor_id && vMap.has(o.vendor_id)) vendorByOrder.set(o.id, vMap.get(o.vendor_id)!)
      if (o.rider_id && rMap.has(o.rider_id)) riderByOrder.set(o.id, rMap.get(o.rider_id)!)
    }
  }

  const rows = txs.map((tx) => ({
    id:          tx.id,
    type:        tx.type,
    icon:        txIcon(tx.type),
    sign:        txSign(tx.type),
    amount:      formatPrice(tx.amount),
    label:       humanizeTx(tx, bankLast4),
    status:      tx.status,
    release_at:  tx.release_at,
    order_id:    tx.order_id,
    reference:   tx.reference,
    balance_after: formatPrice(tx.balance_after),
    created_at:  tx.created_at,
    // The people on this order (whichever exist) — profile + contact.
    vendor:      tx.order_id ? vendorByOrder.get(tx.order_id) ?? null : null,
    rider:       tx.order_id ? riderByOrder.get(tx.order_id) ?? null : null,
    // Tamper-evident verification stamp for this receipt.
    receipt_code: receiptCode({ id: tx.id, reference: tx.reference, amount: tx.amount, type: tx.type, created_at: tx.created_at }),
  }))

  return NextResponse.json({
    transactions: rows,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / limit),
    },
  })
}
