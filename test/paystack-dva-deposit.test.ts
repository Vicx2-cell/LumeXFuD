import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processWebhookAsync } from '@/lib/paystack/webhook'

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  receiptInserted: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => {
          if (table === 'customer_virtual_accounts') {
            return {
              data: {
                id: 'cva-1',
                customer_id: 'customer-1',
                account_number: '0123456789',
                account_name: 'Ada Lovelace',
                paystack_customer_code: 'CUS_123',
                provider_slug: 'paystack',
                bank_name: 'Test Bank',
                status: 'ACTIVE',
              },
            }
          }
          return { data: null }
        },
        insert: async () => {
          if (table === 'virtual_account_receipts') state.receiptInserted += 1
          return { error: null }
        },
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      state.calls.push({ name, args })
      if (name === 'ensure_financial_account') {
        return Promise.resolve({ data: `${String(args.p_account_type)}:${String(args.p_owner_type)}`, error: null })
      }
      if (name === 'post_ledger_journal') {
        return Promise.resolve({ data: [{ journal_id: 'journal-1', replayed: false, journal_status: 'POSTED' }], error: null })
      }
      if (name === 'topup_customer_wallet') {
        return Promise.resolve({ data: 'wallet-tx-1', error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }),
}))

vi.mock('@/lib/paystack/init', () => ({
  paystackEnvironmentFromSecret: vi.fn(() => 'production'),
  verifyPaystackTransaction: vi.fn(async () => ({
    status: 'success',
    amount: 5000,
    reference: 'ref-123',
    metadata: { currency: 'NGN' },
  })),
}))

beforeEach(() => {
  state.calls = []
  state.receiptInserted = 0
  process.env.PAYSTACK_SECRET_KEY = 'sk_live_dummy'
})

describe('Paystack DVA deposit ledger credit', () => {
  it('posts the verified deposit into the ledger and mirrors the wallet credit', async () => {
    await processWebhookAsync({
      event: 'charge.success',
      data: {
        id: 'txn-1',
        reference: 'ref-123',
        amount: 5000,
        currency: 'NGN',
        channel: 'bank_transfer',
        dedicated_account: { account_number: '0123456789' },
      },
    })

    const ledgerCall = state.calls.find((call) => call.name === 'post_ledger_journal')
    const walletCall = state.calls.find((call) => call.name === 'topup_customer_wallet')

    expect(state.receiptInserted).toBe(1)
    expect(ledgerCall?.args.p_idempotency_key).toBe('paystack:dva-deposit:production:ref-123')
    expect(walletCall?.args.p_reference).toBe('DVA-production-ref-123')
    expect(walletCall?.args.p_amount_kobo).toBe(5000)
  })
})
