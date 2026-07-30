import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processWebhookAsync, verifyAndRecordDirectOrderPayment } from './webhook'

type Filter = { kind: 'eq' | 'neq' | 'in'; field: string; value: unknown }
type Query = {
  table: string
  op: 'select' | 'update' | 'insert' | 'delete'
  terminal: 'single' | 'maybeSingle' | null
  payload?: Record<string, unknown>
  filters: Filter[]
}

const state = vi.hoisted(() => ({
  verify: vi.fn(),
  calls: [] as Array<{ table: string; op: string; payload?: Record<string, unknown>; filters: Filter[] }>,
  ledgerCalls: [] as Array<Record<string, unknown>>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}))

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const actual = row[filter.field]
    if (filter.kind === 'eq') return actual === filter.value
    if (filter.kind === 'neq') return actual !== filter.value
    if (!Array.isArray(filter.value)) return false
    return filter.value.includes(actual)
  })
}

function applyUpdate(row: Record<string, unknown>, payload?: Record<string, unknown>): Record<string, unknown> {
  return { ...row, ...(payload ?? {}) }
}

function execute(query: Query): { data: unknown; error: null } {
  const rows = (state.tables[query.table] ?? (state.tables[query.table] = [])) as Array<Record<string, unknown>>
  state.calls.push({ table: query.table, op: query.op, payload: query.payload ? clone(query.payload) : undefined, filters: clone(query.filters) })

  if (query.op === 'insert') {
    const inserted = applyUpdate({}, query.payload)
    rows.push(inserted)
    return { data: query.terminal ? clone(inserted) : clone(inserted), error: null }
  }

  if (query.op === 'update') {
    const updated: Array<Record<string, unknown>> = []
    for (let i = 0; i < rows.length; i += 1) {
      if (matches(rows[i], query.filters)) {
        rows[i] = applyUpdate(rows[i], query.payload)
        updated.push(rows[i])
      }
    }
    if (query.terminal === 'single' || query.terminal === 'maybeSingle') {
      return { data: updated[0] ? clone(updated[0]) : null, error: null }
    }
    return { data: clone(updated), error: null }
  }

  if (query.op === 'delete') {
    const kept = rows.filter((row) => !matches(row, query.filters))
    state.tables[query.table] = kept
    return { data: null, error: null }
  }

  const selected = rows.filter((row) => matches(row, query.filters))
  if (query.terminal === 'single' || query.terminal === 'maybeSingle') {
    return { data: selected[0] ? clone(selected[0]) : null, error: null }
  }
  return { data: clone(selected), error: null }
}

function makeDb(): any {
  function builder(table: string): any {
    const query: Query = { table, op: 'select', terminal: null, filters: [] }
    const proxy: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            const promise = Promise.resolve(execute(query))
            return promise.then.bind(promise)
          }
          if (prop === 'catch') {
            const promise = Promise.resolve(execute(query))
            return promise.catch.bind(promise)
          }
          if (prop === 'finally') {
            const promise = Promise.resolve(execute(query))
            return promise.finally.bind(promise)
          }
          if (prop === 'select') return () => proxy
          if (prop === 'update') return (payload: Record<string, unknown>) => {
            query.op = 'update'
            query.payload = payload
            return proxy
          }
          if (prop === 'insert') return (payload: Record<string, unknown>) => {
            query.op = 'insert'
            query.payload = payload
            return proxy
          }
          if (prop === 'delete') return () => {
            query.op = 'delete'
            return proxy
          }
          if (prop === 'eq') return (field: string, value: unknown) => {
            query.filters.push({ kind: 'eq', field, value })
            return proxy
          }
          if (prop === 'neq') return (field: string, value: unknown) => {
            query.filters.push({ kind: 'neq', field, value })
            return proxy
          }
          if (prop === 'in') return (field: string, value: unknown[]) => {
            query.filters.push({ kind: 'in', field, value })
            return proxy
          }
          if (prop === 'maybeSingle') return async () => {
            query.terminal = 'maybeSingle'
            return execute(query)
          }
          if (prop === 'single') return async () => {
            query.terminal = 'single'
            return execute(query)
          }
          if (prop === 'or' || prop === 'order' || prop === 'limit') return () => proxy
          return () => proxy
        },
      },
    )
    return proxy
  }

  return {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ table: 'rpc', op: name, payload: clone(args), filters: [] })
      if (name === 'ensure_financial_account') {
        return { data: `${String(args.p_account_type)}:${String(args.p_owner_type)}`, error: null }
      }
      if (name === 'post_ledger_journal') {
        state.ledgerCalls.push(clone(args))
        return { data: [{ journal_id: 'journal-1', replayed: state.ledgerCalls.length > 1, journal_status: 'POSTED' }], error: null }
      }
      return { data: null, error: null }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => makeDb() as any,
}))
vi.mock('./init', () => ({
  paystackEnvironmentFromSecret: vi.fn(() => 'test'),
  verifyPaystackTransaction: state.verify,
}))
vi.mock('./billing', () => ({ processPremiumOrBoostWebhook: vi.fn(async () => undefined) }))
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

beforeEach(() => {
  state.verify.mockReset()
  state.verify.mockResolvedValue({
    status: 'success',
    amount: 8000,
    reference: 'LXF-TEST-1',
    currency: 'NGN',
    metadata: {},
  })
  state.calls = []
  state.ledgerCalls = []
  state.tables = {}
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
})

describe('direct Paystack checkout finalization', () => {
  it('rejects browser amount tampering and quarantines the intent', async () => {
    state.tables.orders = [{
      id: 'order-1',
      order_number: 'LXF-1',
      vendor_id: 'vendor-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      payment_status: 'PENDING',
      status: 'PENDING',
      total_amount: 8000,
      subtotal: 7000,
      wallet_amount_kobo: 0,
      payment_method: 'PAYSTACK',
      scheduled_for: null,
      scheduled_release_at: null,
      paystack_reference: 'LXF-TEST-1',
    }]
    state.tables.order_payment_intents = [{
      id: 'intent-1',
      order_id: 'order-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      currency: 'NGN',
      environment: 'test',
      amount_kobo: 8000,
      expected_vendor_allocation_kobo: 7000,
      expected_rider_allocation_kobo: 0,
      expected_platform_allocation_kobo: 1000,
      status: 'CREATED',
      idempotency_key: 'paystack-intent:1',
      internal_reference: 'PINT-order-1',
      paystack_reference: 'LXF-TEST-1',
      paystack_authorization_url: null,
      paystack_access_code: null,
      paystack_transaction_id: null,
      callback_seen_at: null,
      initialized_at: null,
      verified_at: null,
      finalized_at: null,
      quarantined_at: null,
      quarantine_reason: null,
      provider_amount_kobo: null,
      provider_currency: null,
      provider_environment: null,
      provider_payload: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]
    state.verify.mockResolvedValueOnce({
      status: 'success',
      amount: 7900,
      reference: 'LXF-TEST-1',
      currency: 'NGN',
      metadata: {},
    })

    const result = await verifyAndRecordDirectOrderPayment({
      db: makeDb(),
      reference: 'LXF-TEST-1',
      data: { id: 'txn-1', reference: 'LXF-TEST-1', amount: 7900, currency: 'NGN' },
      pending: state.tables.orders[0] as never,
    })

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('amount_mismatch')
    expect((state.tables.order_payment_intents[0] as Record<string, unknown>).status).toBe('QUARANTINED')
    expect(state.ledgerCalls).toHaveLength(0)
  })

  it('quarantines wrong currency and wrong environment attempts', async () => {
    state.tables.orders = [{
      id: 'order-1',
      order_number: 'LXF-1',
      vendor_id: 'vendor-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      payment_status: 'PENDING',
      status: 'PENDING',
      total_amount: 8000,
      subtotal: 7000,
      wallet_amount_kobo: 0,
      payment_method: 'PAYSTACK',
      scheduled_for: null,
      scheduled_release_at: null,
      paystack_reference: 'LXF-TEST-1',
    }]
    state.tables.order_payment_intents = [{
      id: 'intent-1',
      order_id: 'order-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      currency: 'NGN',
      environment: 'production',
      amount_kobo: 8000,
      expected_vendor_allocation_kobo: 7000,
      expected_rider_allocation_kobo: 0,
      expected_platform_allocation_kobo: 1000,
      status: 'CREATED',
      idempotency_key: 'paystack-intent:1',
      internal_reference: 'PINT-order-1',
      paystack_reference: 'LXF-TEST-1',
      paystack_authorization_url: null,
      paystack_access_code: null,
      paystack_transaction_id: null,
      callback_seen_at: null,
      initialized_at: null,
      verified_at: null,
      finalized_at: null,
      quarantined_at: null,
      quarantine_reason: null,
      provider_amount_kobo: null,
      provider_currency: null,
      provider_environment: null,
      provider_payload: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]
    state.verify.mockResolvedValueOnce({
      status: 'success',
      amount: 8000,
      reference: 'LXF-TEST-1',
      currency: 'USD',
      metadata: {},
    })

    const result = await verifyAndRecordDirectOrderPayment({
      db: makeDb(),
      reference: 'LXF-TEST-1',
      data: { id: 'txn-1', reference: 'LXF-TEST-1', amount: 8000, currency: 'USD' },
      pending: state.tables.orders[0] as never,
    })

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('currency_mismatch')
    expect((state.tables.order_payment_intents[0] as Record<string, unknown>).status).toBe('QUARANTINED')
  })

  it('rejects unknown and reused direct-payment references', async () => {
    state.tables.orders = [{
      id: 'order-1',
      order_number: 'LXF-1',
      vendor_id: 'vendor-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      payment_status: 'PENDING',
      status: 'PENDING',
      total_amount: 8000,
      subtotal: 7000,
      wallet_amount_kobo: 0,
      payment_method: 'PAYSTACK',
      scheduled_for: null,
      scheduled_release_at: null,
      paystack_reference: 'LXF-TEST-1',
    }]

    const unknown = await verifyAndRecordDirectOrderPayment({
      db: makeDb(),
      reference: 'LXF-UNKNOWN',
      data: { id: 'txn-1', reference: 'LXF-UNKNOWN', amount: 8000, currency: 'NGN' },
      pending: state.tables.orders[0] as never,
    })
    expect(unknown.accepted).toBe(false)
    expect(unknown.reason).toBe('unknown_reference')

    state.tables.order_payment_intents = [{
      id: 'intent-1',
      order_id: 'order-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      currency: 'NGN',
      environment: 'test',
      amount_kobo: 8000,
      expected_vendor_allocation_kobo: 7000,
      expected_rider_allocation_kobo: 0,
      expected_platform_allocation_kobo: 1000,
      status: 'FINALIZED',
      idempotency_key: 'paystack-intent:1',
      internal_reference: 'PINT-order-1',
      paystack_reference: 'LXF-TEST-1',
      paystack_authorization_url: 'https://paystack.test/txn',
      paystack_access_code: 'ac',
      paystack_transaction_id: 'txn-1',
      callback_seen_at: null,
      initialized_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      finalized_at: new Date().toISOString(),
      quarantined_at: null,
      quarantine_reason: null,
      provider_amount_kobo: 8000,
      provider_currency: 'NGN',
      provider_environment: 'test',
      provider_payload: {},
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]

    const reused = await verifyAndRecordDirectOrderPayment({
      db: makeDb(),
      reference: 'LXF-TEST-1',
      data: { id: 'txn-1', reference: 'LXF-TEST-1', amount: 8000, currency: 'NGN' },
      pending: state.tables.orders[0] as never,
    })

    expect(reused.accepted).toBe(false)
    expect(reused.duplicate).toBe(true)
    expect(reused.reason).toBe('already_finalized')
  })

  it('finalizes a valid webhook once and ignores the replayed delivery', async () => {
    state.tables.orders = [{
      id: 'order-1',
      order_number: 'LXF-1',
      vendor_id: 'vendor-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      payment_status: 'PENDING',
      status: 'PENDING',
      total_amount: 8000,
      subtotal: 7000,
      wallet_amount_kobo: 0,
      payment_method: 'PAYSTACK',
      scheduled_for: null,
      scheduled_release_at: null,
      paystack_reference: 'LXF-TEST-1',
    }]
    state.tables.order_payment_intents = [{
      id: 'intent-1',
      order_id: 'order-1',
      customer_id: 'customer-1',
      guest_phone: null,
      guest_name: null,
      currency: 'NGN',
      environment: 'test',
      amount_kobo: 8000,
      expected_vendor_allocation_kobo: 7000,
      expected_rider_allocation_kobo: 0,
      expected_platform_allocation_kobo: 1000,
      status: 'CREATED',
      idempotency_key: 'paystack-intent:1',
      internal_reference: 'PINT-order-1',
      paystack_reference: 'LXF-TEST-1',
      paystack_authorization_url: 'https://paystack.test/txn',
      paystack_access_code: 'ac',
      paystack_transaction_id: 'txn-1',
      callback_seen_at: null,
      initialized_at: new Date().toISOString(),
      verified_at: null,
      finalized_at: null,
      quarantined_at: null,
      quarantine_reason: null,
      provider_amount_kobo: null,
      provider_currency: null,
      provider_environment: null,
      provider_payload: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]

    await processWebhookAsync({
      event: 'charge.success',
      data: {
        id: 'txn-1',
        reference: 'LXF-TEST-1',
        amount: 8000,
        currency: 'NGN',
        metadata: {},
      },
    })

    expect(state.ledgerCalls).toHaveLength(1)
    expect((state.tables.orders[0] as Record<string, unknown>).payment_status).toBe('PAID')
    expect((state.tables.order_payment_intents[0] as Record<string, unknown>).status).toBe('FINALIZED')

    await processWebhookAsync({
      event: 'charge.success',
      data: {
        id: 'txn-1',
        reference: 'LXF-TEST-1',
        amount: 8000,
        currency: 'NGN',
        metadata: {},
      },
    })

    expect(state.ledgerCalls).toHaveLength(1)
  })
})
