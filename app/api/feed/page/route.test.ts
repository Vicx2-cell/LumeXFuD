import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const loadFeedV2Surface = vi.hoisted(() => vi.fn(async () => ({ posts: [{ id: 'post-1' }], stories: [], rightRail: { topics: [], vendors: [], collections: [] }, hasMore: true, nextOffset: 24 })))

vi.mock('@/lib/feed/v2', () => ({ loadFeedV2Surface }))

import { GET } from './route'

describe('paginated feed route', () => {
  beforeEach(() => loadFeedV2Surface.mockClear())

  it('loads a bounded page with a validated tab and offset', async () => {
    const response = await GET(new NextRequest('http://localhost/api/feed/page?tab=nearby&offset=12'))
    expect(response.status).toBe(200)
    expect(loadFeedV2Surface).toHaveBeenCalledWith({ tab: 'nearby', offset: 12, limit: 12 })
    await expect(response.json()).resolves.toMatchObject({ posts: [{ id: 'post-1' }], hasMore: true, nextOffset: 24 })
  })

  it('rejects invalid tabs and offsets without querying the feed', async () => {
    const tabResponse = await GET(new NextRequest('http://localhost/api/feed/page?tab=made-up'))
    const offsetResponse = await GET(new NextRequest('http://localhost/api/feed/page?offset=-1'))
    expect(tabResponse.status).toBe(400)
    expect(offsetResponse.status).toBe(400)
    expect(loadFeedV2Surface).not.toHaveBeenCalled()
  })
})
