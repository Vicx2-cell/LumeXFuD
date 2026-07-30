import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  walletTransactions: [] as Row[],
  payoutBatchItems: [] as Row[],
  payoutBatches: [] as Row[],
  payoutTransferAttempts: [] as Row[],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  walletSuccessTransitions: 0,
  walletFailureTransitions: 0,
  walletReverseTransitions: 0,
}))

function rowsFor(table: string): Row[] {
  switch (table) {
    case 'wallet_transactions': return state.walletTransactions
    case 'payout_batch_items': return state.payoutBatchItems
    case 'payout_batches': return state.payoutBatches
    case 'payout_transfer_attempts': return state.payoutTransferAttempts
    default: return []
  }
}

function matchRow(row: Row, filters: Array<{ field: string; value: unknown }>): boolean {
  return filters.every((filter) => row[filter.field] === filter.value)
}

function makeDb(): any {
  return {
    from(table: string) {
      const filters: Array<{ field: string; value: unknown }> = []
      let action: 'select' | 'update' | 'insert' = 'select'
      let payload: Row = {}

      const resolveQuery = async () => {
        const rows = rowsFor(table)
        if (action === 'insert') {
          const row = { id: `${table}-${rows.length + 1}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload }
          rows.push(row)
          return { data: row, error: null }
        }

        const row = rows.find((candidate) => matchRow(candidate, filters)) ?? null
        if (row && action === 'update') {
          const prevStatus = row.status
          Object.assign(row, payload, { updated_at: new Date().toISOString() })
          if (table === 'wallet_transactions') {
            if (prevStatus === 'PENDING' && row.status === 'COMPLETED') state.walletSuccessTransitions += 1
            if (prevStatus === 'PENDING' && row.status === 'FAILED') state.walletFailureTransitions += 1
            if (prevStatus === 'PENDING' && row.status === 'REVERSED') state.walletReverseTransitions += 1
          }
        }
        return { data: row, error: null }
      }

      const proxy: any = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'then') return (onFulfilled: (value: unknown) => void, onRejected: (reason?: unknown) => void) => Promise.resolve(resolveQuery()).then(onFulfilled, onRejected)
          if (prop === 'catch') return () => proxy
          if (prop === 'finally') return () => proxy
          if (prop === 'select') return () => proxy
          if (prop === 'update') return (next: Row) => { action = 'update'; payload = next; return proxy }
          if (prop === 'insert') return (next: Row) => { action = 'insert'; payload = next; return proxy }
          if (prop === 'eq') return (field: string, value: unknown) => { filters.push({ field, value }); return proxy }
          if (prop === 'order' || prop === 'limit') return () => proxy
          if (prop === 'maybeSingle' || prop === 'single') return async () => resolveQuery()
          return proxy
        },
      })
      return proxy
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      if (name === 'finalize_sweep') {
        const tx = state.walletTransactions.find((row) => row.id === args.p_tx_id)
        if (!tx || tx.status !== 'PENDING') return { data: false, error: null }
        if (args.p_success) {
          tx.status = 'COMPLETED'
          tx.paystack_transfer_code = args.p_transfer_code ?? tx.paystack_transfer_code ?? null
          tx.paystack_recipient_code = args.p_recipient_code ?? tx.paystack_recipient_code ?? null
          state.walletSuccessTransitions += 1
        } else {
          tx.status = 'FAILED'
          tx.failure_reason = args.p_reason ?? null
          if (String(args.p_reason ?? '').toLowerCase().includes('revers')) {
            state.walletReverseTransitions += 1
          } else {
            state.walletFailureTransitions += 1
          }
        }
        return { data: true, error: null }
      }
      return { data: null, error: null }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb() }))

import { processWebhookAsync } from './webhook'

beforeEach(() => {
  state.walletTransactions = [
    { id: 'tx-1', paystack_transfer_code: 'ps-trf-1', status: 'PENDING', user_id: 'user-1', user_type: 'VENDOR', amount: 12500 },
  ]
  state.payoutBatchItems = [
    { id: 'item-1', batch_id: 'batch-1', transfer_reference: 'TRF-1', paystack_transfer_code: 'ps-trf-1', status: 'PENDING', snapshot_metadata: {} },
  ]
  state.payoutBatches = [
    { id: 'batch-1', batch_reference: 'BATCH-1', status: 'IN_PROGRESS' },
  ]
  state.payoutTransferAttempts = [
    { id: 'attempt-1', payout_batch_item_id: 'item-1', attempt_no: 1, transfer_reference: 'TRF-1', paystack_transfer_code: 'ps-trf-1', status: 'PENDING', provider_payload: {} },
  ]
  state.rpcCalls = []
  state.walletSuccessTransitions = 0
  state.walletFailureTransitions = 0
  state.walletReverseTransitions = 0
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
})

describe('paystack transfer lifecycle', () => {
  it('finalizes a successful transfer once', async () => {
    await processWebhookAsync({
      event: 'transfer.success',
      data: { transfer_code: 'ps-trf-1', reference: 'TRF-1' },
    })

    expect(state.walletTransactions[0].status).toBe('COMPLETED')
    expect(state.payoutBatchItems[0].status).toBe('SUCCESS')
    expect(state.payoutBatches[0].status).toBe('COMPLETED')
    expect(state.payoutTransferAttempts[0].status).toBe('SUCCESS')
    expect(state.walletSuccessTransitions).toBe(1)
  })

  it('ignores a duplicate success webhook after the first terminal update', async () => {
    await processWebhookAsync({
      event: 'transfer.success',
      data: { transfer_code: 'ps-trf-1', reference: 'TRF-1' },
    })
    await processWebhookAsync({
      event: 'transfer.success',
      data: { transfer_code: 'ps-trf-1', reference: 'TRF-1' },
    })

    expect(state.walletTransactions[0].status).toBe('COMPLETED')
    expect(state.walletSuccessTransitions).toBe(1)
  })

  it('reverses a failed transfer once', async () => {
    await processWebhookAsync({
      event: 'transfer.failed',
      data: { transfer_code: 'ps-trf-1', reference: 'TRF-1', reason: 'bank unavailable' },
    })

    expect(state.walletTransactions[0].status).toBe('FAILED')
    expect(state.rpcCalls.filter((call) => call.name === 'finalize_sweep')).toHaveLength(1)
    expect(state.payoutBatchItems[0].status).toBe('FAILED')
    expect(state.payoutBatches[0].status).toBe('FAILED')
    expect(state.payoutTransferAttempts[0].status).toBe('FAILED')
    expect(state.walletFailureTransitions).toBe(1)
  })

  it('marks a reversed transfer distinctly', async () => {
    await processWebhookAsync({
      event: 'transfer.reversed',
      data: { transfer_code: 'ps-trf-1', reference: 'TRF-1', reason: 'provider reversal' },
    })

    expect(state.walletTransactions[0].status).toBe('FAILED')
    expect(state.payoutBatchItems[0].status).toBe('REVERSED')
    expect(state.payoutTransferAttempts[0].status).toBe('REVERSED')
    expect(state.walletReverseTransitions).toBe(1)
  })
})
