import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toggleFollow } from './interactions'

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  profile: { id: 'profile-1', profile_kind: 'customer', handle: 'customer-1', display_name: 'Customer One', campus_id: null, zone_id: null },
}))

class Query {
  private filters: Array<(row: Row) => boolean> = []
  private selected: string | null = null
  private headCount = false

  constructor(private table: string, private mode: 'select' | 'insert' | 'delete' = 'select') {}

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }) {
    this.selected = columns
    this.headCount = Boolean(options?.head)
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  maybeSingle() {
    const rows = this.rows()
    return Promise.resolve({ data: rows[0] ? this.project(rows[0]!, this.selected ?? '*') : null, error: null })
  }

  insert(values: Row | Row[]) {
    const rows = Array.isArray(values) ? values : [values]
    const table = state.tables.get(this.table) ?? []
    if (this.table === 'follows') {
      for (const row of rows) {
        if (table.some((existing) => existing.follower_profile_id === row.follower_profile_id && existing.followed_profile_id === row.followed_profile_id)) {
          return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } })
        }
      }
    }
    table.push(...rows.map((row) => ({ ...row })))
    state.tables.set(this.table, table)
    return Promise.resolve({ data: rows, error: null })
  }

  delete() {
    this.mode = 'delete'
    return this
  }

  then(onFulfilled: (value: { data: Row[] | null; error: null }) => unknown) {
    const rows = this.rows().map((row) => this.project(row, this.selected ?? '*'))
    return Promise.resolve({
      data: rows,
      count: this.headCount ? rows.length : null,
      error: null,
    }).then(onFulfilled)
  }

  private rows() {
    const table = state.tables.get(this.table) ?? []
    const rows = table.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.mode === 'delete') {
      state.tables.set(this.table, table.filter((row) => !this.filters.every((filter) => filter(row))))
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

vi.mock('@/lib/supabase/server', () => ({ createSupabaseAdmin: () => db }))
vi.mock('@/lib/feed/service', () => ({ ensureSocialProfileForSession: vi.fn(async () => state.profile) }))

beforeEach(() => {
  state.tables = new Map<string, Row[]>([
    ['social_profiles', [
      { id: 'profile-2', deleted_at: null },
      { id: 'profile-3', deleted_at: null },
    ]],
    ['follows', []],
    ['blocks', []],
    ['mutes', []],
  ])
  state.profile = { id: 'profile-1', profile_kind: 'customer', handle: 'customer-1', display_name: 'Customer One', campus_id: null, zone_id: null }
})

describe('feed interactions', () => {
  it('allows following and unfollowing with server-counted totals', async () => {
    const first = await toggleFollow('profile-2', true)
    expect(first.followed).toBe(true)
    expect(first.followCount).toBe(1)

    const second = await toggleFollow('profile-2', false)
    expect(second.followed).toBe(false)
    expect(second.followCount).toBe(0)
  })

  it('rejects duplicate follows by unique constraint and keeps one row', async () => {
    await toggleFollow('profile-2', true)
    await expect(toggleFollow('profile-2', true)).resolves.toMatchObject({ followed: true, followCount: 1 })
    expect((state.tables.get('follows') ?? []).length).toBe(1)
  })

  it('rejects follows when either side has blocked the other', async () => {
    state.tables.set('blocks', [
      { blocker_profile_id: 'profile-2', blocked_profile_id: 'profile-1' },
    ])

    await expect(toggleFollow('profile-2', true)).rejects.toThrow('You cannot follow a blocked profile')
  })

  it('rejects follow self-targeting', async () => {
    await expect(toggleFollow('profile-1', true)).rejects.toThrow('You cannot follow yourself')
  })
})
