import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { customerTxIcon, customerTxSign, formatPrice } from '@/lib/customer-wallet'
import type { CustomerWalletTx } from '@/lib/customer-wallet'
import { receiptCode } from '@/lib/receipt'

// GET /api/customer-wallet/transactions?page=1&limit=20
// Returns paginated customer wallet transaction history.

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
  const offset = (page - 1) * limit

  const db = createSupabaseAdmin()

  // Resolve customer UUID
  const { data: cust } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .maybeSingle()
  const customerId = (cust as { id: string } | null)?.id
  if (!customerId) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  const { data, count, error } = await db
    .from('customer_wallet_transactions')
    .select(
      'id, type, amount_kobo, balance_before_kobo, balance_after_kobo, reference, order_id, description, status, created_at',
      { count: 'exact' }
    )
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 })
  }

  const txs = (data ?? []) as unknown as CustomerWalletTx[]

  const transactions = txs.map((tx) => ({
    id:          tx.id,
    type:        tx.type,
    icon:        customerTxIcon(tx.type),
    // GROUP_SPLIT carries both directions under one type — read it from the balance delta.
    sign:        tx.type === 'GROUP_SPLIT' ? (tx.balance_after_kobo < tx.balance_before_kobo ? '-' : '+') : customerTxSign(tx.type),
    amount:      formatPrice(tx.amount_kobo),
    amount_kobo: tx.amount_kobo,
    description: tx.description,
    order_id:    tx.order_id,
    status:      tx.status,
    reference:   tx.reference,
    balance_after: formatPrice(tx.balance_after_kobo),
    created_at:  tx.created_at,
    receipt_code: receiptCode({ id: tx.id, reference: tx.reference, amount: tx.amount_kobo, type: tx.type, created_at: tx.created_at }),
  }))

  return NextResponse.json({
    transactions,
    pagination: {
      page,
      limit,
      total:       count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  })
}
