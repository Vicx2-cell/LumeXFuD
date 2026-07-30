import { beforeEach, describe, expect, it } from 'vitest'
import {
  recordPayoutTransferAttempt,
} from './payout-batches'

type Row = Record<string, unknown>

const state = {
  attempts: [] as Row[],
}

function makeDb(): any {
  return {
    from(table: string) {
      const filters: Array<{ field: string; value: unknown }> = []
      let insertPayload: Row | null = null
      let updatePayload: Row | null = null
      let terminal: 'list' | 'single' = 'list'
      return {
        select() {
          terminal = 'list'
          return this
        },
        insert(payload: Row) {
          insertPayload = payload
          return this
        },
        update(payload: Row) {
          updatePayload = payload
          return this
        },
        eq(field: string, value: unknown) {
          filters.push({ field, value })
          return this
        },
        maybeSingle: async () => {
          if (table !== 'payout_transfer_attempts') return { data: null, error: null }
          terminal = 'single'
          const matches = state.attempts.filter((row) => filters.every((f) => row[f.field] === f.value))
          const found = matches[0] ?? null
          if (found && updatePayload) Object.assign(found, updatePayload)
          return { data: found, error: null }
        },
        single: async () => {
          if (table !== 'payout_transfer_attempts' || !insertPayload) return { data: null, error: null }
          const row = {
            id: `attempt-${state.attempts.length + 1}`,
            attempt_no: Number(insertPayload.attempt_no ?? state.attempts.length + 1),
            payout_batch_item_id: insertPayload.payout_batch_item_id,
            transfer_reference: insertPayload.transfer_reference,
            paystack_transfer_code: insertPayload.paystack_transfer_code ?? null,
            status: insertPayload.status ?? 'PENDING',
            provider_payload: insertPayload.provider_payload ?? {},
            failure_reason: insertPayload.failure_reason ?? null,
            initiated_at: new Date().toISOString(),
            verified_at: null,
            succeeded_at: null,
            failed_at: null,
            reversed_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          state.attempts.push(row)
          return { data: row, error: null }
        },
        then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => {
          void (async () => {
            if (table !== 'payout_transfer_attempts') {
              resolve({ data: null, error: null })
              return
            }
            const matches = state.attempts.filter((row) => filters.every((f) => row[f.field] === f.value))
            if (updatePayload && matches[0]) Object.assign(matches[0], updatePayload)
            if (terminal === 'single') {
              resolve({ data: matches[0] ?? null, error: null })
              return
            }
            resolve({ data: matches, error: null })
          })().catch(reject)
        },
      }
    },
    rpc: async () => ({ data: null, error: null }),
  }
}

beforeEach(() => {
  state.attempts = []
})

describe('payout transfer attempts', () => {
  it('assigns a new attempt number for a new transfer reference and replays the same reference idempotently', async () => {
    const db = makeDb()

    const first = await recordPayoutTransferAttempt(db, {
      payoutBatchItemId: 'item-1',
      transferReference: 'TRF-1',
      providerPayload: { source: 'test' },
    })
    const replay = await recordPayoutTransferAttempt(db, {
      payoutBatchItemId: 'item-1',
      transferReference: 'TRF-1',
      providerPayload: { source: 'test' },
    })
    const second = await recordPayoutTransferAttempt(db, {
      payoutBatchItemId: 'item-1',
      transferReference: 'TRF-2',
      providerPayload: { source: 'test' },
    })

    expect(first.replayed).toBe(false)
    expect(first.attempt.attempt_no).toBe(1)
    expect(replay.replayed).toBe(true)
    expect(state.attempts).toHaveLength(2)
    expect(second.attempt.attempt_no).toBe(2)
  })
})
