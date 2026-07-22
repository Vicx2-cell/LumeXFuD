import { describe, expect, it } from 'vitest'
import { rankFeedCandidates } from './ranking'
import type { FeedCandidate } from './types'

describe('feed ranking', () => {
  it('prefers nearby, fresh, high-conversion posts over stale ones', () => {
    const result = rankFeedCandidates(
      [
        {
          id: 'stale',
          authorProfileId: 'a',
          vendorId: 'v1',
          zoneId: 'z1',
          campusId: 'c1',
          postKind: 'TEXT',
          status: 'published',
          visibility: 'public',
          publishedAt: '2025-01-01T00:00:00.000Z',
          createdAt: '2025-01-01T00:00:00.000Z',
          likeCount: 1,
          orderCount: 0,
          revenueKobo: 0,
          freshnessHours: 200,
        },
        {
          id: 'fresh',
          authorProfileId: 'a',
          vendorId: 'v1',
          zoneId: 'z2',
          campusId: 'c1',
          postKind: 'MENU_ITEM',
          status: 'published',
          visibility: 'public',
          publishedAt: '2025-01-02T00:00:00.000Z',
          createdAt: '2025-01-02T00:00:00.000Z',
          likeCount: 6,
          replyCount: 2,
          menuClickCount: 12,
          addToCartCount: 8,
          orderCount: 3,
          revenueKobo: 120_000,
          freshnessHours: 1,
          watchCompletionRate: 0.8,
          qualityScore: 1,
        },
      ],
      { zoneId: 'z2', campusId: 'c1', role: 'customer' },
    )

    expect(result.items[0]?.id).toBe('fresh')
    expect(result.items[0]?.score).toBeGreaterThan(result.items[1]?.score ?? -999)
  })

  it('penalizes blocked creators heavily', () => {
    const result = rankFeedCandidates(
      [
        {
          id: 'blocked',
          authorProfileId: 'a',
          postKind: 'TEXT',
          status: 'published',
          visibility: 'public',
          publishedAt: '2025-01-02T00:00:00.000Z',
          createdAt: '2025-01-02T00:00:00.000Z',
          blockCount: 0,
        },
      ],
      { blockedAuthor: true, role: 'customer' },
    )

    expect(result.items[0]?.score).toBeLessThan(0)
  })

  it('rotates vendors without changing their explainable scores', () => {
    const makeCandidate = (id: string, vendorId: string, likes: number): FeedCandidate => ({
      id,
      vendorId,
      authorProfileId: `${vendorId}-profile`,
      postKind: 'MENU_ITEM',
      status: 'published',
      visibility: 'public',
      publishedAt: '2026-07-22T10:00:00.000Z',
      createdAt: '2026-07-22T10:00:00.000Z',
      likeCount: likes,
      viewCount: 10,
      freshnessHours: 1,
    })
    const result = rankFeedCandidates([
      makeCandidate('a1', 'vendor-a', 10),
      makeCandidate('a2', 'vendor-a', 9),
      makeCandidate('a3', 'vendor-a', 8),
      makeCandidate('b1', 'vendor-b', 1),
    ], { role: 'customer' })

    expect(result.items.map((item) => item.id)).toEqual(['a1', 'a2', 'b1', 'a3'])
    expect(result.items.every((item) => item.explanation && Number.isFinite(item.score))).toBe(true)
  })

  it('suppresses duplicate candidate ids', () => {
    const candidate: FeedCandidate = {
      id: 'same', authorProfileId: 'profile', vendorId: 'vendor', postKind: 'TEXT', status: 'published', visibility: 'public',
      publishedAt: '2026-07-22T10:00:00.000Z', createdAt: '2026-07-22T10:00:00.000Z',
    }
    expect(rankFeedCandidates([candidate, candidate], { role: 'customer' }).items).toHaveLength(1)
  })
})
