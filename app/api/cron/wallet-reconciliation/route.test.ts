import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ table: string; op: string; payload?: Row }>,
}))

function matches(row: Row, filters: Array<{ kind: 'eq' | 'in'; field: string; value: unknown }>): boolean {
  return filters.every((filter) => {
    if (filter.kind === 'eq') return row[filter.field] === filter.value
    return Array.isArray(filter.value) && filter.value.includes(row[filter.field])
  })
}

function makeDb(): any {
  return {
    from(table: string) {
      const query = {
        op: 'select' as 'select' | 'update' | 'insert' | 'upsert',
        payload: null as Row | null,
        filters: [] as Array<{ kind: 'eq' | 'in'; field: string; value: unknown }>,
      }
      const builder: any = {
        select: () => builder,
        update: (payload: Row) => {
          query.op = 'update'
          query.payload = payload
          return builder
        },
        insert: (payload: Row) => {
          query.op = 'insert'
          query.payload = payload
          return builder
        },
        upsert: (payload: Row) => {
          query.op = 'upsert'
          query.payload = payload
          return builder
        },
        eq: (field: string, value: unknown) => {
          query.filters.push({ kind: 'eq', field, value })
          return builder
        },
        in: (field: string, value: unknown[]) => {
          query.filters.push({ kind: 'in', field, value })
          return builder
        },
        maybeSingle: async () => {
          const rows = state.tables[table] ?? []
          const found = rows.find((row) => matches(row, query.filters)) ?? null
          return { data: found, error: null }
        },
        single: async () => {
          const rows = state.tables[table] ?? (state.tables[table] = [])
          if (query.op === 'insert' && query.payload) {
            const row = {
              id: `row-${rows.length + 1}`,
              created_at: '2026-07-30T00:00:00.000Z',
              updated_at: '2026-07-30T00:00:00.000Z',
              ...query.payload,
            }
            rows.push(row)
            return { data: row, error: null }
          }
          if (query.op === 'upsert' && query.payload) {
            const key = query.payload.id as string | undefined
            if (key) {
              const existing = rows.find((row) => row.id === key)
              if (existing) {
                Object.assign(existing, query.payload, { updated_at: '2026-07-30T00:00:00.000Z' })
                return { data: existing, error: null }
              }
            }
            const row = {
              id: key ?? `row-${rows.length + 1}`,
              created_at: '2026-07-30T00:00:00.000Z',
              updated_at: '2026-07-30T00:00:00.000Z',
              ...query.payload,
            }
            rows.push(row)
            return { data: row, error: null }
          }
          if (query.op === 'update') {
            const updated = rows.filter((row) => matches(row, query.filters))
            for (const row of updated) Object.assign(row, query.payload ?? {}, { updated_at: '2026-07-30T00:00:00.000Z' })
            return { data: updated[0] ?? null, error: null }
          }
          const found = rows.find((row) => matches(row, query.filters)) ?? null
          return { data: found, error: null }
        },
        then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => {
          void (async () => {
            const rows = state.tables[table] ?? (state.tables[table] = [])
            state.calls.push({ table, op: query.op, payload: query.payload ?? undefined })
            if (query.op === 'insert' && query.payload) {
              const row = {
                id: `row-${rows.length + 1}`,
                created_at: '2026-07-30T00:00:00.000Z',
                updated_at: '2026-07-30T00:00:00.000Z',
                ...query.payload,
              }
              rows.push(row)
              resolve({ data: row, error: null })
              return
            }
            if (query.op === 'upsert' && query.payload) {
              const key = query.payload.id as string | undefined
              if (key) {
                const existing = rows.find((row) => row.id === key)
                if (existing) {
                  Object.assign(existing, query.payload, { updated_at: '2026-07-30T00:00:00.000Z' })
                  resolve({ data: existing, error: null })
                  return
                }
              }
              const row = {
                id: key ?? `row-${rows.length + 1}`,
                created_at: '2026-07-30T00:00:00.000Z',
                updated_at: '2026-07-30T00:00:00.000Z',
                ...query.payload,
              }
              rows.push(row)
              resolve({ data: row, error: null })
              return
            }
            if (query.op === 'update') {
              const updated = rows.filter((row) => matches(row, query.filters))
              for (const row of updated) Object.assign(row, query.payload ?? {}, { updated_at: '2026-07-30T00:00:00.000Z' })
              resolve({ data: updated, error: null })
              return
            }
            const found = rows.filter((row) => matches(row, query.filters))
            resolve({ data: found, error: null })
          })().catch(reject)
        },
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => makeDb() }))
vi.mock('@/lib/cron-health', () => ({
  withCronHealth: async (_key: string, fn: () => Promise<Response>) => fn(),
  verifyCronSecret: () => true,
}))
vi.mock('@/lib/audit', () => ({ audit: vi.fn(async () => undefined) }))
vi.mock('@/lib/notify', () => ({ sendWhatsAppWithFallback: vi.fn(async () => undefined) }))

beforeEach(() => {
  state.tables = {}
  state.calls = []
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
  process.env.ADMIN_PHONE = '+2348000000000'
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    status: true,
    data: [{ currency: 'NGN', balance: 45_000 }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
})

describe('wallet reconciliation cron', () => {
  it('records a healthy run without discrepancies', async () => {
    state.tables.wallet_balances = [{ total_balance: 20_000 }]
    state.tables.customer_wallets = [{ balance_kobo: 10_000 }]
    state.tables.reward_credits = [{ remaining_kobo: 0, status: 'ACTIVE' }]

    const response = await POST(new Request('http://localhost/api/cron/wallet-reconciliation', {
      headers: { authorization: 'cron-secret' },
    }) as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('OK')
    expect(state.tables.reconciliation_runs).toHaveLength(1)
    expect((state.tables.reconciliation_runs[0] as Row).status).toBe('COMPLETED')
    expect(state.tables.reconciliation_discrepancies ?? []).toHaveLength(0)
  })

  it('records a shortfall run and freezes withdrawals', async () => {
    state.tables.wallet_balances = [{ total_balance: 30_000 }]
    state.tables.customer_wallets = [{ balance_kobo: 20_000 }]
    state.tables.reward_credits = [{ remaining_kobo: 0, status: 'ACTIVE' }]
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: [{ currency: 'NGN', balance: 20_000 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    const response = await POST(new Request('http://localhost/api/cron/wallet-reconciliation', {
      headers: { authorization: 'cron-secret' },
    }) as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('SHORTFALL')
    expect((state.tables.settings?.[0] as Row).value).toBe(true)
    expect(state.tables.reconciliation_runs).toHaveLength(1)
    expect((state.tables.reconciliation_runs[0] as Row).status).toBe('SHORTFALL')
    expect(state.tables.reconciliation_discrepancies).toHaveLength(1)
    expect((state.tables.reconciliation_discrepancies[0] as Row).severity).toBe('critical')
  })
})
