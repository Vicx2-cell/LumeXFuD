import { describe, expect, it } from 'vitest'
import { archiveOfficialPostsForSource, ensureOfficialAccount } from './official-service'
import { buildOfficialCollectionPlan, formatOfficialMoney, selectFairOfficialItems, type OfficialAreaConfig, type OfficialSourceItem } from './official'

function makeArea(overrides: Partial<OfficialAreaConfig> = {}): OfficialAreaConfig {
  return {
    id: 'area-1',
    areaScope: 'city',
    areaId: 'city-1',
    areaLabel: 'Uturu',
    morningEnabled: true,
    eveningEnabled: true,
    autoPublish: false,
    lateNightStart: '22:00',
    minPopularityOrders: 10,
    priceThresholdKobo: 300000,
    maxPostsPerDay: 2,
    maxCollectionItems: 5,
    picksMaxPerDay: 2,
    ...overrides,
  }
}

function sourceItem(overrides: Partial<OfficialSourceItem> = {}): OfficialSourceItem {
  return {
    id: 'item-1',
    vendorId: 'vendor-1',
    vendorName: 'Vendor One',
    itemName: 'Shawarma',
    priceKobo: 250000,
    imageUrl: 'https://example.com/item.jpg',
    imageBelongsToItem: true,
    isAvailable: true,
    vendorApproved: true,
    vendorActive: true,
    vendorVisible: true,
    servesArea: true,
    areaScope: 'city',
    areaId: 'city-1',
    popularityOrders30d: 12,
    totalRatings: 14,
    avgRating: 4.6,
    sourceType: 'menu_item',
    sourceId: 'item-1',
    ...overrides,
  }
}

function makeDb(initial: Record<string, Record<string, unknown>[]> = {}) {
  const state = new Map<string, Record<string, unknown>[]>(Object.entries(initial))

  function matches(row: Record<string, unknown>, filters: Array<(row: Record<string, unknown>) => boolean>) {
    return filters.every((filter) => filter(row))
  }

  class Query {
    private filters: Array<(row: Record<string, unknown>) => boolean> = []
    private mode: 'select' | 'update' = 'select'
    private updateValues: Record<string, unknown> | null = null
    private selectColumns = '*'

    constructor(private readonly table: string) {}

    eq(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value)
      return this
    }

    is(column: string, value: unknown) {
      this.filters.push((row) => row[column] === value)
      return this
    }

    order() { return this }
    limit() { return this }

    select(columns = '*') {
      this.selectColumns = columns
      return this
    }

    maybeSingle() {
      const rows = this.rows()
      return Promise.resolve({ data: rows[0] ?? null, error: null })
    }

    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: this.rows(), error: null }).then(onFulfilled, onRejected)
    }

    catch(onRejected: (reason: unknown) => unknown) {
      return Promise.resolve({ data: this.rows(), error: null }).catch(onRejected)
    }

    finally(onFinally: () => void) {
      return Promise.resolve({ data: this.rows(), error: null }).finally(onFinally)
    }

    single() {
      const rows = this.rows()
      return Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } })
    }

    insert(values: Record<string, unknown> | Record<string, unknown>[]) {
      const rows = Array.isArray(values) ? values : [values]
      const current = state.get(this.table) ?? []
      current.push(...rows.map((row) => ({ ...row })))
      state.set(this.table, current)
      return {
        select: (columns = '*') => ({
          single: () => Promise.resolve({
            data: this.project(rows[0] ?? {}, columns),
            error: null,
          }),
          maybeSingle: () => Promise.resolve({
            data: rows[0] ? this.project(rows[0], columns) : null,
            error: null,
          }),
        }),
      }
    }

    update(values: Record<string, unknown>) {
      this.mode = 'update'
      this.updateValues = values
      return this
    }

    private rows() {
      const current = state.get(this.table) ?? []
      const rows = current.filter((row) => matches(row, this.filters))
      if (this.mode === 'update' && this.updateValues) {
        for (const row of rows) Object.assign(row, this.updateValues)
      }
      return rows.map((row) => this.project(row))
    }

    private project(row: Record<string, unknown>, columns = this.selectColumns) {
      if (columns === '*' || columns.trim() === '') return { ...row }
      const keys = columns.split(',').map((value) => value.trim()).filter(Boolean)
      return Object.fromEntries(keys.map((key) => [key, row[key]]))
    }
  }

  return {
    state,
    from(table: string) {
      return new Query(table)
    },
  }
}

describe('official feed', () => {
  it('formats 380000 kobo as ₦3,800', () => {
    expect(formatOfficialMoney(380000)).toBe('\u20A63,800')
  })

  it('protects the official account and keeps its gold badge canonical', async () => {
    const db = makeDb({ social_profiles: [] })
    const first = await ensureOfficialAccount(db as never)
    expect(first.display_name).toBe('LumeX Fud')
    expect(first.avatar_url).toBe('/icons/icon-512-v2.png')
    expect(first.is_system_account).toBe(true)
    expect(first.system_account_key).toBe('lumex_fud')

    const rows = db.state.get('social_profiles') ?? []
    rows[0]!.display_name = 'Renamed'
    rows[0]!.handle = 'impersonator'
    const second = await ensureOfficialAccount(db as never)
    expect(second.display_name).toBe('LumeX Fud')
    expect((db.state.get('social_profiles') ?? []).length).toBe(1)
  })

  it('filters unavailable items, expired deals, and vendor domination', () => {
    const rules = {
      minItems: 3,
      maxItems: 5,
      maxPerVendor: 2,
      priceThresholdKobo: 300000,
      minPopularityOrders: 10,
      lateNightStart: '22:00',
      now: new Date('2026-07-12T12:00:00.000Z'),
    }
    const selected = selectFairOfficialItems(
      [
        sourceItem({ id: 'a', vendorId: 'v1', sourceId: 'a' }),
        sourceItem({ id: 'b', vendorId: 'v1', sourceId: 'b' }),
        sourceItem({ id: 'c', vendorId: 'v1', sourceId: 'c' }),
        sourceItem({ id: 'd', vendorId: 'v2', sourceId: 'd', isAvailable: false }),
        sourceItem({ id: 'e', vendorId: 'v3', sourceId: 'e', sourceType: 'deal', dealActive: true, dealEndsAt: '2020-01-01T00:00:00.000Z' }),
      ],
      rules,
      [],
    )

    expect(selected.items.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('uses neutral titles when popularity thresholds are not met', () => {
    const plan = buildOfficialCollectionPlan({
      collectionType: 'lumex_picks',
      area: makeArea(),
      source: [
        sourceItem({ id: 'a', sourceId: 'a', vendorId: 'v1', popularityOrders30d: 1, totalRatings: 1, avgRating: 3.2 }),
        sourceItem({ id: 'b', sourceId: 'b', vendorId: 'v2', popularityOrders30d: 1, totalRatings: 1, avgRating: 3.2 }),
        sourceItem({ id: 'c', sourceId: 'c', vendorId: 'v3', popularityOrders30d: 1, totalRatings: 1, avgRating: 3.2 }),
      ],
      generationReason: 'test',
      now: new Date('2026-07-12T10:00:00.000Z'),
    })

    expect(plan?.title).toBe('LumeX Picks')
  })

  it('supports compact topic collections like breakfast picks', () => {
    const plan = buildOfficialCollectionPlan({
      collectionType: 'breakfast_picks',
      area: makeArea(),
      source: [
        sourceItem({ id: 'a', sourceId: 'a', vendorId: 'v1', itemName: 'Egg bread', category: 'Breakfast' }),
        sourceItem({ id: 'b', sourceId: 'b', vendorId: 'v2', itemName: 'Tea and bread', category: 'Breakfast' }),
        sourceItem({ id: 'c', sourceId: 'c', vendorId: 'v3', itemName: 'Porridge', category: 'Breakfast' }),
      ],
      generationReason: 'test',
      now: new Date('2026-07-12T07:00:00.000Z'),
    })

    expect(plan?.title).toBe('Breakfast Picks')
    expect(plan?.items.length).toBeGreaterThan(0)
  })

  it('allows a popularity-backed claim when thresholds are met', () => {
    const plan = buildOfficialCollectionPlan({
      collectionType: 'lumex_picks',
      area: makeArea(),
      source: [
        sourceItem({ id: 'a', sourceId: 'a', vendorId: 'v1', itemName: 'Shawarma', popularityOrders30d: 15, totalRatings: 14, avgRating: 4.6 }),
        sourceItem({ id: 'b', sourceId: 'b', vendorId: 'v2', itemName: 'Rice', popularityOrders30d: 13, totalRatings: 12, avgRating: 4.4 }),
        sourceItem({ id: 'c', sourceId: 'c', vendorId: 'v3', itemName: 'Pizza', popularityOrders30d: 11, totalRatings: 10, avgRating: 4.3 }),
      ],
      generationReason: 'test',
      now: new Date('2026-07-12T10:00:00.000Z'),
    })

    expect(plan?.title).toContain('Best')
    expect(plan?.title).toContain('Shawarma')
  })

  it('respects the late-night gate', () => {
    const before = buildOfficialCollectionPlan({
      collectionType: 'evening_collection',
      area: makeArea({ lateNightStart: '22:00' }),
      source: [sourceItem({ id: 'a', sourceId: 'a', vendorId: 'v1' }), sourceItem({ id: 'b', sourceId: 'b', vendorId: 'v2' }), sourceItem({ id: 'c', sourceId: 'c', vendorId: 'v3' })],
      generationReason: 'night',
      now: new Date('2026-07-12T20:00:00.000Z'),
    })
    const after = buildOfficialCollectionPlan({
      collectionType: 'evening_collection',
      area: makeArea({ lateNightStart: '22:00' }),
      source: [sourceItem({ id: 'a', sourceId: 'a', vendorId: 'v1' }), sourceItem({ id: 'b', sourceId: 'b', vendorId: 'v2' }), sourceItem({ id: 'c', sourceId: 'c', vendorId: 'v3' })],
      generationReason: 'night',
      now: new Date('2026-07-12T23:30:00.000Z'),
    })

    expect(before).toBeNull()
    expect(after?.items.length).toBeGreaterThan(0)
  })

  it('keeps idempotent dedupe keys stable for the same input', () => {
    const base = {
      collectionType: 'morning_collection' as const,
      area: makeArea(),
      source: [sourceItem()],
      generationReason: 'morning',
      now: new Date('2026-07-12T07:00:00.000Z'),
    }
    const one = buildOfficialCollectionPlan(base)
    const two = buildOfficialCollectionPlan(base)
    expect(one?.dedupeKey).toBe(two?.dedupeKey)
    expect(one?.contentHash).toBe(two?.contentHash)
  })

  it('archives generated posts when the source disappears', async () => {
    const db = makeDb({
      official_feed_posts: [
        { post_id: 'post-1', source_type: 'menu_item', source_id: 'item-1', archived_at: null },
      ],
      posts: [
        { id: 'post-1', status: 'published', is_archived: false },
      ],
    })

    const archived = await archiveOfficialPostsForSource(db as never, 'menu_item', 'item-1', 'source deleted')
    expect(archived).toHaveLength(1)
    expect((db.state.get('posts') ?? [])[0]).toMatchObject({ status: 'archived', is_archived: true })
    expect((db.state.get('official_feed_posts') ?? [])[0]).toMatchObject({ archived_reason: 'source deleted' })
  })
})
