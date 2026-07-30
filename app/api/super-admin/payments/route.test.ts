import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const state = {
  session: { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' },
}

const rows: Record<string, Array<Record<string, unknown>>> = {
  premium_payment_events: [{ id: 'prem-1', paystack_reference: 'PREM-1' }],
  boost_payment_events: [{ id: 'boost-1', paystack_reference: 'BOST-1' }],
  billing_ledger_entries: [{ id: 'led-1', payment_reference: 'PREM-1' }],
  paystack_billing_diagnostics: [{ id: 'diag-1', reference: 'PREM-1' }],
  order_payment_intents: [{ id: 'intent-1', paystack_reference: 'PAY-1' }],
  payment_beneficiary_profiles: [{ id: 'profile-1', beneficiary_type: 'VENDOR' }],
  payout_batches: [{ id: 'batch-1', batch_reference: 'BATCH-1' }],
  payout_batch_items: [{ id: 'item-1', transfer_reference: 'TRF-1' }],
  payout_transfer_attempts: [{ id: 'attempt-1', transfer_reference: 'TRF-1' }],
  refunds: [{ id: 'refund-1', order_id: 'order-1' }],
  reconciliation_runs: [{ id: 'run-1', run_reference: 'RUN-1' }],
  reconciliation_discrepancies: [{ id: 'disc-1', reconciliation_run_id: 'run-1' }],
  processed_webhooks: [{ id: 'webhook-1', reference: 'W-1' }],
  customer_wallet_transactions: [{ id: 'cwtx-1', reference: 'DVA-1' }],
}

function makeQuery(table: string) {
  const q: Record<string, unknown> = {
    select() { return q },
    order() { return q },
    limit() { return q },
    eq() { return q },
    then(resolve: (value: unknown) => void, reject: (reason?: unknown) => void) {
      return Promise.resolve({ data: rows[table] ?? [] }).then(resolve, reject)
    },
  }
  return q
}

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => state.session),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return makeQuery(table as keyof typeof rows)
    },
  })),
}))

describe('super-admin payments route', () => {
  beforeEach(() => {
    state.session = { role: 'super_admin', phone: '+2348000000000', userId: 'super-1' }
  })

  it('requires super admin access', async () => {
    state.session = { role: 'vendor', phone: '+2348000000000', userId: 'vendor-1' }
    const res = (await GET(new NextRequest('http://localhost') as never))!
    expect(res.status).toBe(403)
  })

  it('returns recent billing diagnostics and payment events', async () => {
    const res = (await GET(new NextRequest('http://localhost?domain=all&limit=5') as never))!
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.premium).toHaveLength(1)
    expect(json.boost).toHaveLength(1)
    expect(json.ledger).toHaveLength(1)
    expect(json.diagnostics).toHaveLength(1)
    expect(json.payment_intents).toHaveLength(1)
    expect(json.reconciliation_runs).toHaveLength(1)
    expect(json.processed_webhooks).toHaveLength(1)
  })
})
