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

  const includeBilling = !domain || domain === 'premium' || domain === 'boost' || domain === 'all'
  const includePayments = !domain || domain === 'payments' || domain === 'all'
  const includeReconciliation = !domain || domain === 'reconciliation' || domain === 'all'
  const includeReplay = !domain || domain === 'replay' || domain === 'all'
  const includeDva = !domain || domain === 'dva' || domain === 'all'

  const [premium, boost, ledger, diagnostics, intents, beneficiaries, payouts, payoutItems, payoutAttempts, refunds, reconciliationRuns, discrepancies, processedWebhooks, dvaTransactions] = await Promise.all([
    includeBilling ? db.from('premium_payment_events').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includeBilling ? db.from('boost_payment_events').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includeBilling ? db.from('billing_ledger_entries').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includeBilling ? db.from('paystack_billing_diagnostics').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includePayments ? db.from('order_payment_intents').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includePayments ? db.from('payment_beneficiary_profiles').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includePayments ? db.from('payout_batches').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includePayments ? db.from('payout_batch_items').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includePayments ? db.from('payout_transfer_attempts').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includePayments ? db.from('refunds').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includeReconciliation ? db.from('reconciliation_runs').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includeReconciliation ? db.from('reconciliation_discrepancies').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includeReplay ? db.from('processed_webhooks').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
    includeDva ? db.from('customer_wallet_transactions').select('*').order('created_at', { ascending: false }).limit(limit) : Promise.resolve({ data: [], error: null }),
  ])

  const payload: Record<string, unknown> = { ok: true, limit }
  if (!domain || domain === 'premium' || domain === 'all') payload.premium = premium.data ?? []
  if (!domain || domain === 'boost' || domain === 'all') payload.boost = boost.data ?? []
  if (includeBilling || includePayments || includeReconciliation || includeReplay || includeDva) payload.ledger = ledger.data ?? []
  if (includeBilling) payload.diagnostics = diagnostics.data ?? []
  if (includePayments) {
    payload.payment_intents = intents.data ?? []
    payload.beneficiaries = beneficiaries.data ?? []
    payload.payout_batches = payouts.data ?? []
    payload.payout_items = payoutItems.data ?? []
    payload.payout_attempts = payoutAttempts.data ?? []
    payload.refunds = refunds.data ?? []
  }
  if (includeReconciliation) {
    payload.reconciliation_runs = reconciliationRuns.data ?? []
    payload.reconciliation_discrepancies = discrepancies.data ?? []
  }
  if (includeReplay) payload.processed_webhooks = processedWebhooks.data ?? []
  if (includeDva) payload.dva_transactions = dvaTransactions.data ?? []

  return NextResponse.json(payload)
}
