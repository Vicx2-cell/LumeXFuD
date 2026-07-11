import { beforeEach, describe, expect, it, vi } from 'vitest'
import { feedEventBatchInput } from './validators'

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
}))

class Query {
  private filters: Array<(row: Row) => boolean> = []
  private selected: string | null = null
  private updateValues: Row | null = null

  constructor(private table: string, private mode: 'select' | 'insert' | 'update' = 'select') {}

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value)
    return this
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  gte(column: string, value: string) {
    this.filters.push((row) => String(row[column] ?? '') >= value)
    return this
  }

  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column] ?? '') <= value)
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  select(columns = '*') {
    if (this.mode === 'update') {
      const rows = this.executeRows()
      return Promise.resolve({ data: rows.map((row) => this.project(row, columns)), error: null })
    }
    this.selected = columns
    return this
  }

  maybeSingle() {
    const rows = this.executeRows()
    return Promise.resolve({ data: rows.length > 0 ? this.project(rows[0]!, this.selected ?? '*') : null, error: null })
  }

  single() {
    const rows = this.executeRows()
    return Promise.resolve({ data: rows[0] ? this.project(rows[0], this.selected ?? '*') : null, error: rows[0] ? null : { message: 'not found' } })
  }

  insert(values: Row | Row[]) {
    const rows = Array.isArray(values) ? values : [values]
    const table = state.tables.get(this.table) ?? []
    if (this.table === 'feed_event_batches') {
      const duplicate = rows.some((row) => table.some((existing) => existing.batch_key === row.batch_key))
      if (duplicate) return Promise.resolve({ data: null, error: { message: 'duplicate key', code: '23505' } })
    }
    table.push(...rows.map((row) => ({ ...row })))
    state.tables.set(this.table, table)
    return Promise.resolve({ data: rows, error: null })
  }

  update(values: Row) {
    this.mode = 'update'
    this.updateValues = values
    return this
  }

  private executeRows() {
    const table = state.tables.get(this.table) ?? []
    const rows = table.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.mode === 'update') {
      for (const row of rows) Object.assign(row, this.updateValues ?? {})
    }
    return rows
  }

  private project(row: Row, columns: string) {
    if (columns === '*' || columns.trim() === '') return { ...row }
    const keys = columns.split(',').map((value) => value.trim())
    return Object.fromEntries(keys.map((key) => [key, row[key]]))
  }
}

const db = {
  from(table: string) {
    return new Query(table)
  },
}

const h = vi.hoisted(() => ({
  profile: { id: 'profile-1' },
  rateLimit: { success: true, remaining: 99, reset: 0 },
}))

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => db }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGeneric: vi.fn(async () => h.rateLimit) }))
vi.mock('@/lib/feed/service', () => ({ ensureSocialProfileForSession: vi.fn(async () => h.profile) }))

import { recordFeedEventBatch } from '@/lib/feed/events'
import { reverseOrderFeedAttribution, selectAttributionCandidates } from '@/lib/feed/attribution'

beforeEach(() => {
  state.tables = new Map<string, Row[]>([
    ['feed_event_batches', []],
    ['feed_events', []],
    ['feed_impressions', []],
    ['feed_order_attributions', []],
    ['orders', []],
    ['social_profiles', []],
  ])
  h.profile = { id: 'profile-1' }
  h.rateLimit = { success: true, remaining: 99, reset: 0 }
})

describe('feed event batching', () => {
  it('deduplicates a replayed batch and keeps one impression row', async () => {
    const batch = {
      batch_key: 'batch-0001',
      source_tab: 'for_you' as const,
      events: [
        {
          event_key: 'evt-0001',
          post_id: '11111111-1111-4111-8111-111111111111',
          event_type: 'impression',
          source_tab: 'for_you' as const,
          metadata: { session_id: 'session-1' },
        },
      ],
    }

    const parsed = feedEventBatchInput.safeParse(batch)
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.flatten(), null, 2)).toBe(true)

    const first = await recordFeedEventBatch(batch, 'session-1')
    const second = await recordFeedEventBatch(batch, 'session-1')

    expect(first.inserted).toBe(1)
    expect(second.deduped).toBe(1)
    expect((state.tables.get('feed_events') ?? []).length).toBe(1)
    expect((state.tables.get('feed_impressions') ?? []).length).toBe(1)
  })
})

describe('feed attribution selection', () => {
  it('selects multiple posts, skips self-orders, and ignores expired events', () => {
    const candidates = selectAttributionCandidates({
      orderId: 'order-1',
      orderVendorId: 'vendor-1',
      customerProfileId: 'customer-profile',
      completedAt: '2026-07-10T12:00:00.000Z',
      totalAmountKobo: 12000,
      windowMinutes: 240,
      minimumConfidence: 0.2,
      maxSources: 3,
      posts: [
        { id: 'post-1', vendor_id: 'vendor-1', author_profile_id: 'creator-1', status: 'published', deleted_at: null, is_archived: false },
        { id: 'post-2', vendor_id: 'vendor-1', author_profile_id: 'creator-2', status: 'published', deleted_at: null, is_archived: false },
        { id: 'post-3', vendor_id: 'vendor-1', author_profile_id: 'customer-profile', status: 'published', deleted_at: null, is_archived: false },
      ],
      events: [
        { id: 'event-1', post_id: 'post-1', viewer_profile_id: 'customer-profile', event_type: 'add_to_cart', source_tab: 'for_you', created_at: '2026-07-10T11:30:00.000Z' },
        { id: 'event-2', post_id: 'post-2', viewer_profile_id: 'customer-profile', event_type: 'menu_click', source_tab: 'for_you', created_at: '2026-07-10T10:45:00.000Z' },
        { id: 'event-3', post_id: 'post-3', viewer_profile_id: 'customer-profile', event_type: 'checkout_start', source_tab: 'for_you', created_at: '2026-07-10T11:50:00.000Z' },
        { id: 'event-4', post_id: 'post-2', viewer_profile_id: 'customer-profile', event_type: 'share', source_tab: 'for_you', created_at: '2026-07-10T07:00:00.000Z' },
      ],
    })

    expect(candidates.map((candidate) => candidate.postId)).toEqual(['post-1', 'post-2'])
    expect(candidates[0]?.confidence ?? 0).toBeGreaterThan(candidates[1]?.confidence ?? 0)
  })

  it('drops self-attribution and expired windows', () => {
    const candidates = selectAttributionCandidates({
      orderId: 'order-2',
      orderVendorId: 'vendor-1',
      customerProfileId: 'creator-1',
      completedAt: '2026-07-10T12:00:00.000Z',
      totalAmountKobo: 5000,
      windowMinutes: 60,
      minimumConfidence: 0.2,
      maxSources: 3,
      posts: [
        { id: 'post-1', vendor_id: 'vendor-1', author_profile_id: 'creator-1', status: 'published', deleted_at: null, is_archived: false },
      ],
      events: [
        { id: 'event-1', post_id: 'post-1', viewer_profile_id: 'creator-1', event_type: 'checkout_start', source_tab: 'for_you', created_at: '2026-07-10T11:30:00.000Z' },
        { id: 'event-2', post_id: 'post-1', viewer_profile_id: 'creator-1', event_type: 'add_to_cart', source_tab: 'for_you', created_at: '2026-07-10T09:00:00.000Z' },
      ],
    })

    expect(candidates).toEqual([])
  })
})

describe('feed attribution reversal', () => {
  it('marks attributed rows reversed for refunded orders', async () => {
    state.tables.set('orders', [
      { id: 'order-1', vendor_id: 'vendor-1', customer_id: 'customer-1', completed_at: '2026-07-10T12:00:00.000Z' },
    ])
    state.tables.set('social_profiles', [
      { id: 'profile-1', customer_id: 'customer-1' },
    ])
    state.tables.set('feed_order_attributions', [
      { id: 'attr-1', order_id: 'order-1', status: 'credited' },
    ])

    const result = await reverseOrderFeedAttribution('order-1', 'refunded_order', 'payment reversed')

    expect(result.reversed).toBe(1)
    expect((state.tables.get('feed_order_attributions') ?? [])[0]).toMatchObject({
      status: 'reversed',
      reversal_reason: 'payment reversed',
    })
  })
})
