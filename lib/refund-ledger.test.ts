import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reserveRefundLedger, settleRefundLedger } from './refund-ledger'

type RpcCall = { name: string; args: Record<string, unknown> }

const state = vi.hoisted(() => ({
  rpcCalls: [] as RpcCall[],
}))

function makeDb(): any {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) })
      if (name === 'ensure_financial_account') {
        return { data: `${String(args.p_account_type)}:${String(args.p_owner_type)}`, error: null }
      }
      if (name === 'post_ledger_journal') {
        return { data: [{ journal_id: `${String(args.p_journal_type).toLowerCase()}-journal`, replayed: false, journal_status: 'POSTED' }], error: null }
      }
      return { data: null, error: null }
    },
  }
}

beforeEach(() => {
  state.rpcCalls = []
})

describe('refund ledger helpers', () => {
  it('posts a balanced reservation journal exactly once', async () => {
    const db = makeDb()

    const result = await reserveRefundLedger({
      db,
      idempotencyKey: 'refund-reserve:test:refund-1',
      businessReference: 'ORDER-1',
      correlationId: 'PAYSTACK-REF-1',
      amountKobo: 2500,
      environment: 'test',
      metadata: { refund_id: 'refund-1' },
    })

    expect(result).toEqual({ journalId: 'refund_reservation-journal', replayed: false })
    expect(state.rpcCalls.map((call) => call.name)).toEqual([
      'ensure_financial_account',
      'ensure_financial_account',
      'post_ledger_journal',
    ])
    const postCall = state.rpcCalls[2]
    expect(postCall.args.p_journal_type).toBe('REFUND_RESERVATION')
    expect((postCall.args.p_entries as Array<Record<string, unknown>>)).toHaveLength(2)
    expect((postCall.args.p_entries as Array<Record<string, unknown>>).every((entry) => Number(entry.amount_kobo) === 2500)).toBe(true)
  })

  it('settles wallet and paystack refund amounts without trusting zero totals', async () => {
    const db = makeDb()

    const result = await settleRefundLedger({
      db,
      idempotencyKey: 'refund-settle:test:refund-1',
      businessReference: 'ORDER-1',
      correlationId: 'PAYSTACK-REF-1',
      amountKobo: 2500,
      walletAmountKobo: 1000,
      paystackAmountKobo: 1500,
      customerId: 'customer-1',
      environment: 'test',
      metadata: { refund_id: 'refund-1' },
    })

    expect(result).toEqual({ journalId: 'refund_settlement-journal', replayed: false })
    const postCall = state.rpcCalls.at(-1)
    expect(postCall?.name).toBe('post_ledger_journal')
    expect(postCall?.args.p_journal_type).toBe('REFUND_SETTLEMENT')
    expect((postCall?.args.p_entries as Array<Record<string, unknown>>)).toHaveLength(3)
    expect(postCall?.args.p_metadata).toMatchObject({ amount_kobo: 2500, wallet_amount_kobo: 1000, paystack_amount_kobo: 1500 })
  })
})
