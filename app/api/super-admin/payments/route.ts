import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'

async function requireSuperAdmin() {
  const session = await getCurrentUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.role !== 'super_admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { session }
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin()
  if ('error' in auth) return auth.error

  const db = createSupabaseAdmin()
  const domain = req.nextUrl.searchParams.get('domain')
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 25) || 25, 1), 100)

  const premiumQuery = db.from('premium_payment_events').select('*').order('created_at', { ascending: false }).limit(limit)
  const boostQuery = db.from('boost_payment_events').select('*').order('created_at', { ascending: false }).limit(limit)
  const ledgerQuery = db.from('billing_ledger_entries').select('*').order('created_at', { ascending: false }).limit(limit)
  const diagnosticsQuery = db.from('paystack_billing_diagnostics').select('*').order('created_at', { ascending: false }).limit(limit)

  const [premium, boost, ledger, diagnostics] = await Promise.all([
    premiumQuery,
    boostQuery,
    ledgerQuery,
    diagnosticsQuery,
  ])

  const payload: Record<string, unknown> = { ok: true, limit }
  if (!domain || domain === 'premium' || domain === 'all') payload.premium = premium.data ?? []
  if (!domain || domain === 'boost' || domain === 'all') payload.boost = boost.data ?? []
  payload.ledger = ledger.data ?? []
  payload.diagnostics = diagnostics.data ?? []

  return NextResponse.json(payload)
}
