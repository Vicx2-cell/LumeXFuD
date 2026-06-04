import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { formatPrice, humanizeTx, txSign, txIcon } from '@/lib/wallet'
import type { WalletTransaction, WalletBalance } from '@/lib/wallet'

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
    created_at:  tx.created_at,
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
