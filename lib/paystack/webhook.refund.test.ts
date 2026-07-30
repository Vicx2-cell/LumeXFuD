import { beforeEach, describe, expect, it, vi } from 'vitest'

type Filter = { kind: 'eq'; field: string; value: unknown }
type TableRow = Record<string, unknown>

const state = vi.hoisted(() => ({
  settleRefundLedger: vi.fn(),
  tables: {} as Record<string, TableRow[]>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}))

function matches(row: TableRow, filters: Filter[]): boolean {
  return filters.every((filter) => row[filter.field] === filter.value)
}

function makeDb(): any {
  return {
    from(table: string) {
      const query = {
        op: 'select' as 'select' | 'update',
        payload: null as TableRow | null,
        filters: [] as Filter[],
      }
      const builder: any = {
        select: () => builder,
        update: (payload: TableRow) => {
          query.op = 'update'
          query.payload = payload
          return builder
        },
        eq: (field: string, value: unknown) => {
          query.filters.push({ kind: 'eq', field, value })
          return builder
        },
        order: () => builder,
        maybeSingle: async () => {
          const rows = state.tables[table] ?? []
          const found = rows.find((row) => matches(row, query.filters)) ?? null
          return { data: found, error: null }
        },
        single: async () => {
          const rows = state.tables[table] ?? []
          const found = rows.find((row) => matches(row, query.filters)) ?? null
          return { data: found, error: null }
        },
        then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => {
          void (async () => {
            const rows = state.tables[table] ?? (state.tables[table] = [])
            if (query.op === 'update') {
              const updated = rows.filter((row) => matches(row, query.filters))
              for (const row of updated) Object.assign(row, query.payload ?? {})
              resolve({ data: updated[0] ?? null, error: null })
              return
            }
            const found = rows.filter((row) => matches(row, query.filters))
            resolve({ data: found, error: null })
          })().catch(reject)
        },
      }
      return builder
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) })
      if (name === 'reverse_ledger_journal') {
        return { data: [{ reversal_journal_id: 'reversal-1', replayed: false }], error: null }
      }
      return { data: null, error: null }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb() }))
vi.mock('./init', () => ({
  paystackEnvironmentFromSecret: vi.fn(() => 'test'),
  verifyPaystackTransaction: vi.fn(async () => ({ status: 'success', amount: 0, reference: '', currency: 'NGN', metadata: {} })),
}))
vi.mock('../refund-ledger', () => ({ settleRefundLedger: state.settleRefundLedger }))
vi.mock('../notify', () => ({ sendWhatsAppWithFallback: vi.fn(async () => undefined) }))
vi.mock('../notify-templates', () => ({ renderTemplate: vi.fn(() => '') }))
vi.mock('../notifications', () => ({ notifyInApp: vi.fn(async () => undefined) }))
vi.mock('../push', () => ({ sendPushToUser: vi.fn(async () => undefined) }))
vi.mock('../platform-earnings', () => ({ recordPlatformEarning: vi.fn(async () => undefined), recordOrderCompletedEarnings: vi.fn(async () => undefined) }))
vi.mock('../customer-wallet', () => ({
  processCustomerTopup: vi.fn(async () => undefined),
  spendCustomerWallet: vi.fn(async () => ({ success: true })),
  isCustomerWalletEnabled: vi.fn(async () => true),
}))
vi.mock('../wallet-reservations', () => ({
  consumeWalletReservation: vi.fn(async () => undefined),
  findWalletReservationByOrder: vi.fn(async () => null),
}))
vi.mock('./transfer', () => ({ refundTransaction: vi.fn(async () => undefined) }))
vi.mock('../security-events', () => ({ recordSecurityEvent: vi.fn(async () => undefined) }))
vi.mock('../transactional-email', () => ({ sendOrderConfirmationEmail: vi.fn(async () => undefined) }))
vi.mock('../payout-batches', () => ({
  findPayoutBatchItemByTransferCode: vi.fn(async () => null),
  findPayoutTransferAttemptByTransferCode: vi.fn(async () => null),
  markPayoutBatchItemStatus: vi.fn(async () => undefined),
  markPayoutBatchStatus: vi.fn(async () => undefined),
  markPayoutTransferAttemptStatus: vi.fn(async () => undefined),
}))

import { processWebhookAsync } from './webhook'

beforeEach(() => {
  state.tables = {}
  state.rpcCalls = []
  state.settleRefundLedger.mockReset()
  state.settleRefundLedger.mockResolvedValue({ journalId: 'refund-settlement-journal', replayed: false })
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
})

describe('refund webhook finalization', () => {
  it('finalizes a processed refund once and ignores a duplicate delivery', async () => {
    state.tables.refunds = [{
      id: 'refund-1',
      paystack_transaction_reference: 'order-ref-1',
      paystack_refund_reference: null,
      amount_kobo: 2500,
      status: 'PROCESSING',
      created_at: '2026-07-30T00:00:00.000Z',
      order_id: 'order-1',
    }]
    state.tables.orders = [{
      id: 'order-1',
      order_number: 'LXF-1',
      customer_id: 'customer-1',
      guest_phone: '+2348000000000',
      guest_name: null,
    }]

    await processWebhookAsync({
      event: 'refund.processed',
      data: {
        transaction_reference: 'order-ref-1',
        refund_reference: 'provider-ref-1',
      },
    })

    expect(state.settleRefundLedger).toHaveBeenCalledTimes(1)
    expect((state.tables.refunds[0] as TableRow).status).toBe('COMPLETED')

    await processWebhookAsync({
      event: 'refund.processed',
      data: {
        transaction_reference: 'order-ref-1',
        refund_reference: 'provider-ref-1',
      },
    })

    expect(state.settleRefundLedger).toHaveBeenCalledTimes(1)
  })

  it('reverses the refund reservation when a refund fails', async () => {
    state.tables.refunds = [{
      id: 'refund-1',
      paystack_transaction_reference: 'order-ref-1',
      paystack_refund_reference: null,
      amount_kobo: 2500,
      status: 'PROCESSING',
      created_at: '2026-07-30T00:00:00.000Z',
      order_id: 'order-1',
    }]
    state.tables.ledger_journals = [{
      id: 'journal-1',
      idempotency_key: 'refund-reserve:test:refund-1',
      status: 'POSTED',
    }]

    await processWebhookAsync({
      event: 'refund.failed',
      data: {
        transaction_reference: 'order-ref-1',
        refund_reference: 'provider-ref-1',
        reason: 'declined',
      },
    })

    const reverseCall = state.rpcCalls.find((call) => call.name === 'reverse_ledger_journal')
    expect(reverseCall?.args).toMatchObject({
      p_original_journal_id: 'journal-1',
      p_idempotency_key: 'refund-reverse:test:refund-1',
      p_source: 'refund_provider_failure',
    })
    expect((state.tables.refunds[0] as TableRow).status).toBe('FAILED')
    expect(state.settleRefundLedger).not.toHaveBeenCalled()
  })
})
