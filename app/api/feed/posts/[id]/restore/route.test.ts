import { describe, expect, it, beforeEach, vi } from 'vitest'
import { POST } from './route'

const restoreVideo = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: 'Restored', active_count: 1, limit_count: 60 })))

const state = {
  post: { id: 'post-1', author_profile_id: 'profile-1', deleted_at: null },
  profile: { id: 'profile-1' },
  vendor: { id: 'vendor-1', suspended_until: null as string | null },
}

function makeTable(table: string) {
  return {
    select() { return this },
    eq(column: string, value: string) {
      if (table === 'posts' && column === 'id' && value === state.post.id) return this
      if (table === 'social_profiles' && column === 'vendor_id') return this
      if (table === 'vendors' && column === 'id') return this
      return this
    },
    maybeSingle: async () => {
      if (table === 'posts') return { data: state.post }
      if (table === 'social_profiles') return { data: state.profile }
      if (table === 'vendors') return { data: state.vendor }
      return { data: null }
    },
  }
}

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => ({ role: 'vendor', userId: 'vendor-1', phone: '+2348000000000' })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      return makeTable(table)
    },
  })),
}))

vi.mock('@/lib/feed/lifecycle', () => ({
  restoreVideo,
}))

describe('feed restore route', () => {
  beforeEach(() => {
    restoreVideo.mockClear()
    state.post = { id: 'post-1', author_profile_id: 'profile-1', deleted_at: null }
    state.profile = { id: 'profile-1' }
    state.vendor = { id: 'vendor-1', suspended_until: null }
  })

  it('blocks suspended vendors from restoring videos', async () => {
    state.vendor = { id: 'vendor-1', suspended_until: new Date(Date.now() + 60_000).toISOString() }
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as never, { params: Promise.resolve({ id: 'post-1' }) })
    expect(res.status).toBe(403)
    expect(restoreVideo).not.toHaveBeenCalled()
  })

  it('rejects cross-vendor restore attempts', async () => {
    state.post = { id: 'post-1', author_profile_id: 'profile-2', deleted_at: null }
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as never, { params: Promise.resolve({ id: 'post-1' }) })
    expect(res.status).toBe(404)
    expect(restoreVideo).not.toHaveBeenCalled()
  })
})
