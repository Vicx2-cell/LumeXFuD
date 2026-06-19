import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { receiptCode } from '@/lib/receipt'
import { formatPrice } from '@/lib/customer-wallet'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/sponsor-wallet/receipt?ref=TOPUP-… — PUBLIC. After a parent/sponsor
// pays, the success page polls this for a tamper-evident receipt of the top-up.
// The reference is the secret the payer holds; we only return their own receipt
// fields (amount, date, the student's first name, verification code). Returns
// { pending:true } until the webhook has credited the wallet (a few seconds).
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref') ?? ''
  if (!/^TOPUP-[A-Za-z0-9-]{4,40}$/.test(ref)) {
    return NextResponse.json({ error: 'Invalid reference' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const rl = await rateLimitGeneric(`sponsor-receipt:${ip}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: txRow } = await db
    .from('customer_wallet_transactions')
    .select('id, customer_id, reference, amount_kobo, type, created_at, description')
    .eq('reference', ref)
    .eq('type', 'TOPUP')
    .maybeSingle()
  const tx = txRow as { id: string; customer_id: string; reference: string; amount_kobo: number; type: string; created_at: string; description: string | null } | null
  if (!tx) return NextResponse.json({ pending: true }) // webhook hasn't credited yet

  const { data: cRow } = await db.from('customers').select('name').eq('id', tx.customer_id).maybeSingle()
  const first = ((cRow as { name: string | null } | null)?.name ?? '').trim().split(/\s+/)[0] || 'Student'

  // The sender's name is stored on the transaction as "Top-up from <name> [+ bonus]".
  const m = (tx.description ?? '').match(/^Top-up from (.+?)(?: \+ .*)?$/)
  const from = m ? m[1] : null

  return NextResponse.json({
    pending: false,
    reference: tx.reference,
    amount_kobo: tx.amount_kobo,
    amount_formatted: formatPrice(tx.amount_kobo),
    student_first_name: first,
    from,
    created_at: tx.created_at,
    receipt_code: receiptCode({ id: tx.id, reference: tx.reference, amount: tx.amount_kobo, type: tx.type, created_at: tx.created_at }),
  })
}
