import { describe, expect, it } from 'vitest'
import { rankFeedCandidates } from './ranking'

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
})
