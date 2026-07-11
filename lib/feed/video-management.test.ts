import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanupVideoMedia, getVideoArchiveSuggestions } from './lifecycle'

const storageRemove = vi.fn(async () => ({}))
const updateCalls: Array<{ table: string; data: Record<string, unknown>; filters: Record<string, unknown> }> = []

function makeThenable(data: unknown) {
  const query = {
    select() { return query },
    eq() { return query },
    in() { return query },
    is() { return query },
    lt() { return query },
    order() { return query },
    limit() { return query },
    maybeSingle: async () => ({ data }),
    then(resolve: (value: { data: unknown }) => unknown) { return Promise.resolve(resolve({ data })) },
    catch() { return Promise.resolve({ data }) },
  }
  return query
}

const posts = [{
  id: 'post-1',
  view_count: 0,
  order_count: 0,
  post_menu_items: [{ is_available_snapshot: false }],
  post_promotions: [{ status: 'expired', ends_at: '2025-01-01T00:00:00.000Z' }],
}]

const mediaRows = [{
  id: 'media-1',
  post_id: 'post-1',
  storage_path: 'profile-1/upload-1.mp4',
  public_url: 'https://example.com/upload-1.mp4',
  provider_type: 'native',
  external_provider_ref: null,
  cleanup_state: 'pending',
  cleanup_attempts: 1,
  storage_bytes: 1024,
  created_at: '2025-01-01T00:00:00.000Z',
  post: { id: 'post-1', deleted_at: '2025-01-02T00:00:00.000Z', is_archived: true, status: 'deleted', author_profile_id: 'profile-1', archived_at: '2025-01-02T00:00:00.000Z', published_at: '2025-01-01T00:00:00.000Z' },
}]

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => null),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: vi.fn(() => ({
    from(table: string) {
      if (table === 'posts') return makeThenable(posts)
      if (table === 'post_media') {
        return {
          select() { return makeThenable(mediaRows) },
          update(data: Record<string, unknown>) {
            return {
              eq(column: string, value: string) {
                updateCalls.push({ table, data, filters: { [column]: value } })
                return makeThenable([])
              },
            }
          },
        }
      }
      return makeThenable([])
    },
    storage: {
      from() {
        return { remove: storageRemove }
      },
    },
  })),
}))

describe('feed video lifecycle helpers', () => {
  beforeEach(() => {
    storageRemove.mockClear()
    updateCalls.length = 0
  })

  it('suggests stale videos using evidence from engagement and menu availability', async () => {
    const suggestions = await getVideoArchiveSuggestions('profile-1', 45)

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.reason).toContain('views')
    expect(suggestions[0]?.evidence).toMatchObject({ view_count: 0, order_count: 0 })
    expect(suggestions[0]?.expectedQuotaRecovered).toBe(1)
  })

  it('reports cleanup candidates in dry-run mode without deleting media', async () => {
    const result = await cleanupVideoMedia(true)

    expect(result.dryRun).toBe(true)
    expect(result.candidateCount).toBe(1)
    expect(result.deletedCount).toBe(0)
    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('marks cleanup progress and removes storage references when not a dry-run', async () => {
    const result = await cleanupVideoMedia(false)

    expect(result.dryRun).toBe(false)
    expect(result.deletedCount).toBe(1)
    expect(storageRemove).toHaveBeenCalledWith(['profile-1/upload-1.mp4'])
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]?.data).toMatchObject({ cleanup_state: 'done', cleanup_error: null })
  })
})
