import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { receiptCode } from '@/lib/receipt'
import { formatPrice } from '@/lib/money'
import { rateLimitGeneric } from '@/lib/rate-limit'

// POST /api/admin/verify-receipt  { reference, code }
// Looks up the transaction by its reference, recomputes the tamper-proof code
// from the REAL stored row, and compares it to the code on the receipt the admin
// was shown. Result:
//   not_found → no such transaction (fake/old reference)
//   tampered  → transaction exists but the code doesn't match (receipt altered)
//   valid     → genuine + unaltered; returns the true details
// Admin / super-admin only.

const input = z.object({
  reference: z.string().trim().min(3).max(120),
  code:      z.string().trim().min(4).max(40),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`verify-receipt:${session.phone}`, 60, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = input.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Enter a reference and code' }, { status: 400 })

  const { reference, code } = parsed.data
  const db = createSupabaseAdmin()

  // 1) Vendor/rider wallet ledger.
  const { data: w } = await db
    .from('wallet_transactions')
    .select('id, reference, amount, type, status, created_at, user_type')
    .eq('reference', reference)
    .maybeSingle()

  // 2) Customer wallet ledger (amount_kobo).
  const { data: c } = w ? { data: null } : await db
    .from('customer_wallet_transactions')
    .select('id, reference, amount_kobo, type, status, created_at')
    .eq('reference', reference)
    .maybeSingle()

  if (!w && !c) {
    return NextResponse.json({ result: 'not_found' })
  }

  const row = w
    ? { id: w.id, reference: w.reference, amount: w.amount, type: w.type, status: w.status, created_at: w.created_at, party: `${w.user_type} wallet` }
    : { id: c!.id, reference: c!.reference, amount: c!.amount_kobo, type: c!.type, status: c!.status, created_at: c!.created_at, party: 'Customer wallet' }

  const expected = receiptCode({ id: row.id, reference: row.reference, amount: row.amount, type: row.type, created_at: row.created_at })
  const match = expected === code.trim().toUpperCase()

  return NextResponse.json({
    result: match ? 'valid' : 'tampered',
    expected_code: expected,
    transaction: {
      reference:  row.reference,
      party:      row.party,
      type:       row.type,
      status:     row.status,
      amount:     formatPrice(Number(row.amount)),
      created_at: row.created_at,
    },
  })
}
