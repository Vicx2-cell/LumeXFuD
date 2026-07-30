import { beforeEach, describe, expect, it } from 'vitest'
import { createReconciliationRun, recordReconciliationDiscrepancy, updateReconciliationRun } from './reconciliation'

type Row = Record<string, unknown>

const state = {
  calls: [] as Array<{ table: string; op: string; payload?: Row }>,
  runs: [] as Row[],
  discrepancies: [] as Row[],
}

function makeDb(): any {
  return {
    from(table: string) {
      let op: 'select' | 'insert' | 'update' = 'select'
      let payload: Row | null = null
      const filters: Array<{ field: string; value: unknown }> = []
      const builder: any = {
        select: () => builder,
        insert: (row: Row) => {
          op = 'insert'
          payload = row
          return builder
        },
        update: (row: Row) => {
          op = 'update'
          payload = row
          return builder
        },
        eq: (field: string, value: unknown) => {
          filters.push({ field, value })
          return builder
        },
        single: async () => {
          state.calls.push({ table, op, payload: payload ?? undefined })
          if (table === 'reconciliation_runs') {
            if (op === 'insert' && payload) {
              const row = {
                id: `run-${state.runs.length + 1}`,
                created_at: '2026-07-30T00:00:00.000Z',
                updated_at: '2026-07-30T00:00:00.000Z',
                completed_at: null,
                ...payload,
              }
              state.runs.push(row)
              return { data: row, error: null }
            }
            if (op === 'update' && payload) {
              const found = state.runs.find((row) => filters.every((filter) => row[filter.field] === filter.value))
              if (found) Object.assign(found, payload, { updated_at: '2026-07-30T00:00:00.000Z' })
              return { data: found ?? null, error: null }
            }
          }
          if (table === 'reconciliation_discrepancies' && op === 'insert' && payload) {
            const row = {
              id: `disc-${state.discrepancies.length + 1}`,
              created_at: '2026-07-30T00:00:00.000Z',
              updated_at: '2026-07-30T00:00:00.000Z',
              resolved_at: null,
              repair_journal_id: null,
              ...payload,
            }
            state.discrepancies.push(row)
            return { data: row, error: null }
          }
          return { data: null, error: null }
        },
      }
      return builder
    },
  }
}

beforeEach(() => {
  state.calls = []
  state.runs = []
  state.discrepancies = []
})

describe('reconciliation persistence helpers', () => {
  it('creates and updates a reconciliation run', async () => {
    const db = makeDb()

    const run = await createReconciliationRun(db, {
      runType: 'wallet_balance',
      environment: 'test',
      sourceReference: 'cron-1',
      summary: { liabilities: 1000 },
      runReference: 'recon-wallet-1',
    })

    const updated = await updateReconciliationRun(db, {
      runId: run.id,
      status: 'COMPLETED',
      summary: { liabilities: 1000, surplus_kobo: 50 },
      completedAt: '2026-07-30T00:00:00.000Z',
    })

    expect(run.run_reference).toBe('recon-wallet-1')
    expect(updated.status).toBe('COMPLETED')
    expect(updated.summary).toMatchObject({ surplus_kobo: 50 })
    expect(state.runs).toHaveLength(1)
  })

  it('records a discrepancy with immutable financial fields', async () => {
    const db = makeDb()
    const run = await createReconciliationRun(db, {
      runType: 'wallet_balance',
      environment: 'production',
      sourceReference: 'cron-2',
      runReference: 'recon-wallet-2',
    })

    const discrepancy = await recordReconciliationDiscrepancy(db, {
      reconciliationRunId: run.id,
      entityType: 'WALLET_FLOAT',
      internalReference: 'wallet-reconciliation',
      providerReference: 'paystack-balance',
      expectedAmountKobo: 5000,
      actualAmountKobo: 0,
      currency: 'NGN',
      environment: 'production',
      severity: 'critical',
      investigationNotes: 'Shortfall detected',
    })

    expect(discrepancy.entity_type).toBe('WALLET_FLOAT')
    expect(discrepancy.severity).toBe('critical')
    expect(state.discrepancies).toHaveLength(1)
  })
})
