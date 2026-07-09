import { describe, expect, it } from 'vitest'
import { computeVendorRanking } from './vendor-ranking'

describe('computeVendorRanking', () => {
  it('rewards vendors with strong sales and strong reviews', () => {
    const top = computeVendorRanking({
      completedOrders30d: 32,
      cancelledOrders30d: 2,
      averageRating: 4.8,
      totalRatings: 26,
      averagePrepMinutes: 19,
    })

    const weaker = computeVendorRanking({
      completedOrders30d: 18,
      cancelledOrders30d: 4,
      averageRating: 3.9,
      totalRatings: 8,
      averagePrepMinutes: 33,
    })

    expect(top.compositeScore).toBeGreaterThan(weaker.compositeScore)
    expect(top.visibilityTier).toBe('TOP')
  })

  it('penalizes high cancellation rates even with some sales', () => {
    const result = computeVendorRanking({
      completedOrders30d: 9,
      cancelledOrders30d: 7,
      averageRating: 4.5,
      totalRatings: 14,
      averagePrepMinutes: 24,
    })

    expect(result.visibilityTier).toBe('LOW')
  })

  it('does not over-reward a tiny sample of ratings', () => {
    const tinySample = computeVendorRanking({
      completedOrders30d: 6,
      cancelledOrders30d: 1,
      averageRating: 5,
      totalRatings: 1,
      averagePrepMinutes: 18,
    })
    const proven = computeVendorRanking({
      completedOrders30d: 6,
      cancelledOrders30d: 1,
      averageRating: 4.6,
      totalRatings: 18,
      averagePrepMinutes: 18,
    })

    expect(proven.compositeScore).toBeGreaterThan(tinySample.compositeScore)
  })
})
